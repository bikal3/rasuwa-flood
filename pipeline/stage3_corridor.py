"""Stage 3 -- confine the change to the flood corridor.

    python pipeline/stage3_corridor.py

Stage 2 applies the proposal's thresholds everywhere in the ROI, so a hillslope
landslide, a harvested terrace and a shifted cloud edge all score the same as the
debris flood. A debris flood cannot do that: it is confined to ground the river
can reach. Stage 3 derives that ground from the DEM and intersects it with stage
2's mask.

Reads   data/raster/dem.tif, data/vector/zones.shp    (stage 1)
        -- the DEM covers ROI + DEM_PAD_KM; flow is routed over all of it
           and every result is cut back to the analysis grid
        data/derived/damage_mask.tif                 (stage 2)

Writes  data/derived/terrain.tif              filled_dem, fill_m, drainage_km2, hand_m
        data/derived/channel.shp|.geojson     the drainage network
        data/derived/corridor.shp|.geojson    the valley floor, HAND <= threshold
        data/derived/flood_damage.tif         uint8, stage 2 mask AND corridor
        data/derived/flood_damage_polygons.shp|.geojson
        data/tables/zonal_flood.csv
        data/tables/change_vs_hand.csv
        maps/07_corridor.png
        maps/08_flood_damage.png
        maps/09_change_vs_hand.png

HAND (Height Above Nearest Drainage) is the elevation of a cell above whichever
drainage cell its own flow path first reaches. It is the standard way to say
"reachable by the river" without running a hydraulic model, and terrain.tif is
also the surface HEC-RAS wants for proposal section 6.2.
"""

import math
import sys

import geopandas as gpd
import matplotlib
import numpy as np
import pandas as pd
import rasterio

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from heapq import heapify, heappop, heappush
from rasterio.plot import plotting_extent
from scipy.ndimage import binary_erosion

import config as cfg
import stage2_analysis as s2

DIAG = math.sqrt(2.0)


# --- Flow routing -----------------------------------------------------------
#
# Everything below runs on a 1-cell invalid border (see `pad`), so a neighbour
# offset computed on the flat index can never wrap from column 0 of one row onto
# column w-1 of the row above: the wrap always lands on a border cell, which is
# invalid and therefore rejected. That removes every bounds check from the hot
# loops, which is what makes plain Python fast enough here (~3 s for 2.5M cells).

def pad(a, fill):
    return np.pad(a, 1, constant_values=fill)


def unpad(a):
    return a[1:-1, 1:-1]


def _offsets(w):
    """8-neighbour flat-index offsets and their step lengths in cell widths."""
    return ((-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1),
            (DIAG, 1.0, DIAG, 1.0, 1.0, DIAG, 1.0, DIAG))


def fill_pits(elev, valid, eps=1e-3):
    """Priority-flood depression fill (Barnes, Lehman & Mulla 2014).

    SRTM in a gorge is full of small noise pits. Left in, D8 flow terminates at
    every one of them and the drainage network shatters into disconnected
    fragments, so no trunk river ever forms and HAND is meaningless. Flooding
    inward from the domain edge, always from the lowest cell seen so far, raises
    each pit to its spill elevation.

    `eps` adds a monotonic downhill gradient across the filled flats, which is
    what guarantees every non-outlet cell has a strictly lower neighbour -- the
    property `d8` and `height_above_drainage` both rely on.
    """
    h, w = elev.shape
    # Python lists, not arrays: this loop touches ~20M scalars and numpy scalar
    # indexing is several times slower than list indexing.
    filled = np.where(valid, elev, np.inf).ravel().tolist()
    seen = (~valid).ravel().tolist()
    # Seeds are the valid cells touching invalid ground -- the domain rim.
    seeds = np.flatnonzero(
        (valid & ~binary_erosion(valid, np.ones((3, 3), bool))).ravel()
    ).tolist()
    for i in seeds:
        seen[i] = True
    heap = [(filled[i], i) for i in seeds]
    heapify(heap)

    off, _ = _offsets(w)
    while heap:
        level, i = heappop(heap)
        for d in off:
            j = i + d
            if not seen[j]:
                seen[j] = True
                v = filled[j] if filled[j] > level else level + eps
                filled[j] = v
                heappush(heap, (v, j))
    return np.where(valid, np.array(filled, dtype="float64").reshape(h, w), np.nan)


def d8(filled, valid):
    """Steepest-descent flow. -> (receiver flat index, ascending-elevation order)

    A cell with no lower neighbour is an outlet and receives itself. After
    `fill_pits` those are only the rim cells the fill drained towards.
    """
    h, w = filled.shape
    f = np.where(valid, filled, np.nan).ravel()
    idx = np.arange(f.size)
    recv, best = idx.copy(), np.zeros(f.size)
    for d, length in zip(*_offsets(w)):
        with np.errstate(invalid="ignore"):
            # np.roll wraps, but the invalid border makes every wrapped
            # comparison NaN, and NaN > best is False.
            drop = (f - np.roll(f, -d)) / length
            take = drop > best
        best = np.where(take, drop, best)
        recv = np.where(take, idx + d, recv)
    # NaN sorts last, so trimming to the valid count drops the invalid cells.
    order = np.argsort(f, kind="stable")[: int(valid.sum())]
    return recv, order


def accumulate(recv, order, valid):
    """Upstream cell count. Highest cell first, so every donor is added to its
    receiver before that receiver is itself passed on."""
    acc = valid.ravel().astype("float64").tolist()
    r = recv.tolist()
    for i in order[::-1].tolist():
        j = r[i]
        if j != i:
            acc[j] += acc[i]
    return np.array(acc).reshape(valid.shape)


def height_above_drainage(filled, recv, channel, order):
    """HAND: elevation above the first drainage cell downstream. -> array, m

    Lowest cell first. `filled` strictly decreases along a flow path, so a
    cell's receiver is always already resolved by the time the cell is reached.
    """
    ref = filled.ravel().tolist()
    r, ch = recv.tolist(), channel.ravel().tolist()
    for i in order.tolist():
        if not ch[i] and r[i] != i:
            ref[i] = ref[r[i]]
    return filled - np.array(ref).reshape(filled.shape)


def channel_steps(channel, recv, pixel):
    """Downstream step length of every channel cell, metres.

    Diagonal steps are sqrt(2) cells, so summing this over an area gives a real
    network length rather than a cell count -- which is what turns a scoured area
    into a mean swath width.
    """
    step = dict(zip(*_offsets(channel.shape[1])))
    ch = channel.ravel()
    out = np.zeros(ch.size)
    r = recv.tolist()
    for i in np.flatnonzero(ch).tolist():
        j = r[i]
        if j != i and ch[j]:
            out[i] = step[j - i] * pixel
    return out.reshape(channel.shape)


def corridor_from_dem(elev, pixel):
    """DEM -> the ground a river can reach. -> {name: unpadded array}"""
    e = pad(elev, np.nan)
    valid = np.isfinite(e) & (e >= cfg.DEM_MIN_M)
    print(f"  {int(valid.sum()):,} valid DEM cells "
          f"({100 * (1 - unpad(valid).mean()):.1f}% void or reprojection collar)")

    filled = fill_pits(e, valid)
    recv, order = d8(filled, valid)
    drainage = accumulate(recv, order, valid) * pixel * pixel / 1e6
    channel = drainage >= cfg.MIN_DRAINAGE_KM2
    hand = np.where(valid, height_above_drainage(filled, recv, channel, order), np.nan)
    with np.errstate(invalid="ignore"):
        corridor = hand <= cfg.HAND_MAX_M

    # How much conditioning each cell needed. Deliberately NOT used to exclude
    # anything: the tempting filter -- drop cells the fill had to raise, on the
    # grounds that a filled basin is a flat fake valley floor -- cuts 39% of the
    # trunk river out of this ROI, and the cells it cuts run at 7.4x the
    # far-field change rate against 4.2x for unfilled ground. They are the deep
    # narrow reaches where SRTM's C-band bridged across the gorge instead of
    # reaching the bottom, so the fill is reconstructing the valley floor rather
    # than inventing one. Carried as a band so the reconstruction stays visible,
    # which also matters if terrain.tif is used as a HEC-RAS surface.
    return {k: unpad(v) for k, v in (
        ("filled_dem", filled), ("fill_m", filled - e),
        ("drainage_km2", drainage), ("hand_m", hand),
        ("channel", channel), ("corridor", corridor),
        ("step_m", channel_steps(channel, recv, pixel)))}


# --- Is the corridor doing anything? ----------------------------------------

HAND_BANDS = (0, 5, 10, 20, 30, 50, 100, 200, 500, np.inf)


def hand_profile(hand, change):
    """Stage 2's change rate against height above drainage. -> (table, far-field rate)

    This is the evidence for the whole stage and the way to set HAND_MAX_M. If
    the detections were noise the rate would be flat with height; if the corridor
    is cut too tight, the band just above the threshold is still enriched.
    """
    valid = np.isfinite(hand)
    with np.errstate(invalid="ignore"):
        far = float(change[valid & (hand >= HAND_BANDS[-2])].mean())
    rows = []
    for lo, hi in zip(HAND_BANDS, HAND_BANDS[1:]):
        with np.errstate(invalid="ignore"):
            sel = valid & (hand >= lo) & (hand < hi)
        n = int(sel.sum())
        if not n:
            continue
        rate = float(change[sel].mean())
        rows.append({
            "hand_lo_m": lo, "hand_hi_m": hi,
            "roi_pct": round(100 * n / int(valid.sum()), 2),
            "change_pct": round(100 * rate, 2),
            "vs_far_field": round(rate / far, 2) if far else float("nan"),
        })
    return pd.DataFrame(rows), far


# --- Zonal ------------------------------------------------------------------

def zonal_flood(zones, ids, change, flood, t, pixel_area):
    corridor, step = t["corridor"], t["step_m"]
    rows = []
    for i, z in enumerate(zones.itertuples(), start=1):
        sel = ids == i
        n = int(sel.sum())
        if n == 0:
            rows.append({"zone_id": z.zone_id, "label": z.label, "note": "outside raster"})
            continue
        chg = int((change & sel).sum())
        fld = int((flood & sel).sum())
        # Mean width of the scoured swath: flood area spread along this zone's
        # channel. Section 4.1's "200-300% channel widening" is a claim about
        # this swath against the pre-event waterline, and only the swath is
        # measurable here -- see the README on why the waterline is not.
        length = float(step[sel].sum())
        rows.append({
            "zone_id": z.zone_id,
            "label": z.label,
            "zone_km2": round(n * pixel_area / 1e6, 3),
            "corridor_km2": round(int((corridor & sel).sum()) * pixel_area / 1e6, 3),
            "change_km2": round(chg * pixel_area / 1e6, 3),
            "flood_km2": round(fld * pixel_area / 1e6, 3),
            "off_corridor_pct": round(100 * (1 - fld / chg), 1) if chg else 0.0,
            "channel_len_m": round(length),
            "scour_width_m": round(fld * pixel_area / length, 1) if length else float("nan"),
            "note": "",
        })
    return pd.DataFrame(rows)


# --- Maps -------------------------------------------------------------------

def map_corridor(hand, channel, hs, zones, extent, out):
    fig, ax = plt.subplots(figsize=(8.5, 8), facecolor=cfg.SURFACE)
    ax.imshow(hs, extent=extent, cmap="Greys_r", vmin=0, vmax=1.7)
    with np.errstate(invalid="ignore"):
        band = np.ma.masked_invalid(np.where(hand <= cfg.HAND_MAX_M, hand, np.nan))
    im = ax.imshow(band, extent=extent, cmap="Blues_r", vmin=0, vmax=cfg.HAND_MAX_M,
                   alpha=0.85)
    net = np.zeros((*channel.shape, 4))
    net[channel] = matplotlib.colors.to_rgba(cfg.INK, 0.9)
    ax.imshow(net, extent=extent)
    s2._zones(ax, zones)
    ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
    s2._frame(ax, "Flood corridor from the DEM",
              f"valley floor within {cfg.HAND_MAX_M:.0f} m of a channel draining "
              f"≥ {cfg.MIN_DRAINAGE_KM2:.0f} km² (black)")
    cb = fig.colorbar(im, ax=ax, fraction=0.036, pad=0.02)
    cb.set_label("height above nearest drainage (m)", color=cfg.INK_2, fontsize=9)
    cb.outline.set_edgecolor(cfg.GRID)
    cb.ax.tick_params(colors=cfg.MUTED, labelsize=8)
    s2._save(fig, out)


def map_flood(change, flood, hs, zones, extent, out):
    fig, ax = plt.subplots(figsize=(8.5, 8), facecolor=cfg.SURFACE)
    # Washed-out hillshade and a blue/red split: the rejected layer has to read
    # against the terrain, and muted grey on a grey hillshade reads as nothing.
    ax.imshow(hs, extent=extent, cmap="Greys_r", vmin=-0.1, vmax=2.3)
    for mask, colour, alpha in ((change & ~flood, cfg.SERIES_1, 0.7),
                                (flood, cfg.CRITICAL, 0.95)):
        layer = np.zeros((*mask.shape, 4))
        layer[mask] = matplotlib.colors.to_rgba(colour, alpha)
        ax.imshow(layer, extent=extent)
    s2._zones(ax, zones)
    ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
    s2._frame(ax, "Change confined to the flood corridor",
              "stage 2 detections split by whether the river can reach them")
    for colour, label in ((cfg.CRITICAL, "In corridor — flood damage"),
                          (cfg.SERIES_1, "Off corridor — rejected")):
        ax.scatter([], [], marker="s", s=60, color=colour, label=label)
    leg = ax.legend(loc="lower left", frameon=True, fontsize=8.5)
    leg.get_frame().set_edgecolor(cfg.GRID); leg.get_frame().set_facecolor(cfg.SURFACE)
    s2._save(fig, out)


def chart_hand(profile, far, out):
    df = profile
    labels = [f"{lo:g}–{hi:g}" if np.isfinite(hi) else f"{lo:g}+"
              for lo, hi in zip(df["hand_lo_m"], df["hand_hi_m"])]
    inside = df["hand_hi_m"] <= cfg.HAND_MAX_M
    fig, ax = plt.subplots(figsize=(8.5, 4.8), facecolor=cfg.SURFACE)
    ax.bar(range(len(df)), df["change_pct"], width=0.62,
           color=np.where(inside, cfg.SERIES_1, cfg.MUTED))
    ax.axhline(100 * far, color=cfg.CRITICAL, linewidth=1.1, linestyle=(0, (4, 3)))
    ax.annotate(f"far-field rate {100 * far:.1f}%", (-0.45, 100 * far),
                xytext=(0, 5), textcoords="offset points", ha="left",
                fontsize=8.5, color=cfg.CRITICAL)
    for k, v in enumerate(df["change_pct"]):
        ax.annotate(f"{v:.1f}", (k, v), xytext=(0, 3), textcoords="offset points",
                    ha="center", fontsize=8, color=cfg.INK_2)
    ax.set_xticks(range(len(df)), labels)
    ax.set_xlabel("Height above nearest drainage (m)", color=cfg.INK_2, fontsize=9)
    ax.set_ylabel("Stage 2 change rate (%)", color=cfg.INK_2, fontsize=9)
    ax.set_title("Change rate falls with height above the river", color=cfg.INK,
                 fontsize=11, loc="left", pad=26)
    ax.text(0, 1.02, f"blue = inside the corridor (HAND ≤ {cfg.HAND_MAX_M:.0f} m). "
            "A flat profile would mean the detections are noise.",
            transform=ax.transAxes, color=cfg.MUTED, fontsize=8.5, va="bottom")
    ax.yaxis.grid(True, color=cfg.GRID, linewidth=0.7)
    ax.set_axisbelow(True)
    ax.tick_params(colors=cfg.MUTED, labelsize=8.5)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(cfg.GRID)
    s2._save(fig, out)


# --- Main -------------------------------------------------------------------

def main():
    cfg.ensure_dirs()
    need = [cfg.RASTER / "dem.tif", cfg.DERIVED / "damage_mask.tif"]
    missing = [p.name for p in need if not p.exists()]
    if missing:
        sys.exit(f"Missing {missing}. Run stage1_export.py then stage2_analysis.py first.")

    dem, dem_profile = s2.read_stack(cfg.RASTER / "dem.tif")
    # The analysis grid is the change mask's, not the DEM's: the DEM is wider
    # than the study area on purpose (DEM_PAD_KM) and everything written here has
    # to line up with what stage 2 produced.
    with rasterio.open(cfg.DERIVED / "damage_mask.tif") as src:
        change = src.read(1).astype(bool)
        profile = src.profile

    shape_ = (profile["height"], profile["width"])
    transform = profile["transform"]
    pixel = abs(transform.a)
    pixel_area = pixel * abs(transform.e)
    extent = plotting_extent(np.zeros(shape_), transform)
    zones = gpd.read_file(cfg.VECTOR / "zones.shp").to_crs(profile["crs"])
    crs = profile["crs"]

    print("Flow routing")
    # Route over the whole exported DEM, then cut every result back to the
    # analysis grid. Accumulation has no notion of what lies outside the raster,
    # so on an ROI-sized DEM the Bhote Koshi crosses the north edge carrying
    # zero and has to re-earn MIN_DRAINAGE_KM2 from local hillslopes before it
    # is a channel at all -- taking the corridor with it for the first few km,
    # which is Z1 Rasuwagadhi.
    win = s2.align(dem_profile, profile)
    pad_km = pixel / 1000 * min(win[0].start, win[1].start,
                                dem_profile["height"] - win[0].stop,
                                dem_profile["width"] - win[1].stop)
    if pad_km > 0:
        print(f"  DEM runs {pad_km:.0f} km past the analysis grid on its tightest side, "
              "so flow arrives already accumulated")
    else:
        # stage 1 skips a raster that is already on disk, so a DEM exported
        # before DEM_PAD_KM existed still works and still truncates. Say so.
        print("  note: this DEM has no pad, so accumulation restarts at the ROI "
              "edge and the first few km below it carry no channel. "
              "Delete data/raster/dem.tif and re-run stage 1.")
    t = {k: v[win] for k, v in corridor_from_dem(dem["elevation"], pixel).items()}
    channel, corridor = t["channel"], t["corridor"]
    print(f"  max drainage {t['drainage_km2'].max():,.0f} km²  ->  "
          f"{t['step_m'].sum() / 1000:,.0f} km of channel "
          f"at ≥ {cfg.MIN_DRAINAGE_KM2:.0f} km²")
    print(f"  corridor: {corridor.sum() * pixel_area / 1e6:,.1f} km² "
          f"({100 * corridor.mean():.1f}% of ROI) at HAND ≤ {cfg.HAND_MAX_M:.0f} m; "
          f"the fill reconstructed {100 * (t['fill_m'][corridor] > 1).mean():.0f}% of it")

    flood = change & corridor
    kept = 100 * flood.sum() / max(change.sum(), 1)
    print(f"  stage 2 change {change.sum() * pixel_area / 1e6:.2f} km²  ->  "
          f"flood damage {flood.sum() * pixel_area / 1e6:.2f} km²  "
          f"({kept:.0f}% kept, {100 - kept:.0f}% was off-corridor)")

    profile_df, far = hand_profile(t["hand_m"], change)
    profile_df.to_csv(cfg.TABLES / "change_vs_hand.csv", index=False)
    print(profile_df.to_string(index=False))
    # Every landform carries some false-positive rate. Charging the corridor the
    # far-field rate leaves what is actually attributable to the flood.
    in_rate = flood.sum() / max(corridor.sum(), 1)
    excess = max(in_rate - far, 0.0) * corridor.sum() * pixel_area / 1e6
    print(f"  corridor runs {in_rate / far:.1f}x the far-field change rate; "
          f"net of that floor, {excess:.2f} km² is attributable to the flood")

    print("Writing layers")
    s2.write_stack({k: t[k].astype("float32")
                    for k in ("filled_dem", "fill_m", "drainage_km2", "hand_m")},
                   profile, cfg.DERIVED / "terrain.tif")
    with rasterio.open(cfg.DERIVED / "flood_damage.tif", "w",
                       **cfg.gtiff_profile(profile, 1, "uint8", 0)) as dst:
        dst.write(flood.astype("uint8"), 1)
        dst.set_band_description(1, "flood_damage")

    for mask, name in ((channel, "channel"), (corridor, "corridor"),
                       (flood, "flood_damage_polygons")):
        gdf = s2.vectorize(mask, transform, crs, pixel_area)
        gdf.to_file(cfg.DERIVED / f"{name}.shp")
        gdf.to_crs("EPSG:4326").to_file(cfg.DERIVED / f"{name}.geojson", driver="GeoJSON")
        print(f"  {name}: {len(gdf)} features")

    ids = s2.zone_ids(zones, transform, shape_)
    table = zonal_flood(zones, ids, change, flood, t, pixel_area)
    table.to_csv(cfg.TABLES / "zonal_flood.csv", index=False)
    print(table.drop(columns=["label", "zone_km2"]).to_string(index=False))

    print("Maps")
    hs = s2.hillshade(dem["elevation"][win], pixel)
    map_corridor(t["hand_m"], channel, hs, zones, extent, cfg.MAPS / "07_corridor.png")
    map_flood(change, flood, hs, zones, extent, cfg.MAPS / "08_flood_damage.png")
    chart_hand(profile_df, far, cfg.MAPS / "09_change_vs_hand.png")

    print(f"\nDone. Corridor-confined layers in {cfg.DERIVED}, "
          f"table in {cfg.TABLES / 'zonal_flood.csv'}")


if __name__ == "__main__":
    main()
