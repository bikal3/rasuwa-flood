/** Small shared presentation pieces. */

export const fmt = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : Number(v).toLocaleString("en", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

export const int = (v) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en");

export function Section({ no, title, lede, children, id }) {
  return (
    <section id={id}>
      <div className="wrap">
        <div className="sec-head">
          <span className="sec-no">{no}</span>
          <div>
            <h2>{title}</h2>
            {lede && <p>{lede}</p>}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

export function Table({ caption, cols, rows }) {
  return (
    <div className="tbl-scroll">
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
                  {c.render ? c.render(r) : (r[c.key] ?? "—")}
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
export function Bars({ rows, max, unit = "%", colour = "#2a78d6" }) {
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
                background: r.colour || colour,
                animationDelay: `${i * 55}ms`,
              }}
            />
          </span>
          <span className="val">
            {fmt(r.value, r.decimals ?? 1)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}
