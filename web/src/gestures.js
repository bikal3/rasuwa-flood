/**
 * The map does not get to keep the page's scroll.
 *
 * Leaflet binds `wheel` on its own container, so once the cursor is over a map
 * that is 82vh tall, scrolling zooms and the page stops moving. The only way
 * down the article is to steer the cursor into the margin beside the map, which
 * is not a thing anyone should have to discover.
 *
 * So: a plain wheel scrolls the page, and zoom asks for a modifier -- the same
 * bargain an embedded Google map makes, and the one a trackpad pinch already
 * speaks natively, because a pinch arrives as a wheel event with ctrlKey set.
 *
 * The listener sits on the wrapper in the capture phase, one level above the
 * element Leaflet listens on, so stopping the event here means Leaflet never
 * sees it and the browser scrolls as it would over any other block. Nothing is
 * preventDefault-ed on the way past; the page's own scrolling stays the
 * browser's business.
 */

const MAC = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
const ZOOM_HINT = `Hold ${MAC ? "⌘" : "Ctrl"} and scroll to zoom`;

/** Controls and the swipe divider run their own gestures; leave them alone. */
const CHROME = ".mapctl, .swipe-bar, .swipe-sensor, .leaflet-control, button, a";

export default function tameGestures(map) {
  const box = map.getContainer();
  const host = box.parentElement || box;

  // Built here rather than in JSX: both maps want it, it carries no state React
  // needs to know about, and re-rendering a map component to flash a caption
  // would be a poor trade.
  const hint = document.createElement("div");
  hint.className = "gesture-hint";
  hint.setAttribute("aria-hidden", "true");   // it repeats what the keys already do
  hint.dataset.on = "false";
  host.appendChild(hint);

  let timer;
  const show = (msg) => {
    hint.textContent = msg;
    hint.dataset.on = "true";
    clearTimeout(timer);
    timer = setTimeout(() => (hint.dataset.on = "false"), 1400);
  };
  const hide = () => {
    clearTimeout(timer);
    hint.dataset.on = "false";
  };

  const onWheel = (e) => {
    // Fullscreen has no page behind it to scroll, so the bargain is off.
    if (e.ctrlKey || e.metaKey || document.fullscreenElement) return hide();
    if (e.target.closest?.(CHROME)) return;
    e.stopPropagation();
    show(ZOOM_HINT);
  };

  host.addEventListener("wheel", onWheel, { capture: true, passive: true });

  return () => {
    clearTimeout(timer);
    host.removeEventListener("wheel", onWheel, { capture: true });
    hint.remove();
  };
}
