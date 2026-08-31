"""One runnable check: synthetic rasters with a known damage footprint, run the
whole of stage 2 over them, assert the numbers come back exactly.

    python pipeline/test_analysis.py
"""

import tempfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Point

import config as cfg
import stage2_analysis as s2

N = 200
PIXEL = 20.0                      # m
TRANSFORM = from_origin(300000.0, 3130000.0, PIXEL, PIXEL)
CRS = "EPSG:32645"

DEBRIS = (np.s_[60:100], np.s_[60:100])   # 40x40, visible to optical + SAR
CLOUD = (np.s_[20:60], np.s_[20:60])      # optical is NaN here
SAR_ONLY = (np.s_[30:50], np.s_[30:50])   # 20x20 inside the cloud, SAR-only

# The speckle filter blurs patch edges by SPECKLE_WIN//2, so assert on eroded
# interiors and on background well clear of the patches rather than on an exact
# pixel count.
PAD = cfg.SPECKLE_WIN // 2 + 1
DEBRIS_IN = (np.s_[60 + PAD:100 - PAD], np.s_[60 + PAD:100 - PAD])
SAR_ONLY_IN = (np.s_[30 + PAD:50 - PAD], np.s_[30 + PAD:50 - PAD])


def _write(path, bands):
    profile = dict(
        driver="GTiff", height=N, width=N, count=len(bands), dtype="float32",
        crs=CRS, transform=TRANSFORM, nodata=cfg.NODATA,
    )
    with rasterio.open(path, "w", **profile) as dst:
        for i, (name, a) in enumerate(bands.items(), start=1):
            dst.write(np.nan_to_num(a.astype("float32"), nan=cfg.NODATA), i)
            dst.set_band_description(i, name)


def build_fixture(root):
    raster, vector = root / "raster", root / "vector"
    raster.mkdir(parents=True); vector.mkdir(parents=True)
    f = lambda v: np.full((N, N), v, dtype="float32")

    _write(raster / "s2_pre.tif", {
        "B2": f(0.06), "B3": f(0.08), "B4": f(0.05),
        "B8": f(0.35), "B11": f(0.12), "B12": f(0.10),
    })

    post = {"B2": f(0.06), "B3": f(0.08), "B4": f(0.05),
            "B8": f(0.35), "B11": f(0.12), "B12": f(0.10)}
    post["B4"][DEBRIS] = 0.18           # bare debris: NDVI 0.75 -> 0.05
    post["B8"][DEBRIS] = 0.20
    post["B3"][DEBRIS] = 0.15
    post["B11"][DEBRIS] = 0.25
    for a in post.values():
        a[CLOUD] = np.nan               # masked cloud -> nodata
    _write(raster / "s2_post.tif", post)

    _write(raster / "s1_pre.tif", {"VV": f(-8.0), "VH": f(-14.0)})
    vv, vh = f(-8.0), f(-14.0)
    vv[DEBRIS] = -14.0                  # dVV = -6 dB
    vv[SAR_ONLY] = -13.0                # dVV = -5 dB, under total cloud
    _write(raster / "s1_post.tif", {"VV": vv, "VH": vh})

    yy, xx = np.mgrid[0:N, 0:N]
    _write(raster / "dem.tif", {"elevation": (2000 + 8 * xx + 3 * yy).astype("float32")})

    zones = gpd.GeoDataFrame(
        {"zone_id": ["ZA", "ZB"], "label": ["debris zone", "quiet zone"], "radius_m": [500, 500]},
        geometry=[Point(300000 + 80 * PIXEL, 3130000 - 80 * PIXEL),
                  Point(300000 + 170 * PIXEL, 3130000 - 170 * PIXEL)],
        crs=CRS,
    )
    zones["geometry"] = zones.buffer(zones["radius_m"])
    zones.to_file(vector / "zones.shp")


def test_nd_is_nan_safe():
    assert np.isnan(s2.nd(np.float32(np.nan), np.float32(1.0)))
    assert np.isnan(s2.nd(np.float32(0.0), np.float32(0.0)))     # 0/0, not inf
    assert abs(s2.nd(np.float32(3.0), np.float32(1.0)) - 0.5) < 1e-6


def test_nan_never_counts_as_damage():
    nanful = np.full((2, 2), np.nan, dtype="float32")
    mask = s2.damage_mask({"dNDVI": nanful, "dMNDWI": nanful, "dVV": nanful})
    assert not mask.any(), "all-NaN input must produce no damage"


def test_despeckle_suppresses_speckle():
    """Regression guard: unfiltered single-look SAR trips the dB threshold on
    noise alone. This is the defect that made the first real run report 17% of
    the catchment as damaged."""
    rng = np.random.default_rng(0)
    # Single-look intensity speckle is exponential in linear power.
    pre = 10 * np.log10(rng.exponential(1.0, (300, 300)))
    post = 10 * np.log10(rng.exponential(1.0, (300, 300)))

    raw = (np.abs(post - pre) > cfg.T_DSAR_DB).mean()
    filtered = (np.abs(s2.despeckle(post) - s2.despeckle(pre)) > cfg.T_DSAR_DB).mean()
    assert raw > 0.30, f"fixture is not noisy enough to be a real test ({raw:.2%})"
    assert filtered < 0.02, f"despeckle left {filtered:.2%} of pure noise above threshold"


def test_pipeline(root):
    for name in ("RASTER", "VECTOR", "DERIVED", "TABLES", "MAPS"):
        setattr(cfg, name, root / name.lower())
    s2.main()

    with rasterio.open(cfg.DERIVED / "damage_mask.tif") as src:
        mask = src.read(1).astype(bool)

    assert mask[DEBRIS_IN].all(), "debris patch interior must be flagged"
    assert mask[SAR_ONLY_IN].all(), "SAR-only patch under cloud must be flagged"

    # Everything clear of both patches: SAR_ONLY spans 30:50, DEBRIS 60:100,
    # plus the filter's edge bleed either side.
    quiet = np.ones((N, N), bool)
    quiet[26:104, 26:104] = False
    assert not mask[quiet].any(), f"{int(mask[quiet].sum())} false positives in quiet ground"

    polys = gpd.read_file(cfg.DERIVED / "damage_polygons.shp")
    assert len(polys) == 2, f"expected 2 patches, got {len(polys)}"

    import pandas as pd
    table = pd.read_csv(cfg.TABLES / "zonal_damage.csv")
    assert set(table["zone_id"]) == {"ZA", "ZB"}
    za = table.set_index("zone_id").loc["ZA"]
    assert za["damaged_km2"] > 0, "debris zone should register damage"
    assert table.set_index("zone_id").loc["ZB"]["damaged_km2"] == 0

    for f in ("01_rgb_pre_post.png", "02_dndvi.png", "03_dmndwi.png",
              "04_dvv_sar.png", "05_damage.png", "06_zonal_damage.png"):
        assert (cfg.MAPS / f).stat().st_size > 5000, f


if __name__ == "__main__":
    test_nd_is_nan_safe()
    test_nan_never_counts_as_damage()
    test_despeckle_suppresses_speckle()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        build_fixture(root)
        test_pipeline(root)
    print("\nOK - all checks passed")
