# Rasuwa transboundary flood — two-stage build

Implements `Rasuwa_Nepal_China_Flood_Project_Proposal.md`. Split into two stages
on purpose, so the data is usable without the analysis:

| Stage | Script | Produces | For |
| :-- | :-- | :-- | :-- |
| 1 | `stage1_export.py` | GeoTIFF + Shapefile/GeoJSON, nothing derived | **ArcGIS Pro** (or QGIS, or stage 2) |
| 2 | `stage2_analysis.py` | change rasters, damage polygons, zonal stats, maps | **Python**, and the outputs go back into ArcGIS Pro |

Stage 2 reads only stage 1's files off disk. Neither stage calls the other, so you
can do the whole analysis in ArcGIS Pro instead and ignore stage 2, or run stage 2
and pull its outputs into ArcGIS Pro as extra layers.

## Setup

```bash
pip install earthengine-api rasterio geopandas rioxarray matplotlib pandas requests
earthengine authenticate          # once
export EE_PROJECT=your-gcloud-project-id
```

Everything tunable — study area, dates, pixel size, thresholds, impact zones —
lives in `config.py`. Both stages read it; edit nothing else.

## Way 1 — data only (ArcGIS Pro)

```bash
python stage1_export.py
```

Writes to `data/`, all **EPSG:32645** (UTM 45N, metres), **NODATA −9999**:

```
data/raster/s2_pre.tif     B2 B3 B4 B8 B11 B12   surface reflectance 0–1
data/raster/s2_post.tif    ″
data/raster/s1_pre.tif     VV VH   sigma0 dB
data/raster/s1_post.tif    ″
data/raster/dem.tif        SRTM elevation, m
data/raster/manifest.csv   what each file is, which window, which sensor
data/vector/aoi.shp        study rectangle
data/vector/zones.shp      the 6 impact zones from proposal §4, buffered
data/vector/*.geojson      same, WGS84, for web/portable use
```

Bands carry descriptions, so ArcGIS Pro shows `B8`, not `Band_4`. Add the folder
as a workspace and drag the layers in. Because everything is already projected
and metric, Zonal Statistics and Raster Calculator give real areas with no
reprojection step.

Two choices worth knowing about:

- **Same relative orbit for both SAR dates.** The script queries which orbits
  cover both windows and picks one. Mixing orbits across a pre/post pair is the
  standard way to manufacture fake change in steep terrain — local incidence
  angle shifts, layover and radar shadow move, and the ratio lights up on
  geometry rather than damage. Rasuwa is exactly the terrain where that bites.
- **Per-band download.** Each band is a separate request, which keeps every one
  under Earth Engine's ~48 MB response cap. So `SCALE = 10` in `config.py` works
  with no chunking logic; it just costs ~640 MB instead of ~160 MB.

## Way 2 — analysis in Python

```bash
python stage2_analysis.py
```

Reads `data/raster` and `data/vector`, writes:

```
data/derived/change_stack.tif        dNDVI dMNDWI dNBR dVV dVH
data/derived/damage_mask.tif         uint8, 1 = changed
data/derived/damage_polygons.shp     vectorised, with area_m2
data/derived/damage_polygons.geojson
data/tables/zonal_damage.csv         per zone: area, %, mean dNDVI, mean ΔVV
maps/01_rgb_pre_post.png             true colour before/after
maps/02_dndvi.png                    vegetation loss / debris burial
maps/03_dmndwi.png                   new standing and turbid water
maps/04_dvv_sar.png                  Δσ° VV, cloud-independent
maps/05_damage.png                   damage over hillshade, zones labelled
maps/06_zonal_damage.png             changed area by zone
```

Indices and thresholds are proposal §3.2 and §5:

```
dNDVI  = NDVI_pre  − NDVI_post      > 0.25   vegetation removed or buried
dMNDWI = MNDWI_post − MNDWI_pre     > 0.30   new standing / turbid water
Δσ°VV  = VV_post − VV_pre (dB)      > 3 dB   surface roughness change
damage = spectral OR SAR
```

`Δσ° = 10·log₁₀(post/pre)` in the proposal is a plain dB subtraction here —
Sentinel-1 GRD in Earth Engine is already sigma0 in dB, so the two are the same
number.

**The OR is the important part.** Late-August Rasuwa is under monsoon cloud, so
the optical pair can be largely no-data. NaN comparisons are `False`, so those
pixels fall through to the SAR rather than silently reading as "no change". Both
the console output and every diverging map report the usable-optical percentage,
so you can see how much of the result is carried by SAR alone.

## Check it

```bash
python test_analysis.py
```

Builds synthetic rasters with a known damage footprint — including a patch that
is only visible to SAR because it sits under simulated cloud — runs all of stage
2 over them, and asserts the reported area comes back exactly (0.80 km²). No
pytest, no fixtures.

## Things to fix before this is publishable

- **Zone coordinates are placeholders.** Only Z1 (Rasuwagadhi, 28.278 N 85.378 E)
  is stated in the proposal. Z2a–Z5 are approximate — refine them against the
  stage 1 imagery, then re-run stage 2.
- **Z5 (Betrawati) falls outside the default ROI.** Stage 1 warns about this.
  Drop `ROI`'s south edge to ~27.90 in `config.py` if you want it covered.
- **No radiometric terrain flattening on the SAR.** Same-orbit differencing
  cancels most of the topographic bias, which is why the orbit matching above
  matters, but the residual is real on the steepest slopes. Use SNAP/`gamma0` if
  you need calibrated backscatter rather than change detection.
- **Thresholds are the proposal's, not calibrated.** They are the right starting
  point, not a validated classifier. Digitise a handful of known-damaged and
  known-intact polygons from the PlanetScope imagery and tune against those.
- **Not built:** the HEC-RAS / Telemac-2D hydrodynamic model (§6.2) and
  PlanetScope ingestion (commercial, needs a Planet API key). The DEM export is
  the input HEC-RAS needs.
