"""Stage 1 -- data only.

Pulls the pre/post imagery and the study geometry to disk as plain GeoTIFF and
Shapefile/GeoJSON. Nothing here analyses anything: the point is that the outputs
drop straight into ArcGIS Pro (or QGIS, or stage 2).

    export EE_PROJECT=your-gcloud-project
    python pipeline/stage1_export.py

Outputs (all EPSG:32645, NODATA -9999):
    data/raster/s2_pre.tif     B2 B3 B4 B8 B11 B12, surface reflectance 0-1
    data/raster/s2_post.tif        "
    data/raster/s1_pre.tif     VV VH, sigma0 dB, single relative orbit
    data/raster/s1_post.tif        "
    data/raster/dem.tif        SRTM 1-arcsec elevation, m
    data/vector/aoi.shp|.geojson
    data/vector/zones.shp|.geojson
    data/raster/manifest.csv
"""

import sys
import tempfile
from pathlib import Path

import ee
import geopandas as gpd
import pandas as pd
import rasterio
import requests
from shapely.geometry import Point, box

import config as cfg


# --- Earth Engine collections ----------------------------------------------

def _roi():
    return ee.Geometry.Rectangle(cfg.ROI)


def s2_composite(start, end, masked=True):
    """Sentinel-2 L2A median, reflectance rescaled to 0-1.

    `masked=False` skips the per-pixel SCL mask and keeps every pixel the
    satellite returned, cloud included. Nothing in the analysis uses that -- it
    exists so the site's before/after slider can show what the mask removes,
    which on a monsoon week is most of the post-event frame.
    """
    def mask(img):
        keep = img.select("SCL").remap(cfg.SCL_KEEP, [1] * len(cfg.SCL_KEEP), 0)
        return img.updateMask(keep)

    coll = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(_roi())
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cfg.S2_MAX_CLOUD))
    )
    n = coll.size().getInfo()
    print(f"  Sentinel-2 {start}..{end}: {n} scenes")
    if n == 0:
        raise SystemExit(
            f"No Sentinel-2 scenes for {start}..{end}. Widen the window in "
            "config.py (monsoon cloud over Rasuwa is heavy) or lean on the SAR."
        )
    if masked:
        coll = coll.map(mask)
    return coll.select(cfg.S2_BANDS).median().divide(10000).clip(_roi())


def _s1(start, end, orbit=None):
    coll = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(_roi())
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    )
    if orbit is not None:
        coll = coll.filter(ee.Filter.eq("relativeOrbitNumber_start", orbit))
    return coll


def shared_orbit():
    """Pick one relative orbit present in both windows.

    Mixing orbits across a pre/post SAR pair is the classic way to manufacture
    fake change in steep terrain: the local incidence angle differs, so
    layover/shadow move and the ratio lights up on geometry rather than damage.
    """
    pre = set(_s1(*cfg.S1_PRE).aggregate_array("relativeOrbitNumber_start").getInfo())
    post = set(_s1(*cfg.S1_POST).aggregate_array("relativeOrbitNumber_start").getInfo())
    common = pre & post
    print(f"  Sentinel-1 orbits  pre={sorted(pre)}  post={sorted(post)}")
    if not common:
        raise SystemExit(
            "No Sentinel-1 relative orbit covers both windows. Widen S1_PRE in "
            "config.py (the 12-day repeat means you may need ~24 days)."
        )
    return max(common, key=lambda o: _s1(*cfg.S1_POST, o).size().getInfo())


def s1_composite(start, end, orbit):
    """Sentinel-1 GRD median, sigma0 dB. Already orthorectified by GEE."""
    coll = _s1(start, end, orbit)
    print(f"  Sentinel-1 {start}..{end} orbit {orbit}: {coll.size().getInfo()} scenes")
    return coll.select(cfg.S1_BANDS).median().clip(_roi())


# --- Download ---------------------------------------------------------------

def _fetch_band(image, band, dest):
    """One band -> one GeoTIFF. Per-band keeps every request under GEE's ~48 MB
    response cap, so SCALE=10 works without any chunking logic."""
    url = image.select(band).toFloat().unmask(cfg.NODATA).getDownloadURL(
        {"region": _roi(), "scale": cfg.SCALE, "crs": cfg.CRS, "format": "GEO_TIFF"}
    )
    for attempt in (1, 2):
        try:
            r = requests.get(url, timeout=900)
            r.raise_for_status()
            dest.write_bytes(r.content)
            return
        except requests.RequestException as e:
            if attempt == 2:
                raise
            print(f"    retrying {band} after {e}")


def download_stack(image, bands, out):
    """-> True if it fetched, False if the file was already there."""
    if out.exists():
        print(f"  {out.name} exists, skipping")
        return False
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for b in bands:
            p = Path(tmp) / f"{b}.tif"
            print(f"    {out.stem}:{b}", flush=True)
            _fetch_band(image, b, p)
            parts.append(p)

        with rasterio.open(parts[0]) as src:
            profile = cfg.gtiff_profile(src.profile, len(parts), "float32", cfg.NODATA)
            shape = src.shape
        with rasterio.open(out, "w", **profile) as dst:
            for i, (p, name) in enumerate(zip(parts, bands), start=1):
                with rasterio.open(p) as src:
                    if src.shape != shape:
                        raise SystemExit(f"band grid mismatch: {name} {src.shape} vs {shape}")
                    dst.write(src.read(1).astype("float32"), i)
                dst.set_band_description(i, name)
    print(f"  wrote {out.name}  ({out.stat().st_size / 1e6:.1f} MB)")
    return True


# --- Vector -----------------------------------------------------------------

def write_vectors():
    aoi = gpd.GeoDataFrame(
        {"name": ["Rasuwa corridor ROI"]}, geometry=[box(*cfg.ROI)], crs="EPSG:4326"
    )
    zones = gpd.GeoDataFrame(
        {
            "zone_id": [z[0] for z in cfg.ZONES],
            "label": [z[1] for z in cfg.ZONES],
            "radius_m": [z[4] for z in cfg.ZONES],
        },
        geometry=[Point(z[2], z[3]) for z in cfg.ZONES],
        crs="EPSG:4326",
    ).to_crs(cfg.CRS)
    zones["geometry"] = zones.buffer(zones["radius_m"])

    for name, gdf in (("aoi", aoi), ("zones", zones)):
        # Shapefile in the raster CRS (what ArcGIS Pro wants alongside the
        # GeoTIFFs); GeoJSON in WGS84 (portable / web).
        gdf.to_crs(cfg.CRS).to_file(cfg.VECTOR / f"{name}.shp")
        gdf.to_crs("EPSG:4326").to_file(cfg.VECTOR / f"{name}.geojson", driver="GeoJSON")
    print(f"  wrote aoi + zones ({len(zones)} zones)")

    outside = zones[~zones.to_crs("EPSG:4326").intersects(box(*cfg.ROI))]
    if len(outside):
        print(f"  note: {', '.join(outside.zone_id)} fall outside ROI -- widen ROI in config.py")


def read_manifest():
    """Rows from a previous run, keyed by filename.

    A skipped file was downloaded by some earlier run, under whatever parameters
    that run resolved -- and `shared_orbit()` in particular is data-dependent, so
    a later run can pick a different orbit while the cached file stays as it was.
    Rewriting its row from this run's parameters would describe the file as
    something it is not, silently, in the one place that records provenance.
    """
    path = cfg.RASTER / "manifest.csv"
    if not path.exists():
        return {}
    return {r["file"]: r for r in pd.read_csv(path).to_dict("records")}


def write_manifest(rows):
    pd.DataFrame(rows).to_csv(cfg.RASTER / "manifest.csv", index=False)
    print("  wrote manifest.csv")


# --- Main -------------------------------------------------------------------

def main():
    if not cfg.EE_PROJECT:
        sys.exit("Set EE_PROJECT (env var or config.py) to your Google Cloud project id.")
    ee.Initialize(project=cfg.EE_PROJECT)
    cfg.ensure_dirs()

    print("Sentinel-2")
    s2_pre = s2_composite(*cfg.S2_PRE)
    s2_post = s2_composite(*cfg.S2_POST)
    # The same composites with the cloud mask off. True colour only: these are
    # never analysed, they are the "before the filter" half of the slider.
    s2raw_pre = s2_composite(*cfg.S2_PRE, masked=False)
    s2raw_post = s2_composite(*cfg.S2_POST, masked=False)

    print("Sentinel-1")
    orbit = shared_orbit()
    print(f"  using relative orbit {orbit} for both windows")
    s1_pre = s1_composite(*cfg.S1_PRE, orbit)
    s1_post = s1_composite(*cfg.S1_POST, orbit)

    dem = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(_roi())

    print("Downloading")
    jobs = [
        ("s2_pre", s2_pre, cfg.S2_BANDS, "Sentinel-2 L2A", f"{cfg.S2_PRE[0]}..{cfg.S2_PRE[1]}"),
        ("s2_post", s2_post, cfg.S2_BANDS, "Sentinel-2 L2A", f"{cfg.S2_POST[0]}..{cfg.S2_POST[1]}"),
        ("s2raw_pre", s2raw_pre, cfg.S2_RGB, "Sentinel-2 L2A unmasked", f"{cfg.S2_PRE[0]}..{cfg.S2_PRE[1]}"),
        ("s2raw_post", s2raw_post, cfg.S2_RGB, "Sentinel-2 L2A unmasked", f"{cfg.S2_POST[0]}..{cfg.S2_POST[1]}"),
        ("s1_pre", s1_pre, cfg.S1_BANDS, f"Sentinel-1 GRD orbit {orbit}", f"{cfg.S1_PRE[0]}..{cfg.S1_PRE[1]}"),
        ("s1_post", s1_post, cfg.S1_BANDS, f"Sentinel-1 GRD orbit {orbit}", f"{cfg.S1_POST[0]}..{cfg.S1_POST[1]}"),
        ("dem", dem, ["elevation"], "SRTM GL1 v3", "baseline"),
    ]
    prior = read_manifest()
    rows = []
    for name, img, bands, source, window in jobs:
        out = cfg.RASTER / f"{name}.tif"
        fetched = download_stack(img, bands, out)
        if not fetched and out.name in prior:
            rows.append(prior[out.name])
            continue
        if not fetched:
            print(f"    warning: {out.name} predates the manifest; "
                  "its provenance below is this run's, not the one that wrote it")
        rows.append({
            "file": out.name, "bands": " ".join(bands), "source": source,
            "window": window, "crs": cfg.CRS, "pixel_m": cfg.SCALE, "nodata": cfg.NODATA,
        })

    print("Vectors")
    write_vectors()
    write_manifest(rows)
    print(f"\nDone. Add {cfg.DATA} to ArcGIS Pro, or run: python pipeline/stage2_analysis.py")


if __name__ == "__main__":
    main()
