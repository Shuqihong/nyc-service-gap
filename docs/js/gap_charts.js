/**
 * gap_charts.js — The Gap section: quartile bars + category resolution bars
 * Both animate on scroll (bars grow upward from zero).
 */

const Q_ORDER = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"];
const Q_COLOR = { "Q1 (lowest)": "#d96459", "Q2": "#f2a553", "Q3": "#7bc8a4", "Q4 (highest)": "#5b93c5" };
const Q_LABEL = { "Q1 (lowest)": "Q1 (lowest income)", "Q2": "Q2", "Q3": "Q3", "Q4 (highest)": "Q4 (highest income)" };
const CAT_ORDER = ["interior_housing", "public_infra", "quality_of_life", "other"];
const CAT_COLOR = { health_safety: "#d96459", infrastructure: "#5b93c5", quality_of_life: "#f2a553", other: "#b8b0a8" };
const CAT_LABEL = { interior_housing: "Interior Housing", public_infra: "Public Infrastructure", quality_of_life: "Quality of Life", other: "Other" };

/* ══════════════════════════════════
   CHART 1: Quartile bars
   ══════════════════════════════════ */
(async function () {
  const data = await d3.json("public/data/quartile_bars.json");
  const el = document.getElementById("chart-quartile-bars");
  if (!el) return;

  const margin = { top: 36, right: 20, bottom: 40, left: 55 };
  const W = el.clientWidth || 760;
  const H = 340;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(Q_ORDER).range([0, w]).padding(0.35);
  const yMax = d3.max(data, d => d.median_h);
  const y = d3.scaleLinear().domain([0, Math.ceil(yMax + 3)]).range([h, 0]).nice();

  /* Title */
  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Median Resolution Time by Income Quartile");

  /* Axes */
  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0)).selectAll("text").style("font-size", "12px");
  g.select(".domain").attr("stroke", "#ccc");

  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "h"))
    .selectAll("text").style("font-size", "11px");

  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -42).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("Median resolution time (hours)");

  /* Grid */
  g.append("g").selectAll("line").data(y.ticks(5)).enter().append("line")
    .attr("x1", 0).attr("x2", w).attr("y1", d => y(d)).attr("y2", d => y(d))
    .attr("stroke", "#eae5db").attr("stroke-dasharray", "3,3");

  /* Bars (start at height=0) */
  const bars = g.selectAll(".qbar").data(data, d => d.quartile)
    .enter().append("rect").attr("class", "qbar")
    .attr("x", d => x(d.quartile)).attr("width", x.bandwidth())
    .attr("y", h).attr("height", 0).attr("rx", 3)
    .attr("fill", d => Q_COLOR[d.quartile])
    .style("cursor", "pointer")
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${Q_LABEL[d.quartile]}</strong><br>` +
      `P95: ${d.p95_h}h<br>` +
      `Median: <strong>${d.median_h.toFixed(1)}h</strong><br>` +
      `P5: ${d.p5_h}h`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  /* Value labels (hidden) */
  const labels = g.selectAll(".qbar-label").data(data, d => d.quartile)
    .enter().append("text").attr("class", "qbar-label")
    .attr("x", d => x(d.quartile) + x.bandwidth() / 2)
    .attr("y", h).attr("text-anchor", "middle")
    .style("font-size", "13px").style("font-weight", "700").style("fill", "#333")
    .style("opacity", 0).text(d => d.median_h.toFixed(1) + "h");

  /* Animate on scroll */
  onReveal(el, () => {
    bars.transition().duration(800).ease(d3.easeCubicOut)
      .attr("y", d => y(d.median_h))
      .attr("height", d => h - y(d.median_h));
    labels.transition().duration(800).ease(d3.easeCubicOut)
      .attr("y", d => y(d.median_h) - 6).style("opacity", 1);
  });
})();

/* ══════════════════════════════════
   CHART 2: Median resolution time by category (overall, with hover breakdown)
   ══════════════════════════════════ */
(async function () {
  const raw = await d3.json("public/data/category_resolution.json");
  const el = document.getElementById("chart-category-bars");
  if (!el) return;

  /* One bar per category using the overall median.
     Hover reveals the per-quartile breakdown. */
  const overall = CAT_ORDER.map(cat =>
    raw.find(r => r.category === cat && r.quartile === "Overall")
  ).filter(Boolean);
  const byCatQuartile = {};
  CAT_ORDER.forEach(cat => {
    byCatQuartile[cat] = Q_ORDER.map(q => raw.find(r => r.category === cat && r.quartile === q));
  });

  const margin = { top: 36, right: 20, bottom: 50, left: 60 };
  const W = el.clientWidth || 760;
  const H = 400;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(CAT_ORDER).range([0, w]).padding(0.35);
  const yMax = d3.max(overall, d => d.median_h);
  const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([h, 0]);

  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Median Resolution Time by Category");

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0).tickFormat(d => CAT_LABEL[d]))
    .selectAll("text").style("font-size", "12px");
  g.select(".domain").attr("stroke", "#ccc");

  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "h"))
    .selectAll("text").style("font-size", "11px");

  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -46).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("Median resolution time (hours)");

  g.append("g").selectAll("line").data(y.ticks(5)).enter().append("line")
    .attr("x1", 0).attr("x2", w).attr("y1", d => y(d)).attr("y2", d => y(d))
    .attr("stroke", "#eae5db").attr("stroke-dasharray", "3,3");

  const CAT_COLOR = {
    interior_housing: "#d96459",
    public_infra:     "#5b93c5",
    quality_of_life:  "#f2a553",
    other:            "#b8b0a8",
  };

  /* Bars (one per category) */
  const bars = g.selectAll(".catbar").data(overall)
    .enter().append("rect").attr("class", "catbar")
    .attr("x", d => x(d.category)).attr("width", x.bandwidth())
    .attr("y", h).attr("height", 0).attr("rx", 3)
    .attr("fill", d => CAT_COLOR[d.category])
    .style("cursor", "pointer")
    .on("mouseover", (evt, d) => {
      const rows = byCatQuartile[d.category]
        .filter(Boolean)
        .map(r => `<tr><td style="padding-right:8px">${r.quartile}</td><td style="text-align:right"><strong>${r.median_h.toFixed(1)}h</strong></td></tr>`)
        .join("");
      showTip(evt,
        `<strong>${CAT_LABEL[d.category]}</strong><br>` +
        `Overall median: <strong>${d.median_h.toFixed(1)}h</strong><br>` +
        `<span style="color:#888">${d.n.toLocaleString()} complaints</span>` +
        `<table style="margin-top:6px;font-size:11px">${rows}</table>`);
    })
    .on("mousemove", moveTip).on("mouseout", hideTip);

  /* Value label above each bar */
  const valueLabels = g.selectAll(".catbar-lbl").data(overall)
    .enter().append("text").attr("class", "catbar-lbl")
    .attr("x", d => x(d.category) + x.bandwidth() / 2)
    .attr("y", h)
    .attr("text-anchor", "middle")
    .style("font-size", "13px").style("font-weight", "700").style("fill", "#3a2a1a")
    .style("opacity", 0)
    .text(d => d.median_h >= 10 ? Math.round(d.median_h) + "h" : d.median_h.toFixed(1) + "h");

  /* Range label below the value (Q1–Q4 spread) */
  const rangeLabels = g.selectAll(".catbar-range").data(overall)
    .enter().append("text").attr("class", "catbar-range")
    .attr("x", d => x(d.category) + x.bandwidth() / 2)
    .attr("y", h)
    .attr("text-anchor", "middle")
    .style("font-size", "10px").style("fill", "#888")
    .style("opacity", 0)
    .text(d => {
      const meds = byCatQuartile[d.category].filter(Boolean).map(r => r.median_h);
      const lo = Math.min(...meds), hi = Math.max(...meds);
      const fmt = v => v >= 10 ? Math.round(v) : v.toFixed(1);
      return `Q1–Q4: ${fmt(lo)}–${fmt(hi)}h`;
    });

  onReveal(el, () => {
    bars.transition().duration(800).ease(d3.easeCubicOut)
      .attr("y", d => y(d.median_h))
      .attr("height", d => h - y(d.median_h));
    valueLabels.transition().duration(800).ease(d3.easeCubicOut)
      .attr("y", d => y(d.median_h) - 22)
      .style("opacity", 1);
    rangeLabels.transition().duration(800).ease(d3.easeCubicOut)
      .attr("y", d => y(d.median_h) - 6)
      .style("opacity", 1);
  });
})();
