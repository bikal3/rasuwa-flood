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
 * **Both** panes are clipped, not just the "after" one. Clipping only the after
 * leaves the before drawing full-width underneath it, so wherever the after has
 * no pixels the before shows through and the slider looks like it does nothing.
 * That is not a cosmetic difference here: the post-event optical composite is
 * 17% cloud-free, so five sixths of the "after" half would have been the "before"
 * image wearing the after label.
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

  // The divider.
  //
  // The clip goes on the two <img> elements, not on their panes. A Leaflet pane
  // is a 0x0 positioned div -- its children are placed by transform and never
  // size it -- and clip-path percentages resolve against the element's own
  // border box, so `inset(0 50% 0 0)` on a pane is 50% of nothing and clips the
  // image away entirely. That is invisible in the DOM (the style is set, the
  // image is loaded and positioned) and total on screen. Leaflet does give each
  // overlay <img> a real box, so the split is measured in pixels from that box's
  // left edge instead, and recomputed whenever the map moves it.
  useEffect(() => {
    const m = mapRef.current;
    const pair = overlays.current[sensor];
    if (!m || !on || !pair) return;

    const clip = () => {
      const pre = pair.pre.getElement();
      const post = pair.post.getElement();
      if (!pre || !post) return;
      // Both halves share one set of bounds, so one box does for both.
      const nw = m.latLngToLayerPoint(pair.pre.getBounds().getNorthWest());
      const se = m.latLngToLayerPoint(pair.pre.getBounds().getSouthEast());
      const w = se.x - nw.x;
      const x = m.containerPointToLayerPoint([(m.getSize().x * pos) / 100, 0]).x;
      const cut = Math.min(Math.max(x - nw.x, 0), w);
      pre.style.clipPath = `inset(0 ${w - cut}px 0 0)`;
      post.style.clipPath = `inset(0 0 0 ${cut}px)`;
    };

    clip();
    m.on("move zoom viewreset resize", clip);
    return () => m.off("move zoom viewreset resize", clip);
  }, [mapRef, pos, on, meta, sensor]);

  const toggle = useCallback(() => setOn((v) => !v), []);
  const open = useCallback(() => setOn(true), []);

  return { on, toggle, open, pos, setPos, meta, sensor, setSensor, loading };
}
