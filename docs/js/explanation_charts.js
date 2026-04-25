/**
 * explanation_charts.js — The Explanation section:
 *   1. Complaint mix (stacked percentage bars)
 *   2. Oaxaca decomposition (3 bars)
 * Both animate on scroll.
 */

/* ══════════════════════════════════
   CHART 1: Complaint mix stacked bars
   ══════════════════════════════════ */
(async function () {
  const raw = await d3.json("public/data/complaint_mix.json");
  const el = document.getElementById("chart-complaint-mix");
  if (!el) return;

  const margin = { top: 36, right: 20, bottom: 55, left: 55 };
  const W = el.clientWidth || 760;
  const H = 400;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Complaint Composition by Income Quartile");

  g.append("g").attr("transform", `translate(0,${h})`)
    .attr("class", "mix-x-axis");

  const y = d3.scaleLinear().domain([0, 100]).range([h, 0]);
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "%"))
    .selectAll("text").style("font-size", "11px");

  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -42).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("Share of complaints (%)");

  const stackOrder = ["interior_housing", "public_infra", "quality_of_life", "other"];
  const MIX_LABEL = {
    interior_housing: "Interior Housing",
    public_infra: "Public Infrastructure",
    quality_of_life: "Quality of Life",
    other: "Other"
  };
  const MIX_COLOR = {
    interior_housing: "#d96459",
    public_infra: "#5b93c5",
    quality_of_life: "#f2a553",
    other: "#b8b0a8"
  };

  const toNum = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const valueFrom = (obj, keys) => {
    for (const k of keys) {
      if (obj && obj[k] != null) return toNum(obj[k]);
    }
    return 0;
  };

  const byQuartile = new Map();
  const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
  rows.forEach(row => {
    const q = row && row.quartile ? row.quartile : "";
    if (!q) return;
    if (!byQuartile.has(q)) {
      byQuartile.set(q, { quartile: q, shares: {}, medians: {} });
    }
    const out = byQuartile.get(q);

    /* Format A: [{quartile, shares:{...}, medians:{...}}] */
    if (row.shares || row.medians) {
      const shares = row.shares || {};
      const medians = row.medians || {};
      stackOrder.forEach(cat => {
        out.shares[cat] = valueFrom(shares, [cat]);
        out.medians[cat] = valueFrom(medians, [cat]);
      });
      return;
    }

    /* Format B: one row per quartile-category ({category, share_pct, median_h}) */
    const cat = row.category;
    if (!stackOrder.includes(cat)) return;
    out.shares[cat] = valueFrom(row, ["share_pct", "share", "pct"]);
    out.medians[cat] = valueFrom(row, ["median_h", "median"]);
  });

  const preferredQuartiles = (typeof Q_ORDER !== "undefined" && Array.isArray(Q_ORDER)) ? Q_ORDER : [];
  const quartiles = preferredQuartiles.filter(q => byQuartile.has(q));
  byQuartile.forEach((_, q) => {
    if (!quartiles.includes(q)) quartiles.push(q);
  });

  const x = d3.scaleBand().domain(quartiles).range([0, w]).padding(0.3);
  g.select(".mix-x-axis")
    .call(d3.axisBottom(x).tickSize(0))
    .selectAll("text")
    .style("font-size", "12px");
  g.select(".mix-x-axis .domain").attr("stroke", "#ccc");

  const normalized = quartiles.map(q => {
    const d = byQuartile.get(q) || { shares: {}, medians: {} };
    const shares = {};
    const medians = {};
    stackOrder.forEach(cat => {
      shares[cat] = valueFrom(d.shares, [cat]);
      medians[cat] = valueFrom(d.medians, [cat]);
    });
    return { quartile: q, shares, medians };
  });
  /* Build bar data with y positions */
  const barData = [];
  normalized.forEach(d => {
    let cumY = 0;
    stackOrder.forEach(cat => {
      const val = toNum(d.shares[cat]);
      const med = toNum(d.medians[cat]);
      barData.push({
        quartile: d.quartile, category: cat,
        value: val, median_h: med, y0: cumY,
      });
      cumY += val;
    });
  });

  g.selectAll(".mix-bar").data(barData).enter().append("rect").attr("class", "mix-bar")
    .attr("x", d => x(d.quartile)).attr("width", x.bandwidth())
    .attr("y", d => y(d.y0 + d.value))
    .attr("height", d => y(d.y0) - y(d.y0 + d.value))
    .attr("fill", d => MIX_COLOR[d.category]).attr("rx", 1)
    .on("mouseover", (evt, d) => {
      showTip(evt,
        `<strong>${d.quartile} · ${MIX_LABEL[d.category]}</strong><br>` +
        `Share: ${d.value.toFixed(1)}%<br>` +
        `Median resolution: <strong>${d.median_h.toFixed(1)} h</strong>`);
    })
    .on("mousemove", moveTip).on("mouseout", hideTip);

  /* Persistent percentage labels inside each stack segment */
  g.selectAll(".mix-lbl").data(barData).enter().append("text")
    .attr("class", "mix-lbl")
    .attr("x", d => x(d.quartile) + x.bandwidth() / 2)
    .attr("y", d => y(d.y0 + d.value / 2))
    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .style("font-size", "11px").style("font-weight", "700")
    .style("pointer-events", "none")
    .style("fill", d => (d.category === "quality_of_life") ? "#3a2a10" : "#fff")
    .text(d => d.value >= 4 ? d.value.toFixed(1) + "%" : "");

  /* Legend — horizontal row below x-axis */
  const leg = g.append("g").attr("transform", `translate(${w / 2}, ${h + 30})`);
  let legX = 0;
  const legItems = stackOrder.map(cat => ({ cat, label: MIX_LABEL[cat] }));
  const totalLegW = legItems.reduce((sum, it) => sum + it.label.length * 6.5 + 28, 0);
  legX = -totalLegW / 2;
  legItems.forEach(({ cat, label }) => {
    const row = leg.append("g").attr("transform", `translate(${legX}, 0)`);
    row.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2).attr("fill", MIX_COLOR[cat]);
    row.append("text").attr("x", 14).attr("y", 9).style("font-size", "10px").style("fill", "#666").text(label);
    legX += label.length * 6.5 + 28;
  });

})();

/* ══════════════════════════════════
   CHART 2: Oaxaca decomposition
   ══════════════════════════════════ */
(async function () {
  const data = await d3.json("public/data/oaxaca.json");
  const el = document.getElementById("chart-oaxaca");
  if (!el) return;

  const margin = { top: 36, right: 20, bottom: 40, left: 55 };
  const W = el.clientWidth || 760;
  const H = 360;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("What if Q1 had Q4\u2019s complaint mix?");

  const labels = data.map(d => d.label);
  const barColors = { q1: "#d96459", counterfactual: "#f2a553", q4: "#5b93c5" };

  const x = d3.scaleBand().domain(labels).range([w * 0.1, w * 0.9]).padding(0.35);
  const y = d3.scaleLinear().domain([0, 15]).range([h, 0]);

  const xAxisG = g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0));
  xAxisG.selectAll("text").style("font-size", "12px").style("font-weight", "500");
  xAxisG.select(".domain").remove();
  g.append("line").attr("x1", 0).attr("x2", w).attr("y1", h).attr("y2", h)
    .attr("stroke", "#ccc");

  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "h"))
    .selectAll("text").style("font-size", "11px");

  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -42).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("Median resolution time (hours)");

  g.append("g").selectAll("line").data(y.ticks(5)).enter().append("line")
    .attr("x1", w * 0.1).attr("x2", w * 0.9)
    .attr("y1", d => y(d)).attr("y2", d => y(d))
    .attr("stroke", "#eae5db").attr("stroke-dasharray", "3,3");

  const bars = g.selectAll(".oax-bar").data(data).enter().append("rect").attr("class", "oax-bar")
    .attr("x", d => x(d.label)).attr("width", x.bandwidth())
    .attr("y", h).attr("height", 0).attr("rx", 4)
    .attr("fill", d => barColors[d.type])
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.label}</strong><br>Median: <strong>${d.value} hours</strong>`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  const valLabels = g.selectAll(".oax-lbl").data(data).enter().append("text").attr("class", "oax-lbl")
    .attr("x", d => x(d.label) + x.bandwidth() / 2).attr("y", h)
    .attr("text-anchor", "middle").style("font-size", "15px").style("font-weight", "700").style("fill", "#333")
    .style("opacity", 0).text(d => d.value + "h");

  /* Annotation — centered over the middle bar with downward pointer */
  const b2Mid = x(labels[1]) + x.bandwidth() / 2;
  const annotY = y(3.8); /* just above the 1.7h bar top */

  const pctLabel = g.append("text").attr("class", "oax-pct")
    .attr("x", b2Mid).attr("y", annotY - 22)
    .attr("text-anchor", "middle")
    .style("font-size", "12.5px").style("font-weight", "800").style("fill", "#c72929")
    .style("opacity", 0).text("97.8% explained");

  const pctLabel2 = g.append("text").attr("class", "oax-pct2")
    .attr("x", b2Mid).attr("y", annotY - 8)
    .attr("text-anchor", "middle")
    .style("font-size", "11px").style("font-weight", "600").style("fill", "#c72929")
    .style("opacity", 0).text("by complaint mix");

  /* Downward arrow pointer to the middle bar */
  const arrowTipY = y(1.7) - 2; /* top of middle bar */
  const pointer = g.append("line").attr("class", "oax-pointer")
    .attr("x1", b2Mid).attr("x2", b2Mid)
    .attr("y1", annotY + 2).attr("y2", arrowTipY)
    .attr("stroke", "#c72929").attr("stroke-width", 1.5)
    .attr("marker-end", "url(#arrowhead)")
    .style("opacity", 0);

  /* Arrowhead marker */
  svg.append("defs").append("marker")
    .attr("id", "arrowhead").attr("viewBox", "0 0 10 10")
    .attr("refX", 5).attr("refY", 5)
    .attr("markerWidth", 5).attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path").attr("d", "M 0 0 L 10 5 L 0 10 z").attr("fill", "#c72929");

  onReveal(el, () => {
    const dur = 800;
    bars.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => y(d.value)).attr("height", d => h - y(d.value));
    valLabels.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => y(d.value) - 8).style("opacity", 1);
    pctLabel.transition().delay(dur + 300).duration(400).style("opacity", 1);
    pctLabel2.transition().delay(dur + 400).duration(400).style("opacity", 1);
    pointer.transition().delay(dur + 500).duration(400).style("opacity", 1);
  });
})();
