import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";

/**
 * Before/after imagery swipe.
 *
 * Two georeferenced overlays stacked in their own panes, each clipped to its own
 * side of a draggable divider. Clipping the panes rather than redrawing anything
 * means the divider costs one CSS property per frame, and both images stay
 * perfectly registered while you pan and zoom -- they are the same map layer, so
 * Leaflet moves them together.
 *
 * Two pairs are offered. Optical is the readable one and mostly cloud; radar
 * sees through cloud and covers both dates. The slider opens on whichever pair
 * actually has post-event pixels, so it opens showing something.
 *
 * Each pair is 1-4 MB and is fetched on first use, not on page load -- most
 * visitors read the findings and never open the slider. Once built the overlays
 * are cached, so toggling back is instant.
 */

const DATA = "data";
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ["2026-08-01","2026-08-25"] -> "1–25 Aug 2026", collapsing shared parts. */
export function formatWindow(win) {
  if (!win?.length) return "";
  const [a, b] = win.map((d) => d.split("-").map(Number));
  const [ay, am, ad] = a;
  const [by, bm, bd] = b;
  const end = `${bd} ${MONTH[bm - 1]} ${by}`;
  if (ay === by && am === bm) return `${ad}–${end}`;
  if (ay === by) return `${ad} ${MONTH[am - 1]} – ${end}`;
  return `${ad} ${MONTH[am - 1]} ${ay} – ${end}`;
}

/** The pair with the most valid post-event pixels -- the one worth opening on. */
const clearest = (info) =>
  info.sensors.reduce((a, b) =>
    info[`${b.id}_post`].valid_pct > info[`${a.id}_post`].valid_pct ? b : a).id;

export default function useSwipe(mapRef, ready) {
  const overlays = useRef({});   // sensor id -> { pre, post }
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(50);
  const [meta, setMeta] = useState(null);
  const [sensor, setSensor] = useState(null);
  const [loading, setLoading] = useState(false);

  // The manifest, once, on first activation.
  useEffect(() => {
    if (!on || meta) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${DATA}/overlays.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`overlays.json ${r.status}`);
        return r.json();
      })
      .then((info) => {
        if (cancelled) return;
        setMeta(info);
        setSensor(clearest(info));
      })
      .catch((e) => {
        console.warn("swipe overlays failed", e);
        if (!cancelled) setOn(false);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [on, meta]);

  // Put the chosen pair on the map. Built once per sensor, then reused.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || !on || !meta || !sensor) return;

    // Below the vector panes (410+) so damage polygons stay on top, above the
    // basemap tiles so the imagery is what you are comparing.
    for (const [pane, z] of [["imgPre", 350], ["imgPost", 360]]) {
      if (!m.getPane(pane)) {
        m.createPane(pane);
        m.getPane(pane).style.zIndex = String(z);
      }
    }
    if (!overlays.current[sensor]) {
      const mk = (half, pane) =>
        L.imageOverlay(`${DATA}/${sensor}_${half}.png`, meta.bounds,
                       { pane, opacity: 1 });
      overlays.current[sensor] = {
        pre: mk("pre", "imgPre"),
        post: mk("post", "imgPost"),
      };
    }
    const { pre, post } = overlays.current[sensor];
    pre.addTo(m);
    post.addTo(m);
    return () => {
      m.removeLayer(pre);
      m.removeLayer(post);
    };
  }, [mapRef, ready, on, meta, sensor]);

  // The divider. One property per pane, set straight on the panes.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const pre = m.getPane("imgPre");
    const post = m.getPane("imgPost");
    if (pre) pre.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    if (post) post.style.clipPath = `inset(0 0 0 ${pos}%)`;
  }, [mapRef, pos, on, meta, sensor]);

  const toggle = useCallback(() => setOn((v) => !v), []);
  const open = useCallback(() => setOn(true), []);

  return { on, toggle, open, pos, setPos, meta, sensor, setSensor, loading };
}
