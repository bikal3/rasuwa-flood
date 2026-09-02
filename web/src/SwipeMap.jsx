import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { BASEMAPS, PLACES } from "./layers.js";
import useSwipe, { formatWindow } from "./useSwipe.js";
import tameGestures from "./gestures.js";

/**
 * The before/after comparison, on a map of its own.
 *
 * It used to be a mode on the main map, sharing that map's panes with 1,600
 * damage polygons and a fourteen-layer panel. Two things were wrong with that.
 * The imagery covers the Sentinel ROI, which is the northern third of a corridor
 * the main map has to fit end to end, so the slider spent most of its life
 * showing a patch of overlay in one corner. And a swipe is a different question
 * from a layer toggle -- "what changed here" against "what did the survey record
 * here" -- so making them the same viewport meant answering one destroyed the
 * view you had set up for the other.
 *
 * This map has no vector layers, one basemap, and its own view. Nothing here
 * talks to the map above it.
 */

// The imagery is a 20 m grid. Past this it is mush -- honest mush, but mush --
// and letting someone zoom to 18 only teaches them the overlay is broken.
const MAX_ZOOM = 16;

/**
 * The zoom at which the imagery covers the frame rather than fitting inside it.
 *
 * The scene is roughly square and this map is a wide band, so fitBounds -- which
 * contains -- strands a square of imagery in a field of basemap with nothing to
 * look at down either side. Cover instead: fill the frame and let the ends of
 * the scene run off the top and bottom. Centred, that is the Timure-Syabrubesi
 * stretch, which is the part anyone came here to see.
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
  const swipe = useSwipe(map, ready);
  const sensor = swipe.meta?.sensors.find((s) => s.id === swipe.sensor) ?? {};
  const pre = swipe.meta?.[`${swipe.sensor}_pre`];
  const post = swipe.meta?.[`${swipe.sensor}_post`];

  // Build once.
  useEffect(() => {
    const bm = BASEMAPS[0];
    const m = L.map(host.current, {
      center: [28.2, 85.4],
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

  // A pair of overlays is 1.6 MB and this sits below the fold, so it is fetched
  // when the section gets near the viewport rather than on page load. Where
  // there is no IntersectionObserver -- jsdom, mainly -- just load it.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver !== "function") {
      swipe.open();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          swipe.open();
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [swipe.open]);

  // Open on the imagery. It is a fraction of the corridor the map above covers,
  // and any other starting view is mostly basemap.
  useEffect(() => {
    if (swipe.meta) show(false);
  }, [swipe.meta]);

  // Only the named views the imagery actually covers -- Betrawati is 30 km south
  // of the scene, and a button that flies you off the overlay is a trap.
  const places = swipe.meta
    ? PLACES.filter((p) => p.view &&
        L.latLngBounds(swipe.meta.bounds).contains([p.view[0], p.view[1]]))
    : [];

  function show(animate = true) {
    const m = map.current;
    if (!m || !swipe.meta) return;
    const b = L.latLngBounds(swipe.meta.bounds);
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
    swipe.setPos((p) => clampPos(p + by));
  };

  const dragDivider = (e) => {
    const box = host.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const move = (ev) =>
      swipe.setPos(clampPos(((ev.clientX - box.left) / box.width) * 100));
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section className="comparesec" id="compare">
      <div className="comparehead">
        <div>
          <h2>Before and after</h2>
          <p>
            Two dates over the same ground, on one contrast stretch computed from
            the pre-event image — so a difference in brightness is a difference on
            the ground and not the normalisation moving. Drag the divider.
          </p>
          {sensor.source && <p className="comparesrc">{sensor.source}</p>}
        </div>
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
            "Before and after satellite imagery of the Rasuwa corridor, " +
            `${sensor.label ? sensor.label.toLowerCase() : "satellite"} pair. ` +
            "Arrow keys pan, plus and minus zoom."
          }
        />
        {pre && post && (
          <p className="sr-only">
            {sensor.source}. Before: {formatWindow(pre.window)}, {pre.valid_pct}%
            of the frame {sensor.cover}. After: {formatWindow(post.window)},{" "}
            {post.valid_pct}% {sensor.cover}. Both dates share one contrast
            stretch computed on the pre-event image. The change the comparison
            shows is the Bhote Koshi channel between Rasuwagadhi and Syabrubesi:
            after the flood it is wider and, in radar, darker, because smooth
            standing water and fresh wet sediment reflect the radar pulse away
            from the sensor. Drag the divider, or focus it and use the arrow
            keys, to move between the two dates.
          </p>
        )}

        <div className="mapctl">
          <button onClick={() => map.current?.zoomIn()} title="Zoom in" aria-label="Zoom in comparison">+</button>
          <span className="z" title="Zoom level">{zoom.toFixed(2).replace(/\.?0+$/, "")}</span>
          <button onClick={() => map.current?.zoomOut()} title="Zoom out" aria-label="Zoom out comparison">−</button>
          <button onClick={() => show()} title="Fit the imagery" aria-label="Fit imagery">⤢</button>
        </div>

        <div className="swipe" style={{ "--x": `${swipe.pos}%` }}>
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
            aria-valuenow={Math.round(swipe.pos)}
            aria-valuetext={`${Math.round(swipe.pos)}% before, ${
              100 - Math.round(swipe.pos)
            }% after`}
          >
            <span className="grip" aria-hidden="true">↔</span>
          </div>
          {[["before", "pre", "Before"], ["after", "post", "After"]].map(
            ([side, half, title]) => {
              const d = swipe.meta?.[`${swipe.sensor}_${half}`];
              return (
                <div key={side} className={`swipe-tag ${side}`}>
                  <b>{title}</b>
                  {d && (
                    <>
                      <span>{formatWindow(d.window)}</span>
                      <span className="cover">{d.valid_pct}% {sensor.cover}</span>
                    </>
                  )}
                </div>
              );
            }
          )}
          {/* The optical pair is six days of monsoon and mostly cloud; the radar
              pair covers both dates but is false colour. Neither is the right
              default for everyone, so both are one click away. */}
          {swipe.meta && (
            <div className="swipe-sensor" role="group" aria-label="Imagery source">
              {swipe.meta.sensors.map((s) => (
                <button
                  key={s.id}
                  onClick={() => swipe.setSensor(s.id)}
                  className={s.id === swipe.sensor ? "act" : ""}
                  aria-pressed={s.id === swipe.sensor}
                  title={s.source}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {swipe.loading && <div className="swipe-load">Loading imagery…</div>}
        </div>
      </div>
    </section>
  );
}
