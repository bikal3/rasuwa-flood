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

/**
 * A numbered section. `display: contents` on the head puts the number in the
 * section grid's margin column and the heading in the text column, without a
 * wrapper box between them -- see the section grid in styles.css.
 */
export function Section({ no, title, lede, children, id }) {
  return (
    <section id={id}>
      <div className="wrap secgrid">
        <div className="sec-head">
          <span className="sec-no idx">§{no}</span>
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

/**
 * A numbered caption on the rail.
 *
 * Full-width exhibits hang their index in the section's margin column, beside
 * the section number; one inside a narrow column stacks it above the caption
 * instead, where a 7rem rail would eat the column it is sitting in.
 */
export function Caption({ no, kind = "Figure", tight, children }) {
  return (
    <div className={tight ? "cap" : "cap rail"}>
      <span className="idx">{kind}{no ? ` ${no}` : ""}</span>
      <p className="figcap">{children}</p>
    </div>
  );
}

export function Table({ no, caption, cols, rows }) {
  return (
    <div className="tbl-scroll">
      <table>
        {caption && (
          <caption>
            {no && <b>Table {no}.</b>} {caption}
          </caption>
        )}
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
          <span className="val">
            {fmt(r.value, 1)}
            %
          </span>
        </div>
      ))}
    </div>
  );
}
