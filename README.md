# Rasuwa transboundary flood

Multi-sensor change detection and a terrain-derived flood corridor for the
26 August 2026 Bhote Koshi and Trishuli flood, tested against the Humanitarian
OpenStreetMap Team's ground survey and published as a public information site at
**[rasuwaflood.bikal3.com.np](https://rasuwaflood.bikal3.com.np)**.

[![The Trishuli at Betrawati on 12 and 27 August 2026 side by side: a narrow
river threading a green valley floor, and the same ground with a bare grey bed
several times wider, the fields either side of it buried under flood
deposits.](web/public/share.jpg)](https://rasuwaflood.bikal3.com.np/compare/)

The Trishuli at Betrawati, at the foot of the corridor and 30 km south of the
study rectangle, on the two Sentinel-2 passes either side of the flood — one
acquisition each, not a composite. `stage5_overlays.py` draws this from the same
two scenes it writes the site's slider from, so the picture and [the draggable
version](https://rasuwaflood.bikal3.com.np/compare/) cannot disagree. It is a
picture of the event, not evidence for the figures below: those come from the
study rectangle, which had no clear optical view after 26 August.

Comments in the code cite the project proposal by section ("proposal §3.2") for
the thresholds, indices and impact zones. It is not in the tree; it is in git
history: `git show 3f629c2:Rasuwa_Nepal_China_Flood_Project_Proposal.md`.

## What it found

Stage 2 flags **29.5 km²** of change in 1,966 polygons across the 1,006 km²
study rectangle. Confining it to ground the river can reach leaves **4.2 km²**
of flood damage in 290 polygons, a continuous ribbon down the Bhote Koshi rather
than a scatter over the hillslopes; charging that the far-field false-positive
rate leaves **3.3 km²** attributable to the flood.

The corridor comes from a 30 m elevation model and nothing else — no imagery. It
covers 4.51% of the study area, and the ground survey lands inside it — HOT's
response export for this event
([`hot_flood_npl`](https://data.humdata.org/dataset/hot_flood_npl), ODC-ODbL),
mapped from drone, Landsat, PlanetScope and Sentinel imagery plus volunteer
field reports, independently of anything here — the 2 October 2026 export:

| Ground evidence (n in ROI) | In HAND corridor | In detected damage (0.41% of area) |
| :-- | --: | --: |
| Destroyed buildings (800) | **96.2%** | 54.9% — 134× base rate |
| Bridges washed out (13) | **100%** | 38.5% — 94× |
| Roads destroyed (191) | **93.2%** | 44.5% — 109× |
| HOT observed flood extent | **90.8%** | 29.5% |

Only 29.5% of the observed extent is flagged because most of it is river channel
that was already water on 25 August, where a *change* detector correctly finds
nothing. Read concentration instead: 40.9% of detections land inside observed
water against a 0.57% base rate, **71×**.

Every figure here is recomputed by the pipeline into
`web/public/data/summary.json`, which is what the site reads and what the
downloads page serves. None of them is transcribed by hand.

## Quickstart

```bash
pip install earthengine-api rasterio geopandas matplotlib pandas scipy requests pillow
earthengine authenticate                     # once
export EE_PROJECT=your-gcloud-project-id

python pipeline/stage1_export.py             # ~160 MB out of Earth Engine
python pipeline/stage2_analysis.py
python pipeline/stage3_corridor.py
python pipeline/stage4_hot.py --refresh      # drop --refresh to reuse data/hot/
python pipeline/stage5_overlays.py

cd web && npm install
node build.mjs                               # -> ../site/
node build.mjs --serve                       # watched, http://localhost:5173
```

Study area, dates, pixel size, thresholds and impact zones all live in
`pipeline/config.py`. Every stage reads it; nothing else needs editing. Run the
stages from anywhere — `config.py` resolves paths against the repo root, not its
own directory.

## Stages

| Stage | Script | Produces |
| :-- | :-- | :-- |
| 1 | `pipeline/stage1_export.py` | Sentinel-1/2 and SRTM rasters, AOI and zone vectors |
| 2 | `pipeline/stage2_analysis.py` | change rasters, damage polygons, zonal stats, plates |
| 3 | `pipeline/stage3_corridor.py` | terrain + HAND, the flood corridor, corridor-confined damage |
| 4 | `pipeline/stage4_hot.py` | HOT ground survey, validation scores, the site's data |
| 5 | `pipeline/stage5_overlays.py` | the before/after slider's images, and the share card |
| — | `web/` | the ten-page static site |

Each stage reads the previous one's files off disk and nothing else. No stage
calls another, so stage 1's output stands on its own in ArcGIS Pro or QGIS — it
is plain GeoTIFF and Shapefile, already projected and metric, with bands named
`B8` rather than `Band_4` — and any stage can be re-run alone.

```
pipeline/       the Python stages and their checks; everything tunable is config.py
web/            React source; routes.mjs is the page table, build.mjs writes one HTML per page
data/           stage outputs (gitignored except tables/*.csv)
maps/           matplotlib plates, committed
site/           built site, gitignored -- rebuild with: cd web && node build.mjs
.node-version   pins Node 20 for the Cloudflare Pages build
```

**Where the reasoning lives.** Every script opens with a docstring listing its
exact outputs and saying why it does what it does, and every threshold in
`config.py` carries its justification beside the value. This README does not
repeat them. The ones worth reading before citing a number:

| Question | Where |
| :-- | :-- |
| Why both SAR dates come from one relative orbit | `stage1_export.py` → `shared_orbit()` |
| Why a cached file keeps its old manifest row | `stage1_export.py` → `read_manifest()` |
| Why the SAR is multilooked in linear power | `stage2_analysis.py` → `despeckle()` |
| Why each difference image is re-centred on zero | `stage2_analysis.py` → `debias()` |
| Why damage is spectral **OR** radar, never AND | `stage2_analysis.py` → `damage_mask()` |
| Which cloud classes are dropped, and what that costs | `config.py` → `SCL_KEEP` |
| Why the DEM is exported 12 km wider than the ROI | `config.py` → `DEM_PAD_KM` |
| Why `HAND_MAX_M` is 50 and not the surge's 30 | `config.py` → `HAND_MAX_M` |
| Why the depression fill is kept rather than filtered out | `stage3_corridor.py` → `corridor_from_dem()` |
| Why `scour_width_m` is a swath, not a channel width | `stage3_corridor.py` → `zonal_flood()` |
| Why point evidence beats area overlap for validation | `stage4_hot.py` → `hit_rate()` |
| Why the HOT cache has to be refreshed rather than kept | `stage4_hot.py` → `fetch()` |
| Why the slider frames Betrawati, not the study area | `stage5_overlays.py` |
| Why one fixed tone curve renders all four frames | `stage5_overlays.py` → `tone()` |

`data/tables/change_vs_hand.csv` is the one output to read before trusting the
corridor: the stage 2 change rate holds at ~9% from the river up to 50 m above
it and falls away to 2.0% beyond 500 m. If the detections were noise that
profile would be flat.

## The site

Ten static pages in four groups, so a general reader and a specialist take
different routes through the same material:

| Group | Pages |
| :-- | :-- |
| — | Overview |
| Understand | How it works · Glossary |
| Explore data | Flood map · Before & after |
| Analysis | Terrain corridor · Satellite detection · Damage & exposure |
| Reference | Method & limits · Data & sources |

**Multi-page, and no router** — `web/src/routes.mjs` is the one table of pages
and `build.mjs` writes a real directory per entry, so the browser's own
navigation does the work and no host needs a rewrite rule. `build.mjs`'s own
docstring says how, and `web/src/MapView.jsx` and `gestures.js` say why the two
interactive maps behave as they do.

Every figure on every page is read from `summary.json` at load time, so the prose
cannot drift from what the pipeline computed. `stage4_hot.py` writes
`web/public/data/`, which is committed for the reason `maps/` is: regenerating it
needs the stage 1–3 rasters, which need Earth Engine credentials.

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
python pipeline/test_analysis.py             # stage 2, on synthetic rasters
python pipeline/test_corridor.py             # stage 3, on a valley solved on paper
python pipeline/test_overlays.py             # stage 5's tone curve
python pipeline/test_hot.py                  # stage 4's published data vintage
cd web && node build.mjs && node smoke.mjs   # all 10 pages, in jsdom
cd web && node swipe-check.mjs               # the slider and the bars, in real Chrome
```

No pytest, no fixtures, no test framework. Each file's docstring says what it
proves and why it is written the way it is — `swipe-check.mjs` in particular
exists because jsdom has no layout, so a `clip-path` that resolves to nothing on
screen passes there.

## Known limits

- **Zone coordinates are placeholders.** Only Z1 (Rasuwagadhi, 28.278 N
  85.378 E) is stated in the proposal. Z2a–Z5 are approximate.
- **Z5 (Betrawati) falls outside the default ROI.** Stage 1 warns. Drop `ROI`'s
  south edge to ~27.90 in `config.py` to cover it.
- **`drainage_km2` is a lower bound**, not a catchment area: the Bhote Koshi's
  Tibetan headwaters are ~100 km above the raster.
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
  velocity or timing, so it cannot separate the 26 August surge from ordinary
  high-monsoon inundation. That needs a hydrodynamic model, for which
  `terrain.tif` is the input.
- **The collapse source is out of scope of the mask.** Excluding snow/ice from
  `SCL_KEEP` stops fresh snowfall reading as damage, but also means this pipeline
  cannot speak to the genesis zone.
- **The validation is one event, one corridor.** Not a cross-validated skill
  score, and HOT's mapping is itself densest along the river, which inflates any
  containment statistic computed against it.
- **The ground truth is a moving target, and the figures above are a floor.**
  HOT keeps mapping for months. The first run of this pipeline cached the
  31 August export, five days after the event; the 2 October one carries 2,886
  destroyed buildings where that had 1,611, and 800 inside the ROI where it had
  775. `stage4_hot.py --refresh` re-downloads and recomputes, and the site and
  `summary.json` both carry the export's own date so a stale number is visible
  rather than silent. Re-run before citing anything here.
- **Hydropowers score 25% / 0%** on n = 4, because the points are plant
  locations rather than the headworks that flooded. Reported rather than dropped.
- **English only.** This is a public information site about a Nepali event, and
  part of its audience reads Nepali. `web/src/pages.jsx` interleaves prose with
  figures from `summary.json`, so a second language needs those strings extracted
  into a catalogue first, and a native reviewer rather than a machine. Deferred
  deliberately, not overlooked.
- **Not built:** the HEC-RAS / Telemac-2D hydrodynamic model (proposal §6.2) and
  PlanetScope ingestion (commercial, needs a Planet API key). `terrain.tif` is
  the conditioned surface HEC-RAS wants and `corridor.shp` bounds the 2D mesh.
