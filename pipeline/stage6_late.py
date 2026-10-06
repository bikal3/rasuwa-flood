"""Stage 6 -- the post-monsoon optical check on stage 2's detections.

    python pipeline/stage6_late.py

Stage 2 ran on a pre/post pair with 15% usable optical coverage, so most of its
mask is radar evidence with no optical opinion either way, and one zone (Z2b
Ghattekhola, 7.1% usable) rests on the radar almost entirely. This stage brings
the first clear view of the study area -- the end-of-September monsoon
withdrawal, see S2_LATE -- and asks whether the ground stage 2 flagged still
looks changed five weeks later.

It is a test, not a re-run. The gap contains more monsoon, the start of
recovery and ordinary vegetation phenology, so late optical change cannot be
attributed to 26 August. What it can do is say whether the change is there at
all, which is the question the cloud left open. Nothing here feeds back into the
damage mask, and stages 1-5 do not read anything this writes.

Confirmation is only meaningful against a base rate, so every rate below is
reported beside the rate on ground stage 2 did *not* flag. A detector whose
"confirmations" match the far field has confirmed nothing.

Two asymmetries to carry into any reading of the numbers:

- A confirmation rate is a floor on the true positives, not an estimate of them.
  Ground that was stripped on 26 August and has since revegetated, been cleared
  or been rebuilt reads as unconfirmed, and five weeks of post-monsoon growing
  season is long enough for that on a vegetated deposit.
- The late pair is in practice a dNDVI test. The scene-wide dMNDWI offset is
  negative here -- the rivers are lower in October than in August -- so "new
  water" almost never clears its threshold against a monsoon pre-window. Of the
  5,607 confirmed pixels inside the stage 3 damage, 67 are dMNDWI alone.

Reads   data/raster/s2_pre.tif, s2_late.tif        (stage 1)
        data/derived/change_stack.tif              (stage 2, for the event pair)
        data/derived/damage_mask.tif               (stage 2)
        data/derived/flood_damage.tif, terrain.tif (stage 3)
        data/vector/zones.shp                      (stage 1)

Writes  data/tables/late_optical.csv   per zone, and the ROI totals
        maps/10_late_optical.png      late dNDVI
        maps/11_late_confirmation.png where the check passes, fails, or abstains
"""

import sys

import geopandas as gpd
import matplotlib
import numpy as np
import pandas as pd
import rasterio
from matplotlib import pyplot as plt

import config as cfg
import stage2_analysis as s2

# Stage 2's own index and debias functions, not copies of them: two definitions
# of dNDVI that could drift apart is the one way this check could quietly stop
# testing what stage 2 actually did.
FAR_FIELD_M = 500.0     # HAND beyond which stage 3's change rate has decayed


def late_change(pre, late):
    """-> (changed, pair_valid, offsets). The optical half of damage_mask().

    Same two indices and the same thresholds stage 2 applied to the event pair,
    so a pixel "confirms" only on the evidence that would have flagged it then.
    No radar: there is no late SAR pair here, and the point of the exercise is
    to get an optical opinion where the radar was alone.
    """
    a, b = s2.indices(pre), s2.indices(late)
    dndvi, off_v = s2.debias(a["NDVI"] - b["NDVI"])      # + = vegetation loss
    dmndwi, off_w = s2.debias(b["MNDWI"] - a["MNDWI"])   # + = new water
    with np.errstate(invalid="ignore"):
        changed = (dndvi > cfg.T_DNDVI) | (dmndwi > cfg.T_DMNDWI)
    return (np.where(np.isfinite(dndvi), changed, False),
            np.isfinite(dndvi),
            {"dNDVI": off_v, "dMNDWI": off_w, "dndvi_arr": dndvi})


def rate(changed, pair, sel):
    """-> (n_with_a_late_pair, confirmed_pct). None where nothing is comparable.

    Restricted to pixels that have a valid pre/late pair: scoring a pixel the
    late scene could not see as "unconfirmed" would charge the cloud to the
    detector.
    """
    both = sel & pair
    n = int(both.sum())
    return n, (round(100 * float(changed[both].mean()), 1) if n else None)


def main():
    need = [cfg.RASTER / "s2_pre.tif", cfg.RASTER / "s2_late.tif",
            cfg.DERIVED / "damage_mask.tif", cfg.DERIVED / "change_stack.tif",
            cfg.DERIVED / "flood_damage.tif", cfg.DERIVED / "terrain.tif"]
    missing = [p.name for p in need if not p.exists()]
    if missing:
        sys.exit(f"Missing {missing}. Run stages 1-3 first "
                 "(s2_late.tif needs stage 1 re-run after S2_LATE was added).")

    pre, prof = s2.read_stack(cfg.RASTER / "s2_pre.tif")
    late, _ = s2.read_stack(cfg.RASTER / "s2_late.tif")
    ch, _ = s2.read_stack(cfg.DERIVED / "change_stack.tif")
    with rasterio.open(cfg.DERIVED / "damage_mask.tif") as src:
        det = src.read(1).astype(bool)
    with rasterio.open(cfg.DERIVED / "flood_damage.tif") as src:
        flood = src.read(1).astype(bool)
    with rasterio.open(cfg.DERIVED / "terrain.tif") as src:
        hand = src.read(4)
        hs = s2.hillshade(src.read(1), abs(src.transform.a))
    zones = gpd.read_file(cfg.VECTOR / "zones.shp")

    changed, pair, off = late_change(pre, late)
    dndvi_late = off.pop("dndvi_arr")
    print(f"Late optical pair {cfg.S2_LATE[0]}..{cfg.S2_LATE[1]}")
    print("  scene offsets removed: "
          + ", ".join(f"{k} {v:+.3f}" for k, v in off.items())
          + "   <- five weeks of phenology is in here, not just haze")

    # Coverage: the number this whole stage exists to move.
    event_pair = np.isfinite(ch["dNDVI"])
    roi_cells = det.size
    print(f"\nOptical coverage of the {roi_cells * (cfg.SCALE ** 2) / 1e6:.0f} km² grid")
    print(f"  event pair {cfg.S2_POST[0]}..{cfg.S2_POST[1]}  "
          f"{100 * event_pair.mean():5.1f}%")
    print(f"  late pair  {cfg.S2_LATE[0]}..{cfg.S2_LATE[1]}  "
          f"{100 * pair.mean():5.1f}%")

    # What stage 2 had optical support for at the time, and what it did not.
    with np.errstate(invalid="ignore"):
        spectral_then = np.where(
            event_pair,
            (ch["dNDVI"] > cfg.T_DNDVI) | (ch["dMNDWI"] > cfg.T_DMNDWI), False)
    sar_only = det & ~spectral_then
    far = hand > FAR_FIELD_M

    groups = [
        ("stage 3 flood damage", flood),
        ("  of it, optical at the time", flood & spectral_then),
        ("  of it, radar alone", flood & sar_only),
        ("stage 2 change, whole ROI", det),
        ("  of it, radar alone", det & sar_only),
        (f"unflagged ground, HAND <= {cfg.HAND_MAX_M:.0f} m", ~det & (hand <= cfg.HAND_MAX_M)),
        ("unflagged ground, far field", ~det & far),
    ]
    print("\nDoes the late optical pair still see change there?")
    print(f"  {'group':34s} {'px with late pair':>18s} {'confirmed':>10s}")
    base = None
    for name, sel in groups:
        n, pct = rate(changed, pair, sel)
        if name.endswith("far field"):
            base = pct
        print(f"  {name:34s} {n:18,d} {('—' if pct is None else f'{pct:.1f}%'):>10s}")
    print(f"\n  far-field base rate {base:.1f}%: the share of untouched ground the"
          f" same\n  thresholds call changed over five weeks. Read every rate above"
          " against it.")

    # Per zone. Z2b is the reason this stage exists: 7.1% optical coverage in
    # the event window means its stage 2 figure is a radar figure.
    ids = s2.zone_ids(zones, prof["transform"], det.shape)
    rows = []
    for i, z in enumerate(zones.itertuples(), start=1):
        sel = ids == i
        if not sel.any():
            rows.append({"zone_id": z.zone_id, "label": z.label,
                         "note": "outside raster"})
            continue
        n_det, pct_det = rate(changed, pair, sel & det)
        rows.append({
            "zone_id": z.zone_id,
            "label": z.label,
            "optical_valid_event_pct": round(100 * event_pair[sel].mean(), 1),
            "optical_valid_late_pct": round(100 * pair[sel].mean(), 1),
            "detected_px_with_late_pair": n_det,
            "detected_confirmed_pct": pct_det,
            "unflagged_confirmed_pct": rate(changed, pair, sel & ~det)[1],
            "note": "",
        })
    table = pd.DataFrame(rows)
    roi_row = {
        "zone_id": "ROI", "label": "whole study rectangle",
        "optical_valid_event_pct": round(100 * event_pair.mean(), 1),
        "optical_valid_late_pct": round(100 * pair.mean(), 1),
        "detected_px_with_late_pair": rate(changed, pair, det)[0],
        "detected_confirmed_pct": rate(changed, pair, det)[1],
        "unflagged_confirmed_pct": rate(changed, pair, ~det)[1],
        "note": "",
    }
    table = pd.concat([table, pd.DataFrame([roi_row])], ignore_index=True)
    table.to_csv(cfg.TABLES / "late_optical.csv", index=False)
    print("\n" + table.to_string(index=False))

    # Plates.
    extent = rasterio.plot.plotting_extent(
        rasterio.open(cfg.DERIVED / "damage_mask.tif"))
    s2.map_diverging(
        dndvi_late, zones, extent,
        "Post-monsoon vegetation and surface change",
        f"dNDVI, {cfg.S2_PRE[0]} to {cfg.S2_LATE[1]}. Grey = no clear view in "
        "either window. Five weeks after the flood: persistence, not cause.",
        "dNDVI (pre − late)", cfg.MAPS / "10_late_optical.png", vmax=0.6)
    map_confirmation(flood, changed, pair, hs, zones, extent)
    print(f"\nDone. late_optical.csv in {cfg.TABLES}, two plates in {cfg.MAPS}")


def map_confirmation(flood, changed, pair, hs, zones, extent):
    """Where the late pair agrees with stage 3, disagrees, or cannot say.

    Three categories over the hillshade rather than a continuous field: the
    question is categorical, and the abstentions are part of the answer -- a
    reader needs to see how much of the corridor has no clear view even now.
    """
    cat = np.zeros(flood.shape, dtype="int8")          # 0 = not flood damage
    cat[flood & ~pair] = 1                             # no late view
    cat[flood & pair & ~changed] = 2                   # late pair sees nothing
    cat[flood & pair & changed] = 3                    # still changed
    colours = [cfg.MUTED, cfg.SERIES_1, cfg.CRITICAL]

    fig, ax = plt.subplots(figsize=(8.5, 8), facecolor=cfg.SURFACE)
    ax.imshow(hs, extent=extent, cmap="Greys_r", vmin=0, vmax=1.6)
    for v, colour in zip((1, 2, 3), colours):
        overlay = np.zeros((*cat.shape, 4))
        overlay[cat == v] = matplotlib.colors.to_rgba(colour, 0.9)
        ax.imshow(overlay, extent=extent)
    s2._zones(ax, zones)
    ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
    s2._frame(ax, "Stage 3 flood damage against the post-monsoon view",
              f"{cfg.S2_LATE[0]} to {cfg.S2_LATE[1]}, the same thresholds the "
              "event pair was given, over SRTM hillshade")
    labels = [(3, cfg.CRITICAL, "Still changed"),
              (2, cfg.SERIES_1, "No longer changed"),
              (1, cfg.MUTED, "No clear late view")]
    for v, colour, label in labels:
        ax.scatter([], [], marker="s", s=60, color=colour,
                   label=f"{label} ({int((cat == v).sum()):,} px)")
    leg = ax.legend(loc="lower left", frameon=True, fontsize=8.5)
    leg.get_frame().set_edgecolor(cfg.GRID); leg.get_frame().set_facecolor(cfg.SURFACE)
    s2._save(fig, cfg.MAPS / "11_late_confirmation.png")


if __name__ == "__main__":
    main()
