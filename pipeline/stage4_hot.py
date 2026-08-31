"""Stage 4 -- HOT response data, validated against the pipeline's own detection.

    python pipeline/stage4_hot.py

Pulls the Humanitarian OpenStreetMap Team's response export for this exact event
(https://data.humdata.org/dataset/hot_flood_npl, ODC-ODbL) and does the thing the
earlier stages could not: check the satellite detection against ground truth.

HOT's observed flood extent was mapped from drone, Landsat, PlanetScope and
Sentinel imagery plus volunteer field reports. It is independent of anything in
stages 1-3, so it is a fair test of both the stage 2 thresholds and the stage 3
HAND corridor.

Reads   data/hot/*                             downloaded here, cached
        data/derived/flood_damage.tif          (stage 3)
        data/derived/damage_mask.tif           (stage 2)
        data/derived/terrain.tif               (stage 3)
        data/vector/zones.shp                  (stage 1)

Writes  web/public/data/*.geojson              layers the React app draws
        web/public/data/summary.json           every number the site quotes
        data/tables/validation.csv             detection vs observed extent
        data/tables/exposure.csv               what sits inside the flood extent

Two things worth knowing about the source data:

- Being in the dataset is not evidence of damage. The area of interest is the
  flood extent widened by 200 m, so it sweeps in buildings and roads beside the
  water. Only the `status` field says what was lost. Every count below either
  filters on status or clips to the flood extent itself.
- One of the 59 assessed bridges, "Thulo bharkhu", is published at
  [28.1390111, 28.1390111] -- its latitude in both slots. The longitude is not
  recoverable, so it is dropped from the map and reported separately.
"""

import json
import sys
import zipfile
from io import BytesIO

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
from rasterio import features
from shapely.geometry import box, shape

import config as cfg

WGS84 = "EPSG:4326"
NEPAL_LON = (80.0, 89.0)        # anything outside this is not a Nepali longitude


# --- Fetch ------------------------------------------------------------------

def fetch(name, path):
    """Download one HOT layer into data/hot/, unzipping if needed. Cached."""
    out = cfg.HOT / f"{name}.geojson"
    gpkg = cfg.HOT / f"{name}.gpkg"
    if out.exists() or gpkg.exists():
        return out if out.exists() else gpkg

    url = f"{cfg.HOT_BASE}/{path}"
    print(f"    {name}", flush=True)
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    if not path.endswith(".zip"):
        out.write_bytes(r.content)
        return out

    with zipfile.ZipFile(BytesIO(r.content)) as z:
        inner = [n for n in z.namelist() if n.endswith((".geojson", ".gpkg"))]
        if not inner:
            raise SystemExit(f"{name}: no geojson/gpkg inside {url}")
        dest = cfg.HOT / f"{name}{'.gpkg' if inner[0].endswith('.gpkg') else '.geojson'}"
        dest.write_bytes(z.read(inner[0]))
        return dest


def load_all():
    cfg.HOT.mkdir(parents=True, exist_ok=True)
    print("HOT response data")
    layers = {}
    for name, path in cfg.HOT_LAYERS.items():
        p = fetch(name, path)
        layers[name] = gpd.read_file(p).to_crs(WGS84)
    print(f"  {len(layers)} layers, "
          + ", ".join(f"{k} {len(v)}" for k, v in layers.items()))
    return layers


# --- Clean ------------------------------------------------------------------

def drop_bad_coords(gdf):
    """-> (clean, dropped). Guards the one transposed bridge, and anything else
    that lands outside Nepal, rather than letting it stretch the map bounds."""
    x = gdf.geometry.representative_point().x
    ok = x.between(*NEPAL_LON)
    return gdf[ok].copy(), gdf[~ok].copy()


def keep(gdf, columns):
    """Trim to the columns the site actually reads. These files ship to the
    browser, and the OSM exports carry 30 admin/name fields per feature."""
    cols = [c for c in columns if c in gdf.columns]
    out = gdf[cols + ["geometry"]].copy()
    for c in cols:
        if out[c].dtype == object:
            out[c] = out[c].where(out[c].notna(), None)
    return out


# --- Validation -------------------------------------------------------------

def raster_area(mask, pixel_area):
    return float(mask.sum()) * pixel_area / 1e6


def read_band(path, name):
    """Fetch a band by its description, not its index. terrain.tif gained a
    `fill_m` band in stage 3, which silently shifted hand_m from 3 to 4."""
    with rasterio.open(path) as src:
        names = list(src.descriptions)
        if name not in names:
            raise SystemExit(f"{path.name} has no '{name}' band, only {names}")
        return src.read(names.index(name) + 1, masked=True).filled(np.nan)


def rasterize_to(gdf, transform, shape_):
    """HOT polygons onto the stage 1 grid, so every comparison is pixel to pixel
    and no vector/raster area mismatch creeps in."""
    if gdf.empty:
        return np.zeros(shape_, bool)
    return features.rasterize(
        ((g, 1) for g in gdf.geometry if g is not None and not g.is_empty),
        out_shape=shape_, transform=transform, fill=0, dtype="uint8",
    ).astype(bool)


def validate(hot, roi_poly):
    """Stage 2 and stage 3 against HOT's observed extent, on the stage 1 grid."""
    with rasterio.open(cfg.DERIVED / "damage_mask.tif") as src:
        change = src.read(1).astype(bool)
        transform, shape_, crs = src.transform, src.shape, src.crs
    with rasterio.open(cfg.DERIVED / "flood_damage.tif") as src:
        detected = src.read(1).astype(bool)
    hand = read_band(cfg.DERIVED / "terrain.tif", "hand_m")
    pixel_area = abs(transform.a * transform.e)

    extent = hot["flood_extent"].to_crs(crs)
    observed = rasterize_to(extent, transform, shape_)
    with np.errstate(invalid="ignore"):
        corridor = np.isfinite(hand) & (hand <= cfg.HAND_MAX_M)

    # The ROI only covers the top of HOT's corridor, so every rate below is
    # computed inside the overlap and nowhere else.
    n = observed.sum()
    rows = [
        {"metric": "ROI area", "km2": raster_area(np.isfinite(hand), pixel_area),
         "note": "stage 1 study rectangle"},
        {"metric": "HOT observed flood extent, whole corridor",
         "km2": float(hot["flood_extent"].to_crs(cfg.CRS).area.sum() / 1e6),
         "note": "Rasuwagadhi to the Narayani confluence"},
        {"metric": "HOT observed flood extent, inside ROI",
         "km2": raster_area(observed, pixel_area), "note": "the comparison area"},
        {"metric": "stage 2 change, inside ROI",
         "km2": raster_area(change, pixel_area), "note": "thresholds only"},
        {"metric": "stage 3 flood damage, inside ROI",
         "km2": raster_area(detected, pixel_area), "note": "thresholds ∩ HAND corridor"},
        {"metric": "stage 3 HAND corridor, inside ROI",
         "km2": raster_area(corridor, pixel_area), "note": f"HAND ≤ {cfg.HAND_MAX_M:.0f} m"},
    ]
    stats = {r["metric"]: r["km2"] for r in rows}

    # Does the terrain-derived corridor actually contain the observed flood?
    # This is the strongest available test of the stage 3 idea, because HAND is
    # computed from the DEM alone and never sees the imagery.
    contained = 100.0 * (observed & corridor).sum() / max(n, 1)
    # And of the water HOT observed, how much did the thresholds flag as changed?
    recall_ch = 100.0 * (observed & change).sum() / max(n, 1)
    recall_det = 100.0 * (observed & detected).sum() / max(n, 1)
    # Base rate: what share of the ROI is observed flood at all. Anything above
    # this is the detection doing better than pointing at random ground.
    base = 100.0 * n / max(np.isfinite(hand).sum(), 1)
    precision = 100.0 * (observed & detected).sum() / max(detected.sum(), 1)

    scores = {
        "observed_in_corridor_pct": round(contained, 1),
        "observed_flagged_by_stage2_pct": round(recall_ch, 1),
        "observed_flagged_by_stage3_pct": round(recall_det, 1),
        "detected_inside_observed_pct": round(precision, 1),
        "observed_share_of_roi_pct": round(base, 2),
        "precision_vs_base_rate": round(precision / base, 1) if base else None,
        "iou_pct": round(100.0 * (observed & detected).sum()
                         / max((observed | detected).sum(), 1), 1),
    }
    for k, v in scores.items():
        rows.append({"metric": k, "km2": None, "note": v})

    masks = {"corridor": corridor, "detected": detected, "change": change}
    hits = []
    hit_rate(hot["buildings"][hot["buildings"]["status"].eq("Destroyed")],
             masks, transform, shape_, crs, "Destroyed buildings", hits)
    hit_rate(hot["bridge_damage"][hot["bridge_damage"]["status"].eq("Washed out")],
             masks, transform, shape_, crs, "Bridges washed out", hits)
    hit_rate(hot["roads"][hot["roads"]["status"].eq("Destroyed")],
             masks, transform, shape_, crs, "Roads destroyed", hits)
    hit_rate(hot["hydropowers"], masks, transform, shape_, crs,
             "Hydropowers exposed", hits)
    scores["hits"] = hits

    print("\nValidation against HOT observed extent (inside the ROI)")
    print(f"  observed flood extent            {stats['HOT observed flood extent, inside ROI']:.2f} km²")
    print(f"  stage 3 detected flood damage    {stats['stage 3 flood damage, inside ROI']:.2f} km²")
    print(f"  observed water inside the HAND corridor   {contained:.1f}%  "
          "<- corridor never sees the imagery")
    print(f"  observed water flagged by stage 2         {recall_ch:.1f}%")
    print(f"  observed water flagged by stage 3         {recall_det:.1f}%")
    print(f"  detections landing inside observed water  {precision:.1f}%  "
          f"vs {base:.2f}% base rate  = {scores['precision_vs_base_rate']}x")
    print("\nGround evidence of damage, and whether the masks cover it")
    print(pd.DataFrame(scores["hits"]).to_string(index=False))
    return pd.DataFrame(rows), scores


def hit_rate(gdf, masks, transform, shape_, crs, label, out):
    """Do the detections land where things were actually destroyed?

    A better test than area overlap. HOT's flood extent is where the water was,
    and most of that is the pre-existing river channel, which produces no change
    signal because it was already water before the event. Destroyed buildings and
    washed-out bridges have no such excuse: they are point evidence of damage,
    independent of the imagery, and the mask either covers them or does not.
    """
    if gdf.empty:
        return
    g = gdf.to_crs(crs)
    inv = ~transform
    rows, cols = [], []
    for pt in g.geometry.representative_point():
        c, r = inv * (pt.x, pt.y)
        rows.append(int(r)); cols.append(int(c))
    rows, cols = np.array(rows), np.array(cols)
    inside = (rows >= 0) & (rows < shape_[0]) & (cols >= 0) & (cols < shape_[1])
    if not inside.any():
        return
    rows, cols = rows[inside], cols[inside]
    entry = {"target": label, "n_in_roi": int(inside.sum())}
    for name, m in masks.items():
        entry[f"in_{name}_pct"] = round(100.0 * m[rows, cols].mean(), 1)
        entry[f"{name}_base_pct"] = round(100.0 * m.mean(), 2)
    out.append(entry)


# --- Exposure ---------------------------------------------------------------

def exposure(hot, zones):
    """What sits inside the observed flood extent, by impact zone and overall."""
    extent = hot["flood_extent"].to_crs(cfg.CRS).union_all()
    rows = []

    def count_in(gdf, label, flt=None):
        g = gdf if flt is None else gdf[flt]
        if g.empty:
            return
        m = g.to_crs(cfg.CRS)
        rows.append({"layer": label, "total": len(m),
                     "in_flood_extent": int(m.intersects(extent).sum())})

    count_in(hot["bridge_damage"], "Bridges assessed")
    count_in(hot["bridge_damage"], "Bridges washed out",
             hot["bridge_damage"]["status"].eq("Washed out"))
    count_in(hot["hydropowers"], "Hydropower projects exposed")
    count_in(hot["buildings"], "Buildings mapped")
    count_in(hot["buildings"], "Buildings destroyed",
             hot["buildings"]["status"].eq("Destroyed"))
    count_in(hot["roads"], "Road segments mapped")
    count_in(hot["roads"], "Road segments destroyed",
             hot["roads"]["status"].eq("Destroyed"))
    count_in(hot["health_facilities"], "Health facilities")
    count_in(hot["education_facilities"], "Education facilities")
    count_in(hot["populated_places"], "Populated places")
    table = pd.DataFrame(rows)

    # Per zone, on the same union so the numbers add up with the table above.
    z = zones.to_crs(cfg.CRS)
    zrows = []
    for zone in z.itertuples():
        sel = lambda g: g.to_crs(cfg.CRS).intersects(zone.geometry)
        b = hot["bridge_damage"][sel(hot["bridge_damage"])]
        zrows.append({
            "zone_id": zone.zone_id, "label": zone.label,
            "bridges": len(b),
            "bridges_washed_out": int(b["status"].eq("Washed out").sum()),
            "hydropowers": int(sel(hot["hydropowers"]).sum()),
            "buildings_destroyed": int(
                (sel(hot["buildings"]) & hot["buildings"]["status"].eq("Destroyed")).sum()),
            "roads_destroyed": int(
                (sel(hot["roads"]) & hot["roads"]["status"].eq("Destroyed")).sum()),
        })
    return table, pd.DataFrame(zrows)


# --- Emit -------------------------------------------------------------------

def jsonable(o):
    """NaN is not valid JSON. pandas hands back NaN for every empty cell, and
    json.dumps writes it out as a bare NaN token that JSON.parse rejects, so the
    whole site would fail to load on one blank note field. Convert first, then
    dump with allow_nan=False so a miss is an error here rather than in a
    browser console."""
    if isinstance(o, dict):
        return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else float(o)
    if o is None or isinstance(o, (str, bool, int)):
        return o
    return None if pd.isna(o) else str(o)


def write_geojson(gdf, name, precision=6, simplify=None):
    """One layer for the browser. Coordinates trimmed to ~10 cm; the OSM exports
    ship 14 decimal places, which is most of the file size for nothing. The
    raster-derived polygons are stair-stepped at the 20 m pixel, so a tolerance
    below that throws away nothing a viewer could see."""
    path = cfg.SITE_DATA / f"{name}.geojson"
    g = gdf.to_crs(WGS84)
    if simplify:
        g = g.copy()
        g["geometry"] = g.geometry.simplify(simplify)
    g.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=precision)
    print(f"  {name:<22} {len(gdf):>6} features  {path.stat().st_size / 1e3:>7.0f} kB")
    return path.stat().st_size


def main():
    missing = [p.name for p in (cfg.DERIVED / "damage_mask.tif",
                                cfg.DERIVED / "flood_damage.tif",
                                cfg.DERIVED / "terrain.tif") if not p.exists()]
    if missing:
        sys.exit(f"Missing {missing}. Run stages 1-3 first.")
    cfg.SITE_DATA.mkdir(parents=True, exist_ok=True)

    hot = load_all()
    bridges, bad_bridges = drop_bad_coords(hot["bridge_damage"])
    hot["bridge_damage"] = bridges
    if len(bad_bridges):
        print(f"  dropped {len(bad_bridges)} bridge(s) with unusable coordinates: "
              + ", ".join(bad_bridges["name"].fillna("unnamed")))

    roi_poly = box(*cfg.ROI)
    zones = gpd.read_file(cfg.VECTOR / "zones.shp")

    table, scores = validate(hot, roi_poly)
    table.to_csv(cfg.TABLES / "validation.csv", index=False)
    exp, exp_zone = exposure(hot, zones)
    exp.to_csv(cfg.TABLES / "exposure.csv", index=False)
    print("\n" + exp.to_string(index=False))

    print("\nSite layers")
    dmg = hot["buildings"]["status"].isin(["Destroyed", "Damaged"])
    written = {
        "flood_extent": write_geojson(hot["flood_extent"], "flood_extent", simplify=3e-5),
        "aoi": write_geojson(hot["aoi"], "aoi", simplify=1e-4),
        "bridges": write_geojson(
            keep(hot["bridge_damage"], ["name", "status", "location", "length_m",
                                        "adm2_name", "adm3_name"]), "bridges"),
        "hydropowers": write_geojson(
            keep(hot["hydropowers"], ["name", "capacity_mw", "river", "status",
                                      "district", "municipality"]), "hydropowers"),
        "buildings_damaged": write_geojson(
            keep(hot["buildings"][dmg], ["name", "status", "building",
                                         "building_levels"]), "buildings_damaged"),
        "roads_damaged": write_geojson(
            keep(hot["roads"][hot["roads"]["status"].eq("Destroyed")],
                 ["name", "status", "highway", "surface"]), "roads_damaged"),
        "facilities": write_geojson(_facilities(hot), "facilities"),
        "places": write_geojson(
            keep(hot["populated_places"], ["name", "place", "population"]), "places"),
        "waterways": write_geojson(_waterways(hot), "waterways"),
    }
    written |= _analysis_layers(zones, roi_poly)

    summary = {
        "event": {
            "title": "2026 Bhote Koshi & Trishuli transboundary flood",
            "date": cfg.EVENT,
            "roi": cfg.ROI,
            "hand_max_m": cfg.HAND_MAX_M,
            "min_drainage_km2": cfg.MIN_DRAINAGE_KM2,
            "thresholds": {"dNDVI": cfg.T_DNDVI, "dMNDWI": cfg.T_DMNDWI,
                           "dSAR_dB": cfg.T_DSAR_DB},
        },
        "validation": scores,
        "areas": {r["metric"]: r["km2"] for _, r in table.iterrows()
                  if pd.notna(r["km2"])},
        "exposure": exp.to_dict("records"),
        "exposure_by_zone": exp_zone.to_dict("records"),
        "bridges_by_status": hot["bridge_damage"]["status"].value_counts().to_dict(),
        "buildings_by_status": hot["buildings"]["status"].value_counts().to_dict(),
        "roads_by_status": hot["roads"]["status"].value_counts().to_dict(),
        "damaged_features_by_type": (
            hot["destroyed_features"]["feature_type"].value_counts().head(12).to_dict()
            if "feature_type" in hot["destroyed_features"] else {}),
        "zonal_flood": pd.read_csv(cfg.TABLES / "zonal_flood.csv").to_dict("records"),
        "change_vs_hand": pd.read_csv(cfg.TABLES / "change_vs_hand.csv").to_dict("records"),
        "dropped_bridges": bad_bridges["name"].fillna("unnamed").tolist(),
        "layer_bytes": written,
        "sources": [
            {"name": "Nepal Flood 2026 Flood Affected Area, Bhote Koshi and Trishuli",
             "org": "Humanitarian OpenStreetMap Team (HOT)",
             "licence": "ODC-ODbL",
             "url": f"https://data.humdata.org/dataset/{cfg.HDX_DATASET}"},
            {"name": "Sentinel-2 L2A, Sentinel-1 GRD, SRTM GL1",
             "org": "Copernicus / NASA via Google Earth Engine",
             "licence": "Copernicus open data / public domain",
             "url": "https://developers.google.com/earth-engine/datasets"},
        ],
    }
    (cfg.SITE_DATA / "summary.json").write_text(
        json.dumps(jsonable(summary), indent=1, allow_nan=False))
    print(f"\nDone. {len(written)} layers + summary.json in {cfg.SITE_DATA}")
    print(f"      validation.csv and exposure.csv in {cfg.TABLES}")


def _facilities(hot):
    parts = []
    for key, kind in (("health_facilities", "Health"),
                      ("education_facilities", "Education")):
        g = keep(hot[key], ["name", "amenity", "healthcare"])
        g["kind"] = kind
        parts.append(g)
    return gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=WGS84)


def _waterways(hot):
    g = keep(hot["waterways"], ["name", "waterway"])
    # ~5 m in this latitude band; the rivers are drawn at basin scale.
    g["geometry"] = g.geometry.simplify(0.00005)
    return g


def _analysis_layers(zones, roi_poly):
    """The pipeline's own output, for the layers panel alongside HOT's."""
    out = {}
    for src, name, simp in (("flood_damage_polygons", "detected_damage", 5e-5),
                            ("corridor", "corridor", 1e-4),
                            ("channel", "channel", 1e-4)):
        p = cfg.DERIVED / f"{src}.shp"
        if p.exists():
            out[name] = write_geojson(gpd.read_file(p), name, 5, simp)
    out["zones"] = write_geojson(keep(zones, ["zone_id", "label", "radius_m"]), "zones")
    out["roi"] = write_geojson(
        gpd.GeoDataFrame({"name": ["Study ROI"]}, geometry=[roi_poly], crs=WGS84), "roi")
    return out


if __name__ == "__main__":
    main()
