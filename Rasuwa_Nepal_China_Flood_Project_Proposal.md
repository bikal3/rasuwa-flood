# Geospatial Project Framework: Transboundary Disaster Analysis of the 2026 Rasuwa (Nepal–China Border) Glacial Debris Flow & Flood

**Project Title:** Multi-Sensor Remote Sensing & GIS-Based Change Detection for Genesis, Inundation Mapping, and Infrastructure Damage Assessment of the Rasuwa Transboundary Flash Flood  
**Study Region:** Lende Khola & Bhote Koshi / Trishuli River Corridors (Rasuwa District, Bagmati Province, Nepal & Gyirong County, Tibet Autonomous Region, China)  
**Target Event:** August 26, 2026 Glacial Collapse and Debris Flood  

---

## 1. Project Overview & Objectives

### 1.1 Executive Summary
On August 26, 2026, a catastrophic transboundary flash flood and hyper-concentrated debris flow devastated the Nepal–China border region along the Bhote Koshi and Trishuli River basins. Originating from an unprecedented high-altitude ice-and-rock avalanche on the flanks of Langtang Lirung, the event caused an equivalent $M_s\;5.2$ seismic signal, swept away key international border infrastructure (Rasuwagadhi–Gyirong Port), crippled strategic hydropower installations, and severely impacted downstream human settlements.

This project outlines an end-to-end geospatial and hydrological research pipeline to:
1. **Trace Flood Genesis:** Pinpoint the exact high-altitude collapse origin, track the physical transformation of the avalanche into a debris flow along the Lende Khola, and model propagation dynamics.
2. **Execute Multi-Temporal Change Detection:** Quantify pre- and post-disaster land surface alterations using optical (Sentinel-2, Landsat-9, PlanetScope) and Synthetic Aperture Radar (Sentinel-1 C-band SAR) datasets.
3. **Assess Zonal Vulnerability & Critical Infrastructure Loss:** Map localized impacts across border checkposts, hydropower projects, arterial roadways (Pasang Lhamu Highway), and riparian settlements.

---

## 2. Flood Initiation & Hazard Genesis Analysis

```
+-------------------------------------------------------------------------+
| Langtang Lirung Northern Flank (~5,200 m - 5,400 m)                     |
| Mass Wasting: ~0.2 km² / 100M–200M m³ Glacial Ice & Bedrock Collapse   |
| Seismicity: Ms 5.2 Landslide-Induced Tremor (USGS / DMG Stations)       |
+-------------------------------------------------------------------------+
                                    │
                                    ▼ (~1.2 km Vertical Free-Fall)
+-------------------------------------------------------------------------+
| Lende Khola Valley (High-Energy Friction & Frictional Melting)          |
| Conversion into High-Velocity Hyper-Concentrated Debris Flow            |
+-------------------------------------------------------------------------+
                                    │
                                    ▼ (Transboundary Influx at Border)
+-------------------------------------------------------------------------+
| Bhote Koshi & Trishuli River Corridor                                   |
| Water Surge: +7 m to +9 m within 15–30 min; Extreme Channel Widening    |
+-------------------------------------------------------------------------+
```

### 2.1 Trigger Mechanism
* **Mass Wasting Characteristics:** High-resolution optical imagery confirms the detachment of a massive ice-and-bedrock block (~0.2 $\text{km}^2$, estimated volume between $10^8$ and $2 \times 10^8\;\text{m}^3$) from an elevation of ~5,200–5,400 m.
* **Seismic Profile:** Global and regional seismometers (including Nepal Department of Mines and Geology stations) detected an $M_s\;5.2$ single-force seismic signal, characteristic of a high-mass slope failure rather than a tectonic slip.
* **Thermal & Permafrost Context:** Antecedent rapid temperature spikes degraded alpine permafrost along the shear plane, destabilizing the glaciated bedrock face.

### 2.2 Hydrodynamic Evolution
* **Bulking & Entrainment:** As the collapsing mass dropped ~1,200 m vertically into the upper Lende Khola basin, frictional heating and impact pulverized the ice, entraining glaciolacustrine sediment and scree to form a dense, fast-moving slurry.
* **Downstream Surge:** The debris wave merged into the Bhote Koshi at the Rasuwagadhi border within minutes, elevating the river stage by 7 to 9 meters and creating temporary landslide dams that subsequently breached.

---

## 3. Remote Sensing & GIS Change Detection Methodology

```
                   DATA ACQUISITION
   ┌───────────────────────┬───────────────────────┐
   │  Optical Imagery      │      SAR Imagery      │
   │  Sentinel-2 / Planet  │   Sentinel-1 (C-band) │
   └───────────┬───────────┴───────────┬───────────┘
               │                       │
               ▼                       ▼
      PRE-PROCESSING          SAR CALIBRATION
   Atmospheric / Topographic   Radiometric & Terrain
         Correction                 Correction
               │                       │
               ├───────────────────────┤
               │                       │
               ▼                       ▼
      SPECTRAL INDICES         BACKSCATTER RATIO
    (dNDWI, dNDVI, dNBR)     (Δσ° VV/VH Differencing)
               │                       │
               └───────────┬───────────┘
                           │
                           ▼
                 SUPERVISED / THRESHOLD
                    CHANGE CLASSIFICATION
                           │
                           ▼
                 SPATIAL DAMAGE & HAZARD
                      MAPPING (QGIS/GEE)
```

### 3.1 Data Inventory

| Satellite / Sensor | Spatial Resolution | Temporal Window (2026) | Primary Application |
| :--- | :--- | :--- | :--- |
| **Sentinel-2 (MSI)** | 10 m / 20 m | Pre: Aug 15–20 / Post: Aug 27–30 | Spectral Index differencing (NDWI, NDVI, MNDWI) |
| **PlanetScope** | 3 m | Pre: Aug 24–25 / Post: Aug 26–28 | Fine-scale infrastructure footprint delineation |
| **Sentinel-1 (C-SAR)** | 10 m (GRD) | Pre: Aug 20 / Post: Aug 27 | Cloud-penetrating flood extent & backscatter change |
| **ALOS AW3D30 / SRTM** | 30 m DEM | Baseline Topography | Slope, aspect, stream power index & HEC-RAS 2D modeling |

### 3.2 Key Spectral & Polarimetric Indices
1. **Modified Normalized Difference Water Index (MNDWI):**
   $$\text{MNDWI} = \frac{\text{Green} - \text{SWIR}}{\text{Green} + \text{SWIR}}$$
   *Used to delineate high-turbidity flood paths and modified watercourses.*

2. **Differenced Normalized Difference Vegetation Index ($d\text{NDVI}$):**
   $$d\text{NDVI} = \text{NDVI}_{\text{pre}} - \text{NDVI}_{\text{post}}$$
   *Quantifies riparian vegetation removal, landslide scours, and mud deposition zones.*

3. **SAR Log-Ratio Amplitude Change Detection:**
   $$\Delta \sigma^0 = 10 \cdot \log_{10}\left(\frac{\sigma^0_{\text{post}}}{\sigma^0_{\text{pre}}}\right)$$
   *Identifies structural destruction, bridge collapse, and newly silted riverbanks through roughness/dielectric variations independent of cloud cover.*

---

## 4. Priority Areas & Damage Impact Assessment

```
                      CORRIDOR DAMAGE PROFILE
  
 [China/Tibet Border] ──────▶ [Rasuwagadhi Gate] ──────▶ [Timure Dry Port]
         │                              │                         │
  Gyirong Port Destroyed        Bridge & Customs Razed     Customs Yard Submerged
  
                                       │
                                       ▼
 [Trishuli Cascade] ◀───────── [Syabrubesi Valley] ◀────── [Ghattekhola]
         │                              │
  Hydropower Projects          Settlement & Bridges
  (111MW Rasuwagadhi, etc.)      Severely Damaged
```

### 4.1 Zone 1: Gyirong Port & Rasuwagadhi Border Crossing ($28.278^\circ\text{N}, 85.378^\circ\text{E}$)
* **Customs & Port Infrastructure:** Complete erasure of the international friendship bridge, border checkpoint facilities, and trade terminal.
* **Geomorphic Alteration:** River channel width expanded by over 200–300% due to lateral scour and massive boulder deposition.

### 4.2 Zone 2: Timure & Ghattekhola Freight Corridors
* **Logistics & Trade Impact:** Inundation of the Timure dry port, customs yard, container parking areas, and critical road segments along the Pasang Lhamu Highway.
* **Sediment Burial:** Debris deposition thickness exceeding 3 to 6 meters in alluvial flat zones.

### 4.3 Zone 3: Hydroelectric Generation Hubs (Trishuli Cascade)
* **Rasuwagadhi Hydropower Project (111 MW):** Direct headworks inundation, dam structure scouring, intake structure burial, and severe turbine/desanding basin damage.
* **Cascade Impact:** Downstream cascade projects (Sanjen, Upper Trishuli 3A, Trishuli Devighat) experienced forced shutdowns and structural scouring from extreme sediment concentrations.

### 4.4 Zone 4: Downstream Human Settlements
* **Syabrubesi:** Major tourism and transit hub; riverside commercial lodges, pedestrian bridges, and primary road linkages washed away.
* **Betrawati & Kolpurtar (Nuwakot Border):** Extensive low-lying agricultural land loss, riverbed aggregation, and sediment deposition extending downstream toward the Gandak River basin.

---

## 5. Technical Implementation Workflow (Google Earth Engine / Python)

### Step 1: Pre- and Post-Flood Satellite Ingestion
```python
import ee

ee.Initialize()

# Define Region of Interest (Rasuwa Border Corridor)
roi = ee.Geometry.Rectangle([85.25, 28.05, 85.55, 28.35])

# Filter Sentinel-2 L2A collections
pre_flood = (
    ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(roi)
    .filterDate("2026-08-01", "2026-08-25")
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
    .median()
    .clip(roi)
)

post_flood = (
    ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(roi)
    .filterDate("2026-08-26", "2026-08-31")
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
    .median()
    .clip(roi)
)
```

### Step 2: Spectral Index Differencing
```python
def compute_indices(image):
    ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
    mndwi = image.normalizedDifference(["B3", "B11"]).rename("MNDWI")
    return image.addBands([ndvi, mndwi])


pre_idx = compute_indices(pre_flood)
post_idx = compute_indices(post_flood)

# Calculate difference images
dNDVI = pre_idx.select("NDVI").subtract(post_idx.select("NDVI")).rename("dNDVI")
dMNDWI = (
    post_idx.select("MNDWI").subtract(pre_idx.select("MNDWI")).rename("dMNDWI")
)

# Threshold for flood damage classification (> 0.25 dNDVI indicates vegetation loss / debris deposition)
damage_mask = dNDVI.gt(0.25).Or(dMNDWI.gt(0.30))
```

---

## 6. Expected Project Outputs & Deliverables

1. **High-Resolution Vector Boundary Maps:** Shapefiles and GeoJSON layers showing active scouring zones, channel widening, and inundated infrastructure.
2. **Hydraulic Inundation Model:** 2D HEC-RAS / Telemac-2D hydrodynamic simulation validating flood surge velocities (estimated 12–18 m/s in narrow gorges) and hydrograph peak discharge.
3. **Cross-Border Early Warning Framework:** Policy recommendations for binational seismic-acoustic and satellite telemetry sensor arrays along transboundary glacial headwaters.