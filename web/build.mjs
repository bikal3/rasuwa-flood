/**
 * Static build. esbuild only -- no Vite, no framework CLI.
 *
 *   node build.mjs           bundle web/ into ../site/, ready to publish
 *   node build.mjs --serve   same, but watched and served on :5173
 *
 * public/ is copied verbatim, so public/data/*.geojson written by pipeline/stage4_hot.py
 * ships as static files the app fetches at runtime rather than being inlined
 * into the bundle. That keeps the JS small and lets a browser cache the layers
 * independently of the code.
 */
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  console.log(`\n  serving http://${h}:${served.port}  (watching web/src)\n`);
} else {
  await esbuild.build(options);
  console.log(`\n  built -> ${out}`);
}
