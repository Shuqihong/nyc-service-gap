/**
 * observe.js — Intersection Observer utility for scroll-triggered animations.
 *
 * Usage:
 *   onReveal("#my-chart", () => { ... animate ... });
 *
 * The callback fires once when the element enters the viewport (30% visible).
 */
const _revealCallbacks = new Map();

const _revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        _revealObserver.unobserve(el);
        const cb = _revealCallbacks.get(el);
        if (cb) {
          cb();
          _revealCallbacks.delete(el);
        }
      }
    });
  },
  { threshold: 0.3 }
);

function onReveal(selector, callback) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  _revealCallbacks.set(el, callback);
  _revealObserver.observe(el);
}

/* Shared tooltip helpers (used by all chart scripts) */
const _tooltip = null; // lazily initialized
function getTooltip() {
  return document.getElementById("tooltip");
}
function showTip(evt, html) {
  const t = getTooltip();
  t.style.opacity = "1";
  t.innerHTML = html;
  t.style.left = (evt.clientX + 14) + "px";
  t.style.top = (evt.clientY - 14) + "px";
}
function moveTip(evt) {
  const t = getTooltip();
  t.style.left = (evt.clientX + 14) + "px";
  t.style.top = (evt.clientY - 14) + "px";
}
function hideTip() {
  getTooltip().style.opacity = "0";
}

/* Inline category-name tooltips: any element with class "cat-tip" and a
   data-tip attribute reveals the tooltip on hover. */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".cat-tip").forEach(el => {
    const tip = el.getAttribute("data-tip");
    if (!tip) return;
    el.addEventListener("mouseover", evt => showTip(evt, tip));
    el.addEventListener("mousemove", moveTip);
    el.addEventListener("mouseout", hideTip);
  });
});
