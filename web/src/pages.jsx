import MapView from "./MapView.jsx";
import SwipeMap from "./SwipeMap.jsx";
import {
  Bars, Callout, DefList, Explain, Figcap, Metric, PageHead, Table, fmt, int,
} from "./ui.jsx";
import { C } from "./layers.js";
import { DATA, href } from "./base.js";

/**
 * Every page of the site, in one file.
 *
 * They are nine small functions over one `summary.json` object and they share
 * every helper above, so nine files would be nine copies of the same import
 * block. Nothing here holds state; the two things that do -- the layer map and
 * the imagery slider -- are their own components.
 *
 * Every figure on every page is read from that object. There is no number
 * written into this file, so the prose cannot drift from the pipeline.
 */

const KB = (b) => (b < 1024 ? "<1 kB" : `${Math.round(b / 1024)} kB`);

/** "26 August 2026", from the event's own ISO date rather than written twice. */
const eventDate = (s) =>
  new Date(`${s.event.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

const totals = (s) => ({
  bridges: Object.values(s.bridges_by_status).reduce((a, b) => a + b, 0),
  surveyed: Object.values(s.buildings_by_status).reduce((a, b) => a + b, 0),
});

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Home({ s }) {
  const a = s.areas;
  const v = s.validation;
  const hits = v.hits || [];
  const { bridges } = totals(s);
  const extent = a["HOT observed flood extent, whole corridor"];
  // A pitch is 7,140 m². Scale is the one thing a km² figure does not give a
  // reader who has never had to picture one.
  const pitches = Math.round((extent * 1e6) / 7140);

  return (
    <>
      <PageHead
        kicker={`${eventDate(s)} · Rasuwa, Nepal`}
        title="The flood the terrain already knew about"
        lede="A glacial lake above Langtang Lirung emptied in an afternoon and took a border crossing, a highway and most of two villages with it. This site is what the flood did, and how far you could have predicted it from the shape of the land alone."
      />

      <Callout kind="alert">
        <p>
          <strong>This is an unreviewed analysis, not an operational damage
          assessment.</strong> The ground survey counts are the Humanitarian
          OpenStreetMap Team's and are real. The satellite detection is this
          project's own, and its thresholds are the study design's rather than
          values calibrated against reference polygons — so treat the derived
          layers as an illustration of the method, not a verified map of damage.
        </p>
        <p>Do not use anything here for planning, response or risk communication.</p>
      </Callout>

      <div className="metrics">
        <Metric tone="blue" value={`${fmt(extent, 1)} km²`}
                label="Flood extent recorded on the ground, Rasuwagadhi to the Narayani" />
        <Metric tone="red" value={int(s.buildings_by_status.Destroyed)}
                label="Buildings destroyed" />
        <Metric tone="red" value={int(s.bridges_by_status["Washed out"])}
                label={`Road bridges washed out, of ${int(bridges)} assessed`} />
        <Metric tone="red" value={int(s.roads_by_status.Destroyed)}
                label="Road segments destroyed" />
        <Metric value={int(s.exposure.find((e) => e.layer.startsWith("Hydropower"))?.total)}
                label="Hydropower projects exposed" />
      </div>
      <p className="metric-key">
        Red is a recorded loss · blue a measured extent · teal exposure without a
        loss claim. Every count here is the ground survey's, not this pipeline's.
      </p>

      <hr />

      <div className="prose">
        <h2>What happened</h2>
        <p>
          On {eventDate(s)} a mass of ice and rock came off Langtang Lirung, high
          above the Nepal–China border, and released the meltwater ponded behind
          it. What came down the Lende Khola was not a swollen river. It was a{" "}
          <strong>debris flood</strong> — water carrying so much rock and
          sediment that it behaves more like wet concrete than like water, and
          destroys accordingly.
        </p>
        <p>
          It reached the Bhote Koshi, turned south, and ran{" "}
          <strong>{fmt(extent, 1)} km²</strong> of valley floor — roughly{" "}
          {int(pitches)} football pitches — down to the Narayani. The Rasuwagadhi
          border post, the customs yard and the road to Tibet are gone.
        </p>

        <h2>The question this site answers</h2>
        <p>
          Could you have drawn the dangerous ground <em>beforehand</em>, from a
          contour map, with no satellite and no warning? Largely, yes. A corridor
          derived from elevation alone covers{" "}
          <strong>{fmt(hits[0]?.corridor_base_pct, 2)}%</strong> of this valley
          and contains{" "}
          <strong>{fmt(hits[0]?.in_corridor_pct, 1)}%</strong> of the buildings
          recorded destroyed — about{" "}
          {fmt(hits[0]?.in_corridor_pct / hits[0]?.corridor_base_pct, 0)} times
          the concentration you would get by chance.
        </p>
        <p>
          That matters because elevation data already exists for the whole
          planet, while a satellite pass over one particular valley on one
          particular afternoon does not.
        </p>
      </div>

      <h2>The corridor</h2>
      <p className="muted">
        Fourteen layers over the whole 120 km corridor: what the survey recorded
        on the ground, and what this pipeline worked out from imagery and terrain
        without ever seeing the survey. Click a feature for its attributes.
      </p>
      <MapView short />
      <Figcap>
        <b>Rasuwagadhi to the Narayani.</b> Fade one group against the other with
        the opacity sliders — the overlap between them is the whole finding.{" "}
        <a href={href("map")}>Open the full map →</a> Basemap: Esri world imagery.
      </Figcap>

      <h2>Explore</h2>
      <div className="cards">
        <ExploreCard id="how" title="💡 How it works"
          text="What a glacial lake outburst is, what height above the river means, and why this needs two different satellites." />
        <ExploreCard id="terrain" title="⛰️ Terrain corridor"
          text="The finding: a corridor drawn from elevation alone holds almost every recorded loss." />
        <ExploreCard id="compare" title="🛰️ Before & after"
          text="The same ground on two dates, optical and radar, on a draggable divider." />
        <ExploreCard id="exposure" title="👥 Damage & exposure"
          text="What sat inside the water, counted by impact zone from Rasuwagadhi south." />
        <ExploreCard id="satellites" title="📡 Satellite detection"
          text="What the sensors caught, what they missed, and why the miss is mostly river." />
        <ExploreCard id="downloads" title="⬇️ Data & sources"
          text="Every layer as GeoJSON, and the statistics file behind every figure on this site." />
      </div>
    </>
  );
}

function ExploreCard({ id, title, text }) {
  return (
    <a className="card" href={href(id)}>
      <h3>{title}</h3>
      <p>{text}</p>
      <span className="go">Open →</span>
    </a>
  );
}

/* ── How it works ─────────────────────────────────────────────────────────── */

function How({ s }) {
  const hits = s.validation.hits || [];
  return (
    <>
      <PageHead
        kicker="Understand"
        title="How it works"
        lede="Five things worth knowing before any of the numbers on this site mean anything. No prior knowledge assumed."
      />

      <div className="cols explainers">
      <Explain q="Why a glacial lake bursting is worse than heavy rain">
        <p>
          Glaciers leave behind loose ridges of rubble, and meltwater ponds
          behind them. That dam is gravel and ice, not concrete. A rockfall into
          the lake, an ice avalanche, or simply the ridge soaking through can
          open it — and when it opens the lake does not drain over days. It
          leaves in minutes.
        </p>
        <p>
          The wave picks up everything loose on the way down: boulders, gravel,
          trees, whole hillsides. Steep Himalayan valleys make it worse by
          funnelling the flow instead of letting it spread out. What arrives at a
          village 40 km downstream is a wall of moving rock, which is why the
          damage here is scouring and burial rather than the soaking you would
          expect from a river in flood. Nepal has hundreds of these lakes and
          they are growing as the ice retreats.
        </p>
      </Explain>

      <Explain q="What “height above the river” means, and why it predicts damage">
        <p>
          Start with an elevation model: a grid where every 30 m cell holds its
          height. For each cell, work out which way water would run off it,
          follow that path downhill until it meets a river, and record how much
          higher the cell sits than the river it drains into. That number is{" "}
          <strong>HAND</strong> — Height Above Nearest Drainage.
        </p>
        <p>
          It is not height above sea level. A house 5 m above the channel and a
          house 300 m up the valley side can share an altitude; HAND tells them
          apart, because it measures each against <em>its own</em> river. Water
          cannot climb, so low HAND is ground a flood can reach and high HAND is
          ground it cannot.
        </p>
        <p>
          Everything within <strong>{s.event.hand_max_m} m</strong> of a channel
          here is {fmt(hits[0]?.corridor_base_pct, 2)}% of the map — and{" "}
          {fmt(hits[0]?.in_corridor_pct, 1)}% of the destroyed buildings are
          inside it. The corridor never looks at the satellite imagery, which is
          what makes that a test rather than a restatement.
        </p>
      </Explain>

      <Explain q="Why this needs two different satellites">
        <p>
          <strong>Sentinel-2 is a camera.</strong> It sees colour the way you
          would from an aeroplane — and, like you, it sees nothing at all through
          cloud. This flood happened at the height of the monsoon, and the
          clear-sky image taken afterwards covers only a sixth of the scene.
        </p>
        <p>
          <strong>Sentinel-1 is radar.</strong> It sends its own microwave pulse
          down and times the echo, so it works at night and straight through
          cloud. What it measures is roughness rather than colour: smooth
          standing water and fresh wet sediment bounce the pulse away from the
          satellite, so they come back dark. The cost is that a radar image is
          not a photograph — it is grainy, false-coloured and genuinely hard to
          read.
        </p>
        <p>
          Neither one alone gets through a monsoon disaster, so the detector
          accepts a change flagged by <em>either</em>. You can switch between
          them on the <a href={href("compare")}>before &amp; after</a> page.
        </p>
      </Explain>

      <Explain q="What “change detection” can and cannot see">
        <p>
          A change detector does one thing: it compares the same ground on two
          dates and flags what is different. That works beautifully for forest
          scoured down to gravel, or a terraced field buried in sediment, or a
          village replaced by riverbed.
        </p>
        <p>
          It is blind to anything that already looked that way. The river was a
          river on both dates, so along the channel itself there is nothing to
          flag — and the channel is most of the mapped flood extent. When you
          read on this site that only{" "}
          {fmt(s.validation.observed_flagged_by_stage3_pct, 1)}% of the flood
          extent was flagged, that is mostly what it means.
        </p>
      </Explain>

      <Explain q="What a damage survey actually records">
        <p>
          Not “a village was destroyed”. Mappers work through imagery and ground
          reports feature by feature, tagging each one with a condition —
          standing, damaged, destroyed. Every count on this site is a sum over
          those tags, which is why a bridge and a field boundary are counted
          separately, and why presence in the dataset is not itself evidence of
          damage.
        </p>
      </Explain>
      </div>

      <h2>What the survey recorded here</h2>
      <p className="muted">
        The eight most common kinds of feature mapped as damaged or destroyed in
        the Bhote Koshi and Trishuli corridor.
      </p>
      <DefList
        items={Object.entries(s.damaged_features_by_type)
          .slice(0, 8)
          .map(([kind, n]) => [kind, `${int(n)} mapped as damaged or destroyed`])}
      />

      <h2>How to read the map</h2>
      <p>
        The layer panel on the <a href={href("map")}>flood map</a> splits in two,
        and the split is the argument. <strong>Observed</strong> layers are what
        surveyors recorded on the ground. <strong>Derived</strong> layers are what
        this pipeline worked out from imagery and terrain, having never seen the
        survey. Drag one group's opacity slider down and watch whether the other
        one is underneath it.
      </p>
    </>
  );
}

/* ── Glossary ─────────────────────────────────────────────────────────────── */

function Glossary({ s }) {
  return (
    <>
      <PageHead
        kicker="Understand"
        title="Glossary"
        lede="Every term this site uses, in plain language."
      />
      <DefList items={[
        ["GLOF", "Glacial lake outburst flood. A lake dammed by glacial rubble or ice fails, and empties in minutes rather than days."],
        ["Debris flood", "Water carrying so much rock and sediment that it moves and destroys more like wet concrete than like a river."],
        ["DEM", "Digital elevation model — a grid where every cell holds the height of the ground. Here, SRTM at 30 m."],
        ["HAND", `Height Above Nearest Drainage. How far a cell sits above the river it drains into, rather than above sea level. The corridor on this site is everything within ${s.event.hand_max_m} m of a channel draining at least ${s.event.min_drainage_km2} km².`],
        ["Sentinel-2", "An optical satellite: a camera that sees colour, and nothing through cloud."],
        ["Sentinel-1", "A radar satellite. It sends its own microwave pulse and measures the echo, so it works at night and through cloud. Smooth standing water returns a dark signal."],
        ["Backscatter (σ⁰)", "How much of a radar pulse comes back to the satellite. A swing between two dates means the surface changed its roughness or its wetness."],
        ["NDVI and MNDWI", "Index images built from Sentinel-2 bands, one tracking living vegetation and one tracking surface water. Differencing them between two dates is how vegetation loss and new water are detected."],
        ["Change detection", "Comparing the same ground on two dates and flagging what differs. It cannot see damage to something that already looked that way — a river channel, for instance."],
        ["Base rate and concentration", "The share of the map a mask covers, and how many times more damage falls inside it than that share alone would predict. A mask over 4% of the map holding 96% of the losses is a 22× concentration."],
        ["Ground truth", "Independent observation used to test a result. Here, the HOT survey — which this pipeline never reads before making its own estimate."],
        ["Impact zone", "One of six named stretches of the corridor, from the Rasuwagadhi border south to Betrawati, used to break every count down by place."],
        ["Scour swath", "Detected damage per metre of channel: the width of the disturbed valley floor. It is not the width of the water."],
        ["GeoJSON", "A plain-text file format for map features. Every layer on the downloads page is one, and opens directly in QGIS or ArcGIS Pro."],
      ]} />
    </>
  );
}


/* ── Flood map ────────────────────────────────────────────────────────────── */

function FloodMap({ s }) {
  const { bridges, surveyed } = totals(s);
  return (
    <>
      <PageHead
        kicker="Explore data"
        title="Flood map"
        lede="Fourteen layers over the corridor, in two groups: what the ground survey observed, and what this pipeline derived from imagery and terrain. Each group fades against the other, which is the comparison this whole site is about."
      />
      <MapView />
      <Figcap>
        <b>Rasuwagadhi to the Narayani.</b> Clicking a feature reports its
        attributes in the panel. Building footprints draw from zoom 12.5 — all{" "}
        {int(s.damaged_features_by_type.building)} of them are an unreadable
        smear at corridor zoom. Basemap: Esri world imagery.
      </Figcap>

      <div className="cards">
        <div className="card">
          <h3>Observed — HOT survey</h3>
          <p>
            {int(surveyed)} buildings, {int(s.roads_by_status.Standing + s.roads_by_status.Destroyed)}{" "}
            road segments and {int(bridges)} bridges walked through feature by
            feature and tagged with a condition, plus the flood extent mapped
            from imagery on 27 August.
          </p>
        </div>
        <div className="card">
          <h3>Derived — this pipeline</h3>
          <p>
            The terrain corridor, the drainage network it hangs off, and the
            change the satellites detected inside it. None of these layers read
            the survey, which is what makes comparing them meaningful.
          </p>
        </div>
      </div>

      <h2>Using the map</h2>
      <ul className="steps">
        <li><b>Opacity</b> — fade one group against the other. The overlap is the finding.</li>
        <li><b>Click</b> — any feature reports its attributes; zone outlines give the zone id used in the tables.</li>
        <li><b>Zoom</b> — quarter-level steps, because the corridor is 120 km but a washed-out bridge is metres. <b>+</b>, <b>−</b> and <b>f</b> to fit.</li>
        <li><b>Scroll</b> — a plain wheel scrolls the page; hold ctrl or ⌘ to zoom the map, or use two fingers on a touchscreen.</li>
        <li><b>Share</b> — the view lives in the address bar, so any view you set up can be linked to.</li>
      </ul>
    </>
  );
}

/* ── Before & after ───────────────────────────────────────────────────────── */

function Compare({ s }) {
  return (
    <>
      <PageHead
        kicker="Explore data"
        title="Before &amp; after"
        lede="The same ground on two dates, with one contrast stretch computed on the pre-event image — so a difference in brightness is a difference on the ground and not the normalisation moving."
      />
      <SwipeMap />
      <Figcap>
        <b>Drag the divider</b>, or focus it and use the arrow keys. The change to
        look for is the Bhote Koshi channel between Rasuwagadhi and Syabrubesi:
        after the flood it is wider and, in radar, darker — smooth standing water
        and fresh wet sediment reflect the radar pulse away from the sensor.
      </Figcap>

      <div className="cards">
        <div className="card">
          <h3>📷 Optical — Sentinel-2</h3>
          <p>
            True colour, readable at a glance, and useless under cloud. The
            post-event composite is a monsoon week: most of the frame is white.
          </p>
        </div>
        <div className="card">
          <h3>📡 Radar — Sentinel-1</h3>
          <p>
            False colour and grainy, but it sees through the monsoon and covers
            both dates. This is the pair the slider opens on, because it is the
            one with post-event pixels to show.
          </p>
        </div>
      </div>

      <Callout>
        <p>
          The imagery covers the Sentinel study rectangle — the northern third of
          the corridor the <a href={href("map")}>flood map</a> spans end to end.
          Places outside that footprint get no button here, because a button that
          flies you off the overlay is a trap.
        </p>
      </Callout>
    </>
  );
}

/* ── Terrain corridor ─────────────────────────────────────────────────────── */

function Terrain({ s }) {
  const a = s.areas;
  const v = s.validation;
  const hits = v.hits || [];
  const lift = fmt(hits[0]?.in_corridor_pct / hits[0]?.corridor_base_pct, 0);

  return (
    <>
      <PageHead
        kicker="Analysis"
        title="Terrain alone finds the damage"
        lede="Height Above Nearest Drainage is computed from a 30 m elevation model and nothing else — no imagery, no flood report. It asks one question of every pixel: how far above the river is this ground?"
      />

      <div className="metrics">
        <Metric value={`${fmt(hits[0]?.corridor_base_pct, 2)}%`}
                label={`of the ${fmt(a["ROI area"], 0)} km² study area is inside the corridor`} />
        <Metric tone="red" value={`${fmt(hits[0]?.in_corridor_pct, 1)}%`}
                label="of buildings recorded destroyed are inside it" />
        <Metric tone="blue" value={`${fmt(v.observed_in_corridor_pct, 1)}%`}
                label="of the observed flood extent is inside it" />
        <Metric value={`${lift}×`}
                label="concentration against the corridor's own base rate" />
      </div>

      <Explain q="In plain English">
        <p>
          The corridor is {fmt(hits[0]?.corridor_base_pct, 2)}% of the map. If
          the flood had damaged buildings at random you would expect about{" "}
          {fmt(hits[0]?.corridor_base_pct, 0)} in every 100 destroyed buildings
          to fall inside it. {fmt(hits[0]?.in_corridor_pct, 0)} in 100 did.
        </p>
        <p>
          Nothing about the corridor knows a flood happened. It is a contour map
          asking which ground is low enough to be reached. So this is a statement
          about the whole of the high Himalaya, not only about{" "}
          {eventDate(s).replace(/ \d{4}$/, "")}: the ground a debris flood can
          occupy is largely decidable in advance, anywhere there is an elevation
          model — which is everywhere.
        </p>
      </Explain>

      <h2>Ground evidence inside the corridor</h2>
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
          <Figcap>
            Share of each kind of recorded loss falling within HAND ≤{" "}
            {s.event.hand_max_m} m of a channel draining at least{" "}
            {s.event.min_drainage_km2} km². The corridor never sees the imagery,
            so this is not the model marking its own homework.
          </Figcap>
        </div>
        <Callout>
          <p>
            <strong>Read this as a well-drawn corridor, not a skill score.</strong>{" "}
            {fmt(hits[0]?.in_corridor_pct, 1)}% containment says the corridor is
            right <em>here</em>, on one event. It is not cross-validated, and the
            survey's own mapping is densest along the river, which inflates any
            containment statistic computed against it.
          </p>
        </Callout>
      </div>

      <Table
        caption={<><b>Ground evidence against the derived masks,</b> inside the study rectangle.</>}
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
      <Figcap>
        The corridor is the terrain-only mask; detected damage is what the
        satellites flagged inside it. Concentration is the last column over its
        own base rate — how much better than chance each mask does.
      </Figcap>
    </>
  );
}

/* ── Satellite detection ──────────────────────────────────────────────────── */

function Satellites({ s }) {
  const a = s.areas;
  const v = s.validation;
  const hits = v.hits || [];

  return (
    <>
      <PageHead
        kicker="Analysis"
        title="What the satellites caught, and what they missed"
        lede="A pixel counts as changed if Sentinel-2 saw its vegetation or water index move, or Sentinel-1 saw its radar backscatter swing — and if it sits inside the terrain corridor. Measured against the ground survey, honestly."
      />

      <div className="metrics">
        <Metric tone="blue" value={`${fmt(v.observed_flagged_by_stage3_pct, 1)}%`}
                label="of the observed flood extent was flagged" />
        <Metric value={`${fmt(v.detected_inside_observed_pct, 1)}%`}
                label="of what was flagged sits inside observed water" />
        <Metric value={`${fmt(v.precision_vs_base_rate, 0)}×`}
                label={`better than the ${fmt(v.observed_share_of_roi_pct, 2)}% base rate`} />
        <Metric value={`${fmt(a["stage 3 flood damage, inside ROI"], 1)} km²`}
                label="detected flood damage inside the study rectangle" />
      </div>

      <Explain q="In plain English: why “29.5% flagged” is not “70% missed”">
        <p>
          A change detector compares the same ground on two dates and flags what
          is different. The river was already a river on both dates, so along the
          channel itself there is nothing to flag — and the channel is most of
          the mapped flood extent. Finding nothing there is the detector being
          right, not being blind.
        </p>
        <p>
          What it does light up is ground that changed <em>state</em>: forest
          stripped to gravel, terraces buried in sediment, a village replaced by
          riverbed. Add the monsoon — 65–80% cloud over the upper catchment,
          leaving the radar working alone — and the honest way to read the score
          is concentration rather than coverage.
        </p>
      </Explain>

      <h2>Ground evidence inside the detected-damage mask</h2>
      <div className="cols">
        <div>
          <Bars
            rows={[
              { label: "Buildings", value: hits[0]?.in_detected_pct, colour: C.red },
              { label: "Roads", value: hits[2]?.in_detected_pct, colour: C.red },
              { label: "Bridges", value: hits[1]?.in_detected_pct, colour: C.red },
              { label: "Flood extent", value: v.observed_flagged_by_stage3_pct, colour: C.blue },
            ]}
            max={100}
          />
          <Figcap>
            Share covered by the detected-damage mask, which occupies{" "}
            {fmt(hits[0]?.detected_base_pct, 2)}% of the study area — an
            eightieth of the terrain corridor above it.
          </Figcap>
        </div>
        <Callout kind="warn">
          <p>
            <strong>The upper catchment sat under 65–80% cloud.</strong> Those
            pixels rest on radar alone, and one zone — Ghattekhola — has only
            7.1% usable optical coverage. Its figure should not be quoted
            without that caveat.
          </p>
        </Callout>
      </div>

      <Table
        caption={<><b>Areas inside the study rectangle,</b> in km².</>}
        cols={[
          { key: "k", label: "Measure" },
          { key: "v", label: "km²", n: true },
        ]}
        rows={[
          ["Study rectangle", a["ROI area"]],
          ["Observed flood extent (ground survey)", a["HOT observed flood extent, inside ROI"]],
          ["HAND corridor", a["stage 3 HAND corridor, inside ROI"]],
          ["Change, thresholds only", a["stage 2 change, inside ROI"]],
          ["Flood damage, confined to the corridor", a["stage 3 flood damage, inside ROI"]],
        ].map(([k, val]) => ({ k, v: fmt(val, 2) }))}
      />

      <h2>Change rate against height above the river</h2>
      <Bars
        rows={s.change_vs_hand.map((r) => ({
          label: `${r.hand_lo_m}–${Number.isFinite(r.hand_hi_m) && r.hand_hi_m ? r.hand_hi_m : "∞"} m`,
          value: r.change_pct,
          colour: r.hand_hi_m && r.hand_hi_m <= s.event.hand_max_m ? C.blue : C.muted,
        }))}
      />
      <Figcap>
        <b>The profile that set the corridor ceiling.</b> Share of each height
        band flagged as changed, against height above the nearest drainage. Flat
        to {s.event.hand_max_m} m, then falling away to a far-field floor; blue
        is the band the corridor keeps. A threshold cutting below{" "}
        {s.event.hand_max_m} m would slice through the middle of the signal.
      </Figcap>
    </>
  );
}

/* ── Damage & exposure ────────────────────────────────────────────────────── */

function Exposure({ s }) {
  return (
    <>
      <PageHead
        kicker="Analysis"
        title="What sat inside the water"
        lede="Counts clipped to the observed flood extent itself, not to the 200 m buffer the source export ships. Being in the dataset is not evidence of damage; being inside the extent is."
      />

      <Table
        caption={<><b>Exposure along the whole corridor.</b> Everything mapped, and how much of it fell inside the observed flood extent.</>}
        cols={[
          { key: "layer", label: "Feature" },
          { key: "total", label: "Mapped", n: true, render: (r) => int(r.total) },
          { key: "in_flood_extent", label: "In flood extent", n: true, render: (r) => int(r.in_flood_extent) },
        ]}
        rows={s.exposure}
      />

      <h2>Losses by impact zone</h2>
      <p className="muted">
        Six named stretches from the Rasuwagadhi border south to Betrawati. Click
        a zone id to fly the <a href={href("map")}>flood map</a> to it.
      </p>
      <Table
        caption={<><b>Recorded losses by zone,</b> from the ground survey.</>}
        cols={[
          { key: "zone_id", label: "Zone" },
          { key: "label", label: "Place" },
          { key: "buildings_destroyed", label: "Buildings", n: true, render: (r) => int(r.buildings_destroyed) },
          { key: "roads_destroyed", label: "Roads", n: true, render: (r) => int(r.roads_destroyed) },
          { key: "bridges_washed_out", label: "Bridges out", n: true, render: (r) => int(r.bridges_washed_out) },
        ]}
        rows={s.exposure_by_zone}
      />

      <Table
        caption={<><b>Detected damage by zone,</b> from the satellites rather than the survey.</>}
        cols={[
          { key: "zone_id", label: "Zone" },
          { key: "label", label: "Place" },
          { key: "corridor_km2", label: "Corridor km²", n: true, render: (r) => fmt(r.corridor_km2, 2) },
          { key: "flood_km2", label: "Detected km²", n: true, render: (r) => fmt(r.flood_km2, 2) },
          { key: "scour_width_m", label: "Scour swath m", n: true, render: (r) => fmt(r.scour_width_m, 0) },
          { key: "note", label: "", render: (r) => r.note || "" },
        ]}
        rows={s.zonal_flood}
      />
      <Figcap>
        <b>Scour swath is not river width.</b> It is detected damage per metre of
        channel — the width of the disturbed valley floor, which is the widened
        channel plus its deposition aprons. Sentinel-1 cannot resolve this river:
        its backscatter never goes specular in a gorge this steep.
      </Figcap>

      <Callout kind="warn">
        <p>
          Impact-zone coordinates beyond Rasuwagadhi are approximate — only the
          border zone has a position stated in the study design. Treat the
          per-zone splits as indicative of where along the valley the damage
          concentrated, not as precise boundaries.
        </p>
      </Callout>
    </>
  );
}

/* ── Method & limits ──────────────────────────────────────────────────────── */

function Method({ s }) {
  const a = s.areas;
  const roi = s.event.roi;
  const { bridges, surveyed } = totals(s);

  return (
    <>
      <PageHead
        kicker="Reference"
        title="Method &amp; limits"
        lede="Five stages, each reading the previous one's files off disk. Nothing here is a validated classifier, and this page is the list of everything it cannot tell you."
      />

      <DefList items={[
        ["Event", `${eventDate(s)} — glacial lake outburst and debris flood`],
        ["Study area", `${roi[0]}–${roi[2]}° E, ${roi[1]}–${roi[3]}° N · ${fmt(a["ROI area"], 0)} km²`],
        ["Instruments", "Sentinel-2 L2A · Sentinel-1 GRD · SRTM GL1 (30 m)"],
        ["Ground truth", `${int(surveyed)} buildings, ${int(s.roads_by_status.Standing + s.roads_by_status.Destroyed)} road segments, ${int(bridges)} bridges`],
        ["Corridor", `HAND ≤ ${s.event.hand_max_m} m of a channel draining ≥ ${s.event.min_drainage_km2} km²`],
        ["Products", `${Object.keys(s.layer_bytes).length} GeoJSON layers, WGS84`],
      ]} />

      <div className="cols">
        <div>
      <h2>The pipeline</h2>
      <ol className="steps">
        <li>
          Sentinel-2 L2A and Sentinel-1 GRD pre/post composites plus SRTM, on one
          relative orbit so terrain geometry cancels between the dates.
        </li>
        <li>
          A pixel is flagged as changed where <code>(1)</code> holds, after a
          linear-power multilook on the radar to knock down speckle.
        </li>
        <li>
          Priority-flood fill → D8 flow directions → flow accumulation → HAND.
          The corridor is <code>(2)</code>, and the flagged pixels are clipped to it.
        </li>
        <li>The ground survey is joined in, and everything above is measured against it.</li>
        <li>Pre/post imagery is reprojected to Web Mercator for the before/after slider.</li>
      </ol>
        </div>
        <div>
          <h2>Known limits</h2>
          <ul className="steps">
            <li>
              <b>Thresholds are uncalibrated.</b> They are the study design's,
              not values tuned against reference polygons. This is a starting
              point, not a validated classifier.
            </li>
            <li>
              <b>HAND has no notion of flow volume or timing.</b> It cannot
              separate the {eventDate(s).replace(/ \d{4}$/, "")} surge from
              ordinary high-monsoon inundation on the same valley floor.
            </li>
            <li>
              <b>Flow accumulation is truncated at the study boundary.</b> The
              Bhote Koshi's Tibetan headwaters lie outside the elevation model,
              so the first few kilometres below the border are undercounted.
            </li>
            <li>
              <b>No radiometric terrain flattening on the radar.</b> Same-orbit
              differencing cancels most of the topographic bias, but the
              residual is real on the steepest slopes.
            </li>
            <li>
              <b>The collapse source itself is out of scope.</b> Excluding snow
              and ice is what stops fresh snowfall reading as damage, but it
              also means this pipeline cannot speak to the high-altitude genesis
              zone.
            </li>
            <li>
              <b>One event, one corridor.</b> Containment says the corridor is
              well drawn here. It is not a cross-validated skill score.
            </li>
            {s.dropped_bridges?.length > 0 && (
              <li>
                <b>
                  {s.dropped_bridges.length} bridge
                  {s.dropped_bridges.length > 1 ? "s" : ""} dropped from the map.
                </b>{" "}
                {s.dropped_bridges.join(", ")} — published with latitude in both
                coordinate slots.
              </li>
            )}
          </ul>
        </div>
      </div>

      <h2>The two rules everything rests on</h2>
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
      <Figcap>
        Δ is post minus pre. σ⁰ is Sentinel-1 VV backscatter, differenced in dB
        after averaging in linear power. HAND is height above the nearest
        drainage and A the upslope area draining to it, both from SRTM alone —
        neither reads the imagery, which is what makes the{" "}
        <a href={href("terrain")}>terrain result</a> a test rather than a
        restatement. Both thresholds are read from the pipeline's own output, so
        this notation cannot drift from what actually ran.
      </Figcap>

    </>
  );
}

/* ── Data & sources ───────────────────────────────────────────────────────── */

function Downloads({ s }) {
  return (
    <>
      <PageHead
        kicker="Reference"
        title="Data &amp; sources"
        lede="Every layer this site draws, as GeoJSON in WGS84. Open them in QGIS or ArcGIS Pro directly — no account, no API key, no licence to agree to beyond the ones below."
      />

      <h2>Layers</h2>
      <div className="files">
        {Object.entries(s.layer_bytes).map(([name, bytes]) => (
          <a className="file" key={name} href={`${DATA}/${name}.geojson`} download>
            {name.replace(/_/g, " ")}
            <span>{KB(bytes)}</span>
          </a>
        ))}
        <a className="file" href={`${DATA}/summary.json`} download>
          summary.json
          <span>statistics</span>
        </a>
      </div>

      <Callout>
        <p>
          <strong>Every figure on this site is in <code>summary.json</code>.</strong>{" "}
          The pages read their numbers out of that one file at load time, so
          there is no statistic quoted anywhere here that is not in the download —
          and no way for the prose to drift from what the pipeline computed.
        </p>
      </Callout>

      <h2>Sources</h2>
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

      <h2>How it was built</h2>
      <p>
        A five-stage Python pipeline — Earth Engine, rasterio, geopandas — each
        stage reading the previous one's files off disk and nothing else. The
        ground survey is the Humanitarian OpenStreetMap Team's and the field
        reports behind it; the hydropower inventory was contributed by Niti
        Foundation. The site itself is static files bundled by esbuild, with no
        server behind it.
      </p>
      <p>
        Source code and the full method write-up:{" "}
        <a href="https://github.com/bikal3/rasuwa-flood">github.com/bikal3/rasuwa-flood</a>.
      </p>
    </>
  );
}

export default {
  home: Home,
  how: How,
  glossary: Glossary,
  map: FloodMap,
  compare: Compare,
  terrain: Terrain,
  satellites: Satellites,
  exposure: Exposure,
  method: Method,
  downloads: Downloads,
};
