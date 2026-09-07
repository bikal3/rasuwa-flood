import { useEffect, useState } from "react";
import { ROUTES } from "./routes.mjs";
import { DATA, href } from "./base.js";
import PAGES from "./pages.jsx";

/**
 * The app shell: sidebar, page, foot.
 *
 * Every page needs summary.json and none of them need anything else, so the
 * fetch, the loading state and the error state live here once rather than nine
 * times. The page components are pure functions of that object.
 *
 * Navigation is ordinary links to real files. There is no router: build.mjs
 * writes an index.html per route, so the browser's own navigation handles back,
 * forward, middle-click, refresh and deep links without a line of code.
 */
export default function Shell({ page }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    fetch(`${DATA}/summary.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`summary.json ${r.status}`);
        return r.json();
      })
      .then(setS)
      .catch((e) => setErr(String(e)));
  }, []);

  // The overlay closes the drawer on a phone; on a desktop the class is inert.
  useEffect(() => {
    document.body.classList.toggle("nav-open", navOpen);
    return () => document.body.classList.remove("nav-open");
  }, [navOpen]);

  const i = Math.max(0, ROUTES.findIndex((r) => r.id === page));
  const route = ROUTES[i];
  const Page = PAGES[route.id];

  return (
    <>
      <button
        className="sidebar-toggle"
        aria-label="Toggle navigation"
        aria-expanded={navOpen}
        onClick={() => setNavOpen((v) => !v)}
      >
        ☰
      </button>

      <div className="app">
        <aside className="sidebar">
          <a className="brand" href={href("home")}>
            <span className="mark" aria-hidden="true">🌊</span>
            <span>
              <b>Rasuwa Flood 2026</b>
              <span className="sub">Bhote Koshi · Nepal</span>
            </span>
          </a>

          <nav aria-label="Pages">
            {ROUTES.map((r, n) => (
              <div key={r.id}>
                {r.group && r.group !== ROUTES[n - 1]?.group && (
                  <div className="group-label">{r.group}</div>
                )}
                <a
                  className="nav-item"
                  href={href(r.id)}
                  aria-current={r.id === route.id ? "page" : undefined}
                >
                  <span className="icon" aria-hidden="true">{r.icon}</span>
                  {r.label}
                </a>
              </div>
            ))}
          </nav>

          <div className="foot">
            <p className="warn">
              ⚠️ Unreviewed analysis. Thresholds are the study design's, not
              calibrated — nothing here is a validated classifier.
            </p>
            <p className="caption">
              26 Aug 2026 · Rasuwagadhi to the Narayani
              {s ? ` · ${Math.round(s.areas["ROI area"])} km² studied` : ""}
            </p>
            <a className="badge" href="https://github.com/bikal3/rasuwa-flood">
              <span className="left">GitHub</span>
              <span className="right">bikal3/rasuwa-flood</span>
            </a>
          </div>
        </aside>

        <main id="main">
          {err ? (
            <>
              <h1 className="page-title">Data not loaded</h1>
              <p className="lede">
                {err}. Run <code>python pipeline/stage4_hot.py</code>, then{" "}
                <code>node web/build.mjs</code>.
              </p>
            </>
          ) : !s ? (
            <p className="lede">Loading…</p>
          ) : (
            <>
              <Page s={s} />
              <Pager prev={ROUTES[i - 1]} next={ROUTES[i + 1]} />
              <SiteFoot s={s} />
            </>
          )}
        </main>
      </div>
    </>
  );
}

/** Read the site straight through, as well as looking things up in it. */
function Pager({ prev, next }) {
  if (!prev && !next) return null;
  return (
    <nav className="pager" aria-label="Previous and next page">
      {prev && (
        <a href={href(prev.id)}>
          <small>Previous</small>
          <b>{prev.icon} {prev.label}</b>
        </a>
      )}
      {next && (
        <a className="next" href={href(next.id)}>
          <small>Next</small>
          <b>{next.label} {next.icon}</b>
        </a>
      )}
    </nav>
  );
}

function SiteFoot({ s }) {
  return (
    <footer>
      <p>
        <strong>Unreviewed analysis — not an operational damage assessment.</strong>{" "}
        Presence in a source export is not evidence of damage; only the{" "}
        <code>status</code> field is. Detection thresholds are the study design's
        rather than values calibrated against reference polygons.
      </p>
      <p>
        Ground survey: {s.sources[0].org} ({s.sources[0].licence}). Imagery:{" "}
        {s.sources[1].org} ({s.sources[1].licence}). Hydropower inventory
        contributed by Niti Foundation. Basemap tiles © Esri and ©
        OpenStreetMap contributors. Full citations on the{" "}
        <a href={href("downloads")}>Data &amp; sources</a> page.
      </p>
    </footer>
  );
}
