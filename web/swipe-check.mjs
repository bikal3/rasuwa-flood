/**
 * The one check jsdom cannot do: is the before/after slider actually showing
 * two images?
 *
 *   node build.mjs && node swipe-check.mjs
 *
 * smoke.mjs runs the real bundle, but jsdom has no layout -- every element
 * reports the same stubbed box -- so it will happily pass a slider that renders
 * nothing. That is not hypothetical: this slider shipped clipping its overlays
 * with `clip-path: inset(0 50% 0 0)` set on the Leaflet *pane*, and a pane is a
 * 0x0 positioned div (its children are placed by transform and never size it).
 * 50% of nothing is nothing, so the clip removed the whole image. In the DOM
 * everything looked right -- style set, image loaded, position correct -- and on
 * screen there was only basemap.
 *
 * So this drives real Chrome over CDP, with no dependencies, and measures the
 * strip of each overlay that survives its clip. Nothing here trusts a style
 * string on its own.
 *
 * Set CHROME to override the binary. Skips with a notice if it is not installed.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..", "site");
const CHROME = process.env.CHROME
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!existsSync(CHROME)) {
  console.log(`SKIP - no Chrome at ${CHROME} (set CHROME=... to run this)`);
  process.exit(0);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// Static server on an ephemeral port. Chrome will not fetch relative URLs off
// file://, so the site has to be served even for a local check.
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(site, rel);
  if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}/`;

const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=0",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  `--user-data-dir=${path.join(here, ".chrome-swipe-check")}`,
  "--window-size=1400,900", "--hide-scrollbars", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

// Chrome prints the chosen port on stderr: "DevTools listening on ws://...".
const wsUrl = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("Chrome did not report a debugger port")), 20000);
  chrome.stderr.on("data", (b) => {
    const m = /ws:\/\/\S+/.exec(String(b));
    if (m) { clearTimeout(t); res(m[0]); }
  });
});
const port = new URL(wsUrl).port;
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  .find((t) => t.type === "page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const p = m.id && pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    pending.set(++id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval threw");
  return r.result.value;
};

/** Read each overlay's on-screen strip: its box, intersected with its own clip. */
const GEOM = String.raw`(() => {
  const map = document.querySelector(".comparecanvas .mapfill").getBoundingClientRect();
  const read = (pane) => {
    const img = document.querySelector(".leaflet-" + pane + "-pane img");
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const clip = getComputedStyle(img).clipPath;
    const n = /inset\(([^)]+)\)/.exec(clip);
    const [, right, , left] = n ? n[1].trim().split(/\s+/).map(parseFloat) : [0, 0, 0, 0];
    const x0 = Math.max(map.left, r.left + (left || 0));
    const x1 = Math.min(map.right, r.right - (right || 0));
    return {
      loaded: img.complete && img.naturalWidth > 0,
      src: img.getAttribute("src"), clip,
      x0: Math.round(x0), x1: Math.round(x1), visible: Math.round(Math.max(0, x1 - x0)),
    };
  };
  const bar = document.querySelector(".swipe-bar");
  return { mapLeft: Math.round(map.left), mapTop: Math.round(map.top),
           mapWidth: Math.round(map.width), mapHeight: Math.round(map.height),
           barX: bar ? Math.round(bar.getBoundingClientRect().left + 1) : null,
           pre: read("imgPre"), post: read("imgPost") };
})()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: origin });
await sleep(4000);

// Scroll the comparison section in -- that is what triggers the overlay fetch --
// then fly somewhere the imagery footprint fills the map. At the whole-scene view
// the frame has basemap around its edges, and "half the map is the before image"
// is not the right expectation there.
await evaluate(String.raw`(async () => {
  document.querySelector(".comparesec").scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 2000));
  [...document.querySelectorAll(".compareplaces button")]
    .find((b) => b.textContent.trim() === "Rasuwagadhi").click();
  await new Promise((r) => setTimeout(r, 2500));
})()`);

const fail = [];
const want = (cond, msg) => !cond && fail.push(msg);

/** Drag the divider to a fraction of the map. Real mouse events, pressed on the
 *  grip where it currently is: dragDivider only starts from a pointerdown on the
 *  bar itself, and its pointer capture needs a pointer id that really exists. */
const dragTo = async (frac, g) => {
  const to = Math.round(g.mapLeft + g.mapWidth * frac);
  const y = Math.round(g.mapTop + g.mapHeight / 2);
  const ev = (type, x) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await ev("mousePressed", g.barX);
  await ev("mouseMoved", to);
  await ev("mouseReleased", to);
  await sleep(400);
  return evaluate(GEOM);
};

let g = await evaluate(GEOM);
want(g.pre && g.post, "the overlay images were never added to the map");
want(g.barX !== null, "the divider is not on the page");

if (g.pre && g.post) {
  want(g.pre.loaded && g.post.loaded,
    `overlay images did not load (${g.pre.src} ${g.pre.loaded}, ${g.post.src} ${g.post.loaded})`);

  // The regression itself: a percentage clip resolves against the element's own
  // border box, so it is only ever correct on a box that has a size.
  for (const [half, o] of [["before", g.pre], ["after", g.post]]) {
    want(!o.clip.includes("%"),
      `${half} image is clipped in percentages (${o.clip}) -- that is a percentage `
      + "of the image box, and on a Leaflet pane it is a percentage of zero");
  }

  // Both halves must actually be on screen, and must meet at the divider.
  g = await dragTo(0.5, g);
  want(g.pre.visible > 100, `before image shows ${g.pre.visible}px at a centred divider`);
  want(g.post.visible > 100, `after image shows ${g.post.visible}px at a centred divider`);
  want(Math.abs(g.pre.x1 - g.post.x0) <= 2,
    `the two halves do not meet: before ends at ${g.pre.x1}, after starts at ${g.post.x0}`);

  // And the divider must move them.
  const wide = await dragTo(0.8, g);
  want(wide.pre.visible > g.pre.visible + 100,
    `dragging the divider right did not widen the before image `
    + `(${g.pre.visible}px -> ${wide.pre.visible}px)`);
}

ws.close();
chrome.kill();
server.close();

if (fail.length) {
  console.error("\nFAIL");
  fail.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(`OK - slider shows both dates: before ${g.pre.visible}px | `
  + `after ${g.post.visible}px across a ${g.mapWidth}px map`);
process.exit(0);
