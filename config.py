"""Single source of truth for both stages. Edit here, not in the scripts.

Stage 1 (stage1_export.py) writes data/  -> open in ArcGIS Pro.
Stage 2 (stage2_analysis.py) reads data/ -> writes data/derived, data/tables, maps/.
"""

import os
from pathlib import Path

# --- Earth Engine -----------------------------------------------------------
# `earthengine authenticate` once, then set your Cloud project id here or in the
# EE_PROJECT env var.
EE_PROJECT = os.environ.get("EE_PROJECT", "bshresthaclark")

# --- Paths ------------------------------------------------------------------
ROOT = Path(__file__).parent
DATA = ROOT / "data"
RASTER = DATA / "raster"        # stage 1 output: raw imagery, ArcGIS-Pro ready
VECTOR = DATA / "vector"        # stage 1 output: AOI + zones
DERIVED = DATA / "derived"      # stage 2 output: indices, change rasters, damage polys
TABLES = DATA / "tables"        # stage 2 output: zonal statistics
MAPS = ROOT / "maps"            # stage 2 output: figures

# --- Study area -------------------------------------------------------------
# Proposal section 5. minx, miny, maxx, maxy in EPSG:4326.
# Widen the south edge to ~27.90 if you want Zone 5 (Betrawati) covered.
ROI = [85.25, 28.05, 85.55, 28.35]

# Export in a metric CRS so area/length stats are real metres in both ArcGIS Pro
# and Python. UTM 45N covers 84E-90E.
CRS = "EPSG:32645"

# Pixel size in metres. 10 is the Sentinel native grid and costs ~4x the bytes
# (~640 MB vs ~160 MB for the full stack).
SCALE = 20

# --- Event windows ----------------------------------------------------------
EVENT = "2026-08-26"
S2_PRE = ("2026-08-01", "2026-08-25")
S2_POST = ("2026-08-26", "2026-09-01")
S1_PRE = ("2026-08-08", "2026-08-25")
S1_POST = ("2026-08-26", "2026-09-01")

S2_BANDS = ["B2", "B3", "B4", "B8", "B11", "B12"]
S1_BANDS = ["VV", "VH"]

# Sentinel-2 scene classification values kept as valid ground.
# 2=dark/topographic shadow (very common in these gorges), 4=veg, 5=bare,
# 6=water, 7=unclassified, 11=snow/ice.
SCL_KEEP = [2, 4, 5, 6, 7, 11]
# Scene-level filter only; per-pixel SCL masking does the real work. Kept loose
# because the whole post-event window is 78-83% cloud -- a tighter scene filter
# throws away the only two post scenes there are.
S2_MAX_CLOUD = 90

NODATA = -9999.0

# --- Change-detection thresholds (proposal sections 3.2 and 5) --------------
T_DNDVI = 0.25      # vegetation loss / debris burial
T_DMNDWI = 0.30     # new standing or turbid water
T_DSAR_DB = 3.0     # |post - pre| sigma0 in dB
MIN_POLY_PIXELS = 5  # drop specks when vectorising the damage mask

# --- Impact zones (proposal section 4) --------------------------------------
# (id, label, lon, lat, radius_m). Only Z1 has a coordinate stated in the
# proposal; the rest are approximate placeholders -- refine against the imagery
# once stage 1 has run.
ZONES = [
    ("Z1", "Rasuwagadhi / Gyirong border", 85.3780, 28.2780, 2000),
    ("Z2a", "Timure dry port", 85.3770, 28.2450, 1800),
    ("Z2b", "Ghattekhola", 85.3720, 28.2220, 1500),
    ("Z3", "Rasuwagadhi HPP 111 MW", 85.3755, 28.2700, 1500),
    ("Z4", "Syabrubesi", 85.3310, 28.1630, 2000),
    ("Z5", "Betrawati", 85.1830, 27.9660, 2500),
]

# --- Palette (validated diverging/sequential/status set) --------------------
INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
SURFACE = "#fcfcfb"
SERIES_1 = "#2a78d6"
DIVERGING = ("#2a78d6", "#f0efec", "#d03b3b")  # cool <- neutral -> warm
CRITICAL = "#d03b3b"


def ensure_dirs():
    for d in (RASTER, VECTOR, DERIVED, TABLES, MAPS):
        d.mkdir(parents=True, exist_ok=True)


def gtiff_profile(ref, count, dtype, nodata):
    """Clean GeoTIFF profile from a reference profile. Built from scratch rather
    than copied: inheriting a striped source's block sizes breaks a tiled write.
    """
    return dict(
        driver="GTiff", height=ref["height"], width=ref["width"],
        crs=ref["crs"], transform=ref["transform"],
        count=count, dtype=dtype, nodata=nodata,
        compress="deflate", tiled=True, blockxsize=256, blockysize=256,
    )
