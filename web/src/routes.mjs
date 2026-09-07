/**
 * Every page on the site, in sidebar order.
 *
 * One table, read by three things that would otherwise drift apart: build.mjs
 * writes an index.html per entry, Shell.jsx draws the sidebar from it, and
 * main.jsx picks which component to render from the id the build stamped onto
 * the page. Adding a route here adds it to all three.
 *
 * `path` is a directory, so every URL ends in a slash and every page sits
 * exactly one level below the site root -- which is why the relative base a
 * page needs is always "" or "../" and never has to be computed.
 *
 * Plain data and no imports: build.mjs runs this in Node, where there is no
 * document and no React.
 */
export const ROUTES = [
  {
    id: "home", path: "", icon: "🏔️", label: "Overview",
    title: "Rasuwa Flood 2026",
    desc: "What the 26 August 2026 debris flood did to the Bhote Koshi valley, and how it was measured from satellites and terrain.",
  },
  {
    id: "how", path: "how-it-works", group: "Understand", icon: "💡",
    label: "How it works",
    title: "How it works",
    desc: "What a glacial lake outburst flood is, what height above the river means, and why mapping one needs both a camera satellite and a radar satellite.",
  },
  {
    id: "glossary", path: "glossary", group: "Understand", icon: "📖",
    label: "Glossary",
    title: "Glossary",
    desc: "Every term this site uses, in plain language: GLOF, HAND, backscatter, change detection, base rate.",
  },
  {
    id: "map", path: "map", group: "Explore data", icon: "🗺️",
    label: "Flood map",
    title: "Flood map",
    desc: "Fourteen layers over the Rasuwagadhi-to-Narayani corridor: what the ground survey observed, and what this pipeline derived.",
  },
  {
    id: "compare", path: "compare", group: "Explore data", icon: "🛰️",
    label: "Before & after",
    title: "Before & after",
    desc: "Satellite imagery of the same ground before and after the flood, optical and radar, on a draggable divider.",
  },
  {
    id: "terrain", path: "terrain", group: "Analysis", icon: "⛰️",
    label: "Terrain corridor",
    title: "Terrain corridor",
    desc: "A flood corridor drawn from elevation alone holds almost every recorded loss, at 22 times its own base rate.",
  },
  {
    id: "satellites", path: "satellites", group: "Analysis", icon: "📡",
    label: "Satellite detection",
    title: "Satellite detection",
    desc: "What Sentinel-1 and Sentinel-2 caught of the flood, what they missed, and why the miss is mostly river that was already river.",
  },
  {
    id: "exposure", path: "exposure", group: "Analysis", icon: "👥",
    label: "Damage & exposure",
    title: "Damage & exposure",
    desc: "Buildings, roads, bridges and hydropower inside the observed flood extent, counted by impact zone.",
  },
  {
    id: "method", path: "method", group: "Reference", icon: "📋",
    label: "Method & limits",
    title: "Method & limits",
    desc: "The five-stage pipeline, the two rules the analysis rests on, and everything this method cannot tell you.",
  },
  {
    id: "downloads", path: "downloads", group: "Reference", icon: "⬇️",
    label: "Data & sources",
    title: "Data & sources",
    desc: "Every layer as GeoJSON in WGS84, the summary statistics behind every figure on the site, and where the source data came from.",
  },
];
