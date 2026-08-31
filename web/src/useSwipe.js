import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";

/**
 * Before/after imagery swipe.
 *
 * Two georeferenced Sentinel-2 overlays stacked in their own panes, with the
 * "after" pane clipped to the right of a draggable divider. Clipping the pane
 * rather than redrawing anything means the divider costs one CSS property per
 * frame, and both images stay perfectly registered while you pan and zoom --
 * they are the same map layer, so Leaflet moves them together.
 *
 * The PNGs are 5.7 MB together and are fetched on first activation, not on page
 * load. Most visitors read the findings and never open the slider; they should
 * not pay for it. Once built the overlays are cached, so toggling is instant.
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

export default function useSwipe(mapRef, ready) {
  const overlays = useRef(null);
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(50);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  // Build on first activation, then reuse.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || !on) return;
    let cancelled = false;

    (async () => {
      if (!overlays.current) {
        setLoading(true);
        try {
          const res = await fetch(`${DATA}/overlays.json`);
          if (!res.ok) throw new Error(`overlays.json ${res.status}`);
          const info = await res.json();
          if (cancelled) return;

          // Below the vector panes (410+) so damage polygons stay on top, above
          // the basemap tiles so the imagery is what you are comparing.
          for (const [pane, z] of [["imgPre", 350], ["imgPost", 360]]) {
            if (!m.getPane(pane)) {
              m.createPane(pane);
              m.getPane(pane).style.zIndex = String(z);
            }
          }
          const mk = (file, pane) =>
            L.imageOverlay(`${DATA}/${file}`, info.bounds, { pane, opacity: 1 });
          overlays.current = {
            pre: mk("s2_pre.png", "imgPre"),
            post: mk("s2_post.png", "imgPost"),
          };
          setMeta(info);
        } catch (e) {
          console.warn("swipe overlays failed", e);
          setOn(false);
          return;
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      if (cancelled) return;
      overlays.current.pre.addTo(m);
      overlays.current.post.addTo(m);
    })();

    return () => {
      cancelled = true;
      if (overlays.current) {
        m.removeLayer(overlays.current.pre);
        m.removeLayer(overlays.current.post);
      }
    };
  }, [mapRef, ready, on]);

  // The divider. One property, set straight on the pane.
  useEffect(() => {
    const m = mapRef.current;
    const pane = m?.getPane("imgPost");
    if (pane) pane.style.clipPath = `inset(0 0 0 ${pos}%)`;
  }, [mapRef, pos, on, meta]);

  const toggle = useCallback(() => setOn((v) => !v), []);
  const open = useCallback(() => setOn(true), []);

  return { on, toggle, open, pos, setPos, meta, loading };
}
