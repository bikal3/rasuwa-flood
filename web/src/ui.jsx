/** Small shared presentation pieces. */

/**
 * Ask the map to fly somewhere. A DOM CustomEvent rather than context or a ref
 * threaded through five components: there is exactly one map, one sender shape,
 * and no state to share -- only a message.
 */
const flyTo = (zoneId) =>
  window.dispatchEvent(new CustomEvent("map:fly", { detail: zoneId }));

export const fmt = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : Number(v).toLocaleString("en", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

export const int = (v) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en");

/** The heading block every page opens on. */
export function PageHead({ kicker, title, lede, children }) {
  return (
    <header>
      {kicker && <p className="page-kicker">{kicker}</p>}
      <h1 className="page-title">{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}

/** A headline number. `tone` carries the site's one colour rule. */
export function Metric({ value, label, tone }) {
  return (
    <div className={tone ? `metric is-${tone}` : "metric"}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Callout({ kind, title, children }) {
  return (
    <div className={kind ? `callout ${kind}` : "callout"}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

/** A fold of plain-language explanation. Native <details>: ctrl-F opens it. */
export function Explain({ q, children }) {
  return (
    <details className="plain">
      <summary>{q}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

export function Figcap({ children }) {
  return <p className="figcap">{children}</p>;
}

export function Table({ caption, cols, rows }) {
  return (
    <div className="table-wrap">
      <table>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.n ? "n" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className={c.n ? "n" : ""}>
                  {c.key === "zone_id" && r.zone_id ? (
                    <button className="zonelink" onClick={() => flyTo(r.zone_id)}
                            title={`Show ${r.zone_id} on the map`}>
                      {r.zone_id}
                    </button>
                  ) : c.render ? c.render(r) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Horizontal bars. Deliberately not a charting library: these are one-dimensional
 * comparisons where the bar IS the data, and a 90 kB dependency to draw a div of
 * a given width is not a trade worth making.
 */
export function Bars({ rows, max }) {
  const top = max ?? Math.max(...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="bar-row" key={r.label}>
          <span className="lbl">{r.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${Math.max(0.6, (r.value / top) * 100)}%`,
                background: r.colour,
                animationDelay: `${i * 55}ms`,
              }}
            />
          </span>
          <span className="val">{fmt(r.value, 1)}%</span>
        </div>
      ))}
    </div>
  );
}

/** A key/value block: page metadata, or a glossary. */
export function DefList({ items }) {
  return (
    <dl className="deflist">
      {items.map(([term, def]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{def}</dd>
        </div>
      ))}
    </dl>
  );
}
