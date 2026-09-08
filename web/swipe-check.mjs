/**
 * The checks jsdom cannot do: is what the DOM claims actually on the screen?
 *
 * Both bugs caught here are the same shape -- a style that reads correctly in
 * the DOM and resolves to no pixels -- and jsdom cannot see either, because it
 * has no layout.
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
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
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
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
  let file = path.join(site, rel);
  // Directory URLs, the way any static host serves them.
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!rel) file = path.join(site, "index.html");
  if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}/`;

// A throwaway profile in the OS temp dir, not in the repo: Chrome writes tens of
// megabytes of cache into it and nothing here wants it kept between runs.
const profile = mkdtempSync(path.join(tmpdir(), "swipe-check-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=0",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  `--user-data-dir=${profile}`,
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
await send("Page.navigate", { url: `${origin}compare/` });
await sleep(4000);

// Fit the imagery first. That view covers rather than contains -- the frame
// fills the map and runs off two of its edges -- and "half the map is the before
// image" is only the right expectation somewhere the overlay spans it. A named
// place would do too, but its zoom is chosen for the main map, so whether the
// overlay reaches both edges there is luck.
await evaluate(String.raw`(async () => {
  [...document.querySelectorAll(".compareplaces button")]
    .find((b) => b.textContent.trim() === "Fit imagery").click();
  await new Promise((r) => setTimeout(r, 2500));
})()`);

const fail = [];
const want = (cond, msg) => !cond && fail.push(msg);

// Every bar on the site drew its empty track and nothing else: .bar-fill is a
// span inside a plain block box, so it stayed inline, and width, height and
// transform are all ignored on an inline box. The DOM said 96.1%, the screen
// said nothing. Measured against the track, in a browser that has done layout,
// on the two pages that carry charts.
for (const page of ["terrain", "satellites"]) {
  await send("Page.navigate", { url: `${origin}${page}/` });
  await sleep(2500);
  const bars = await evaluate(String.raw`[...document.querySelectorAll(".bar-row")].map((row) => ({
    label: row.querySelector(".lbl").textContent.trim(),
    want: parseFloat(row.querySelector(".bar-fill").style.width),
    got: Math.round(1000 * row.querySelector(".bar-fill").getBoundingClientRect().width
                         / row.querySelector(".bar-track").getBoundingClientRect().width) / 10,
  }))`);
  want(bars.length >= 4, `${page}: expected bar charts, found ${bars.length} bars`);
  for (const b of bars) {
    want(Math.abs(b.got - b.want) < 1.5,
      `${page}: bar "${b.label}" fills ${b.got}% of its track where the data says ${b.want}%`);
  }
}

// Back to the slider for the rest.
await send("Page.navigate", { url: `${origin}compare/` });
await sleep(3500);
await evaluate(String.raw`(async () => {
  [...document.querySelectorAll(".compareplaces button")]
    .find((b) => b.textContent.trim() === "Fit imagery").click();
  await new Promise((r) => setTimeout(r, 2500));
})()`);

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

  // The divider must also work without a pointer. It shipped pointer-only --
  // role="separator" with an onPointerDown and nothing else -- which put the
  // whole comparison out of reach of a keyboard. Tab to it for real, then drive
  // it, and check the pixels moved rather than only the ARIA value.
  const key = async (k, shift = false) => {
    const vk = { ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35, Tab: 9 }[k];
    for (const type of ["rawKeyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, key: k, code: k,
        modifiers: shift ? 8 : 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }
    await sleep(110);
  };
  const bar = () => evaluate(String.raw`(() => {
    const b = document.querySelector(".swipe-bar");
    return { focused: document.activeElement === b,
             now: b.getAttribute("aria-valuenow"),
             text: b.getAttribute("aria-valuetext") };
  })()`);

  let hops = 0;
  while (hops < 14 && !(await bar()).focused) { await key("Tab"); hops++; }
  const focused = await bar();
  want(focused.focused, `the divider is not reachable by Tab (gave up after ${hops})`);

  if (focused.focused) {
    want(/%\s*before/.test(focused.text || ""),
      `the divider reports no position to assistive tech (aria-valuetext ${JSON.stringify(focused.text)})`);
    const before = await evaluate(GEOM);
    await key("End");
    const after = await evaluate(GEOM);
    const moved = await bar();
    want(moved.now !== focused.now,
      `End did not change aria-valuenow (${focused.now} -> ${moved.now})`);
    want(Math.abs(after.pre.visible - before.pre.visible) > 100,
      `End changed the value but not the image `
      + `(before ${before.pre.visible}px -> ${after.pre.visible}px)`);
  }
}

ws.close();
chrome.kill();
server.close();
// Wait for it to actually go: kill() only signals, and Chrome keeps writing its
// cache on the way out, so removing the directory under it fails with ENOTEMPTY.
await new Promise((r) => chrome.on("exit", r));
rmSync(profile, { recursive: true, force: true });

if (fail.length) {
  console.error("\nFAIL");
  fail.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(`OK - slider shows both dates: before ${g.pre.visible}px | `
  + `after ${g.post.visible}px across a ${g.mapWidth}px map`);
process.exit(0);
