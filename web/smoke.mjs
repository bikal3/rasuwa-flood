/**
 * One runnable check for the built site.
 *
 *   node build.mjs && node smoke.mjs
 *
 * Loads every page's real bundle in jsdom with fetch served off disk, so it
 * exercises the actual data contract: if pipeline/stage4_hot.py renames a field,
 * drops a layer, or emits a NaN that JSON.parse rejects, this fails here instead
 * of rendering a blank page in someone's browser.
 *
 * The site is ten static pages that share one bundle and differ only by the
 * data-page attribute build.mjs stamps on them, so every page is loaded the way
 * a browser loads it -- from its own URL, at its own directory depth, resolving
 * its own relative paths. A page whose base is wrong fetches nothing and is
 * caught here rather than 404-ing in production.
 *
 * jsdom has no canvas, so Leaflet's canvas renderer gets a no-op 2D context.
 * That is enough for the map to build its panes, parse every GeoJSON and
 * register its layers. Nothing is asserted about pixels -- that is
 * swipe-check.mjs, which drives real Chrome.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ROUTES, SHARE, SITE } from "./src/routes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..", "site");

// The figures below are read from the pipeline's own output, never typed in:
// re-running stage 4 or stage 5 changes them, and a check that fails for that
// is a check nobody keeps.
const read = async (f) => JSON.parse(await readFile(path.join(site, "data", f), "utf8"));
const summary = await read("summary.json");
const overlays = await read("overlays.json");
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fail = [];
const want = (cond, msg) => !cond && fail.push(msg);

const bundle = await readFile(path.join(site, "app.js"), "utf8");

/** Load one route the way a browser would, and settle. */
async function load(route, settleMs = 700) {
  const url = `http://localhost/${route.path ? route.path + "/" : ""}`;
  const errors = [];
  const vc = new VirtualConsole();
  const brief = (e) => String(e?.detail?.message || e?.message || e).slice(0, 300);
  vc.on("jsdomError", (e) => errors.push(brief(e.detail || e)));
  vc.on("error", (...a) => errors.push(a.map(brief).join(" ")));

  const base = route.path ? "../" : "";
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root" data-page="${route.id}" data-base="${base}"></div></body></html>`,
    { url, pretendToBeVisual: true, runScripts: "outside-only", virtualConsole: vc }
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

  // Static files off disk, resolved against this page's own URL -- which is what
  // makes a wrong data-base show up as a missing layer rather than passing.
  window.fetch = async (u) => {
    const abs = new URL(String(u), url);
    if (abs.host !== "localhost") return { ok: false, status: 599 };
    try {
      const body = await readFile(path.join(site, decodeURIComponent(abs.pathname)), "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };

  try {
    window.eval(bundle);
  } catch (e) {
    errors.push(`bundle threw on load: ${e.message}`);
  }

  const root = window.document.getElementById("root");
  for (let i = 0; i < 160 && root.textContent.length < 400; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, settleMs));
  return { window, root, errors, text: root.textContent, html: root.innerHTML };
}

/* ── Every page ───────────────────────────────────────────────────────────── */

const pages = {};
for (const route of ROUTES) {
  const heavy = ["home", "map", "compare"].includes(route.id);
  const p = await load(route, heavy ? 2200 : 500);
  pages[route.id] = p;
  const at = `[${route.id}]`;

  want(!p.text.includes("Data not loaded"), `${at} could not load summary.json`);
  want(p.text.length > 700, `${at} rendered only ${p.text.length} chars`);
  want(!/NaN|undefined|\[object Object\]/.test(p.text),
    `${at} rendered NaN / undefined / [object Object]`);
  want(p.errors.length === 0, `${at} uncaught errors:\n      ${p.errors.slice(0, 3).join("\n      ")}`);

  // The shell: every page carries the whole site's navigation, and marks itself.
  const nav = [...p.root.querySelectorAll(".nav-item")];
  want(nav.length === ROUTES.length,
    `${at} sidebar has ${nav.length} links, expected ${ROUTES.length}`);
  const current = nav.filter((a) => a.getAttribute("aria-current") === "page");
  want(current.length === 1 && current[0].textContent.includes(route.label),
    `${at} does not mark itself current in the sidebar`);
  want(p.root.querySelector("h1.page-title"), `${at} has no page title`);
  want(p.root.querySelector("footer"), `${at} has no footer`);

  // Links between pages must resolve from this page's depth, not the root's.
  for (const a of [...p.root.querySelectorAll("a[href]")]) {
    const h = a.getAttribute("href");
    if (h.startsWith("http") || h.startsWith("#")) continue;
    const abs = new URL(h, `http://localhost/${route.path ? route.path + "/" : ""}`);
    const target = abs.pathname.endsWith("/") ? `${abs.pathname}index.html` : abs.pathname;
    want(await exists(target), `${at} links to ${h}, which resolves to a missing ${target}`);
  }
}

async function exists(p) {
  try {
    await readFile(path.join(site, decodeURIComponent(p)));
    return true;
  } catch {
    return false;
  }
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
{
  const { root, text } = pages.home;
  const at = "[home]";
  const km2 = summary.areas["HOT observed flood extent, whole corridor"]
    .toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  want(text.includes(`${km2} km²`), `${at} does not quote the observed flood extent`);
  want(text.includes(summary.buildings_by_status.Destroyed.toLocaleString("en")),
    `${at} does not quote the destroyed-building count`);
  want(root.querySelectorAll(".metric").length >= 5,
    `${at} has ${root.querySelectorAll(".metric").length} metric tiles, expected 5`);
  want(root.querySelector(".callout.alert"), `${at} lost the "not an operational assessment" warning`);
  want(root.querySelectorAll("a.card").length >= 6, `${at} is missing its explore cards`);
  want(root.querySelector(".maprow.short"), `${at} has no overview map`);
}

/* ── Flood map ────────────────────────────────────────────────────────────── */
{
  const { root, html } = pages.map;
  const at = "[map]";
  want(html.includes("leaflet-container"), `${at} Leaflet never initialised`);
  want((html.match(/class="layer"/g) || []).length >= 14, `${at} layer panel is missing toggles`);
  want(/\d+<\/span>/.test(html), `${at} layer feature counts never populated`);

  // Panel order is importance order: flying between the four named places is how
  // anyone moves around a 120 km corridor, so it leads; the inspector answers
  // the map's other primary action and sticks under it; the basemap switch
  // changes no data, so it trails.
  const blocks = [...root.querySelector("aside.panel").children];
  const [flyto, inspector, layers, basemaps] =
    ["panel-nav", "inspector", "panel-group", "basemaps"]
      .map((cls) => blocks.findIndex((b) => b.className.includes(cls)));
  want(flyto === 0, `${at} "Fly to" is not at the top of the panel (index ${flyto})`);
  want(inspector === 1, `${at} the selected-feature inspector does not follow it (index ${inspector})`);
  want(layers > inspector && layers < basemaps,
    `${at} panel blocks are out of importance order `
    + `(fly-to ${flyto}, inspector ${inspector}, layers ${layers}, basemap ${basemaps})`);
  want(blocks[flyto]?.textContent.includes("Fly to"), `${at} the fly-to block lost its heading`);
  want(blocks[flyto]?.querySelectorAll("button").length >= 4,
    `${at} the fly-to block has lost its places`);

  const rows = [...root.querySelectorAll(".fade-row")];
  want(rows.length === 2, `${at} expected two labelled opacity controls, found ${rows.length}`);
  for (const r of rows) {
    const input = r.querySelector("input.fade");
    want(input?.id && r.querySelector(`label[for="${input.id}"]`),
      `${at} an opacity slider has no visible label bound to it`);
  }

  want(root.querySelector(".mapfill")?.getAttribute("aria-label"),
    `${at} the map container has no accessible name`);

  // Every layer the app asks for must exist on disk.
  for (const name of Object.keys(summary.layer_bytes)) {
    want(await exists(`/data/${name}.geojson`), `${at} layer file missing: ${name}.geojson`);
  }
}

/* ── Before & after ───────────────────────────────────────────────────────── */
{
  const { root, window } = pages.compare;
  const at = "[compare]";
  want(root.querySelector(".comparecanvas"), `${at} the comparison map is missing`);
  const sw = root.querySelector(".swipe");
  want(sw, `${at} the swipe divider is missing`);
  want(sw?.getAttribute("style")?.includes("--x"), `${at} divider position is not bound`);
  want(root.querySelector(".leaflet-imgPre-pane img"), `${at} before overlay was never added`);
  want(root.querySelector(".leaflet-imgPost-pane img"), `${at} after overlay was never added`);

  // Every pair stage 5 emitted must be reachable from the switch and must label
  // both tags with its own dates and cover figure. Driven off the manifest
  // rather than off ids written in here: which pairs exist is stage 5's
  // decision, and this check should survive changing it.
  //
  // The id is everything before the last underscore, not a prefix match --
  // "slideraw_pre".startsWith("slide") is true, and a prefix match would read
  // the wrong pair's cover word depending on the order of the sensors array.
  const idOf = (k) => k.slice(0, k.lastIndexOf("_"));
  const cover = (k) =>
    `${overlays[k].valid_pct}% ${overlays.sensors.find((x) => x.id === idOf(k)).cover}`;
  const taken = (k) => {
    const [y, m, d] = overlays[k].date.split("-").map(Number);
    return `${d} ${MONTH[m - 1]} ${y}`;
  };
  const shows = (id) => {
    const tags = [...root.querySelectorAll(".swipe-tag")].map((t) => t.textContent).join(" ");
    for (const k of [`${id}_pre`, `${id}_post`]) {
      want(tags.includes(taken(k)), `${at} the ${k} acquisition date is not on the slider`);
      want(tags.includes(cover(k)), `${at} the ${k} cover figure is not on the slider`);
    }
  };

  const buttons = [...root.querySelectorAll(".swipe-sensor button")];
  want(buttons.length === overlays.sensors.length,
    `${at} the switch offers ${buttons.length} pairs, the manifest has ${overlays.sensors.length}`);
  for (const spec of overlays.sensors) {
    want(buttons.some((b) => b.textContent === spec.label), `${at} no button for "${spec.label}"`);
  }

  // It opens on whichever pair has the most post-event pixels; every other pair
  // must relabel both tags when clicked.
  const opensOn = overlays.sensors.reduce((a, b) =>
    overlays[`${b.id}_post`].valid_pct > overlays[`${a.id}_post`].valid_pct ? b : a);
  shows(opensOn.id);
  for (const spec of overlays.sensors) {
    if (spec.id === opensOn.id) continue;
    buttons.find((b) => b.textContent === spec.label)
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    shows(spec.id);
  }

  // Only the named views the imagery covers get a button. The slider frames
  // Betrawati; the northern zones are tens of km outside it.
  const places = [...root.querySelectorAll(".compareplaces button")].map((b) => b.textContent);
  want(places.includes("Trishuli / Betrawati"),
    `${at} place buttons are missing (${JSON.stringify(places)})`);
  want(!places.includes("Rasuwagadhi") && !places.includes("Syabrubesi"),
    `${at} offers a view outside the imagery footprint (${JSON.stringify(places)})`);
}

/* ── The general reader's pages ───────────────────────────────────────────── */
{
  // Native <details>, not a hand-rolled accordion: it must open on ctrl-F and
  // survive JS half-loading, which a div with an onClick does not.
  const folds = [...pages.how.root.querySelectorAll("details.plain")];
  want(folds.length >= 5, `[how] expected the plain-language explainers, found ${folds.length}`);
  want(folds.every((d) => d.querySelector("summary")),
    "[how] an explainer has no summary, so nothing opens it");
  want(pages.how.text.includes("Height Above Nearest Drainage"),
    "[how] no longer explains what HAND is");

  want(pages.glossary.root.querySelectorAll(".deflist > div").length >= 12,
    "[glossary] has lost entries");
  want(pages.glossary.text.includes("Glacial lake outburst flood"),
    "[glossary] no longer defines GLOF");

  for (const id of ["terrain", "satellites"]) {
    want(pages[id].root.querySelector("details.plain"),
      `[${id}] lost its "in plain English" reading`);
  }
}

/* ── Analysis pages ───────────────────────────────────────────────────────── */
{
  want(pages.terrain.root.querySelectorAll(".bar-row").length >= 4, "[terrain] bar chart is missing");
  want(pages.terrain.root.querySelector("table"), "[terrain] evidence table is missing");
  want(pages.satellites.root.querySelectorAll(".bar-row").length >= 8,
    "[satellites] is missing a bar chart");
  want(pages.exposure.root.querySelectorAll("table").length === 3,
    `[exposure] expected three tables, found ${pages.exposure.root.querySelectorAll("table").length}`);
  const zonelinks = (pages.exposure.html.match(/class="zonelink"/g) || []).length;
  want(zonelinks >= 10, `[exposure] zone cross-links missing (found ${zonelinks})`);
}

/* ── Reference pages ──────────────────────────────────────────────────────── */
{
  // The two rules the analysis rests on, quoting the thresholds that ran.
  const eqs = [...pages.method.root.querySelectorAll(".eq")];
  want(eqs.length === 2, `[method] expected two rules, found ${eqs.length}`);
  want(eqs[0]?.textContent.includes(String(summary.event.thresholds.dNDVI)),
    "[method] the notation does not quote the dNDVI threshold the pipeline used");
  want(eqs[1]?.textContent.includes(String(summary.event.hand_max_m)),
    "[method] the corridor definition does not quote the HAND ceiling the pipeline used");
  want(pages.method.text.includes(summary.dropped_bridges[0]),
    "[method] the dropped-bridge caveat is gone");

  const files = (pages.downloads.html.match(/\.geojson"/g) || []).length;
  want(files >= Object.keys(summary.layer_bytes).length,
    `[downloads] offers ${files} layers, expected ${Object.keys(summary.layer_bytes).length}`);
  want(pages.downloads.root.querySelectorAll(".refs li").length === summary.sources.length,
    "[downloads] the reference list does not match summary.json's sources");
}

/* ── The map still keeps the page's scroll ────────────────────────────────── */

// A plain wheel is stopped above Leaflet's own listener, so it stays uncancelled
// and the browser scrolls the page with it; ctrl/cmd + wheel is let through and
// Leaflet cancels it to zoom. One finger scrolls a touchscreen, two move the map.
for (const id of ["map", "compare"]) {
  const { root, window } = pages[id];
  const canvas = root.querySelector(".mapcanvas");
  const pane = canvas?.querySelector(".leaflet-map-pane");
  want(pane, `[${id}] has no map pane to scroll over`);
  if (!pane) continue;

  const wheel = (mods) =>
    pane.dispatchEvent(new window.WheelEvent("wheel", {
      bubbles: true, cancelable: true, deltaY: 120, clientX: 400, clientY: 300, ...mods,
    }));
  want(wheel({}), `[${id}] a plain wheel still reaches Leaflet: the page cannot scroll past the map`);
  want(canvas.querySelector('.gesture-hint[data-on="true"]'),
    `[${id}] nothing told the reader how to zoom after the wheel was let through`);
  want(!wheel({ ctrlKey: true }), `[${id}] ctrl + wheel no longer zooms the map`);

  const box = canvas.querySelector(".leaflet-container");
  want(box?.style.touchAction === "pan-x pan-y",
    `[${id}] the map still claims the browser's touch gestures (${box?.style.touchAction || "unset"})`);
  const touch = (type, n) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: Array.from({ length: n }, () => ({})) });
    box.dispatchEvent(ev);
  };
  touch("touchstart", 1);
  want(!box.classList.contains("leaflet-touch-drag"),
    `[${id}] one finger on the map still drags it, so the page cannot scroll under the thumb`);
  touch("touchend", 0);
  want(box.classList.contains("leaflet-touch-drag"),
    `[${id}] dragging was never restored after the hand left, so a mouse cannot pan either`);
}

/* ── Shared links and view state ──────────────────────────────────────────── */
{
  const { root, window } = pages.map;
  root.querySelector(".zonelink")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  want(/^#[\d.]+\/-?[\d.]+\/-?[\d.]+\//.test(window.location.hash),
    `[map] the view was not mirrored into the URL (got ${JSON.stringify(window.location.hash)})`);
}

/* ── What a chat client sees ──────────────────────────────────────────────── */
{
  // The page components never render these, so jsdom above cannot catch them:
  // read the built index.html as a scraper would.
  const at = "[share]";
  for (const r of ROUTES) {
    const file = path.join(r.path || ".", "index.html");
    const head = await readFile(path.join(site, file), "utf8");
    // Decoded, not raw: four of the ten titles contain "&", so this asserts the
    // build escaped them and that they survive the round trip. &amp; last.
    const meta = (k, attr = "property") =>
      head.match(new RegExp(`<meta ${attr}="${k}" content="([^"]*)"`))?.[1]
        ?.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&amp;", "&");

    want(!/\{\{\w+\}\}/.test(head), `${at} ${file} still has an unreplaced placeholder`);
    want(head.includes(`<link rel="canonical" href="${SITE}/${r.path ? r.path + "/" : ""}">`),
      `${at} ${file} has no canonical URL, or the wrong one`);
    want(meta("og:url") === `${SITE}/${r.path ? r.path + "/" : ""}`,
      `${at} ${file} og:url is ${meta("og:url")}`);
    want(meta("og:title")?.includes(r.title), `${at} ${file} og:title is not this page's`);
    want(meta("og:description") === r.desc,
      `${at} ${file} og:description is not this page's`);
    want(meta("og:image") === `${SITE}/${SHARE.image}`, `${at} ${file} og:image is wrong`);
    want(meta("twitter:card", "name") === "summary_large_image",
      `${at} ${file} will render as a thumbnail card, not a large one`);
  }
  // The card is the one absolute asset URL on the site; nothing else would
  // notice if the file went missing.
  want(await exists(`/${SHARE.image}`), `${at} og:image points at a missing /${SHARE.image}`);

  const sitemap = await readFile(path.join(site, "sitemap.xml"), "utf8");
  for (const r of ROUTES) {
    want(sitemap.includes(`<loc>${SITE}/${r.path ? r.path + "/" : ""}</loc>`),
      `${at} sitemap.xml does not list ${r.id}`);
  }
  want((sitemap.match(/<loc>/g) || []).length === ROUTES.length,
    `${at} sitemap.xml lists a URL that is not a route`);
  want((await readFile(path.join(site, "robots.txt"), "utf8"))
    .includes(`Sitemap: ${SITE}/sitemap.xml`), `${at} robots.txt does not point at the sitemap`);
}

if (fail.length) {
  console.error("\nFAIL");
  fail.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
const chars = Object.values(pages).reduce((n, p) => n + p.text.length, 0);
console.log(
  `OK - ${ROUTES.length} pages render, ${Object.keys(summary.layer_bytes).length} layers resolve, ` +
  `${chars.toLocaleString()} chars of content, every internal link resolves, `
  + "every page has its own share card, no console errors"
);
