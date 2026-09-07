import { ROUTES } from "./routes.mjs";

/**
 * Where the site root is, relative to whichever page is open.
 *
 * Every route is a directory one level down, so build.mjs stamps "" on the home
 * page and "../" on the rest. Reading it off the DOM rather than guessing from
 * location.pathname means the site still works mounted in a subdirectory --
 * a GitHub Pages project site, for instance.
 */
const root = typeof document !== "undefined" && document.getElementById("root");

export const BASE = (root && root.dataset.base) || "";
export const DATA = `${BASE}data`;
/**
 * A link to another page on this site, by route id, from wherever we are.
 *
 * By id and not by path: the two differ (`how` lives at `how-it-works/`), and a
 * caller that passes one where the other was meant produces a link to a page
 * that does not exist. Looking it up here means there is one place to be wrong,
 * and smoke.mjs walks every link on every page against the files on disk.
 */
export const href = (id) => {
  const r = ROUTES.find((x) => x.id === id);
  if (!r) throw new Error(`no route "${id}"`);
  return `${BASE}${r.path}${r.path ? "/" : ""}`;
};
