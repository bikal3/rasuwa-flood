/**
 * Static build. esbuild only -- no Vite, no framework CLI, no router.
 *
 *   node build.mjs           bundle web/ into ../site/, ready to publish
 *   node build.mjs --serve   same, but watched and served on :5173
 *
 * public/ is copied verbatim, so public/data/*.geojson written by pipeline/stage4_hot.py
 * ships as static files the app fetches at runtime rather than being inlined
 * into the bundle. That keeps the JS small and lets a browser cache the layers
 * independently of the code.
 *
 * The site is genuinely multi-page: one real directory and index.html per entry
 * in routes.mjs, each loading the same bundle and told which page it is by a
 * data attribute. That means no client-side router, no history interception and
 * no 404 rewrite rule on the host -- the browser's own navigation does the work,
 * back and forward included, and a link to /terrain/ is a link to a file that
 * exists. The cost is a full page load between sections, which after the first
 * one is a cache hit on app.js and app.css.
 */
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ROUTES, SHARE, SITE } from "./src/routes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "site");
const serve = process.argv.includes("--serve");
// PORT=5174 node build.mjs --serve, for when 5173 is already taken.
const port = Number(process.env.PORT || 5173);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(here, "public"), out, { recursive: true });

const options = {
  entryPoints: [path.join(here, "src", "main.jsx")],
  bundle: true,
  outdir: out,
  entryNames: "app",
  assetNames: "[name]",
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  loader: { ".png": "file", ".svg": "file" },
  minify: !serve,
  sourcemap: serve,
  logLevel: "info",
  define: { "process.env.NODE_ENV": serve ? '"development"' : '"production"' },
};

/**
 * One index.html per route, from one template.
 *
 * Every route is a directory exactly one level below the root, so the relative
 * path back to app.js, app.css and data/ is "" at the top and "../" everywhere
 * else -- stamped into the page rather than worked out at runtime, so the site
 * survives being mounted in a subdirectory.
 */
/** Every value below is stamped into a double-quoted attribute. */
const esc = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** A route's absolute URL, for the tags that are read off-site. */
const urlOf = (r) => `${SITE}/${r.path ? r.path + "/" : ""}`;

async function writePages() {
  const tpl = await readFile(path.join(here, "template.html"), "utf8");
  for (const r of ROUTES) {
    const dir = r.path ? path.join(out, r.path) : out;
    await mkdir(dir, { recursive: true });
    // The home page is already called "Rasuwa Flood 2026"; the rest hang the
    // site name off their own.
    const html = tpl
      .replaceAll("{{titletag}}", esc(r.path ? `${r.title} — Rasuwa Flood 2026` : r.title))
      .replaceAll("{{base}}", r.path ? "../" : "")
      .replaceAll("{{page}}", r.id)
      .replaceAll("{{title}}", esc(r.title))
      .replaceAll("{{desc}}", esc(r.desc))
      // Absolute, not {{base}}-relative: a scraper resolves these against the
      // page it fetched, but a chat client is handed the string as-is.
      .replaceAll("{{url}}", urlOf(r))
      .replaceAll("{{image}}", `${SITE}/${SHARE.image}`)
      .replaceAll("{{imagew}}", String(SHARE.width))
      .replaceAll("{{imageh}}", String(SHARE.height))
      .replaceAll("{{imagealt}}", esc(SHARE.alt));
    await writeFile(path.join(dir, "index.html"), html);
  }
}
await writePages();

/**
 * 404.html, which Cloudflare Pages serves for any URL that is not one of the
 * ten. Its own template rather than the shared one: it renders without the
 * bundle and links absolutely, both explained in the file. All it needs from
 * here is the list of pages, so that a route added to ROUTES appears on it.
 */
await writeFile(
  path.join(out, "404.html"),
  (await readFile(path.join(here, "404.html"), "utf8")).replace(
    "{{cards}}",
    ROUTES.map((r) =>
      `    <a class="card" href="/${r.path}${r.path ? "/" : ""}">\n`
      + `      <h3><span aria-hidden="true">${r.icon}</span> ${esc(r.label)}</h3>\n`
      + `      <p>${esc(r.desc)}</p>\n`
      + `      <span class="go">Open →</span>\n`
      + "    </a>"
    ).join("\n")
  )
);

/**
 * sitemap.xml and robots.txt.
 *
 * Ten pages is small enough to list by hand and exactly the size that goes
 * stale when someone adds an eleventh, so both come off ROUTES like everything
 * else. No <lastmod>: the only date available here is the build's, which
 * changes on every deploy whether or not the page did, and a sitemap that
 * claims everything changed today is worth less than one that claims nothing.
 */
await writeFile(
  path.join(out, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + ROUTES.map((r) => `  <url><loc>${urlOf(r)}</loc></url>\n`).join("")
    + "</urlset>\n"
);
await writeFile(
  path.join(out, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
);

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // esbuild >=0.17 returns `hosts` (array); older builds returned `host`.
  const served = await ctx.serve({ servedir: out, port }).catch((e) => {
    console.error(`\n  ${e.message}\n  Try: PORT=5174 node build.mjs --serve\n`);
    process.exit(1);
  });
  const { hosts, host } = served;
  const h = (hosts?.[0] ?? host ?? "localhost").replace(/^(0\.0\.0\.0|::)$/, "localhost");
  // Note: routes.mjs is read by writePages above, not by esbuild, so adding a
  // route needs a restart rather than a rebuild.
  console.log(`\n  serving http://${h}:${served.port}  (watching web/src)`);
  console.log(`  ${ROUTES.length} pages: ${ROUTES.map((r) => "/" + r.path).join(" ")}\n`);
} else {
  await esbuild.build(options);
  console.log(`\n  built ${ROUTES.length} pages -> ${out}`);
}
