import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAYERS, BASEMAPS, PLACES, BRIDGE_COLOUR } from "./layers.js";

/**
 * Leaflet driven directly from an effect rather than through react-leaflet.
 *
 * The map owns imperative state that React should not be re-rendering: tile
 * caches, 1,600 building polygons, pane order. One effect builds it once, and
 * everything after is a toggle on an already-built layer. react-leaflet would
 * add a dependency and a version-matching problem to wrap an API that is three
 * calls wide here.
 *
 * Canvas renderer throughout -- the damaged-buildings layer alone is 1,626
 * polygons and the SVG renderer creates a DOM node per feature.
 */

const DATA = "data";

function markerFor(feature, latlng, layer) {
  const colour = layer.colourBy
    ? layer.colourBy(feature.properties || {})
    : layer.colour;
  // circleMarker, not rectangle: its radius is in pixels, so a hydropower dot
  // stays the same size at every zoom. L.rectangle takes a geographic box and
  // would vanish the moment you zoomed out to the whole corridor.
  const base = {
    radius: layer.radius || 5,
    color: "#fcfcfb",
    weight: 1.2,
    fillColor: colour,
    fillOpacity: 0.95,
  };
  const mk = L.circleMarker(latlng, base);
  mk.options.__base = base;
  return mk;
}

/**
 * A feature's resting style: whatever its own design says, scaled by the group's
 * current opacity. Both the fade slider and hover-restore go through here, so
 * moving the mouse over a faded layer cannot quietly restore it to full.
 *
 * markerFor stashes __base on point markers because they are built by
 * pointToLayer and never see the style callback that carries it for paths.
 */
function rest(lyr, o) {
  if (!lyr.setStyle) return;
  const base = lyr.options.__base || {};
  lyr.setStyle({
    ...base,
    opacity: (base.opacity ?? 1) * o,
    fillOpacity: (base.fillOpacity ?? 0) * o,
  });
}

/** Thicken and lift a feature. `hard` marks the clicked one, which stays lit. */
function emphasise(lyr, o, hard) {
  if (!lyr.setStyle) return;
  const base = lyr.options.__base || {};
  lyr.setStyle({
    weight: (base.weight ?? 1) + (hard ? 2.5 : 1.5),
    color: hard ? "#0b0b0b" : base.color,
    opacity: 1,
    fillOpacity: Math.min(1, (base.fillOpacity ?? 0) * o + 0.25),
  });
  lyr.bringToFront?.();
}

export default function MapView() {
  const host = useRef(null);
  const map = useRef(null);
  const groups = useRef({});
  const tiles = useRef(null);
  const picked = useRef(null);
  const fadeRef = useRef({});   // read inside Leaflet handlers, which do not re-bind
  const [visible, setVisible] = useState(
    () => new Set(LAYERS.filter((l) => l.on).map((l) => l.id))
  );
  const [counts, setCounts] = useState({});
  const [basemap, setBasemap] = useState("imagery");
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(10);
  const [full, setFull] = useState(false);
  // Keyed by group name; the two groups are what people compare.
  const [fade, setFade] = useState({});

  // Build once.
  useEffect(() => {
    const m = L.map(host.current, {
      center: [28.1, 85.2],
      zoom: 10,
      preferCanvas: true,
      // Own control below, styled with the rest of the page.
      zoomControl: false,
      attributionControl: true,
      // Quarter-step zoom. The corridor is 120 km long but the features that
      // matter -- a washed-out bridge, a 40 m channel -- are metres wide, so
      // whole-integer steps jump straight past the scale you want. The wheel is
      // slowed to match, otherwise one notch still crosses a full level.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 140,
    });
    map.current = m;
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(m);
    m.on("zoomend", () => setZoom(m.getZoom()));

    let cancelled = false;
    // One pane per geometry kind. Without this, draw order is load order, and
    // the building polygons (loaded after the bridges) bury the bridge markers.
    const renderers = {};
    for (const [kind, z] of [["polygon", 410], ["line", 420], ["point", 430]]) {
      m.createPane(kind);
      m.getPane(kind).style.zIndex = String(z);
      renderers[kind] = L.canvas({ pane: kind, padding: 0.4 });
    }

    (async () => {
      const loaded = {};
      // Sequential on purpose: the browser caches these, and firing 14 parallel
      // requests just makes the first paint wait for the largest file.
      for (const layer of LAYERS) {
        try {
          const res = await fetch(`${DATA}/${layer.id}.geojson`);
          if (!res.ok) continue;
          const gj = await res.json();
          if (cancelled) return;

          const g = L.geoJSON(gj, {
            renderer: renderers[layer.kind],
            pane: layer.kind,
            style: () => ({ ...(layer.style || {}), __base: layer.style || {} }),
            pointToLayer: (f, ll) => markerFor(f, ll, layer),
            onEachFeature: (f, lyr) => {
              const props = f.properties || {};
              const op = () => fadeRef.current[layer.group] ?? 1;
              lyr.on("click", () => {
                if (picked.current && picked.current !== lyr) rest(picked.current, op());
                picked.current = lyr;
                emphasise(lyr, op(), true);
                setSelected({ layer: layer.label, props, title: layer.title?.(props) });
              });
              // Nothing else tells you a feature is clickable -- there is no
              // cursor change on a canvas-rendered path by default.
              lyr.on("mouseover", () => {
                m.getContainer().style.cursor = "pointer";
                if (lyr !== picked.current) emphasise(lyr, op(), false);
              });
              lyr.on("mouseout", () => {
                m.getContainer().style.cursor = "";
                if (lyr !== picked.current) rest(lyr, op());
              });
            },
          });
          loaded[layer.id] = g;
          groups.current[layer.id] = g;
          setCounts((c) => ({ ...c, [layer.id]: gj.features?.length ?? 0 }));
          if (layer.on) g.addTo(m);
        } catch (e) {
          console.warn(`layer ${layer.id} failed`, e);
        }
      }
      if (cancelled) return;
      // The container is sized by CSS, which may not have settled when L.map
      // ran; fitBounds against a zero-height map picks a nonsense zoom.
      m.invalidateSize();
      const extent = loaded.aoi || loaded.flood_extent;
      if (extent) m.fitBounds(extent.getBounds(), { padding: [24, 24] });
      setReady(true);
    })();

    return () => {
      cancelled = true;
      m.remove();
    };
  }, []);

  // Basemap swap.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const spec = BASEMAPS.find((b) => b.id === basemap);
    if (tiles.current) m.removeLayer(tiles.current);
    tiles.current = L.tileLayer(spec.url, {
      attribution: spec.attribution,
      maxZoom: spec.maxZoom,
    }).addTo(m);
    tiles.current.bringToBack();
  }, [basemap]);

  // A layer draws when it is switched on AND the map is close enough for it to
  // mean anything. Re-runs on zoom, so crossing a threshold adds or drops the
  // layer without the toggle changing.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const layer of LAYERS) {
      const g = groups.current[layer.id];
      if (!g) continue;
      const want = visible.has(layer.id) && zoom >= (layer.minZoom ?? 0);
      if (want && !m.hasLayer(g)) g.addTo(m);
      if (!want && m.hasLayer(g)) m.removeLayer(g);
    }
  }, [visible, ready, zoom]);

  // Observed and derived damage sit on top of each other by design -- that
  // overlap is the finding. Fading one group against the other is the cheapest
  // way to read it, and it works on canvas layers where a CSS filter would not.
  useEffect(() => {
    fadeRef.current = fade;
    for (const layer of LAYERS) {
      const g = groups.current[layer.id];
      if (!g) continue;
      const o = fade[layer.group] ?? 1;
      g.eachLayer((l) => (l === picked.current ? emphasise(l, o, true) : rest(l, o)));
    }
  }, [fade, ready]);

  const toggle = (id) =>
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const fit = () => {
    const m = map.current;
    const g = groups.current.aoi || groups.current.flood_extent;
    if (m && g) m.flyToBounds(g.getBounds(), { padding: [24, 24], duration: 0.8 });
  };

  const goto = (place) => {
    const m = map.current;
    if (!m) return;
    if (place.bounds) fit();
    else m.flyTo([place.view[0], place.view[1]], place.view[2], { duration: 0.9 });
  };

  const toggleFull = () => {
    const el = host.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  // Keyboard, but only when the map is the thing being used -- these must not
  // fire while someone is typing or tabbing through the layer list.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest("input, textarea, button, a")) return;
      if (!host.current?.parentElement.contains(e.target) && e.target !== document.body) return;
      const m = map.current;
      if (!m) return;
      if (e.key === "+" || e.key === "=") m.zoomIn();
      else if (e.key === "-" || e.key === "_") m.zoomOut();
      else if (e.key === "f") fit();
      else return;
      e.preventDefault();
    };
    const onFull = () => {
      setFull(Boolean(document.fullscreenElement));
      setTimeout(() => map.current?.invalidateSize(), 120);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  const grouped = LAYERS.reduce((acc, l) => {
    (acc[l.group] ||= []).push(l);
    return acc;
  }, {});

  return (
    <div className="maprow">
      <div className="mapcanvas">
        <div ref={host} className="mapfill" />
        <div className="maploading" data-done={ready}>
          Loading layers…
        </div>
        <div className="mapctl">
          <button onClick={() => map.current?.zoomIn()} title="Zoom in  (+)" aria-label="Zoom in">+</button>
          <span className="z" title="Zoom level">{zoom.toFixed(2).replace(/\.?0+$/, "")}</span>
          <button onClick={() => map.current?.zoomOut()} title="Zoom out  (−)" aria-label="Zoom out">−</button>
          <button onClick={fit} title="Fit the whole corridor  (F)" aria-label="Fit corridor">⤢</button>
          <button onClick={toggleFull} title={full ? "Leave fullscreen" : "Fullscreen"} aria-label="Toggle fullscreen">
            {full ? "⤡" : "⛶"}
          </button>
        </div>

        <div className="legend-float">
          <b>Bridge condition</b>
          {Object.entries(BRIDGE_COLOUR).map(([k, v]) => (
            <div key={k}>
              <i style={{ background: v }} />
              {k}
            </div>
          ))}
        </div>
      </div>

      <aside className="panel">
        <h3>Basemap</h3>
        <div className="basemaps">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              aria-pressed={basemap === b.id}
              onClick={() => setBasemap(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <h3>Fly to</h3>
        <div className="zoombar">
          {PLACES.map((p) => (
            <button key={p.label} onClick={() => goto(p)}>
              {p.label}
            </button>
          ))}
        </div>

        {Object.entries(grouped).map(([group, items]) => (
          <div className="panel-group" key={group}>
            <h3>
              {group}
              <input
                className="fade"
                type="range"
                min="0.15"
                max="1"
                step="0.05"
                value={fade[group] ?? 1}
                aria-label={`Opacity of ${group}`}
                title={`Opacity — fade this group against the other`}
                onChange={(e) =>
                  setFade((f) => ({ ...f, [group]: Number(e.target.value) }))
                }
              />
            </h3>
            {items.map((l) => (
              <button
                key={l.id}
                className="layer"
                aria-pressed={visible.has(l.id)}
                data-dormant={visible.has(l.id) && zoom < (l.minZoom ?? 0)}
                onClick={() => toggle(l.id)}
                title={
                  l.minZoom
                    ? `Draws from zoom ${l.minZoom} — click the value to jump there`
                    : undefined
                }
              >
                <span className="box">
                  <span
                    className="swatch"
                    style={{
                      background: visible.has(l.id) ? l.colour : "transparent",
                      display: "block",
                      margin: "1.5px",
                    }}
                  />
                </span>
                {l.label}
                <span className="count">
                  {visible.has(l.id) && zoom < (l.minZoom ?? 0)
                    ? `z${l.minZoom}+`
                    : (counts[l.id] ?? "—")}
                </span>
              </button>
            ))}
          </div>
        ))}

        <div className="inspector">
          <h3 style={{ padding: 0, marginBottom: ".5rem" }}>Selected feature</h3>
          {selected ? (
            <>
              <h4>{selected.title || selected.layer}</h4>
              <dl>
                {Object.entries(selected.props)
                  .filter(([, v]) => v !== null && v !== "" && v !== undefined)
                  .slice(0, 10)
                  .map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt>{k.replace(/_/g, " ")}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </>
          ) : (
            <p className="empty">Click any feature on the map.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
