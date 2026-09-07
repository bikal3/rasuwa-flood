# Rasuwa transboundary flood

Multi-sensor change detection and a terrain-derived flood corridor for the
26 August 2026 Bhote Koshi and Trishuli flood, tested against the Humanitarian
OpenStreetMap Team's ground survey and published as a public information site at
**[rasuwaflood.bikal3.com.np](https://rasuwaflood.bikal3.com.np)**.

Comments in the code cite the project proposal by section ("proposal §3.2") for
the thresholds, indices and impact zones. It is not in the tree; it is in git
history: `git show 3f629c2:Rasuwa_Nepal_China_Flood_Project_Proposal.md`.

## Stages

| Stage | Script | Produces |
| :-- | :-- | :-- |
| 1 | `pipeline/stage1_export.py` | Sentinel-1/2 and SRTM rasters, AOI and zone vectors |
| 2 | `pipeline/stage2_analysis.py` | change rasters, damage polygons, zonal stats, plates |
| 3 | `pipeline/stage3_corridor.py` | terrain + HAND, the flood corridor, corridor-confined damage |
| 4 | `pipeline/stage4_hot.py` | HOT ground survey, validation scores, the site's data |
| 5 | `pipeline/stage5_overlays.py` | pre/post optical + radar PNGs in Web Mercator |
| — | `web/` | the ten-page static site |

Each stage reads the previous one's files off disk and nothing else. No stage
calls another, so stage 1's output is usable on its own in ArcGIS Pro or QGIS.

```
pipeline/       the Python stages and their checks; everything tunable is config.py
web/            React source; routes.mjs is the page table, build.mjs writes one HTML per page
data/           stage outputs (gitignored except tables/*.csv)
maps/           matplotlib plates, committed
site/           built site, gitignored -- rebuild with: cd web && node build.mjs
.node-version   pins Node 20 for the Cloudflare Pages build
```

Run the stages from anywhere; `config.py` resolves every path against the repo
root, not its own directory.

## Setup

```bash
pip install earthengine-api rasterio geopandas matplotlib pandas scipy requests
earthengine authenticate          # once
export EE_PROJECT=your-gcloud-project-id
```

Study area, dates, pixel size, thresholds and impact zones all live in
`pipeline/config.py`. All five stages read it; edit nothing else.

## Stage 1 — export

```bash
python pipeline/stage1_export.py
```

Writes `data/`, all **EPSG:32645** (UTM 45N, metres), **NODATA −9999**:

```
data/raster/s2_pre.tif     B2 B3 B4 B8 B11 B12   surface reflectance 0–1
data/raster/s2_post.tif    ″
data/raster/s2raw_*.tif    B4 B3 B2, cloud mask off -- the slider's "before the filter"
data/raster/s1_pre.tif     VV VH   sigma0 dB
data/raster/s1_post.tif    ″
data/raster/dem.tif        SRTM elevation, m
data/raster/manifest.csv   what each file is, which window, which sensor
data/vector/aoi.shp        study rectangle
data/vector/zones.shp      the 6 impact zones from proposal §4, buffered
data/vector/*.geojson      same, WGS84
```

Bands carry descriptions, so ArcGIS Pro shows `B8`, not `Band_4`. Everything is
already projected and metric, so Zonal Statistics and Raster Calculator give real
areas with no reprojection step.

Files that already exist are skipped, and **their manifest rows are preserved
rather than rewritten**. `shared_orbit()` is data-dependent — Earth Engine's
holdings change — so a later run can resolve a different orbit while the cached
SAR stays as it was, and rewriting its row from the new run would silently
describe the file as something it is not.

Both SAR dates come from the **same relative orbit** — the script picks one that
covers both windows. Mixing orbits across a pre/post pair manufactures fake
change in steep terrain, because local incidence angle, layover and radar shadow
all move. Bands download one request at a time, which keeps each under Earth
Engine's ~48 MB cap, so dropping `SCALE` from its default 20 m to 10 m needs no
chunking logic — it just costs ~640 MB instead of ~160 MB.

## Stage 2 — change detection

```bash
python pipeline/stage2_analysis.py
```

```
data/derived/change_stack.tif        dNDVI dMNDWI dNBR dVV dVH
data/derived/damage_mask.tif         uint8, 1 = changed
data/derived/damage_polygons.shp|.geojson
data/tables/zonal_damage.csv         per zone: area, %, mean dNDVI, mean ΔVV
maps/01–06_*.png                     true colour, the three indices, damage, zones
```

Thresholds are proposal §3.2 and §5:

```
dNDVI  = NDVI_pre  − NDVI_post      > 0.25   vegetation removed or buried
dMNDWI = MNDWI_post − MNDWI_pre     > 0.30   new standing / turbid water
Δσ°VV  = VV_post − VV_pre (dB)      > 3 dB   surface roughness change
damage = spectral OR SAR
```

**The OR matters.** Late-August Rasuwa is under monsoon cloud, so the optical
pair can be largely no-data. NaN comparisons are `False`, so those pixels fall
through to the SAR rather than reading as "no change". Console output and every
diverging plate report the usable-optical percentage.

Three things keep the thresholds meaning what they say:

- **`despeckle()`** — 5×5 boxcar multilook in **linear power** (averaging
  decibels biases low). One Sentinel-1 scene per window on orbit 85 means
  `median()` does no temporal averaging, and the raw difference is ~2 dB of
  speckle with 13% past the threshold; after the multilook, 0.98 dB and 0.9%.
- **A tight `SCL_KEEP`** — vegetation, bare ground and water only. Including
  dark/shadow, unclassified and snow puts a **+0.099** scene-wide dNDVI bias in
  the result; without them it is **+0.007**.
- **`debias()`** — subtracts the median from each difference image so unchanged
  ground sits at zero. Offsets are printed every run. Safe only because the
  corridor is a small fraction of the ROI; tighten the ROI to the affected valley
  and it would subtract signal.

Result: **29.5 km²** of change in 1,966 polygons.

## Stage 3 — confine it to the corridor

```bash
python pipeline/stage3_corridor.py
```

A debris flood is confined to ground the river can reach. Stage 3 derives that
ground from the DEM alone and intersects it with stage 2's mask.

```
data/derived/terrain.tif           filled_dem, fill_m, drainage_km2, hand_m
data/derived/channel|corridor.shp|.geojson
data/derived/flood_damage.tif      uint8, stage 2 mask AND corridor
data/derived/flood_damage_polygons.shp|.geojson
data/tables/zonal_flood.csv        per zone: corridor, flood area, scour width
data/tables/change_vs_hand.csv     change rate against height above the river
maps/07–09_*.png                   corridor, kept vs rejected, the HAND profile
```

Plain numpy and scipy, no hydrology dependency: priority-flood depression fill →
D8 steepest descent → flow accumulation → channel at ≥ `MIN_DRAINAGE_KM2` (8 km²,
224 km of network) → HAND → corridor at HAND ≤ `HAND_MAX_M`.

**29.5 km² of change becomes 4.1 km² of flood damage** in 279 polygons, tracing a
continuous ribbon down the Bhote Koshi instead of a scatter over the hillslopes.

`change_vs_hand.csv` is what justifies the corridor rather than assuming it — if
the detections were noise the profile would be flat:

| HAND | 0–5 | 5–10 | 10–20 | 20–30 | 30–50 | 50–100 | 100–200 | 200–500 | 500+ |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| change rate | 9.6% | 8.7% | 9.2% | 9.8% | 9.1% | 6.7% | 4.9% | 3.5% | 2.1% |

**`HAND_MAX_M` is 50, not the 30 the proposal's +7–9 m surge figure alone would
argue for, because the plateau ends at 50.** Charging the corridor the 2.1%
far-field floor leaves **3.2 km² attributable to the flood**. Re-read the table
after changing the ROI or the stage 2 thresholds.

Two things the corridor deliberately does not do:

- **It does not drop the depression fill.** Filtering out cells the fill raised
  cuts 39% of the trunk river, and those cells run at 7.4× the far-field change
  rate against 4.2× for unfilled ground — they are the deep reaches where SRTM's
  C-band bridged the gorge instead of reaching the bottom. `fill_m` is carried as
  a band so the reconstruction stays visible, which matters if `terrain.tif` is
  used as a HEC-RAS surface. 19% of the corridor is reconstructed ground.
- **It does not measure river width.** On trunk-channel cells VV never goes
  specular (1st percentile −14.9 dB, median −7.5 dB, against a −16 dB water
  threshold): a 20–60 m whitewater gorge river is rough, mixed-pixel and
  foreshortened against bright banks. `scour_width_m` is flood-damage area per
  metre of channel instead — the disturbed swath, 50–84 m at Z1/Z2a/Z3/Z4.

## Stage 4 — ground truth

```bash
python pipeline/stage4_hot.py
```

Pulls HOT's response export for this event —
[`hot_flood_npl`](https://data.humdata.org/dataset/hot_flood_npl), ODC-ODbL —
mapped from drone, Landsat, PlanetScope and Sentinel imagery plus volunteer field
reports, independently of anything here. Downloads cache in `data/hot/`; outputs
go to `web/public/data/` (GeoJSON + `summary.json`) and
`data/tables/{validation,exposure}.csv`.

The corridor comes from a 30 m elevation model and nothing else. Inside the study
rectangle it covers **4.35% of the area**, and contains:

| Ground evidence (n in ROI) | In HAND corridor | In detected damage (0.41% of area) |
| :-- | --: | --: |
| Destroyed buildings (775) | **96.1%** | 55.5% — 135× base rate |
| Bridges washed out (13) | **100%** | 38.5% — 94× |
| Roads destroyed (172) | **94.2%** | 47.7% — 116× |
| HOT observed flood extent | **90.6%** | 29.5% |

Two numbers that look bad and are not:

- **Only 29.5% of the observed extent is flagged.** Most of it is river channel
  that was already water on 25 August, where a *change* detector correctly finds
  nothing. Read concentration: 41.7% of detections land inside observed water
  against a 0.59% base rate, **71×**.
- **Hydropowers score 25% / 0%.** n = 4 in the ROI, and the points are plant
  locations rather than the headworks that flooded. Reported because leaving it
  out would be cherry-picking.

## Stage 5 — before/after imagery

```bash
python pipeline/stage5_overlays.py
```

Reprojects the Sentinel-2 composites to Web Mercator as 8-bit palette PNGs, plus
`overlays.json` with bounds, windows and valid cover.

- **Two pairs of the same imagery**, differing only in whether the cloud mask
  ran. *Without the filter* is every pixel the satellite returned — on a monsoon
  week over a Himalayan gorge, an after-frame that is almost solid cloud. *With
  the filter* is the same median composite with cloud, shadow and snow dropped
  per pixel by `SCL_KEEP`, leaving the post-event frame **17% cloud-free**
  against the pre's **87%**. The holes are the point: they are what the filter
  removed. Stage 1 exports the unmasked pair as `s2raw_{pre,post}.tif`, true
  colour only, and nothing in the analysis reads them.
- **The unmasked tag says "of pixels kept", not "of the frame".** It sits beside
  an image that is solid cloud, and a percentage there is read as a clarity
  figure unless it is worded so it cannot be.
- **One stretch across all four frames**, computed on the *masked* pre-event
  image so the percentiles come off ground rather than cloud tops. Give each
  pair its own and the unmasked one renders darker, which would make the filter
  switch look like a brightness control.
- **EPSG:3857, not UTM** — Leaflet stretches an `ImageOverlay` linearly between
  two corners in Web Mercator, so a UTM raster lands wrong and the error grows
  across the frame.

Gaps are transparent and the valid figure is printed on the slider, so dragging
across a hole tells you it is cloud rather than clear ground. Labels read
`1–25 Aug 2026` and `26 Aug – 1 Sep 2026` because these are median composites
over a window, not single acquisitions.

There is no cloud-free optical view of this ground after the event, which is why
the detection accepts a change flagged by radar alone and why only 29.5% of the
observed extent could be confirmed. The slider shows the optical half of that
problem; it does not show the radar.

## The site

```bash
cd web
npm install
node build.mjs              # -> ../site/
node build.mjs --serve      # watched, http://localhost:5173
node smoke.mjs              # check every page renders
```

Ten static pages in four groups, so a general reader and a specialist take
different routes through the same material:

| Group | Pages |
| :-- | :-- |
| — | Overview |
| Understand | How it works · Glossary |
| Explore data | Flood map · Before & after |
| Analysis | Terrain corridor · Satellite detection · Damage & exposure |
| Reference | Method & limits · Data & sources |

**Multi-page, and no router.** `web/src/routes.mjs` is the one table of pages;
`build.mjs` writes a real directory and `index.html` per entry, each loading the
same bundle and told which page it is by a `data-page` attribute — so the
browser's own navigation handles back, forward, middle-click and deep links, and
no host needs a 404-rewrite rule. `data-base` carries the path back to the root,
so the site also works mounted in a subdirectory. `href()` in `base.js` resolves
links by **route id**, not path, because the two differ (`how` lives at
`how-it-works/`).

Every figure on every page is read from `summary.json` at load time. No number is
written into the page source, so the prose cannot drift from what the pipeline
computed — and that file is on the downloads page, so no statistic on the site is
missing from the download.

Two interactive maps, on pages of their own:

| | |
| :-- | :-- |
| Zoom | Quarter-level steps — the corridor is 120 km but a washed-out bridge is metres. `+` / `−` / `f` to fit |
| Fly to | Leads the layer panel: four named places is how anyone moves along 120 km |
| Click | A bridge, building or zone id selects it and flies there |
| Opacity | A slider per group fades observed against derived, which is the whole argument |
| Zoom-gated | 1,626 building footprints draw from z12.5; the panel says so rather than looking broken |
| Scroll | The page's, not the map's — plain wheel scrolls, ctrl/⌘ zooms, one finger scrolls and two pan (`web/src/gestures.js`) |
| Share | The view lives in the URL hash, so any view can be linked |

`stage4_hot.py` writes `web/public/data/`, so the app fetches static files at
runtime rather than inlining 2.6 MB into the bundle. That directory is committed
for the same reason `maps/` is: regenerating it needs the stage 1–3 rasters,
which need Earth Engine credentials.

## Deploy

Cloudflare Pages. Connect the repo once; every push to `main` rebuilds it.

| Setting | Value |
| :-- | :-- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `cd web && npm ci && npm run pages` |
| Output directory | `site` |
| Node version | `.node-version` pins it to 20 |

`npm run pages` is `node build.mjs && node smoke.mjs`, so a site that fails the
check never deploys. GitHub Pages would want this repository public or a paid
plan; Cloudflare Pages serves a private one free, and the DNS for `bikal3.com.np`
is already there.

## Check it

```bash
python pipeline/test_analysis.py             # stage 2
python pipeline/test_corridor.py             # stage 3
cd web && node build.mjs && node smoke.mjs   # all 10 pages
cd web && node swipe-check.mjs               # the slider and the bars, in real Chrome
```

No pytest, no fixtures, no test framework.

`test_analysis.py` builds synthetic rasters with a known damage footprint —
including a patch visible only to SAR, under simulated cloud — runs all of stage
2 over them, and asserts the reported area comes back exactly (0.80 km²).

`test_corridor.py` builds a V-shaped valley whose answer is known on paper: the
floor drops 2 m per row and the sides rise 5 m per cell, so `HAND(row, col) =
5·|col − 40|` exactly. Every assertion falls out of that one line.

`smoke.mjs` loads every page's built bundle in jsdom, each from its own URL at its
own directory depth with `fetch` served off disk, so it exercises the real data
contract — a renamed field, a dropped layer or a `NaN` fails here rather than
rendering blank in a browser, and a wrong `data-base` fails rather than 404-ing in
production. Every internal link on every page is resolved against the files on
disk. Figures it checks are read from `summary.json` and `overlays.json` rather
than transcribed, so re-running stage 4 or 5 cannot break it for no reason.

`swipe-check.mjs` drives real Chrome over CDP, no dependencies, because jsdom has
no layout: it stubs every box to the same rectangle, so a `clip-path` or a bar
width that resolves to nothing on screen passes there. It measures the strip of
each overlay that survives its clip, and every bar against its own track.

## Known limits

- **Zone coordinates are placeholders.** Only Z1 (Rasuwagadhi, 28.278 N
  85.378 E) is stated in the proposal. Z2a–Z5 are approximate.
- **Z5 (Betrawati) falls outside the default ROI.** Stage 1 warns. Drop `ROI`'s
  south edge to ~27.90 in `config.py` to cover it.
- **Flow accumulation is truncated at the ROI edge.** The Bhote Koshi's Tibetan
  headwaters are outside the DEM, so accumulation restarts from zero at the
  boundary and the first kilometres below it are undercounted. A padded DEM
  export would fix it; the DEM is a single band, so re-downloading it is cheap.
- **`scour_width_m` is a swath width, not a channel width.** Do not derive
  proposal §4.1's widening ratio from it without a pre-event waterline.
- **No radiometric terrain flattening on the SAR.** Same-orbit differencing
  cancels most of the topographic bias, but the residual is real on the steepest
  slopes. Use SNAP/`gamma0` for calibrated backscatter.
- **Thresholds are the proposal's, not calibrated.** A starting point, not a
  validated classifier.
- **Z2b Ghattekhola has only 7.1% usable optical pixels.** Its 1.6% figure rests
  almost entirely on SAR. Check `optical_valid_pct` in `zonal_damage.csv` before
  citing any zone.
- **HAND says nothing about how the corridor was reached** — no flow volume,
  velocity or timing, so it cannot distinguish the 26 August surge from ordinary
  high-monsoon inundation. That needs a hydrodynamic model, for which
  `terrain.tif` is the input.
- **The collapse source is out of scope of the mask.** Excluding snow/ice from
  `SCL_KEEP` stops fresh snowfall reading as damage, but also means this pipeline
  cannot speak to the genesis zone.
- **The validation is one event, one corridor.** Not a cross-validated skill
  score, and HOT's mapping is itself densest along the river, which inflates any
  containment statistic computed against it.
- **Not built:** the HEC-RAS / Telemac-2D hydrodynamic model (proposal §6.2) and
  PlanetScope ingestion (commercial, needs a Planet API key). `terrain.tif` is
  the conditioned surface HEC-RAS wants and `corridor.shp` bounds the 2D mesh.
