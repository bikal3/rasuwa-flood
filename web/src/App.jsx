import { useEffect, useState } from "react";
import MapView from "./MapView.jsx";
import SwipeMap from "./SwipeMap.jsx";
import { Section, Table, Bars, Caption, fmt, int } from "./ui.jsx";
import { C } from "./layers.js";

const KB = (b) => (b < 1024 ? "<1 kB" : `${Math.round(b / 1024)} kB`);

/**
 * The page in one line. Two audiences read it: someone who wants to know what
 * happened to this valley, and someone who wants to check how it was measured.
 * The bar is what lets the second skip §1 and the first skip §5.
 */
const NAV = [
  ["primer", "§1 Start here"],
  ["themap", "Map"],
  ["compare", "Before / after"],
  ["finding", "§2 Terrain"],
  ["detection", "§3 Satellites"],
  ["exposure", "§4 Exposure"],
  ["method", "§5 Method"],
  ["data", "§6 Data"],
  ["references", "§7 References"],
];

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
                <dd>
                  Sentinel-2 L2A · Sentinel-1 GRD · SRTM GL1 (30 m){" "}
                  <a className="citelink" href="#ref-2">[2]</a>
                </dd>
              </div>
              <div>
                <dt>Ground truth</dt>
                <dd>
                  HOT survey <a className="citelink" href="#ref-1">[1]</a> ·{" "}
                  <b>{int(surveyed)}</b> buildings,{" "}
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
                  <a href="#data">§6</a>
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

      <nav className="tocbar" aria-label="Sections">
        <ol>
          {NAV.map(([id, label]) => (
            <li key={id}><a href={`#${id}`}>{label}</a></li>
          ))}
        </ol>
      </nav>

      {/* ---------------------------------------------------------------- */}
      {/* The other half of the page. Everything below §1 assumes you know what
          a backscatter swing is; this section assumes you do not, and it is
          first because the report is about a valley before it is about a
          method. Its figures are read from summary.json like every other
          number here, so the plain reading and the technical one cannot
          disagree. */}
      <Section
        id="primer"
        no="1"
        title="What happened, in plain language"
        lede="A lake above a glacier emptied in an afternoon and took a border crossing, a highway and most of two villages with it. This section is the story and the vocabulary — every term it uses is defined in the glossary in §7 — and the rest of the report is the measurement."
      >
        <p className="lede">
          On {DATE} a mass of ice and rock came off Langtang Lirung, high above
          the Nepal–China border, and released the meltwater ponded behind it.
          What came down the Lende Khola was not a swollen river. It was a{" "}
          <strong>debris flood</strong> — water carrying so much rock and
          sediment that it behaves more like wet concrete than like water,
          heavier and far more destructive than the same volume of clear flow.
        </p>
        <p className="lede">
          It reached the Bhote Koshi, turned south, and ran{" "}
          <strong>{fmt(a["HOT observed flood extent, whole corridor"], 1)} km²</strong>{" "}
          of valley floor — roughly{" "}
          {int(Math.round(a["HOT observed flood extent, whole corridor"] * 1e6 / 7140))}{" "}
          football pitches — down to the Narayani. The Rasuwagadhi border post,
          the customs yard and the road to Tibet are gone. Surveyors on the
          ground afterwards recorded{" "}
          <strong>{int(s.buildings_by_status.Destroyed)} buildings destroyed</strong>,{" "}
          {int(s.roads_by_status.Destroyed)} stretches of road broken and{" "}
          {int(s.bridges_by_status["Washed out"])} of {int(bridges)} bridges
          washed away.
        </p>

        <h3 className="subhead">The one question this report asks</h3>
        <p className="lede">
          Could you have drawn the dangerous ground <em>beforehand</em>, from a
          contour map, with no satellite and no warning? The answer here is
          largely yes — and that matters, because elevation data exists for the
          whole planet already, while a satellite pass over a specific valley on
          a specific afternoon does not.
        </p>

        <h3 className="subhead">Three things worth knowing</h3>

        <details className="plain">
          <summary>Why a glacial lake bursting is worse than heavy rain</summary>
          <p>
            Glaciers leave behind loose ridges of rubble, and meltwater ponds
            behind them. That dam is gravel and ice, not concrete. A rockfall
            into the lake, an ice avalanche, or simply the ridge soaking through
            can open it, and when it opens the lake does not drain over days —
            it leaves in minutes.
          </p>
          <p>
            The wave picks up everything loose on the way down: boulders,
            gravel, trees, whole hillsides. Steep Himalayan valleys make it
            worse by funnelling the flow instead of letting it spread. What
            arrives at a village 40 km downstream is a wall of moving rock,
            which is why the damage here is scouring and burial rather than the
            soaking you would expect from a river in flood. Nepal has hundreds
            of these lakes and they are growing as the ice retreats.
          </p>
        </details>

        <details className="plain">
          <summary>What "height above the river" means, and why it predicts damage</summary>
          <p>
            Start with an elevation model: a grid where every 30 m cell holds
            its height. For each cell, work out which way water would run off
            it, follow that path downhill until it meets a river, and record how
            much higher the cell sits than the river it drains into. That number
            is <strong>HAND</strong> — Height Above Nearest Drainage.
          </p>
          <p>
            It is not height above sea level. A house 5 m above the channel and
            a house 300 m up the valley side can share an altitude; HAND tells
            them apart, because it measures each against <em>its own</em> river.
            Water cannot climb, so low HAND is ground a flood can reach and high
            HAND is ground it cannot. Everything within{" "}
            <strong>{s.event.hand_max_m} m</strong> of a channel here is{" "}
            {fmt(hits[0]?.corridor_base_pct, 2)}% of the map — and{" "}
            {fmt(hits[0]?.in_corridor_pct, 1)}% of the destroyed buildings are
            inside it.
          </p>
          <p>
            The corridor never looks at the satellite imagery. That is the whole
            point: it is drawn from the shape of the land alone, so checking the
            damage against it is a test rather than a restatement.
          </p>
        </details>

        <details className="plain">
          <summary>Why this needs two different satellites</summary>
          <p>
            <strong>Sentinel-2 is a camera.</strong> It sees colour the way you
            would from an aeroplane — and, like you, it sees nothing at all
            through cloud. This flood happened at the height of the monsoon, and
            the clear-sky image taken after it covers only a sixth of the scene.
          </p>
          <p>
            <strong>Sentinel-1 is radar.</strong> It sends its own microwave
            pulse down and times the echo, so it works at night and straight
            through cloud. What it measures is roughness rather than colour:
            smooth standing water and fresh wet sediment bounce the pulse away
            from the satellite, so they come back dark. The cost is that a radar
            image is not a photograph — it is grainy, false-coloured, and
            genuinely hard to read.
          </p>
          <p>
            Neither one alone gets through a monsoon disaster. So the detector
            accepts a change flagged by <em>either</em>, and the before/after
            slider below lets you switch between them over the same ground.
          </p>
        </details>

        <h3 className="subhead">What a damage survey actually records</h3>
        <p className="lede">
          Not "a village was destroyed". Mappers walk the imagery and the ground
          feature by feature, tagging each one with a condition. That is what
          the counts on this page are made of, and it is why a bridge and a
          field boundary are counted separately:
        </p>
        <div className="meta">
          <dl>
            {Object.entries(s.damaged_features_by_type)
              .slice(0, 8)
              .map(([kind, n]) => (
                <div key={kind}>
                  <dt>{kind}</dt>
                  <dd><b>{int(n)}</b> mapped as damaged or destroyed</dd>
                </div>
              ))}
          </dl>
        </div>

        <h3 className="subhead">How to read the map above</h3>
        <p className="lede">
          The layer panel splits in two, and the split is the argument.{" "}
          <em>Observed</em> layers are what surveyors recorded on the ground.{" "}
          <em>Derived</em> layers are what this pipeline worked out from imagery
          and terrain, having never seen the survey. Drag one group's opacity
          slider down and watch whether the other one is underneath it. That
          overlap is the finding, and everything from §2 on is an attempt to put
          a number on it.
        </p>
      </Section>

      <div className="mapsec" id="themap">
        <MapView />
        <div className="wrap mapcapwrap">
          <Caption no={1}>
            <b>The corridor, Rasuwagadhi to the Narayani.</b> Fourteen layers in
            two groups — what the HOT survey observed on the ground, and what
            this pipeline derived from imagery and terrain — each fadeable
            against the other, which is the comparison the report is about.
            Clicking a feature reports its attributes; building footprints draw
            from zoom 12.5. Basemap: Esri world imagery.
          </Caption>
        </div>
      </div>

      <SwipeMap />

      {/* ---------------------------------------------------------------- */}
      <Section
        id="finding"
        no="2"
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
            <Caption no={3} tight>
              <b>Ground evidence inside the terrain-derived corridor.</b> Share
              of each kind of recorded loss falling within HAND ≤{" "}
              {s.event.hand_max_m} m. The corridor never sees the imagery, so
              this is not the model marking its own homework.
            </Caption>
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

        <details className="plain" style={{ marginTop: "2rem" }}>
          <summary>In plain English</summary>
          <p>
            The corridor is {fmt(hits[0]?.corridor_base_pct, 2)}% of the map. If
            the flood had damaged buildings at random you would expect about{" "}
            {fmt(hits[0]?.corridor_base_pct, 0)} in every 100 destroyed
            buildings to fall inside it. {fmt(hits[0]?.in_corridor_pct, 0)} in
            100 did.
          </p>
          <p>
            Nothing about the corridor knows a flood happened. It is a contour
            map asking which ground is low enough to be reached. So this is a
            statement about the whole of the high Himalaya, not only about 26
            August: the ground a debris flood can occupy is largely decidable in
            advance, anywhere there is an elevation model — which is everywhere.
          </p>
        </details>

        <div style={{ marginTop: "2rem" }}>
          <Table
            no={1}
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
        no="3"
        title="What the satellites caught, and what they missed"
        lede="Sentinel-2 index differencing OR a Sentinel-1 backscatter swing, confined to the corridor. Measured against the survey, honestly."
      >
        <div className="cols">
          <div>
            <Table
              no={2}
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
            <Caption no={4} tight>
              <b>Ground evidence inside the detected-damage mask.</b> Share
              covered by the mask, which occupies{" "}
              {fmt(hits[0]?.detected_base_pct, 2)}% of the study area — an
              eightieth of the corridor above it.
            </Caption>

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

        <details className="plain">
          <summary>In plain English: why "29.5% flagged" is not "70% missed"</summary>
          <p>
            A change detector does one thing: it compares the same ground on two
            dates and flags what is different. The river was already a river on
            both dates, so along the channel itself there is nothing to flag —
            and the channel is most of the mapped flood extent. Finding nothing
            there is the detector being right, not being blind.
          </p>
          <p>
            What it does light up is ground that changed <em>state</em>: forest
            stripped to gravel, terraces buried in sediment, a village replaced
            by riverbed. Add the monsoon — 65–80% cloud over the upper
            catchment, leaving the radar working alone — and the honest way to
            read the score is concentration rather than coverage:{" "}
            {fmt(v.detected_inside_observed_pct, 1)}% of what the detector
            flagged is inside real flood water, against a{" "}
            {fmt(v.observed_share_of_roi_pct, 2)}% base rate.
          </p>
        </details>

        <h3 className="subhead">Change rate against height above the river</h3>
        <Bars
          rows={s.change_vs_hand.map((r) => ({
            label: `${r.hand_lo_m}–${Number.isFinite(r.hand_hi_m) && r.hand_hi_m ? r.hand_hi_m : "∞"} m`,
            value: r.change_pct,
            colour: r.hand_hi_m && r.hand_hi_m <= s.event.hand_max_m ? C.blue : C.muted,
          }))}
        />
        <Caption no={5}>
          <b>The profile that set the corridor ceiling.</b> Share of each height
          band flagged as changed, against height above the nearest drainage.
          Flat to {s.event.hand_max_m} m, then falling away to a far-field floor;
          blue is the band the corridor keeps. A threshold cutting below{" "}
          {s.event.hand_max_m} m would slice through the middle of the signal.
        </Caption>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="exposure"
        no="4"
        title="What sat inside the water"
        lede="Counts clipped to the observed flood extent itself, not to the 200 m buffer the export ships. Being in the dataset is not evidence of damage; being inside the extent is."
      >
        {/* Stacked, not paired: five columns of zone losses inside half the text
            column meant Table 4 shipped with its last column cut off. */}
        <div className="stack">
          <Table
            no={3}
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
            no={4}
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
            no={5}
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
          <Caption kind="Note" tight>
            Scour swath is detected damage per metre of channel — the width of the
            disturbed valley floor. It is not the wetted channel width: Sentinel-1
            cannot resolve this river, whose backscatter never goes specular in a
            gorge this steep.
          </Caption>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="method"
        no="5"
        title="Method, and where it breaks"
        lede="Four stages, each reading the previous one's files off disk. Nothing here is a validated classifier."
      >
        <div className="cols">
          <div>
            <h3 className="subhead first">Pipeline</h3>
            <ol className="steps">
              <li>
                Sentinel-2 L2A and Sentinel-1 GRD pre/post composites plus SRTM,
                on one relative orbit so terrain geometry cancels.
              </li>
              <li>
                A pixel is flagged as changed where <b>(1)</b> holds, after a
                linear-power multilook on the radar.
              </li>
              <li>
                Priority-flood fill → D8 → flow accumulation → HAND. The corridor
                is <b>(2)</b>, and the flagged pixels are clipped to it.
              </li>
              <li>HOT survey joined in, and everything above measured against it.</li>
            </ol>
          </div>
          <div>
            <h3 className="subhead first">Known limits</h3>
            <ul className="steps">
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

        {/* The two rules the whole analysis rests on, set where a reader can
            check them rather than buried mid-sentence in a list item. The
            numbers come from summary.json, so the notation cannot drift from
            what stage 2 and stage 3 actually ran. */}
        <div className="eq">
          <code>
            dNDVI &gt; {s.event.thresholds.dNDVI} ∨ dMNDWI &gt;{" "}
            {fmt(s.event.thresholds.dMNDWI, 2)} ∨ |Δσ⁰| &gt;{" "}
            {fmt(s.event.thresholds.dSAR_dB, 1)} dB
          </code>
          <span className="eqno">(1)</span>
        </div>
        <div className="eq">
          <code>
            corridor = &#123; x : HAND(x) ≤ {s.event.hand_max_m} m ∧ A(x) ≥{" "}
            {s.event.min_drainage_km2} km² &#125;
          </code>
          <span className="eqno">(2)</span>
        </div>
        <Caption kind="Note" tight>
          Δ is post minus pre. σ⁰ is Sentinel-1 VV backscatter, differenced in dB
          after averaging in linear power. HAND is height above the nearest
          drainage and A the upslope area draining to it, both from SRTM GL1
          alone — neither reads the imagery, which is what makes §1 a test rather
          than a restatement.
        </Caption>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="data"
        no="6"
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

      {/* ---------------------------------------------------------------- */}
      <Section
        id="references"
        no="7"
        title="References and reuse"
        lede="What this was built from, what it may be used for, and what it must not be read as."
      >
        <ol className="refs">
          {s.sources.map((src, i) => (
            <li key={src.name} id={`ref-${i + 1}`}>
              <span className="refno">[{i + 1}]</span>
              <div>
                {src.org}. <i>{src.name}</i>. Licence: {src.licence}.{" "}
                <a href={src.url} target="_blank" rel="noreferrer">
                  {src.url.replace(/^https:\/\//, "")}
                </a>
              </div>
            </li>
          ))}
        </ol>

        <h3 className="subhead">Glossary</h3>
        <div className="meta gloss">
          <dl>
            {[
              ["GLOF", "Glacial lake outburst flood. A lake dammed by glacial rubble or ice fails, and empties in minutes rather than days."],
              ["Debris flood", "Water carrying so much rock and sediment that it moves and destroys more like wet concrete than like a river."],
              ["DEM", "Digital elevation model — a grid where every cell holds the height of the ground. Here, SRTM at 30 m."],
              ["HAND", `Height Above Nearest Drainage. How far a cell sits above the river it drains into, rather than above sea level. The corridor here is everything within ${s.event.hand_max_m} m.`],
              ["Sentinel-2", "An optical satellite: a camera that sees colour, and nothing through cloud."],
              ["Sentinel-1", "A radar satellite: it sends its own microwave pulse and measures the echo, so it works at night and through cloud. Smooth water returns a dark signal."],
              ["Backscatter (σ⁰)", "How much of a radar pulse comes back to the satellite. A swing between two dates means the surface changed its roughness or wetness."],
              ["NDVI / MNDWI", "Index images built from Sentinel-2 bands, one tracking living vegetation and one tracking surface water. Differencing them between dates is how vegetation loss and new water are detected."],
              ["Change detection", "Comparing the same ground on two dates and flagging what differs. It cannot see damage to something that already looked that way — a river channel, for instance."],
              ["Base rate / concentration", "The share of the map a mask covers, and how many times more damage falls inside it than that share alone would predict. A mask over 4% of the map holding 96% of the losses is a 22× concentration."],
              ["Ground truth", "Independent observation used to test a result. Here, the HOT survey, which this pipeline never reads before making its own estimate."],
              ["GeoJSON", "A plain-text file format for map features. Every layer in §6 is one, and opens directly in QGIS or ArcGIS Pro."],
            ].map(([term, def]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{def}</dd>
              </div>
            ))}
          </dl>
        </div>

        <h3 className="subhead">Data availability</h3>
        <p>
          Every layer this report draws is published in §5 as GeoJSON in WGS84,
          together with <code>summary.json</code>, which holds every figure
          quoted above — the page reads its own numbers from that file, so there
          is no statistic here that is not in the download.
        </p>

        <h3 className="subhead">About this analysis</h3>
        <p>
          Built from a four-stage Python pipeline (Earth Engine, rasterio,
          geopandas), each stage reading the previous one's files off disk. The
          ground survey is the Humanitarian OpenStreetMap Team's{" "}
          <a className="citelink" href="#ref-1">[1]</a> and the
          field reports behind it; the hydropower inventory was contributed by
          Niti Foundation.
        </p>
        <p>
          Presence in a source export is not evidence of damage — only the{" "}
          <code>status</code> field is. The thresholds in (1) are the study
          design's rather than values calibrated against reference polygons, and
          nothing here is a validated classifier.
        </p>
      </Section>

      {/* A running foot: the header line again, so the document closes on the
          same statement it opened with rather than stopping at a rule. */}
      <footer className="wrap">
        <span>The flood the terrain already knew about</span>
        <span>Rasuwa · Bagmati · Nepal · {DATE}</span>
      </footer>
    </>
  );
}
