/**
 * Every drawable layer, in one table.
 *
 * `group` splits observed ground truth from what the pipeline inferred, which is
 * the distinction the whole site turns on: HOT's layers are survey, ours are
 * derived. Keeping them visually separable is the point of the map.
 */

export const C = {
  ink: "#0b0b0b",
  blue: "#2a78d6",
  red: "#d03b3b",
  amber: "#b8860b",
  teal: "#127f6d",
  violet: "#6b4ea8",
  muted: "#898781",
};

/** Bridge condition drives colour everywhere it appears. */
export const BRIDGE_COLOUR = {
  "Washed out": C.red,
  Damaged: C.amber,
  Intact: C.teal,
};

export const LAYERS = [
  // --- Observed: HOT ground survey -----------------------------------------
  {
    id: "flood_extent",
    label: "Observed flood extent",
    group: "Observed — HOT survey",
    kind: "polygon",
    on: true,
    colour: C.blue,
    style: { color: C.blue, weight: 1.2, fillColor: C.blue, fillOpacity: 0.26 },
    title: () => "Observed flood extent, 27 Aug 2026",
  },
  {
    id: "aoi",
    label: "Area of interest (+200 m)",
    group: "Observed — HOT survey",
    kind: "polygon",
    on: false,
    colour: C.muted,
    style: { color: C.muted, weight: 1, dashArray: "4 3", fill: false },
    title: () => "HOT area of interest",
  },
  {
    id: "bridges",
    label: "Bridges assessed",
    group: "Observed — HOT survey",
    kind: "point",
    on: true,
    colour: C.red,
    radius: 6,
    colourBy: (p) => BRIDGE_COLOUR[p.status] || C.muted,
    title: (p) => p.name || "Bridge",
  },
  {
    id: "hydropowers",
    label: "Hydropower exposed",
    group: "Observed — HOT survey",
    kind: "point",
    on: true,
    colour: C.violet,
    radius: 7,
    title: (p) => p.name || "Hydropower",
  },
  {
    id: "buildings_damaged",
    label: "Buildings destroyed/damaged",
    group: "Observed — HOT survey",
    kind: "polygon",
    on: true,
    colour: C.red,
    style: { color: C.red, weight: 0.6, fillColor: C.red, fillOpacity: 0.75 },
    // 1,626 footprints are a red smear at corridor zoom and tell you nothing;
    // they only become readable once a settlement fills the screen.
    minZoom: 12.5,
    title: (p) => p.name || `${p.building || "Building"} — ${p.status}`,
  },
  {
    id: "roads_damaged",
    label: "Roads destroyed",
    group: "Observed — HOT survey",
    kind: "line",
    on: true,
    colour: C.amber,
    style: { color: C.amber, weight: 2.4, opacity: 0.9 },
    title: (p) => p.name || `${p.highway || "Road"} — destroyed`,
  },
  {
    id: "facilities",
    label: "Health & education",
    group: "Observed — HOT survey",
    kind: "point",
    on: false,
    colour: C.teal,
    radius: 5,
    title: (p) => p.name || p.kind,
  },
  {
    id: "places",
    label: "Populated places",
    group: "Observed — HOT survey",
    kind: "point",
    on: false,
    colour: C.ink,
    radius: 3.5,
    minZoom: 11,
    title: (p) => p.name || "Place",
  },
  {
    id: "waterways",
    label: "Waterways (OSM)",
    group: "Observed — HOT survey",
    kind: "line",
    on: false,
    colour: "#5aa0e0",
    style: { color: "#5aa0e0", weight: 1, opacity: 0.75 },
    title: (p) => p.name || p.waterway || "Waterway",
  },

  // --- Derived: this pipeline ----------------------------------------------
  {
    id: "detected_damage",
    label: "Detected flood damage",
    group: "Derived — this pipeline",
    kind: "polygon",
    on: true,
    colour: C.red,
    style: { color: C.red, weight: 0.7, fillColor: C.red, fillOpacity: 0.42 },
    title: () => "Detected flood damage (stage 3)",
  },
  {
    id: "corridor",
    label: "HAND flood corridor",
    group: "Derived — this pipeline",
    kind: "polygon",
    on: false,
    colour: C.teal,
    style: { color: C.teal, weight: 0.8, fillColor: C.teal, fillOpacity: 0.18 },
    title: () => "Valley floor within 50 m of the drainage network",
  },
  {
    id: "channel",
    label: "Drainage network",
    group: "Derived — this pipeline",
    kind: "polygon",
    on: false,
    colour: C.ink,
    style: { color: C.ink, weight: 0.5, fillColor: C.ink, fillOpacity: 0.8 },
    title: () => "Channel, ≥ 8 km² upstream",
  },
  {
    id: "zones",
    label: "Impact zones",
    group: "Derived — this pipeline",
    kind: "polygon",
    on: true,
    colour: C.ink,
    style: { color: C.ink, weight: 1.1, fill: false, dashArray: "2 3" },
    title: (p) => `${p.zone_id} — ${p.label}`,
  },
  {
    id: "roi",
    label: "Study ROI",
    group: "Derived — this pipeline",
    kind: "polygon",
    on: false,
    colour: C.muted,
    style: { color: C.muted, weight: 1, fill: false, dashArray: "8 4" },
    title: () => "Stage 1 study rectangle",
  },
];

export const BASEMAPS = [
  {
    id: "imagery",
    label: "Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics",
    maxZoom: 18,
  },
  {
    id: "map",
    label: "Map",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap contributors, © CARTO",
    maxZoom: 19,
  },
];

/** Named views for the zoom-to buttons. [lat, lon, zoom] */
export const PLACES = [
  { label: "Whole corridor", bounds: true },
  { label: "Rasuwagadhi", view: [28.278, 85.378, 14] },
  { label: "Timure", view: [28.245, 85.377, 14] },
  { label: "Syabrubesi", view: [28.163, 85.331, 14] },
  { label: "Trishuli / Betrawati", view: [27.966, 85.183, 13] },
];
