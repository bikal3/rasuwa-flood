/**
 * One runnable check for the built site.
 *
 *   node build.mjs && node smoke.mjs
 *
 * Loads the real bundle in jsdom with fetch served off disk, so it exercises the
 * actual data contract: if pipeline/stage4_hot.py renames a field, drops a layer, or emits
 * a NaN that JSON.parse rejects, this fails here instead of rendering a blank
 * page in someone's browser.
 *
 * jsdom has no canvas, so Leaflet's canvas renderer gets a no-op 2D context. That
 * is enough for the map to build its panes, parse every GeoJSON and register its
 * layers -- which is what we want to check. Nothing is asserted about pixels.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..", "site");

const errors = [];
const vc = new VirtualConsole();
const brief = (e) => String(e?.detail?.message || e?.message || e).slice(0, 300);
vc.on("jsdomError", (e) => errors.push(brief(e.detail || e)));
vc.on("error", (...a) => errors.push(a.map(brief).join(" ")));

const dom = new JSDOM(
  `<!doctype html><html><body><div id="root"></div></body></html>`,
  {
    url: "http://localhost/",
    pretendToBeVisual: true,       // gives requestAnimationFrame, which React wants
    runScripts: "outside-only",    // required for window.eval to run in jsdom's realm
    virtualConsole: vc,
  }
);
const { window } = dom;

// Leaflet measures its container; jsdom reports every element as 0x0, which
// makes fitBounds throw on a zero-size viewport.
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800,
  width: 1200, height: 800, toJSON() {},
});
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { value: 1200 });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { value: 800 });

const ctx2d = new Proxy(
  { canvas: null, measureText: () => ({ width: 0 }), getImageData: () => ({ data: [0, 0, 0, 0] }) },
  { get: (t, k) => (k in t ? t[k] : () => {}) }
);
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;

// Static files off disk. Tile requests are absolute URLs and never resolve here.
window.fetch = async (url) => {
  const rel = String(url).replace(/^https?:\/\/localhost\//, "");
  if (/^https?:/.test(rel)) return { ok: false, status: 599 };
  try {
    const body = await readFile(path.join(site, rel), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

try {
  window.eval(await readFile(path.join(site, "app.js"), "utf8"));
} catch (e) {
  // Print the message, not the minified bundle Node would echo as context.
  errors.push(`bundle threw on load: ${e.message}`);
}

// React renders on a microtask; the layer loop awaits 14 fetches after that.
const root = window.document.getElementById("root");
for (let i = 0; i < 120 && !/Data\b/.test(root.textContent); i++) {
  await new Promise((r) => setTimeout(r, 25));
}
await new Promise((r) => setTimeout(r, 400));

const text = root.textContent;
const html = root.innerHTML;
const fail = [];
const want = (cond, msg) => !cond && fail.push(msg);

want(!text.includes("Data not loaded"), "app reported it could not load summary.json");
want(text.length > 2000, `root rendered only ${text.length} chars`);

// Content the page must be quoting from summary.json, not from a placeholder.
for (const s of [
  "flood",                       // headline
  "31.7 km²",                    // observed extent, whole corridor
  "Terrain alone finds the damage",
  "What the satellites caught",
  "What sat inside the water",
  "Method, and where it breaks",
  "Rasuwagadhi",                 // zone label from the CSV
  "Thulo bharkhu",               // the dropped-bridge caveat
]) {
  want(text.includes(s), `page is missing ${JSON.stringify(s)}`);
}

want(!/NaN|undefined|\[object Object\]/.test(text),
  "page rendered NaN / undefined / [object Object]");

// Map chrome, layer panel and downloads.
want(html.includes("leaflet-container"), "Leaflet never initialised");
want((html.match(/class="layer"/g) || []).length >= 14,
  "layer panel is missing toggles");
want((html.match(/href="data\/[a-z_]+\.geojson"/g) || []).length >= 14,
  "data downloads are missing");
want(/\d+<\/span>/.test(html), "layer feature counts never populated");

// Every layer the app asks for must exist on disk.
const summary = JSON.parse(await readFile(path.join(site, "data", "summary.json"), "utf8"));
for (const name of Object.keys(summary.layer_bytes)) {
  const r = await window.fetch(`data/${name}.geojson`);
  want(r.ok, `layer file missing: ${name}.geojson`);
}

// The before/after comparison is a map of its own, below the main one. It is
// not a mode any more, so nothing has to be clicked to bring it up -- the
// overlays load when the section nears the viewport, and jsdom has no
// IntersectionObserver, so SwipeMap falls back to loading them immediately.
{
  for (let i = 0; i < 120 && !root.querySelector(".swipe-tag span"); i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  want(root.querySelector(".comparesec"), "the comparison section is missing");
  want((root.innerHTML.match(/leaflet-container/g) || []).length >= 2,
    "the comparison map was never built as a second Leaflet map");
  want(!root.querySelector('[aria-label="Toggle before and after imagery"]'),
    "the main map still carries the before/after toggle");

  const sw = root.querySelector(".swipe");
  want(sw, "the swipe divider is missing from the comparison map");
  want(sw?.getAttribute("style")?.includes("--x"), "divider position is not bound");

  // It opens on the pair with post-event pixels, which is radar: the optical
  // "after" is 17% cloud-free and would open on a mostly empty frame.
  want(root.textContent.includes("8\u201325 Aug 2026"), "before label is missing its date window");
  want(root.textContent.includes("26 Aug \u2013 1 Sep 2026"), "after label is missing its date window");
  want(root.textContent.includes("97.4% in frame"), "radar cover is not stated on the slider");

  // Switching to optical must relabel both tags from the same manifest.
  const optical = [...root.querySelectorAll(".swipe-sensor button")]
    .find((b) => b.textContent === "Optical");
  want(optical, "no optical/radar switch on the slider");
  optical?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  want(root.textContent.includes("87% cloud-free") && root.textContent.includes("17% cloud-free"),
    "switching to optical did not relabel the slider with its cloud cover");

  // Whether the slider actually *renders* two images is not checkable here:
  // jsdom has no layout, and this file stubs every element's box to the same
  // 1200x800 rectangle, so a clip that resolves to nothing looks fine. That is
  // swipe-check.mjs, which drives real Chrome.
  want(root.querySelector(".leaflet-imgPre-pane img"),
    "before overlay image was never added to the comparison map");
  want(root.querySelector(".leaflet-imgPost-pane img"),
    "after overlay image was never added to the comparison map");

  // Only the named views the imagery covers get a button.
  const places = [...root.querySelectorAll(".compareplaces button")].map((b) => b.textContent);
  want(places.includes("Rasuwagadhi") && places.includes("Syabrubesi"),
    `comparison place buttons are missing (${JSON.stringify(places)})`);
  want(!places.includes("Trishuli / Betrawati"),
    "Betrawati is outside the imagery footprint and should not be offered");
}

// Both maps must be named; without it a screen reader meets two identical
// unlabelled groups whose only readable content is the Esri attribution.
{
  const labels = [...root.querySelectorAll(".mapfill")].map((m) => m.getAttribute("aria-label"));
  want(labels.length === 2, `expected two maps, found ${labels.length}`);
  want(labels.every(Boolean), "a map container has no accessible name");
  want(new Set(labels).size === labels.length, "both maps carry the same name");
  want(root.querySelector(".comparesec .sr-only")?.textContent.length > 200,
    "the comparison imagery has no text alternative");
}

// Zone ids still fly the main map, and must not throw doing it.
root.querySelector(".zonelink")
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));

// Zone ids in the tables must be clickable handles onto the map.
want((html.match(/class="zonelink"/g) || []).length >= 10,
  `zone cross-links missing (found ${(html.match(/class="zonelink"/g) || []).length})`);

// The view must round-trip through the URL, or shared links are dead links.
want(/^#[\d.]+\/-?[\d.]+\/-?[\d.]+\//.test(window.location.hash),
  `map view was not mirrored into the URL hash (got ${JSON.stringify(window.location.hash)})`);

want(errors.length === 0, `uncaught errors:\n      ${errors.slice(0, 4).join("\n      ")}`);

if (process.env.DUMP) {
  console.log(root.textContent.replace(/\s{2,}/g, "\n"));
}

if (fail.length) {
  console.error("\nFAIL");
  fail.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(
  `OK - site renders, ${Object.keys(summary.layer_bytes).length} layers resolve, ` +
  `${text.length.toLocaleString()} chars of content, no console errors`
);
