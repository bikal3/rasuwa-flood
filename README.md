# Rasuwa transboundary flood — staged build

Implements the project proposal for the 2026 Rasuwa transboundary flood. Comments
throughout cite it by section ("proposal §3.2", "proposal section 4") for the
thresholds, indices and impact zones; the document itself is no longer in the tree,
but it is in git history:

```bash
git show 3f629c2:Rasuwa_Nepal_China_Flood_Project_Proposal.md
```

Split into stages on purpose, so the data is usable without the analysis, the
analysis is usable without the terrain conditioning, and the site is usable
without any of it:

| Stage | Script | Produces | For |
| :-- | :-- | :-- | :-- |
| 1 | `pipeline/stage1_export.py` | GeoTIFF + Shapefile/GeoJSON, nothing derived | **ArcGIS Pro** (or QGIS, or stage 2) |
| 2 | `pipeline/stage2_analysis.py` | change rasters, damage polygons, zonal stats, maps | **Python**, and the outputs go back into ArcGIS Pro |
| 3 | `pipeline/stage3_corridor.py` | terrain + HAND, the flood corridor, corridor-confined damage | **Python**, ditto — and the DEM stack HEC-RAS wants |
| 4 | `pipeline/stage4_hot.py` | HOT ground survey, validation scores, the site's data | **Python**, and `web/` |
| 5 | `pipeline/stage5_overlays.py` | pre/post true-colour PNGs in Web Mercator | the site's before/after slider |
| — | `web/` (React + esbuild) | a static site: interactive map, findings, tables, downloads | **Anyone with a browser** |

Each stage reads the previous one's files off disk and nothing else. No stage calls
another, so you can do the whole analysis in ArcGIS Pro instead and ignore stages 2
and 3, or run them and pull the outputs in as extra layers.

## Layout

```
pipeline/   the Python stages and their checks; everything tunable is config.py
web/        React source for the site, bundled by esbuild
data/       stage outputs (gitignored except tables/*.csv)
maps/       matplotlib plates, committed
site/       built site, gitignored -- rebuild with: cd web && node build.mjs
```

Run the stages from anywhere; `pipeline/config.py` resolves every path against the
repo root, not its own directory.

## Setup

```bash
pip install earthengine-api rasterio geopandas matplotlib pandas scipy requests
earthengine authenticate          # once
export EE_PROJECT=your-gcloud-project-id
```

Everything tunable — study area, dates, pixel size, thresholds, impact zones —
lives in `pipeline/config.py`. All three stages read it; edit nothing else.

## Way 1 — data only (ArcGIS Pro)

```bash
python pipeline/stage1_export.py
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
  under Earth Engine's ~48 MB response cap. So `SCALE = 10` in `pipeline/config.py` works
  with no chunking logic; it just costs ~640 MB instead of ~160 MB.

## Way 2 — analysis in Python

```bash
python pipeline/stage2_analysis.py
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

### Three corrections the first real run forced

Applying the proposal's thresholds to the raw imagery reported **172.8 km²** of
change — 17% of the catchment, spread evenly across every zone. That was wrong,
and each cause needed a different fix:

1. **Speckle.** Only one Sentinel-1 scene exists per window on orbit 85, so
   `median()` did no temporal averaging and the dB difference was ~2 dB of pure
   speckle — symmetric about zero, 13% of it past the 3 dB threshold. Fixed by
   `despeckle()`, a 5×5 boxcar multilook in **linear power** (averaging decibels
   is a log-domain mean and biases low). Residual noise is now 0.98 dB and 0.9%
   of pixels cross the threshold. `test_despeckle_suppresses_speckle` guards it.
2. **Shadow and snow in the cloud mask.** The scene-classification keep-list
   originally included dark/shadow, unclassified and snow. In these gorges NDVI
   in shadow is unstable between dates, and fresh snowfall between composites is
   an enormous index change unrelated to the flood. Tightening `SCL_KEEP` to
   vegetation/bare/water dropped the scene-wide dNDVI bias from **+0.099 to
   +0.007** — the bias *was* those pixels.
3. **Residual scene offset.** `debias()` subtracts the median from each
   difference image so unchanged ground sits at zero and the proposal's fixed
   thresholds mean what they say. The offsets removed are printed every run.
   This is only safe because the flood corridor is a small fraction of the ROI;
   tighten the ROI to just the affected valley and it would subtract signal.

After all three: **29.5 km²** in 1,966 polygons, and the zones separate
(Timure 11.3%, Rasuwagadhi 9.4%, Syabrubesi 6.6%) instead of sitting flat.

## Way 3 — confine it to the corridor

```bash
python pipeline/stage3_corridor.py
```

Stage 2 applies the proposal's thresholds everywhere in the ROI. A debris flood
cannot be everywhere: it is confined to ground the river can reach. Stage 3
derives that ground from the DEM and intersects it with stage 2's mask.

```
data/derived/terrain.tif           filled_dem, fill_m, drainage_km2, hand_m
data/derived/channel.shp|.geojson  the drainage network
data/derived/corridor.shp|.geojson the valley floor
data/derived/flood_damage.tif      uint8, stage 2 mask AND corridor
data/derived/flood_damage_polygons.shp|.geojson
data/tables/zonal_flood.csv        per zone: corridor, flood area, scour width
data/tables/change_vs_hand.csv     change rate against height above the river
maps/07_corridor.png               HAND + drainage network over hillshade
maps/08_flood_damage.png           kept vs rejected detections
maps/09_change_vs_hand.png         the profile that justifies the whole stage
```

The pipeline is plain numpy and scipy — no hydrology dependency:

1. **Priority-flood depression fill.** SRTM in a gorge is full of noise pits;
   unfilled, D8 flow stops at every one and the network shatters. ~3 s over 2.5M
   cells, because the hot loop runs on Python lists rather than numpy scalars.
2. **D8 steepest descent**, then flow accumulation in descending-elevation order.
3. **Channel** = cells draining ≥ `MIN_DRAINAGE_KM2` (8 km²) → 224 km of network.
4. **HAND** — each cell's height above the first drainage cell its own flow path
   reaches — computed in ascending-elevation order, so a cell's receiver is
   always already resolved.
5. **Corridor** = HAND ≤ `HAND_MAX_M`, **flood damage** = corridor ∩ stage 2.

**29.5 km² of change becomes 4.1 km² of flood damage** in 279 polygons, tracing a
continuous ribbon down the Bhote Koshi instead of a scatter over the hillslopes.

### The corridor is not an assumption, it is measurable

`change_vs_hand.csv` bins stage 2's change rate by height above the river. If the
detections were noise the profile would be flat:

| HAND | 0–5 | 5–10 | 10–20 | 20–30 | 30–50 | 50–100 | 100–200 | 200–500 | 500+ |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| change rate | 9.6% | 8.7% | 9.2% | 9.8% | 9.1% | 6.7% | 4.9% | 3.5% | 2.1% |

Flat to 50 m, then falling away to a 2.1% far-field floor. **`HAND_MAX_M` is 50,
not the 30 the proposal's +7–9 m surge figure alone would argue for, because the
plateau ends at 50** — a 30 m cut sliced through the middle of the signal. Charging
the corridor that 2.1% floor leaves **3.2 km² attributable to the flood**. Re-read
the table after changing the ROI or the stage 2 thresholds.

### Two things the first run got wrong

- **Do not filter out the depression fill.** The tempting move is to drop cells the
  fill had to raise, on the grounds that a filled basin is a flat fake valley floor.
  It cuts 39% of the trunk river out of this ROI, and the cells it cuts run at 7.4×
  the far-field change rate against 4.2× for unfilled ground. They are the deep
  narrow reaches where SRTM's C-band bridged across the gorge instead of reaching
  the bottom, so the fill is reconstructing the valley floor rather than inventing
  one. `fill_m` is carried as a band so the reconstruction stays visible — which
  matters if `terrain.tif` is used as a HEC-RAS surface. 19% of the corridor is
  reconstructed ground.
- **Sentinel-1 cannot measure this river's width, so stage 3 does not claim to.**
  The plan was wetted-area-before / wetted-area-after for §4.1's 200–300% channel
  widening. On trunk-channel cells VV never goes specular: 1st percentile −14.9 dB,
  median −7.5 dB, against a −16 dB water threshold. A 20–60 m whitewater gorge
  river is rough, mixed-pixel and foreshortened against bright banks — it has no
  dark-water signature to find. The first version duly reported a 5 m wide river,
  which 20 m pixels cannot resolve. What replaced it is `scour_width_m`: flood-damage
  area per metre of channel, i.e. the mean width of the disturbed swath — 50–84 m
  at Z1/Z2a/Z3/Z4. Verifying the widening *ratio* needs the 3 m PlanetScope imagery,
  which is on the not-built list below.

## Way 4 — the ground survey, and does any of this hold up

```bash
python pipeline/stage4_hot.py
```

Pulls the Humanitarian OpenStreetMap Team's response export for this exact event —
[`hot_flood_npl`](https://data.humdata.org/dataset/hot_flood_npl), ODC-ODbL — and
does the thing stages 1–3 could not: check the detection against ground truth.
HOT's flood extent was mapped from drone, Landsat, PlanetScope and Sentinel
imagery plus volunteer field reports, independently of anything here.

Downloads are cached in `data/hot/`. Outputs go to `web/public/data/` (GeoJSON +
`summary.json`) and `data/tables/{validation,exposure}.csv`.

### The result

The HAND corridor is derived from a 30 m elevation model and nothing else — no
imagery, no flood report. Inside the study rectangle it covers **4.35% of the
area**, and it contains:

| Ground evidence (n in ROI) | In HAND corridor | In detected damage (0.41% of area) |
| :-- | --: | --: |
| Destroyed buildings (775) | **96.1%** | 55.5% — 135× base rate |
| Bridges washed out (13) | **100%** | 38.5% — 94× |
| Roads destroyed (172) | **94.2%** | 47.7% — 116× |
| HOT observed flood extent | **90.6%** | 29.5% |

Where a flood can reach turns out to be a terrain question long before it is an
imaging one, which is the case for stage 3 existing at all.

Two numbers that look bad and are not:

- **Only 29.5% of the observed extent is flagged.** Most of that extent is the
  river channel itself, which was already water on 25 August, so a *change*
  detector correctly finds nothing there. Read concentration instead: 41.7% of
  detections land inside observed water against a 0.59% base rate, **71×**.
- **Hydropowers score 25% / 0%.** n = 4 inside the ROI, and the points are plant
  locations rather than the headworks that actually flooded. Reported because
  leaving it out would be cherry-picking.

## Way 5 — before/after imagery

```bash
python pipeline/stage5_overlays.py
```

Reprojects the Sentinel-2 composites to Web Mercator and writes them as PNGs the
map lays over the terrain, plus `overlays.json` with the bounds, windows and
cloud cover. Two decisions worth knowing:

- **One stretch for both dates.** Stage 2's plate percentile-stretches each image
  independently, which is right for looking at one scene and wrong for comparing
  two — a chunk of the apparent change would be the normalisation moving rather
  than the ground. The stretch is computed on the pre-event image and applied
  unchanged to the post.
- **EPSG:3857, not UTM.** Leaflet stretches an `ImageOverlay` linearly between
  two corners in Web Mercator. Hand it a UTM raster with lat/lon corners and the
  pixels land in roughly the right place and precisely the wrong one, with the
  error growing across the frame.

The post-event composite is **17% cloud-free** against the pre's **87%**. Gaps
are transparent rather than filled, and both figures are printed on the slider —
dragging across a hole should tell you it is cloud, not clear ground. For the
same reason the labels read `1–25 Aug 2026` and `26 Aug – 1 Sep 2026`: these are
median composites over a window, not single acquisitions, and dating them exactly
would be a lie.

The PNGs are 5.7 MB and load only when the slider is opened.

## Way 6 — the static site

```bash
cd web
npm install                 # react, react-dom, leaflet; esbuild + jsdom as dev deps
node build.mjs              # -> ../site/, ready to publish
node build.mjs --serve      # watched, http://localhost:5173
node smoke.mjs              # check the built site actually renders
```

`site/` is plain static files — drop it on GitHub Pages, Netlify, S3, anything.
No Vite, no framework CLI: esbuild bundles `src/main.jsx` in about 20 ms.

The page is an interactive Leaflet map over the whole corridor with 14 toggleable
layers, split into what HOT *observed* and what this pipeline *derived*, plus the
validation above, exposure tables, method, caveats and a GeoJSON download for
every layer. Interaction:

| | |
| :-- | :-- |
| Zoom | Quarter-level steps — the corridor is 120 km but a washed-out bridge is metres. `+` / `−` / `f` to fit |
| Before/after | `◐` opens a draggable divider over the pre/post imagery, each side dated |
| Click | A bridge, building or zone id flies there **and** opens the comparison |
| Opacity | A slider per group fades observed against derived, which is the whole argument |
| Zoom-gated | 1,626 building footprints draw from z12.5; the panel says so rather than looking broken |
| Share | The view lives in the URL hash, so any view can be linked | `pipeline/stage4_hot.py` writes `web/public/data/`, so the app fetches static
files at runtime rather than inlining 2.6 MB into the bundle.

`web/public/data/` is committed for the same reason `maps/` is: regenerating it
needs the stage 1–3 rasters, which need Earth Engine credentials.

## Check it

```bash
python pipeline/test_analysis.py                 # stage 2
python pipeline/test_corridor.py                 # stage 3
cd web && node build.mjs && node smoke.mjs   # the site, incl. the slider
```

`pipeline/test_analysis.py` builds synthetic rasters with a known damage footprint —
including a patch that is only visible to SAR because it sits under simulated
cloud — runs all of stage 2 over them, and asserts the reported area comes back
exactly (0.80 km²).

`pipeline/test_corridor.py` builds a V-shaped valley whose answer is known on paper. The
floor drops 2 m per row and the sides rise 5 m per cell, so D8 sends a hillslope
cell straight across the contour rather than diagonally downstream (5 m over one
cell beats 7 m over √2 cells) and `HAND(row, col) = 5·|col − 40|` exactly. Every
assertion falls out of that one line: HAND to within 0.5 m, the corridor exactly
as many columns wide as the threshold allows, accumulation collecting 100% of the
domain at the outlet, a bowl filled to its rim and no further.

`web/smoke.mjs` loads the *built* bundle in jsdom with `fetch` served off disk,
so it exercises the real data contract: if `pipeline/stage4_hot.py` renames a field, drops
a layer or emits a `NaN` that `JSON.parse` rejects, it fails there instead of
rendering a blank page in someone's browser. It asserts the page quotes real
figures, Leaflet initialises, all 14 layers parse, and the console stays clean.

No pytest, no fixtures, no test framework.

## Things to fix before this is publishable

- **Zone coordinates are placeholders.** Only Z1 (Rasuwagadhi, 28.278 N 85.378 E)
  is stated in the proposal. Z2a–Z5 are approximate — refine them against the
  stage 1 imagery, then re-run stage 2.
- **Z5 (Betrawati) falls outside the default ROI.** Stage 1 warns about this.
  Drop `ROI`'s south edge to ~27.90 in `pipeline/config.py` if you want it covered.
- **Flow accumulation is truncated at the ROI edge.** The Bhote Koshi enters from
  the north already a major river, but its Tibetan headwaters are outside the DEM,
  so accumulation restarts from zero at the boundary and the first few kilometres
  below it are undercounted. `MIN_DRAINAGE_KM2` is low enough (8 km²) that the
  trunk re-forms quickly; a padded DEM export would fix it properly, and the DEM
  is a single band, so re-downloading just that one is cheap.
- **`scour_width_m` is a swath width, not a channel width.** It is flood-damage
  area per metre of channel — the width of the disturbed valley floor, which is
  the widened channel plus its deposition aprons. Do not quote it as the wetted
  channel width, and do not derive §4.1's widening ratio from it without a
  pre-event waterline.
- **No radiometric terrain flattening on the SAR.** Same-orbit differencing
  cancels most of the topographic bias, which is why the orbit matching above
  matters, but the residual is real on the steepest slopes. Use SNAP/`gamma0` if
  you need calibrated backscatter rather than change detection.
- **Thresholds are the proposal's, not calibrated.** They are the right starting
  point, not a validated classifier. Digitise a handful of known-damaged and
  known-intact polygons from the PlanetScope imagery and tune against those.
- **Z2b Ghattekhola has only 7.1% usable optical pixels.** Its 1.6% figure rests
  almost entirely on SAR and should not be quoted without that caveat. Check
  `optical_valid_pct` in `zonal_damage.csv` before citing any zone.
- **Stage 3 says nothing about how the corridor was reached.** HAND asks only
  whether a cell is low enough above the drainage network. It has no notion of
  flow volume, velocity or timing, so it cannot distinguish the 26 August surge
  from ordinary high-monsoon inundation on the same valley floor. That separation
  needs the hydrodynamic model in §6.2, for which `terrain.tif` is the input.
- **The high-altitude collapse source is out of scope of the mask.** Excluding
  snow/ice from `SCL_KEEP` is what stops fresh snowfall reading as damage, but it
  also means this pipeline cannot speak to the genesis zone in proposal §2. That
  needs a snow/ice-aware analysis with its own thresholds.
- **The validation is one event, one corridor.** 96% of destroyed buildings
  falling inside the corridor says the corridor is well drawn *here*. It is not a
  cross-validated skill score, and HOT's mapping is itself densest along the
  river, which inflates any containment statistic computed against it.
- **Not built:** the HEC-RAS / Telemac-2D hydrodynamic model (§6.2) and
  PlanetScope ingestion (commercial, needs a Planet API key). Stage 3's
  `terrain.tif` is the conditioned surface HEC-RAS wants — hydrologically
  enforced, metric, with `fill_m` marking which parts of it are reconstructed
  rather than measured — and `corridor.shp` bounds the 2D mesh.
