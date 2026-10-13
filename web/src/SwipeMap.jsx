import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { BASEMAPS, PLACES } from "./layers.js";
import tameGestures from "./gestures.js";
import { DATA } from "./base.js";

/**
 * The before/after comparison, on a map of its own.
 *
 * It used to be a mode on the main map, sharing that map's panes with 1,600
 * damage polygons and a fourteen-layer panel. Two things were wrong with that.
 * The imagery is an 11 km frame at Betrawati, the foot of a corridor the main
 * map has to fit end to end, so the slider spent most of its life showing a
 * patch of overlay in one corner. And a swipe is a different question from a
 * layer toggle -- "what changed here" against "what did the survey record here"
 * -- so making them the same viewport meant answering one destroyed the view you
 * had set up for the other.
 *
 * This map has no vector layers, one basemap, and its own view. Nothing here
 * talks to the map above it.
 *
 * Two georeferenced overlays stacked in their own panes, each clipped to its own
 * side of a draggable divider. Clipping rather than redrawing means the divider
 * costs one CSS property per frame, and both images stay perfectly registered
 * while you pan and zoom -- they are ordinary map layers, so Leaflet moves them
 * together.
 *
 * **Both** images are clipped, not just the "after" one. Clipping only the after
 * leaves the before drawing full-width underneath it, so wherever the after has
 * no pixels the before shows through and the slider looks like it does nothing.
 * That is not cosmetic here: the masked post-event frame is two thirds
 * cloud-free, so a third of the "after" half would have been the "before" image
 * wearing the after label.
 *
 * Two pairs are offered, the same two acquisitions with the cloud mask on and
 * off. The slider opens on whichever has the most post-event pixels, so it opens
 * showing something.
 *
 * Nothing loads until the section nears the viewport, so a visitor who never
 * scrolls that far never pays the 0.85 MB. Each pair is built once and kept, so
 * switching back is instant.
 */

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-12" -> "12 Aug 2026". Each half is one acquisition, not a window. */
function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH[m - 1]} ${y}`;
}

/** The pair with the most valid post-event pixels -- the one worth opening on. */
const clearest = (info) =>
  info.sensors.reduce((a, b) =>
    info[`${b.id}_post`].valid_pct > info[`${a.id}_post`].valid_pct ? b : a).id;

// The imagery is a 10 m grid -- Sentinel-2 native, which this frame is small
// enough to afford. Past this it is mush -- honest mush, but mush -- and letting
// someone zoom further only teaches them the overlay is broken.
const MAX_ZOOM = 17;

/**
 * The zoom at which the imagery covers the frame rather than fitting inside it.
 *
 * The scene is roughly square and this map is a wide band, so fitBounds -- which
 * contains -- strands a square of imagery in a field of basemap with nothing to
 * look at down either side. Cover instead: fill the frame and let the ends of
 * the scene run off the top and bottom. Centred, that is the Trishuli-Phalankhu
 * confluence at Betrawati, which is the part anyone came here to see.
 */
const coverZoom = (m, bounds) => {
  const nw = m.project(bounds.getNorthWest(), 0);
  const se = m.project(bounds.getSouthEast(), 0);
  const size = m.getSize();
  return Math.min(MAX_ZOOM, Math.max(
    Math.log2(size.x / (se.x - nw.x)),
    Math.log2(size.y / (se.y - nw.y)),
  ));
};

export default function SwipeMap() {
  const host = useRef(null);
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(12);

  // Build once.
  useEffect(() => {
    const bm = BASEMAPS[0];
    const m = L.map(host.current, {
      center: [27.97, 85.18],
      zoom: 12,
      maxZoom: MAX_ZOOM,
      zoomControl: false,
      attributionControl: true,
      // Quarter steps, to match the map above.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 140,
    });
    L.tileLayer(bm.url, { attribution: bm.attribution, maxZoom: MAX_ZOOM }).addTo(m);
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(m);
    m.on("zoomend", () => setZoom(m.getZoom()));
    map.current = m;
    const freeGestures = tameGestures(m);
    setReady(true);
    return () => {
      freeGestures();
      m.remove();
      map.current = null;
    };
  }, []);

  const overlays = useRef({});   // sensor id -> { pre, post }
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(50);
  const [meta, setMeta] = useState(null);
  const [sensorId, setSensorId] = useState(null);
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
        setSensorId(clearest(info));
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
    const m = map.current;
    if (!m || !ready || !on || !meta || !sensorId) return;

    // Above the basemap tiles (200) so the imagery is what you are comparing;
    // nothing else is on this map.
    for (const [pane, z] of [["imgPre", 350], ["imgPost", 360]]) {
      if (!m.getPane(pane)) {
        m.createPane(pane);
        m.getPane(pane).style.zIndex = String(z);
      }
    }
    if (!overlays.current[sensorId]) {
      const mk = (half, pane) =>
        L.imageOverlay(`${DATA}/${sensorId}_${half}.webp`, meta.bounds,
                       { pane, opacity: 1 });
      overlays.current[sensorId] = {
        pre: mk("pre", "imgPre"),
        post: mk("post", "imgPost"),
      };
    }
    const { pre, post } = overlays.current[sensorId];
    pre.addTo(m);
    post.addTo(m);
    return () => {
      m.removeLayer(pre);
      m.removeLayer(post);
    };
  }, [ready, on, meta, sensorId]);

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
    const m = map.current;
    const pair = overlays.current[sensorId];
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
  }, [pos, on, meta, sensorId]);

  const sensor = meta?.sensors.find((s) => s.id === sensorId) ?? {};
  const pre = meta?.[`${sensorId}_pre`];
  const post = meta?.[`${sensorId}_post`];

  // A pair of overlays is ~0.45 MB and this sits below the fold, so it is fetched
  // when the section gets near the viewport rather than on page load. Where
  // there is no IntersectionObserver -- jsdom, mainly -- just load it.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Open on the imagery. It is a fraction of the corridor the map above covers,
  // and any other starting view is mostly basemap.
  useEffect(() => {
    if (meta) show(false);
  }, [meta]);

  // Only the named views the imagery actually covers -- Rasuwagadhi and
  // Syabrubesi are tens of km north of this frame, and a button that flies you
  // off the overlay is a trap.
  const places = meta
    ? PLACES.filter((p) => p.view &&
        L.latLngBounds(meta.bounds).contains([p.view[0], p.view[1]]))
    : [];

  function show(animate = true) {
    const m = map.current;
    if (!m || !meta) return;
    const b = L.latLngBounds(meta.bounds);
    const z = coverZoom(m, b);
    if (animate) m.flyTo(b.getCenter(), z, { duration: 0.8 });
    else m.setView(b.getCenter(), z, { animate: false });
  }

  const clampPos = (v) => Math.min(97, Math.max(3, v));

  // The divider was pointer-only: role="separator" with an onPointerDown and
  // nothing else, so a keyboard walk of the page never reached it and the whole
  // comparison was unavailable without a mouse. A focusable separator is a
  // window splitter, which is exactly what this is, so it takes the splitter
  // keys and reports its position as a value.
  const onDividerKey = (e) => {
    const step = e.shiftKey ? 10 : 2;
    const by = { ArrowLeft: -step, ArrowRight: step, Home: -100, End: 100 }[e.key];
    if (by === undefined) return;
    e.preventDefault();
    setPos((p) => clampPos(p + by));
  };

  const dragDivider = (e) => {
    const box = host.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const move = (ev) =>
      setPos(clampPos(((ev.clientX - box.left) / box.width) * 100));
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <div className="compareplaces">
        <button onClick={() => show()}>Fit imagery</button>
        {places.map((p) => (
          <button
            key={p.label}
            onClick={() =>
              map.current?.flyTo([p.view[0], p.view[1]], p.view[2], { duration: 0.9 })
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mapcanvas comparecanvas">
        {/* Leaflet writes alt="" on every image overlay and gives the container
            tabindex=0 with no name, so without these two the entire argument of
            this map -- that the channel widens between the dates -- exists only
            as pixels. The description is built from the same manifest as the
            labels, so it cannot drift from what is on screen. */}
        <div
          ref={host}
          className="mapfill"
          aria-label={
            "Before and after satellite imagery of the Trishuli at Betrawati, " +
            `${sensor.label ? sensor.label.toLowerCase() : "satellite"} pair. ` +
            "Arrow keys pan, plus and minus zoom."
          }
        />
        {pre && post && (
          <p className="sr-only">
            {sensor.source}. Before: {formatDate(pre.date)}, {pre.valid_pct}%
            of the frame {sensor.cover}. After: {formatDate(post.date)},{" "}
            {post.valid_pct}% {sensor.cover}. Every frame goes through one fixed
            tone curve, so a brighter pixel is brighter ground. The change the comparison
            shows is the Trishuli at Betrawati and Gerkhu: a narrow river
            threading green valley floor on 12 August, and on 27 August a bare
            grey bed several times wider, the fields and terraces either side of
            it buried under flood deposits. Drag the divider, or focus it and use
            the arrow keys, to move between the two dates.
          </p>
        )}

        <div className="mapctl">
          <button onClick={() => map.current?.zoomIn()} title="Zoom in" aria-label="Zoom in comparison">+</button>
          <span className="z" title="Zoom level">{zoom.toFixed(2).replace(/\.?0+$/, "")}</span>
          <button onClick={() => map.current?.zoomOut()} title="Zoom out" aria-label="Zoom out comparison">−</button>
          <button onClick={() => show()} title="Fit the imagery" aria-label="Fit imagery">⤢</button>
        </div>

        <div className="swipe" style={{ "--x": `${pos}%` }}>
          <div
            className="swipe-bar"
            onPointerDown={dragDivider}
            onKeyDown={onDividerKey}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Comparison divider"
            aria-valuemin={3}
            aria-valuemax={97}
            aria-valuenow={Math.round(pos)}
            aria-valuetext={`${Math.round(pos)}% before, ${
              100 - Math.round(pos)
            }% after`}
          >
            <span className="grip" aria-hidden="true">↔</span>
          </div>
          {[["before", "pre", "Before"], ["after", "post", "After"]].map(
            ([side, half, title]) => {
              const d = meta?.[`${sensorId}_${half}`];
              return (
                <div key={side} className={`swipe-tag ${side}`}>
                  <b>{title}</b>
                  {d && (
                    <>
                      <span>{formatDate(d.date)}</span>
                      <span className="cover">{d.valid_pct}% {sensor.cover}</span>
                    </>
                  )}
                </div>
              );
            }
          )}
          {/* The unmasked pair is the picture as published; the masked one is
              the same frames with the weather cut out. Neither is the right
              default for everyone, so both are one click away. */}
          {meta && (
            <div className="swipe-sensor" role="group" aria-label="Imagery source">
              {meta.sensors.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSensorId(s.id)}
                  className={s.id === sensorId ? "act" : ""}
                  aria-pressed={s.id === sensorId}
                  title={s.source}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {loading && <div className="swipe-load">Loading imagery…</div>}
        </div>
      </div>

      {/* Which pair is on screen, under the figure: the sensor switch changes it,
          so it cannot be written into the page's own caption. */}
      <p className="figcap">{sensor.source}.</p>
    </>
  );
}
