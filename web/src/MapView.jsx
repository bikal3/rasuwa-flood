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
  return L.circleMarker(latlng, {
    radius: layer.radius || 5,
    color: "#fcfcfb",
    weight: 1.2,
    fillColor: colour,
    fillOpacity: 0.95,
  });
}

function popupHtml(layer, props) {
  const title = layer.title ? layer.title(props) : layer.label;
  const rows = Object.entries(props)
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .slice(0, 8)
    .map(
      ([k, v]) =>
        `<tr><td style="color:#898781;padding-right:.6rem">${k.replace(/_/g, " ")}</td>` +
        `<td style="font-family:'IBM Plex Mono',monospace">${v}</td></tr>`
    )
    .join("");
  return (
    `<b style="font-family:Fraunces,Georgia,serif;font-size:.95rem">${title}</b>` +
    `<div style="color:#898781;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;margin:.25rem 0 .4rem">${layer.label}</div>` +
    `<table style="font-size:.75rem;border-collapse:collapse">${rows}</table>`
  );
}

export default function MapView() {
  const host = useRef(null);
  const map = useRef(null);
  const groups = useRef({});
  const tiles = useRef(null);
  const [visible, setVisible] = useState(
    () => new Set(LAYERS.filter((l) => l.on).map((l) => l.id))
  );
  const [counts, setCounts] = useState({});
  const [basemap, setBasemap] = useState("imagery");
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(null);

  // Build once.
  useEffect(() => {
    const m = L.map(host.current, {
      center: [28.1, 85.2],
      zoom: 10,
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
    });
    map.current = m;
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(m);

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
            style: () => layer.style || {},
            pointToLayer: (f, ll) => markerFor(f, ll, layer),
            onEachFeature: (f, lyr) => {
              const props = f.properties || {};
              lyr.bindPopup(() => popupHtml(layer, props), {
                closeButton: true,
                maxWidth: 320,
              });
              lyr.on("click", () => {
                setSelected({ layer: layer.label, props, title: layer.title?.(props) });
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

  // Toggles.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const [id, g] of Object.entries(groups.current)) {
      const want = visible.has(id);
      if (want && !m.hasLayer(g)) g.addTo(m);
      if (!want && m.hasLayer(g)) m.removeLayer(g);
    }
  }, [visible, ready]);

  const toggle = (id) =>
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const goto = (place) => {
    const m = map.current;
    if (!m) return;
    if (place.bounds) {
      const g = groups.current.aoi || groups.current.flood_extent;
      if (g) m.fitBounds(g.getBounds(), { padding: [24, 24] });
    } else {
      m.flyTo([place.view[0], place.view[1]], place.view[2], { duration: 0.9 });
    }
  };

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
            <h3>{group}</h3>
            {items.map((l) => (
              <button
                key={l.id}
                className="layer"
                aria-pressed={visible.has(l.id)}
                onClick={() => toggle(l.id)}
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
                <span className="count">{counts[l.id] ?? "—"}</span>
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
