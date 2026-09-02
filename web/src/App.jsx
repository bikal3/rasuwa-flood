import { useEffect, useState } from "react";
import MapView from "./MapView.jsx";
import SwipeMap from "./SwipeMap.jsx";
import { Section, Table, Bars, fmt, int } from "./ui.jsx";
import { C } from "./layers.js";

const KB = (b) => (b < 1024 ? "<1 kB" : `${Math.round(b / 1024)} kB`);

export default function App() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch("data/summary.json")
      .then((r) => {
        if (!r.ok) throw new Error(`summary.json ${r.status}`);
        return r.json();
      })
      .then(setS)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err)
    return (
      <div className="wrap" style={{ padding: "4rem 0" }}>
        <h1>Data not loaded</h1>
        <p className="lede">
          {err}. Run <code>python pipeline/stage4_hot.py</code>, then{" "}
          <code>node web/build.mjs</code>.
        </p>
      </div>
    );
  if (!s) return <div className="maploading">Loading…</div>;

  const a = s.areas;
  const v = s.validation;
  const hits = v.hits || [];
  const roi = s.event.roi;
  const bridges = Object.values(s.bridges_by_status).reduce((x, y) => x + y, 0);
  const surveyed = Object.values(s.buildings_by_status).reduce((x, y) => x + y, 0);
  // "26 August 2026", from the event's own ISO date rather than written twice.
  const DATE = new Date(`${s.event.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  return (
    <>
      <header className="masthead">
        <div className="wrap">
          <div className="kicker">
            <span><b>Technical report</b> · Multi-sensor change detection</span>
            <span>Rasuwa · Bagmati · Nepal · {DATE}</span>
          </div>
          <h1>
            The flood the terrain <em>already knew about</em>
          </h1>
          <p className="subtitle">
            Terrain-derived flood corridors and multi-sensor change detection for
            the {s.event.title}, tested against the HOT ground survey.
          </p>
          <p className="status">
            Unreviewed analysis · thresholds are the study design's, not
            calibrated · nothing here is a validated classifier
          </p>

          {/* The abstract does the work the standfirst used to: says what was
              done, on what, and what came out, with the numbers in it rather
              than promised further down. Every figure is read from
              summary.json, so it cannot drift from the tables below. */}
          <div className="abstract rail">
            <span className="idx">Abstract</span>
            <div>
              <p>
                A glacial collapse on Langtang Lirung on {DATE} sent a debris
                flood down the Lende Khola into the Bhote Koshi and Trishuli,
                erasing the Rasuwagadhi border crossing. This report pairs a
                multi-sensor change detection of that corridor — Sentinel-2 index
                differencing and Sentinel-1 backscatter, confined by a corridor
                derived from terrain alone — with the ground survey mapped by the
                Humanitarian OpenStreetMap Team, and tests one claim: that the
                shape of the land predicts where a flood can do damage before any
                satellite is consulted.
              </p>
              <p>
                Height Above Nearest Drainage, computed from a 30 m elevation
                model and nothing else, defines a corridor covering{" "}
                <strong>{fmt(hits[0]?.corridor_base_pct, 2)}%</strong> of the{" "}
                {fmt(a["ROI area"], 0)} km² study area. Inside it fall{" "}
                <strong>{fmt(hits[0]?.in_corridor_pct, 1)}%</strong> of buildings
                recorded destroyed,{" "}
                <strong>{fmt(hits[1]?.in_corridor_pct, 0)}%</strong> of bridges
                washed out and{" "}
                <strong>{fmt(v.observed_in_corridor_pct, 1)}%</strong> of the
                observed flood extent — a{" "}
                {fmt(hits[0]?.in_corridor_pct / hits[0]?.corridor_base_pct, 0)}×
                concentration against its base rate. The change detector itself
                flags {fmt(v.observed_flagged_by_stage3_pct, 1)}% of that extent;
                most of the remainder is river channel that was already water
                before the event, where a change detector correctly finds
                nothing.
              </p>
            </div>
          </div>

          <div className="keywords rail">
            <span className="idx">Keywords</span>
            <p>
              flood mapping · HAND · Sentinel-1 · Sentinel-2 · change detection ·
              humanitarian mapping · Bhote Koshi · Rasuwa
            </p>
          </div>

          {/* What a reader needs to judge the work before reading it: where,
              when, with what, against what, and how the corridor is defined. */}
          <div className="meta">
            <dl>
              <div>
                <dt>Event</dt>
                <dd><b>{DATE}</b> — glacial lake outburst and debris flood</dd>
              </div>
              <div>
                <dt>Study area</dt>
                <dd>
                  {roi[0]}–{roi[2]}° E, {roi[1]}–{roi[3]}° N ·{" "}
                  <b>{fmt(a["ROI area"], 0)} km²</b>
                </dd>
              </div>
              <div>
                <dt>Instruments</dt>
                <dd>Sentinel-2 L2A · Sentinel-1 GRD · SRTM GL1 (30 m)</dd>
              </div>
              <div>
                <dt>Ground truth</dt>
                <dd>
                  HOT survey · <b>{int(surveyed)}</b> buildings,{" "}
                  {int(s.roads_by_status.Standing + s.roads_by_status.Destroyed)} road
                  segments, {int(bridges)} bridges
                </dd>
              </div>
              <div>
                <dt>Corridor</dt>
                <dd>
                  HAND ≤ <b>{s.event.hand_max_m} m</b> of a channel draining ≥{" "}
                  {s.event.min_drainage_km2} km²
                </dd>
              </div>
              <div>
                <dt>Products</dt>
                <dd>
                  {Object.keys(s.layer_bytes).length} GeoJSON layers, WGS84 —{" "}
                  <a href="#data">§5</a>
                </dd>
              </div>
            </dl>
          </div>

          {/* Colour encodes one thing and only one thing: red is a loss, blue is
              a measured extent, ink is exposure without a loss claim. Before
              this rule the row had 264 road segments *destroyed* set in the same
              ink as 10 hydropower projects merely *exposed*, while 39 bridges
              destroyed were red -- five numbers at one size with a colour that
              meant nothing, so the reader did the ranking. */}
          <div className="statbar">
            <div className="stat is-blue">
              <b>{fmt(a["HOT observed flood extent, whole corridor"], 1)} km²</b>
              <span>Observed flood extent, Rasuwagadhi to the Narayani</span>
            </div>
            <div className="stat is-red">
              <b>{int(s.bridges_by_status["Washed out"])}</b>
              <span>Road bridges washed out, of {int(bridges)} assessed</span>
            </div>
            <div className="stat is-red">
              <b>{int(s.buildings_by_status.Destroyed)}</b>
              <span>Buildings destroyed</span>
            </div>
            <div className="stat is-red">
              <b>{int(s.roads_by_status.Destroyed)}</b>
              <span>Road segments destroyed</span>
            </div>
            <div className="stat">
              <b>{int(s.exposure.find((e) => e.layer.startsWith("Hydropower"))?.total)}</b>
              <span>Hydropower projects exposed</span>
            </div>
          </div>
          <p className="statkey">
            Red is a recorded loss · blue a measured extent · ink exposure
            without a loss claim. Counts are the HOT survey's, not this
            pipeline's.
          </p>
        </div>
      </header>

      <div className="mapsec" id="themap">
        <MapView />
      </div>

      <SwipeMap />

      {/* ---------------------------------------------------------------- */}
      <Section
        id="finding"
        no="1"
        title="Terrain alone finds the damage"
        lede="Height Above Nearest Drainage is computed from a 30 m elevation model and nothing else — no imagery, no flood report. It asks one question of every pixel: how far above the river is this ground?"
      >
        <p className="lede">
          That corridor covers{" "}
          <strong>{fmt(hits[0]?.corridor_base_pct, 2)}% of the study area</strong>. Inside
          it sits almost everything the ground survey recorded as lost.
        </p>

        <div className="cols">
          <div>
            <Bars
              rows={hits.map((h) => ({
                label: `${h.target.split(" ")[0]} (${h.n_in_roi})`,
                value: h.in_corridor_pct,
                colour: C.teal,
              }))}
              max={100}
            />
            <p className="note">
              Share of each kind of ground evidence falling inside the
              terrain-derived corridor. The corridor never sees the imagery, so
              this is not the model marking its own homework.
            </p>
          </div>
          <div>
            <div className="callout">
              <p>
                <strong>
                  {fmt(v.observed_in_corridor_pct, 1)}% of the observed flood
                  extent
                </strong>{" "}
                falls inside a corridor derived from elevation alone, as does{" "}
                <strong>{fmt(hits[0]?.in_corridor_pct, 1)}%</strong> of destroyed
                buildings and{" "}
                <strong>{fmt(hits[1]?.in_corridor_pct, 0)}%</strong> of the
                bridges washed out.
              </p>
              <p>
                Against a {fmt(hits[0]?.corridor_base_pct, 2)}% base rate, that is
                roughly a{" "}
                <strong>
                  {fmt(hits[0]?.in_corridor_pct / hits[0]?.corridor_base_pct, 0)}×
                </strong>{" "}
                concentration. Where a flood can reach is a terrain question long
                before it is an imaging one.
              </p>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "2rem" }}>
          <Table
            caption="Ground evidence vs the derived masks, inside the study area"
            cols={[
              { key: "target", label: "Evidence" },
              { key: "n_in_roi", label: "Count", n: true, render: (r) => int(r.n_in_roi) },
              {
                key: "in_corridor_pct",
                label: `In HAND corridor (${fmt(hits[0]?.corridor_base_pct, 2)}% of area)`,
                n: true,
                render: (r) => `${fmt(r.in_corridor_pct, 1)}%`,
              },
              {
                key: "in_detected_pct",
                label: `In detected damage (${fmt(hits[0]?.detected_base_pct, 2)}% of area)`,
                n: true,
                render: (r) => `${fmt(r.in_detected_pct, 1)}%`,
              },
              {
                key: "lift",
                label: "Concentration",
                n: true,
                render: (r) => `${fmt(r.in_detected_pct / r.detected_base_pct, 0)}×`,
              },
            ]}
            rows={hits}
          />
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="detection"
        no="2"
        title="What the satellites caught, and what they missed"
        lede="Sentinel-2 index differencing OR a Sentinel-1 backscatter swing, confined to the corridor. Measured against the survey, honestly."
      >
        <div className="cols">
          <div>
            <Table
              caption="Areas inside the study rectangle"
              cols={[
                { key: "k", label: "Measure" },
                { key: "v", label: "km²", n: true },
              ]}
              rows={[
                ["Study rectangle", a["ROI area"]],
                ["Observed flood extent (HOT)", a["HOT observed flood extent, inside ROI"]],
                ["HAND corridor", a["stage 3 HAND corridor, inside ROI"]],
                ["Stage 2 change, thresholds only", a["stage 2 change, inside ROI"]],
                ["Stage 3 flood damage", a["stage 3 flood damage, inside ROI"]],
              ].map(([k, val]) => ({ k, v: fmt(val, 2) }))}
            />
          </div>
          <div>
            <Bars
              rows={[
                {
                  label: "Buildings",
                  value: hits[0]?.in_detected_pct,
                  colour: C.red,
                },
                { label: "Roads", value: hits[2]?.in_detected_pct, colour: C.red },
                { label: "Bridges", value: hits[1]?.in_detected_pct, colour: C.red },
                {
                  label: "Flood extent",
                  value: v.observed_flagged_by_stage3_pct,
                  colour: C.blue,
                },
              ]}
              max={100}
            />
            <p className="note">
              Share covered by the detected-damage mask, which occupies{" "}
              {fmt(hits[0]?.detected_base_pct, 2)}% of the study area.
            </p>

            <div className="callout">
              <p>
                Only <strong>{fmt(v.observed_flagged_by_stage3_pct, 1)}%</strong> of
                the observed flood extent is flagged, and that is expected rather
                than a failure. Most of the extent is the river channel itself,
                which was already water before 26 August, so a{" "}
                <em>change</em> detector correctly finds nothing there. The upper
                catchment also sat under 65–80% monsoon cloud, leaving the radar
                to carry those pixels alone.
              </p>
              <p>
                The fairer read is concentration:{" "}
                <strong>{fmt(v.detected_inside_observed_pct, 1)}%</strong> of
                detections land inside observed water against a{" "}
                {fmt(v.observed_share_of_roi_pct, 2)}% base rate —{" "}
                <strong>{fmt(v.precision_vs_base_rate, 0)}×</strong>.
              </p>
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: "2.5rem", fontSize: "1.05rem" }}>
          Change rate against height above the river
        </h3>
        <p className="note" style={{ marginBottom: "1rem" }}>
          The profile that set the corridor ceiling. Flat to 50 m, then falling
          away to a far-field floor — a threshold cutting below 50 m would slice
          through the middle of the signal.
        </p>
        <Bars
          rows={s.change_vs_hand.map((r) => ({
            label: `${r.hand_lo_m}–${Number.isFinite(r.hand_hi_m) && r.hand_hi_m ? r.hand_hi_m : "∞"} m`,
            value: r.change_pct,
            colour: r.hand_hi_m && r.hand_hi_m <= s.event.hand_max_m ? C.blue : C.muted,
          }))}
        />
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="exposure"
        no="3"
        title="What sat inside the water"
        lede="Counts clipped to the observed flood extent itself, not to the 200 m buffer the export ships. Being in the dataset is not evidence of damage; being inside the extent is."
      >
        <div className="cols">
          <Table
            caption="Exposure along the whole corridor"
            cols={[
              { key: "layer", label: "Feature" },
              { key: "total", label: "Mapped", n: true, render: (r) => int(r.total) },
              {
                key: "in_flood_extent",
                label: "In flood extent",
                n: true,
                render: (r) => int(r.in_flood_extent),
              },
            ]}
            rows={s.exposure}
          />
          <Table
            caption="Losses by impact zone"
            cols={[
              { key: "zone_id", label: "Zone" },
              { key: "label", label: "Place" },
              {
                key: "buildings_destroyed",
                label: "Buildings",
                n: true,
                render: (r) => int(r.buildings_destroyed),
              },
              {
                key: "roads_destroyed",
                label: "Roads",
                n: true,
                render: (r) => int(r.roads_destroyed),
              },
              {
                key: "bridges_washed_out",
                label: "Bridges out",
                n: true,
                render: (r) => int(r.bridges_washed_out),
              },
            ]}
            rows={s.exposure_by_zone}
          />
        </div>

        <div style={{ marginTop: "2rem" }}>
          <Table
            caption="Detected damage by impact zone"
            cols={[
              { key: "zone_id", label: "Zone" },
              { key: "label", label: "Place" },
              {
                key: "corridor_km2",
                label: "Corridor km²",
                n: true,
                render: (r) => fmt(r.corridor_km2, 2),
              },
              {
                key: "flood_km2",
                label: "Detected km²",
                n: true,
                render: (r) => fmt(r.flood_km2, 2),
              },
              {
                key: "scour_width_m",
                label: "Scour swath m",
                n: true,
                render: (r) => fmt(r.scour_width_m, 0),
              },
              { key: "note", label: "", render: (r) => r.note || "" },
            ]}
            rows={s.zonal_flood}
          />
          <p className="note">
            Scour swath is detected damage per metre of channel — the width of the
            disturbed valley floor. It is not the wetted channel width: Sentinel-1
            cannot resolve this river, whose backscatter never goes specular in a
            gorge this steep.
          </p>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="method"
        no="4"
        title="Method, and where it breaks"
        lede="Four stages, each reading the previous one's files off disk. Nothing here is a validated classifier."
      >
        <div className="cols">
          <div>
            <h3 style={{ fontSize: "1rem", marginBottom: ".6rem" }}>Pipeline</h3>
            <ol style={{ paddingLeft: "1.1rem", color: "var(--ink-2)", fontSize: ".92rem" }}>
              <li>
                Sentinel-2 L2A and Sentinel-1 GRD pre/post composites plus SRTM,
                on one relative orbit so terrain geometry cancels.
              </li>
              <li>
                dNDVI &gt; {s.event.thresholds.dNDVI}, dMNDWI &gt;{" "}
                {s.event.thresholds.dMNDWI}, or |Δσ⁰| &gt;{" "}
                {s.event.thresholds.dSAR_dB} dB after a linear-power multilook.
              </li>
              <li>
                Priority-flood fill → D8 → flow accumulation → HAND. Corridor is
                HAND ≤ {s.event.hand_max_m} m of a channel draining ≥{" "}
                {s.event.min_drainage_km2} km².
              </li>
              <li>HOT survey joined in, and everything above measured against it.</li>
            </ol>
          </div>
          <div>
            <h3 style={{ fontSize: "1rem", marginBottom: ".6rem" }}>Known limits</h3>
            <ul style={{ paddingLeft: "1.1rem", color: "var(--ink-2)", fontSize: ".92rem" }}>
              <li>
                Thresholds are the study design's, not calibrated against
                reference polygons.
              </li>
              <li>
                HAND has no notion of flow volume or timing, so it cannot separate
                the 26 August surge from ordinary monsoon inundation.
              </li>
              <li>
                Flow accumulation is truncated at the study boundary — the Bhote
                Koshi's Tibetan headwaters lie outside the elevation model.
              </li>
              <li>
                Impact-zone coordinates beyond Rasuwagadhi are approximate.
              </li>
              {s.dropped_bridges?.length > 0 && (
                <li>
                  {s.dropped_bridges.length} bridge
                  {s.dropped_bridges.length > 1 ? "s" : ""} dropped from the map —{" "}
                  {s.dropped_bridges.join(", ")} — published with latitude in both
                  coordinate slots.
                </li>
              )}
            </ul>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="data"
        no="5"
        title="Data"
        lede="Every layer the map draws, as GeoJSON in WGS84. Open them in QGIS or ArcGIS Pro directly."
      >
        <div className="files">
          {Object.entries(s.layer_bytes).map(([name, bytes]) => (
            <a className="file" key={name} href={`data/${name}.geojson`} download>
              {name.replace(/_/g, " ")}
              <span>{KB(bytes)}</span>
            </a>
          ))}
          <a className="file" href="data/summary.json" download>
            summary.json
            <span>stats</span>
          </a>
        </div>
      </Section>

      <footer>
        <div className="wrap cols">
          {s.sources.map((src) => (
            <div key={src.name}>
              <h3>{src.org}</h3>
              <p>{src.name}</p>
              <p>
                <a href={src.url} target="_blank" rel="noreferrer">
                  {src.url.replace(/^https:\/\//, "")}
                </a>
              </p>
              <p>Licence: {src.licence}</p>
            </div>
          ))}
          <div>
            <h3>About</h3>
            <p>
              Built from a four-stage Python pipeline (Earth Engine, rasterio,
              geopandas). Ground survey by HOT and volunteer field reports;
              hydropower inventory contributed by Niti Foundation.
            </p>
            <p>
              Feature presence in the source export does not imply damage — only
              the <code>status</code> field does.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
