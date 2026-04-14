/**
 * explanation_charts.js — The Explanation section:
 *   1. Infrastructure breakdown (stacked composition + within-type resolution)
 *   2. Complaint mix (stacked percentage bars)
 *   3. Oaxaca decomposition (3 bars)
 * All animate on scroll.
 */

/* ══════════════════════════════════
   CHART 3: Infrastructure breakdown (dual panel)
   ══════════════════════════════════ */
(async function () {
  const data = await d3.json("public/data/infra_breakdown.json");
  const el = document.getElementById("chart-infra-breakdown");
  if (!el) return;

  const margin = { top: 50, right: 20, bottom: 55, left: 55 };
  const W = el.clientWidth || 760;
  const H = 420;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Inside Infrastructure: Composition & Resolution Time");

  const halfW = w * 0.44;
  const gapX = w * 0.12;

  /* ── LEFT: stacked composition ── */
  const xL = d3.scaleBand().domain(Q_ORDER).range([0, halfW]).padding(0.3);
  const yL = d3.scaleLinear().domain([0, 100]).range([h, 0]);

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xL).tickSize(0)).selectAll("text").style("font-size", "10px");

  g.append("g").call(d3.axisLeft(yL).ticks(5).tickFormat(d => d + "%"))
    .selectAll("text").style("font-size", "10px");

  g.append("text").attr("x", halfW / 2).attr("y", -6)
    .attr("text-anchor", "middle").style("font-size", "11px").style("font-weight", "600").style("fill", "#888")
    .text("Share of infrastructure complaints");

  /* stacked bars (start at 0) */
  const intBars = g.selectAll(".infra-int").data(data).enter().append("rect").attr("class", "infra-int")
    .attr("x", d => xL(d.quartile)).attr("width", xL.bandwidth())
    .attr("y", h).attr("height", 0).attr("fill", "#d96459").attr("rx", 2)
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.quartile}</strong><br>Interior: <strong>${d.interior_pct}%</strong><br>${d.interior_n.toLocaleString()} complaints`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  const pubBars = g.selectAll(".infra-pub").data(data).enter().append("rect").attr("class", "infra-pub")
    .attr("x", d => xL(d.quartile)).attr("width", xL.bandwidth())
    .attr("y", h).attr("height", 0).attr("fill", "#5b93c5").attr("rx", 2)
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.quartile}</strong><br>Public: <strong>${d.public_pct}%</strong><br>${d.public_n.toLocaleString()} complaints`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  const intLabels = g.selectAll(".infra-int-lbl").data(data).enter().append("text").attr("class", "infra-int-lbl")
    .attr("x", d => xL(d.quartile) + xL.bandwidth() / 2).attr("y", h)
    .attr("text-anchor", "middle").style("font-size", "11px").style("font-weight", "600").style("fill", "#fff")
    .style("opacity", 0).text(d => d.interior_pct + "%");

  /* left legend */
  const legL = g.append("g").attr("transform", `translate(0, ${h + 28})`);
  [["Interior housing", "#d96459"], ["Public infra", "#5b93c5"]].forEach(([t, c], i) => {
    const r = legL.append("g").attr("transform", `translate(${i * 130}, 0)`);
    r.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2).attr("fill", c);
    r.append("text").attr("x", 14).attr("y", 9).style("font-size", "10px").style("fill", "#666").text(t);
  });

  /* ── RIGHT: within-type resolution ── */
  const xR = d3.scaleBand().domain(Q_ORDER).range([halfW + gapX, w]).padding(0.3);
  const maxRT = d3.max(data, d => Math.max(d.interior_median_h, d.public_median_h));
  const yR = d3.scaleLinear().domain([0, maxRT * 1.1]).range([h, 0]);
  const x1R = d3.scaleBand().domain(["interior", "public"]).range([0, xR.bandwidth()]).padding(0.1);

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xR).tickSize(0)).selectAll("text").style("font-size", "10px");

  const yRAxis = g.append("g").attr("transform", `translate(${halfW + gapX},0)`)
    .call(d3.axisLeft(yR).ticks(5).tickFormat(d => d + "h"));
  yRAxis.selectAll("text").style("font-size", "10px");

  g.append("text").attr("x", halfW + gapX + (w - halfW - gapX) / 2).attr("y", -6)
    .attr("text-anchor", "middle").style("font-size", "11px").style("font-weight", "600").style("fill", "#888")
    .text("Within-type resolution time");

  const rtIntBars = g.selectAll(".infra-rt-int").data(data).enter().append("rect").attr("class", "infra-rt-int")
    .attr("x", d => xR(d.quartile) + x1R("interior")).attr("width", x1R.bandwidth())
    .attr("y", h).attr("height", 0).attr("fill", "#d96459").attr("rx", 2)
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.quartile}</strong> · Interior<br>` +
      `P95: ${d.interior_p95_h}h<br>` +
      `Median: <strong>${d.interior_median_h.toFixed(1)}h</strong><br>` +
      `P5: ${d.interior_p5_h}h`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  const rtPubBars = g.selectAll(".infra-rt-pub").data(data).enter().append("rect").attr("class", "infra-rt-pub")
    .attr("x", d => xR(d.quartile) + x1R("public")).attr("width", x1R.bandwidth())
    .attr("y", h).attr("height", 0).attr("fill", "#5b93c5").attr("rx", 2)
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.quartile}</strong> · Public<br>` +
      `P95: ${d.public_p95_h}h<br>` +
      `Median: <strong>${d.public_median_h.toFixed(1)}h</strong><br>` +
      `P5: ${d.public_p5_h}h`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  onReveal(el, () => {
    const dur = 800;
    intBars.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => yL(d.interior_pct)).attr("height", d => h - yL(d.interior_pct));
    pubBars.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => yL(100)).attr("height", d => yL(d.interior_pct) - yL(100));
    intLabels.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => yL(d.interior_pct / 2) + 4).style("opacity", 1);
    rtIntBars.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => yR(d.interior_median_h)).attr("height", d => h - yR(d.interior_median_h));
    rtPubBars.transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", d => yR(d.public_median_h)).attr("height", d => h - yR(d.public_median_h));
  });
})();

/* ══════════════════════════════════
   CHART 4: Complaint mix stacked bars
   ══════════════════════════════════ */
(async function () {
  const data = await d3.json("public/data/complaint_mix.json");
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

  const x = d3.scaleBand().domain(Q_ORDER).range([0, w]).padding(0.3);
  const y = d3.scaleLinear().domain([0, 100]).range([h, 0]);

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0)).selectAll("text").style("font-size", "12px");
  g.select(".domain").attr("stroke", "#ccc");

  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "%"))
    .selectAll("text").style("font-size", "11px");

  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -42).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("Share of complaints (%)");

  const stackOrder = ["health_safety", "interior_housing", "public_infra", "quality_of_life", "other"];
  const MIX_LABEL = {
    health_safety: "Health & Safety",
    interior_housing: "Interior housing repairs",
    public_infra: "Public infrastructure",
    quality_of_life: "Quality of Life",
    other: "Other"
  };
  const MIX_COLOR = {
    health_safety: "#d96459",
    interior_housing: "#c27a4a",
    public_infra: "#5b93c5",
    quality_of_life: "#f2a553",
    other: "#b8b0a8"
  };

  /* Build bar data with y positions */
  const barData = [];
  data.forEach(d => {
    let cumY = 0;
    stackOrder.forEach(cat => {
      const val = d[cat];
      barData.push({ quartile: d.quartile, category: cat, value: val, y0: cumY });
      cumY += val;
    });
  });

  const bars = g.selectAll(".mix-bar").data(barData).enter().append("rect").attr("class", "mix-bar")
    .attr("x", d => x(d.quartile)).attr("width", x.bandwidth())
    .attr("y", h).attr("height", 0)
    .attr("fill", d => MIX_COLOR[d.category]).attr("rx", 1)
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.quartile}</strong><br>${MIX_LABEL[d.category]}: <strong>${d.value.toFixed(1)}%</strong>`))
    .on("mousemove", moveTip).on("mouseout", hideTip);

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

  onReveal(el, () => {
    bars.transition().duration(800).ease(d3.easeCubicOut)
      .attr("y", d => y(d.y0 + d.value))
      .attr("height", d => y(d.y0) - y(d.y0 + d.value));
  });
})();

/* ══════════════════════════════════
   CHART 5: Oaxaca decomposition
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
