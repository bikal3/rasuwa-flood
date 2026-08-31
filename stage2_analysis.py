"""Stage 2 -- analysis in Python on stage 1's files.

    python stage2_analysis.py

Reads data/raster/*.tif and data/vector/zones.shp, writes:
    data/derived/change_stack.tif     dNDVI dMNDWI dNBR dVV dVH
    data/derived/damage_mask.tif      uint8, 1 = changed
    data/derived/damage_polygons.shp|.geojson   with area_m2
    data/tables/zonal_damage.csv
    maps/*.png

The derived rasters and polygons are ordinary GeoTIFF/Shapefile, so they load
into ArcGIS Pro next to the stage 1 layers.
"""

import sys

import geopandas as gpd
import matplotlib
import numpy as np
import pandas as pd
import rasterio

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm
from rasterio import features
from rasterio.plot import plotting_extent
from shapely.geometry import shape

import config as cfg

DIVERGING_CMAP = LinearSegmentedColormap.from_list("cool_warm", cfg.DIVERGING)
# Cloud gaps must not read as "no change" -- they sit next to the neutral midpoint.
DIVERGING_CMAP.set_bad("#cfcec8")


# --- Raster IO --------------------------------------------------------------

def read_stack(path):
    """-> ({band_name: float32 array with NaN nodata}, rasterio profile)"""
    with rasterio.open(path) as src:
        arr = src.read(masked=True).astype("float32").filled(np.nan)
        names = [d or f"b{i}" for i, d in enumerate(src.descriptions, start=1)]
        return dict(zip(names, arr)), src.profile


def write_stack(bands, ref, path):
    profile = cfg.gtiff_profile(ref, len(bands), "float32", cfg.NODATA)
    with rasterio.open(path, "w", **profile) as dst:
        for i, (name, a) in enumerate(bands.items(), start=1):
            dst.write(np.nan_to_num(a, nan=cfg.NODATA), i)
            dst.set_band_description(i, name)


# --- Change detection (proposal sections 3.2 and 5) -------------------------

def nd(a, b):
    """Normalized difference, NaN-safe."""
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (a - b) / (a + b)
    return np.where(np.isfinite(out), out, np.nan)


def indices(s2):
    return {
        "NDVI": nd(s2["B8"], s2["B4"]),
        "MNDWI": nd(s2["B3"], s2["B11"]),
        "NDWI": nd(s2["B3"], s2["B8"]),
        "NBR": nd(s2["B8"], s2["B12"]),
    }


def change(s2_pre, s2_post, s1_pre, s1_post):
    pre, post = indices(s2_pre), indices(s2_post)
    # S1_GRD is already sigma0 in dB, so post - pre IS 10*log10(post/pre).
    return {
        "dNDVI": pre["NDVI"] - post["NDVI"],      # + = vegetation loss / burial
        "dMNDWI": post["MNDWI"] - pre["MNDWI"],   # + = new water
        "dNBR": pre["NBR"] - post["NBR"],         # + = surface scouring
        "dVV": s1_post["VV"] - s1_pre["VV"],
        "dVH": s1_post["VH"] - s1_pre["VH"],
    }


def damage_mask(ch):
    """Spectral thresholds OR a SAR backscatter swing.

    Either channel alone is enough: under monsoon cloud the optical pair can be
    largely NaN, and NaN comparisons are False, so the SAR carries those pixels.
    """
    spectral = (ch["dNDVI"] > cfg.T_DNDVI) | (ch["dMNDWI"] > cfg.T_DMNDWI)
    sar = np.abs(ch["dVV"]) > cfg.T_DSAR_DB
    return spectral | sar


def vectorize(mask, transform, crs, pixel_area, min_pixels=cfg.MIN_POLY_PIXELS):
    m = mask.astype("uint8")
    polys = [
        shape(geom)
        for geom, val in features.shapes(m, mask=m.astype(bool), transform=transform)
        if val == 1
    ]
    gdf = gpd.GeoDataFrame(geometry=polys, crs=crs)
    if len(gdf) == 0:
        gdf["area_m2"] = []
        return gdf
    gdf["area_m2"] = gdf.area
    return gdf[gdf["area_m2"] >= min_pixels * pixel_area].reset_index(drop=True)


def zonal(mask, ch, zones, transform, shape_, pixel_area):
    ids = features.rasterize(
        ((g, i) for i, g in enumerate(zones.geometry, start=1)),
        out_shape=shape_, transform=transform, fill=0, dtype="int32",
    )
    rows = []
    for i, z in enumerate(zones.itertuples(), start=1):
        sel = ids == i
        n = int(sel.sum())
        if n == 0:
            rows.append({"zone_id": z.zone_id, "label": z.label, "note": "outside raster"})
            continue
        dmg = int((mask & sel).sum())
        with np.errstate(invalid="ignore"):
            rows.append({
                "zone_id": z.zone_id,
                "label": z.label,
                "zone_km2": round(n * pixel_area / 1e6, 3),
                "damaged_km2": round(dmg * pixel_area / 1e6, 3),
                "damaged_pct": round(100 * dmg / n, 1),
                "optical_valid_pct": round(100 * np.isfinite(ch["dNDVI"][sel]).mean(), 1),
                "mean_dNDVI": round(float(np.nanmean(ch["dNDVI"][sel])), 3),
                "mean_dVV_dB": round(float(np.nanmean(ch["dVV"][sel])), 2),
                "note": "",
            })
    return pd.DataFrame(rows)


# --- Terrain ----------------------------------------------------------------

def hillshade(dem, res, azimuth=315.0, altitude=45.0):
    dy, dx = np.gradient(np.nan_to_num(dem, nan=float(np.nanmedian(dem))), res)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = np.radians(360.0 - azimuth + 90.0), np.radians(altitude)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


# --- Maps -------------------------------------------------------------------

def _frame(ax, title, subtitle=""):
    ax.set_title(title, color=cfg.INK, fontsize=11, loc="left",
                 pad=26 if subtitle else 12)
    if subtitle:
        ax.text(0, 1.004, subtitle, transform=ax.transAxes, color=cfg.MUTED,
                fontsize=8.5, va="bottom")
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_edgecolor(cfg.GRID)


def _zones(ax, zones):
    zones.boundary.plot(ax=ax, color=cfg.INK, linewidth=0.8, alpha=0.65)
    for z in zones.itertuples():
        c = z.geometry.centroid
        ax.annotate(z.zone_id, (c.x, c.y), color=cfg.INK, fontsize=7.5,
                    ha="center", va="center",
                    bbox=dict(boxstyle="round,pad=0.2", fc=cfg.SURFACE, ec="none", alpha=0.85))


def stretch(a, lo=2, hi=98):
    v = a[np.isfinite(a)]
    if v.size == 0:
        return np.zeros_like(a)
    p1, p2 = np.percentile(v, [lo, hi])
    return np.clip((a - p1) / (p2 - p1 + 1e-9), 0, 1)


def rgb(s2):
    return np.nan_to_num(np.dstack([stretch(s2[b]) for b in ("B4", "B3", "B2")]))


def map_rgb(s2_pre, s2_post, zones, extent, out):
    fig, axes = plt.subplots(1, 2, figsize=(13, 7), facecolor=cfg.SURFACE)
    for ax, img, when in zip(axes, (rgb(s2_pre), rgb(s2_post)), ("Pre-event", "Post-event")):
        ax.imshow(img, extent=extent)
        _zones(ax, zones)
        ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
        _frame(ax, f"{when} true colour", "Sentinel-2 L2A, cloud-masked median")
    fig.suptitle("Rasuwa corridor before and after 26 Aug 2026", color=cfg.INK,
                 fontsize=13, x=0.09, ha="left", y=0.97)
    _save(fig, out)


def map_diverging(arr, zones, extent, title, subtitle, label, out, vmax=None):
    finite = arr[np.isfinite(arr)]
    if vmax is None:
        vmax = float(np.percentile(np.abs(finite), 98)) if finite.size else 1.0
    vmax = max(vmax, 1e-6)
    gaps = 100.0 * (1.0 - finite.size / arr.size)
    if gaps > 0.5:
        subtitle += f"  ·  grey = no data ({gaps:.0f}%)"
    fig, ax = plt.subplots(figsize=(8.5, 8), facecolor=cfg.SURFACE)
    im = ax.imshow(arr, extent=extent, cmap=DIVERGING_CMAP,
                   norm=TwoSlopeNorm(vcenter=0.0, vmin=-vmax, vmax=vmax))
    _zones(ax, zones)
    ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
    _frame(ax, title, subtitle)
    cb = fig.colorbar(im, ax=ax, fraction=0.036, pad=0.02)
    cb.set_label(label, color=cfg.INK_2, fontsize=9)
    cb.outline.set_edgecolor(cfg.GRID)
    cb.ax.tick_params(colors=cfg.MUTED, labelsize=8)
    _save(fig, out)


def map_damage(mask, hs, zones, extent, out):
    fig, ax = plt.subplots(figsize=(8.5, 8), facecolor=cfg.SURFACE)
    ax.imshow(hs, extent=extent, cmap="Greys_r", vmin=0, vmax=1.6)
    overlay = np.zeros((*mask.shape, 4))
    overlay[mask] = matplotlib.colors.to_rgba(cfg.CRITICAL, 0.85)
    ax.imshow(overlay, extent=extent)
    _zones(ax, zones)
    ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
    _frame(ax, "Detected surface change",
           f"dNDVI > {cfg.T_DNDVI} or dMNDWI > {cfg.T_DMNDWI} or |dVV| > {cfg.T_DSAR_DB} dB, "
           "over SRTM hillshade")
    ax.scatter([], [], marker="s", s=60, color=cfg.CRITICAL, label="Changed surface")
    leg = ax.legend(loc="lower left", frameon=True, fontsize=8.5)
    leg.get_frame().set_edgecolor(cfg.GRID); leg.get_frame().set_facecolor(cfg.SURFACE)
    _save(fig, out)


def chart_zones(table, out):
    df = table[table["note"] == ""].sort_values("damaged_km2")
    if df.empty:
        return
    fig, ax = plt.subplots(figsize=(8.5, 0.62 * len(df) + 2.2), facecolor=cfg.SURFACE)
    ax.barh(df["zone_id"] + "  " + df["label"], df["damaged_km2"],
            height=0.55, color=cfg.SERIES_1)
    for y, (v, pct) in enumerate(zip(df["damaged_km2"], df["damaged_pct"])):
        ax.annotate(f"{v:.2f} km²  ({pct:.0f}%)", (v, y), xytext=(6, 0),
                    textcoords="offset points", va="center", fontsize=8.5, color=cfg.INK_2)
    ax.set_xlim(0, df["damaged_km2"].max() * 1.32)
    ax.set_xlabel("Changed surface area (km²)", color=cfg.INK_2, fontsize=9)
    ax.set_title("Changed surface by impact zone", color=cfg.INK, fontsize=11, loc="left", pad=14)
    ax.xaxis.grid(True, color=cfg.GRID, linewidth=0.7)
    ax.set_axisbelow(True)
    ax.tick_params(colors=cfg.MUTED, labelsize=8.5)
    for side in ("top", "right", "bottom"):
        ax.spines[side].set_visible(False)
    ax.spines["left"].set_color(cfg.GRID)
    _save(fig, out)


def _save(fig, out):
    fig.tight_layout()
    fig.savefig(out, dpi=170, facecolor=cfg.SURFACE, bbox_inches="tight")
    plt.close(fig)
    print(f"  {out.name}")


# --- Main -------------------------------------------------------------------

def main():
    cfg.ensure_dirs()
    missing = [n for n in ("s2_pre", "s2_post", "s1_pre", "s1_post", "dem")
               if not (cfg.RASTER / f"{n}.tif").exists()]
    if missing:
        sys.exit(f"Missing {missing} in {cfg.RASTER}. Run stage1_export.py first.")

    s2_pre, profile = read_stack(cfg.RASTER / "s2_pre.tif")
    s2_post, _ = read_stack(cfg.RASTER / "s2_post.tif")
    s1_pre, _ = read_stack(cfg.RASTER / "s1_pre.tif")
    s1_post, _ = read_stack(cfg.RASTER / "s1_post.tif")
    dem, _ = read_stack(cfg.RASTER / "dem.tif")

    shape_ = (profile["height"], profile["width"])
    transform = profile["transform"]
    pixel_area = abs(transform.a * transform.e)
    extent = plotting_extent(np.zeros(shape_), transform)
    zones = gpd.read_file(cfg.VECTOR / "zones.shp").to_crs(profile["crs"])

    print("Change detection")
    ch = change(s2_pre, s2_post, s1_pre, s1_post)
    mask = damage_mask(ch)
    write_stack(ch, profile, cfg.DERIVED / "change_stack.tif")

    with rasterio.open(cfg.DERIVED / "damage_mask.tif", "w",
                       **cfg.gtiff_profile(profile, 1, "uint8", 0)) as dst:
        dst.write(mask.astype("uint8"), 1)
        dst.set_band_description(1, "damage")

    polys = vectorize(mask, transform, profile["crs"], pixel_area)
    polys.to_file(cfg.DERIVED / "damage_polygons.shp")
    polys.to_crs("EPSG:4326").to_file(cfg.DERIVED / "damage_polygons.geojson", driver="GeoJSON")

    table = zonal(mask, ch, zones, transform, shape_, pixel_area)
    table.to_csv(cfg.TABLES / "zonal_damage.csv", index=False)

    total_km2 = mask.sum() * pixel_area / 1e6
    optical = 100 * np.isfinite(ch["dNDVI"]).mean()
    print(f"  changed surface: {total_km2:.2f} km²  in {len(polys)} polygons")
    print(f"  usable optical pixels: {optical:.1f}%  (rest is cloud -- SAR only)")
    print(table.to_string(index=False))

    print("Maps")
    hs = hillshade(dem["elevation"], abs(transform.a)) if dem["elevation"].shape == shape_ \
        else np.full(shape_, 0.8)
    map_rgb(s2_pre, s2_post, zones, extent, cfg.MAPS / "01_rgb_pre_post.png")
    map_diverging(ch["dNDVI"], zones, extent, "Vegetation change (dNDVI)",
                  "Sentinel-2, positive = vegetation removed or buried",
                  "NDVI pre − post", cfg.MAPS / "02_dndvi.png")
    map_diverging(ch["dMNDWI"], zones, extent, "Water change (dMNDWI)",
                  "Sentinel-2, positive = new standing or turbid water",
                  "MNDWI post − pre", cfg.MAPS / "03_dmndwi.png")
    map_diverging(ch["dVV"], zones, extent, "SAR backscatter change (Δσ⁰ VV)",
                  "Sentinel-1 C-band, same relative orbit, cloud-independent",
                  "dB post − pre", cfg.MAPS / "04_dvv_sar.png")
    map_damage(mask, hs, zones, extent, cfg.MAPS / "05_damage.png")
    chart_zones(table, cfg.MAPS / "06_zonal_damage.png")

    print(f"\nDone. Tables in {cfg.TABLES}, maps in {cfg.MAPS}, "
          f"ArcGIS-ready layers in {cfg.DERIVED}")


if __name__ == "__main__":
    main()
