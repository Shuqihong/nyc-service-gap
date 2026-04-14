/**
 * stat_analysis.js — Statistical Analysis section
 *
 * Three D3 visualizations using the page's color palette:
 *   1. chart-heatmap       — static 7x7 variable association heatmap
 *   2. chart-nested-models — static nested R² bar chart
 *   3. chart-block-attribution — agency vs complaint-type attribution
 *   4. chart-dag           — animated causal DAG (nodes fade in, arrows draw)
 *
 * Palette matches gap_charts.js / explanation_charts.js:
 *   red #d96459, orange #f2a553, green #7bc8a4, blue #5b93c5, gray #b8b0a8
 *   page accent #c72929, ink #222, border #e0d7c2, bg #fbf6ed
 */

/* ══════════════════════════════════
   CHART 1: Association heatmap (static)
   ══════════════════════════════════ */
(function () {
  const el = document.getElementById("chart-heatmap");
  if (!el) return;

  const LABELS = [
    "Resolution time",
    "Median household income",
    "Population",
    "Month filed",
    "Complaint type",
    "City agency",
    "Filing channel",
  ];
  // Values from draft/results/association_matrix_clean.csv
  const M = [
    [1.000, 0.035, 0.041, 0.011, 0.843, 0.814, 0.345],
    [0.035, 1.000, 0.339, 0.012, 0.360, 0.297, 0.128],
    [0.041, 0.339, 1.000, 0.003, 0.221, 0.236, 0.082],
    [0.011, 0.012, 0.003, 1.000, 0.117, 0.108, 0.051],
    [0.843, 0.360, 0.221, 0.117, 1.000, 0.871, 0.518],
    [0.814, 0.297, 0.236, 0.108, 0.871, 1.000, 0.441],
    [0.345, 0.128, 0.082, 0.051, 0.518, 0.441, 1.000],
  ];

  const margin = { top: 46, right: 40, bottom: 110, left: 160 };
  const W = el.clientWidth || 760;
  const cellSize = Math.min(58, (W - margin.left - margin.right) / LABELS.length);
  const gridW = cellSize * LABELS.length;
  const H = gridW + margin.top + margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Title
  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("How strongly each variable moves with the others");

  // Color scale — warm palette consistent with page (#fbf6ed → #c72929)
  const color = d3.scaleLinear()
    .domain([0, 0.35, 0.7, 1])
    .range(["#fbf6ed", "#f2a553", "#d96459", "#8a1f1f"]);

  // Cells
  LABELS.forEach((row, i) => {
    LABELS.forEach((col, j) => {
      const v = M[i][j];
      g.append("rect")
        .attr("x", j * cellSize).attr("y", i * cellSize)
        .attr("width", cellSize - 1).attr("height", cellSize - 1)
        .attr("rx", 2)
        .attr("fill", color(v))
        .on("mouseover", (evt) => showTip(evt,
          `<strong>${row}</strong> &times; <strong>${col}</strong><br>` +
          `Association: <strong>${v.toFixed(2)}</strong>`))
        .on("mousemove", moveTip).on("mouseout", hideTip);
      g.append("text")
        .attr("x", j * cellSize + cellSize / 2)
        .attr("y", i * cellSize + cellSize / 2 + 4)
        .attr("text-anchor", "middle")
        .style("font-size", "11px").style("font-weight", "600")
        .style("fill", v > 0.55 ? "#fff" : "#3a2a1a")
        .style("pointer-events", "none")
        .text(v.toFixed(2));
    });
  });

  // Row labels
  LABELS.forEach((lab, i) => {
    g.append("text")
      .attr("x", -8).attr("y", i * cellSize + cellSize / 2 + 4)
      .attr("text-anchor", "end")
      .style("font-size", "12px").style("fill", "#333")
      .text(lab);
  });

  // Column labels (rotated)
  LABELS.forEach((lab, j) => {
    g.append("text")
      .attr("transform", `translate(${j * cellSize + cellSize / 2},${gridW + 10}) rotate(-40)`)
      .attr("text-anchor", "end")
      .style("font-size", "12px").style("fill", "#333")
      .text(lab);
  });

  // Legend
  const legendW = 180, legendH = 10;
  const legendX = (gridW - legendW) / 2;
  const legendY = gridW + 70;
  const lg = g.append("g").attr("transform", `translate(${legendX},${legendY})`);

  const defs = svg.append("defs");
  const gradId = "heatmap-gradient";
  const grad = defs.append("linearGradient").attr("id", gradId)
    .attr("x1", "0%").attr("x2", "100%");
  [0, 0.35, 0.7, 1].forEach(stop => {
    grad.append("stop").attr("offset", `${stop * 100}%`).attr("stop-color", color(stop));
  });
  lg.append("rect").attr("width", legendW).attr("height", legendH)
    .attr("rx", 2).attr("fill", `url(#${gradId})`);
  lg.append("text").attr("x", 0).attr("y", legendH + 14)
    .style("font-size", "11px").style("fill", "#666").text("weak (0)");
  lg.append("text").attr("x", legendW).attr("y", legendH + 14)
    .attr("text-anchor", "end")
    .style("font-size", "11px").style("fill", "#666").text("strong (1)");
})();


/* ══════════════════════════════════
   CHART 2: Nested R² bars + phone coefficient line (static)
   ══════════════════════════════════ */
(function () {
  const el = document.getElementById("chart-nested-models");
  if (!el) return;

  const data = [
    { name: "income only",           r2: 0.001, phone: null  },
    { name: "+ month",               r2: 0.005, phone: null  },
    { name: "+ filing channel",      r2: 0.123, phone: 1.79  },
    { name: "+ city agency",         r2: 0.666, phone: 0.06  },
    { name: "+ complaint type",      r2: 0.792, phone: -0.02 },
  ];

  const margin = { top: 46, right: 70, bottom: 70, left: 60 };
  const W = el.clientWidth || 760;
  const H = 380;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Nested regression (without borough): variance explained & phone-effect collapse");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(data.map(d => d.name)).range([0, w]).padding(0.35);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
  const yR = d3.scaleLinear().domain([-0.2, 2.0]).range([h, 0]);

  // Left axis (R²)
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .selectAll("text").style("font-size", "11px");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -44).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("R² (variance explained)");

  // Right axis (phone coefficient)
  g.append("g").attr("transform", `translate(${w},0)`)
    .call(d3.axisRight(yR).ticks(5)).selectAll("text").style("font-size", "11px");
  g.append("text").attr("transform", "rotate(90)")
    .attr("x", h / 2).attr("y", -w - 50).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#c72929")
    .text("PHONE coefficient (log-hours)");

  // Grid
  g.append("g").selectAll("line").data(y.ticks(5)).enter().append("line")
    .attr("x1", 0).attr("x2", w).attr("y1", d => y(d)).attr("y2", d => y(d))
    .attr("stroke", "#eae5db").attr("stroke-dasharray", "3,3");

  // X axis
  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0))
    .selectAll("text").style("font-size", "11px")
    .attr("transform", "rotate(-18)").style("text-anchor", "end");

  // Bars (R²) — blue from the page palette
  g.selectAll(".rbar").data(data).enter().append("rect")
    .attr("class", "rbar")
    .attr("x", d => x(d.name)).attr("width", x.bandwidth())
    .attr("y", d => y(d.r2)).attr("height", d => h - y(d.r2))
    .attr("rx", 3).attr("fill", "#5b93c5").attr("opacity", 0.88)
    .on("mouseover", (evt, d) => showTip(evt,
      `<strong>${d.name}</strong><br>R²: <strong>${(d.r2 * 100).toFixed(1)}%</strong>` +
      (d.phone !== null ? `<br>PHONE coef: ${d.phone.toFixed(2)}` : "")))
    .on("mousemove", moveTip).on("mouseout", hideTip);

  g.selectAll(".rlab").data(data).enter().append("text")
    .attr("x", d => x(d.name) + x.bandwidth() / 2)
    .attr("y", d => y(d.r2) - 6)
    .attr("text-anchor", "middle")
    .style("font-size", "11px").style("font-weight", "700").style("fill", "#333")
    .text(d => (d.r2 * 100).toFixed(1) + "%");

  // Phone coefficient line (red) — only rows where phone is defined
  const lineData = data.filter(d => d.phone !== null);
  const line = d3.line().x(d => x(d.name) + x.bandwidth() / 2).y(d => yR(d.phone));

  g.append("path").datum(lineData).attr("fill", "none")
    .attr("stroke", "#c72929").attr("stroke-width", 2.5)
    .attr("stroke-dasharray", "6,3")
    .attr("d", line);

  g.selectAll(".pdot").data(lineData).enter().append("circle")
    .attr("cx", d => x(d.name) + x.bandwidth() / 2)
    .attr("cy", d => yR(d.phone)).attr("r", 5)
    .attr("fill", "#c72929").attr("stroke", "#fff").attr("stroke-width", 1.5);

  g.selectAll(".plabel").data(lineData).enter().append("text")
    .attr("x", d => x(d.name) + x.bandwidth() / 2 + 8)
    .attr("y", d => yR(d.phone) - 8)
    .style("font-size", "11px").style("font-weight", "600").style("fill", "#c72929")
    .text(d => d.phone.toFixed(2));

  // Legend
  const lg = svg.append("g").attr("transform", `translate(${margin.left + 10},${H - 18})`);
  lg.append("rect").attr("width", 14).attr("height", 10).attr("fill", "#5b93c5").attr("opacity", 0.88);
  lg.append("text").attr("x", 20).attr("y", 9).style("font-size", "11px").style("fill", "#444")
    .text("R² of model");
  lg.append("circle").attr("cx", 128).attr("cy", 5).attr("r", 5).attr("fill", "#c72929");
  lg.append("line").attr("x1", 115).attr("x2", 141).attr("y1", 5).attr("y2", 5)
    .attr("stroke", "#c72929").attr("stroke-width", 2).attr("stroke-dasharray", "4,2");
  lg.append("text").attr("x", 148).attr("y", 9).style("font-size", "11px").style("fill", "#444")
    .text("PHONE coefficient (log-hours)");
})();


/* ══════════════════════════════════
   CHART 3: Block attribution (drop-one vs Shapley)
   ══════════════════════════════════ */
(function () {
  const el = document.getElementById("chart-block-attribution");
  if (!el) return;

  const data = [
    { block: "Complaint type", drop_unique: 0.1255, shapley: 0.4314 },
    { block: "Agency",         drop_unique: 0.0117, shapley: 0.3169 },
    { block: "Channel",        drop_unique: 0.0005, shapley: 0.0400 },
    { block: "Month",          drop_unique: 0.0020, shapley: 0.0025 },
    { block: "Income quartile",drop_unique: 0.0005, shapley: 0.0007 },
  ];

  const margin = { top: 44, right: 20, bottom: 56, left: 60 };
  const W = el.clientWidth || 760;
  const H = 360;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("text").attr("x", W / 2).attr("y", 22).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Agency vs complaint type: unique effect vs shared effect");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x0 = d3.scaleBand().domain(data.map(d => d.block)).range([0, w]).padding(0.24);
  const x1 = d3.scaleBand().domain(["drop_unique", "shapley"]).range([0, x0.bandwidth()]).padding(0.12);
  const y = d3.scaleLinear().domain([0, 0.46]).range([h, 0]);
  const color = d3.scaleOrdinal()
    .domain(["drop_unique", "shapley"])
    .range(["#5b93c5", "#d96459"]);

  g.append("g").call(d3.axisLeft(y).ticks(5))
    .selectAll("text").style("font-size", "11px");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -44).attr("text-anchor", "middle")
    .style("font-size", "12px").style("fill", "#666")
    .text("R² contribution");

  g.append("g").selectAll("line").data(y.ticks(5)).enter().append("line")
    .attr("x1", 0).attr("x2", w).attr("y1", d => y(d)).attr("y2", d => y(d))
    .attr("stroke", "#eae5db").attr("stroke-dasharray", "3,3");

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x0).tickSize(0))
    .selectAll("text")
    .style("font-size", "11px")
    .attr("transform", "rotate(-14)")
    .style("text-anchor", "end");

  const groups = g.selectAll(".attr-group").data(data).enter().append("g")
    .attr("class", "attr-group")
    .attr("transform", d => `translate(${x0(d.block)},0)`);

  groups.selectAll("rect").data(d => ([
    { key: "drop_unique", value: d.drop_unique, block: d.block },
    { key: "shapley", value: d.shapley, block: d.block },
  ])).enter().append("rect")
    .attr("x", d => x1(d.key))
    .attr("y", d => y(d.value))
    .attr("width", x1.bandwidth())
    .attr("height", d => h - y(d.value))
    .attr("rx", 2)
    .attr("fill", d => color(d.key))
    .on("mouseover", (evt, d) => {
      const lbl = d.key === "drop_unique" ? "Drop-one unique ΔR²" : "Shapley R² share";
      showTip(evt, `<strong>${d.block}</strong><br>${lbl}: <strong>${d.value.toFixed(4)}</strong>`);
    })
    .on("mousemove", moveTip)
    .on("mouseout", hideTip);

  const lg = svg.append("g").attr("transform", `translate(${margin.left + 8},${H - 16})`);
  [
    { key: "drop_unique", label: "Drop-one unique ΔR²", c: "#5b93c5" },
    { key: "shapley", label: "Shapley-style R² share", c: "#d96459" },
  ].forEach((d, i) => {
    const row = lg.append("g").attr("transform", `translate(${i * 190},0)`);
    row.append("rect").attr("width", 12).attr("height", 10).attr("rx", 2).attr("fill", d.c);
    row.append("text").attr("x", 18).attr("y", 9).style("font-size", "11px").style("fill", "#444").text(d.label);
  });
})();


/* ══════════════════════════════════
   CHART 4: Animated causal DAG
   ══════════════════════════════════ */
(function () {
  const el = document.getElementById("chart-dag");
  if (!el) return;

  const W = el.clientWidth || 760;
  const H = 520;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("text").attr("x", W / 2).attr("y", 24).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Causal DAG — how the gap is produced");

  // Node positions tuned for a 760-wide canvas; scale if wider
  const sx = W / 760;
  function P(x, y) { return [x * sx, y]; }

  const NODES = {
    root:    { pos: P(380, 70),  w: 220, h: 44, label: "Economic inequality",       color: "#d96459", text: "#fff" },
    housing: { pos: P(210, 180), w: 240, h: 58, label: "Rental housing with\ndeferred maintenance", color: "#f2a553", text: "#3a2a10" },
    digital: { pos: P(560, 180), w: 220, h: 58, label: "Less reliable\ndigital access",            color: "#f2a553", text: "#3a2a10" },
    mix:     { pos: P(380, 295), w: 300, h: 58, label: "More slow-to-fix\ncomplaint types",        color: "#d96459", text: "#fff"    },
    agency:  { pos: P(140, 395), w: 180, h: 44, label: "Agency mix (HPD)",          color: "#5b93c5", text: "#fff" },
    channel: { pos: P(380, 395), w: 190, h: 44, label: "Channel mix (phone)",       color: "#5b93c5", text: "#fff" },
    winter:  { pos: P(620, 395), w: 180, h: 44, label: "Winter amplifier",          color: "#5b93c5", text: "#fff" },
    out:     { pos: P(380, 480), w: 300, h: 44, label: "Longer wait in Q1 neighborhoods", color: "#8a1f1f", text: "#fff" },
  };

  // Edges: [from, to, dashed?, label]
  const EDGES = [
    ["root",    "housing", false, null],
    ["root",    "digital", false, null],
    ["housing", "mix",     false, "main path"],
    ["digital", "mix",     false, "small"],
    ["digital", "channel", true,  null],
    ["mix",     "agency",  false, null],
    ["mix",     "channel", false, null],
    ["mix",     "winter",  false, null],
    ["mix",     "out",     false, null],
    ["agency",  "out",     false, null],
    ["channel", "out",     false, null],
    ["winter",  "out",     false, null],
  ];

  // Arrow marker
  svg.append("defs").append("marker")
    .attr("id", "arrowhead").attr("viewBox", "0 -5 10 10")
    .attr("refX", 10).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#7a6a50");

  const gEdges = svg.append("g").attr("class", "dag-edges");
  const gNodes = svg.append("g").attr("class", "dag-nodes");

  // Compute edge endpoints on node borders
  function edgePoints(from, to) {
    const [x1, y1] = NODES[from].pos;
    const [x2, y2] = NODES[to].pos;
    const dx = x2 - x1, dy = y2 - y1;
    const a = Math.atan2(dy, dx);
    const hh1 = NODES[from].h / 2, ww1 = NODES[from].w / 2;
    const hh2 = NODES[to].h / 2,   ww2 = NODES[to].w / 2;
    // exit on box edge (approx — intersect with rectangle)
    function pt(x, y, w, h, sign) {
      const tx = Math.abs(Math.cos(a)) > 1e-6 ? w / Math.abs(Math.cos(a)) : Infinity;
      const ty = Math.abs(Math.sin(a)) > 1e-6 ? h / Math.abs(Math.sin(a)) : Infinity;
      const t = Math.min(tx, ty);
      return [x + sign * t * Math.cos(a), y + sign * t * Math.sin(a)];
    }
    const [sxP, syP] = pt(x1, y1, ww1, hh1, +1);
    const [exP, eyP] = pt(x2, y2, ww2, hh2, -1);
    return { sx: sxP, sy: syP, ex: exP, ey: eyP };
  }

  // Build edges (initially hidden)
  const edgeSel = gEdges.selectAll("line").data(EDGES).enter().append("line")
    .attr("x1", d => edgePoints(d[0], d[1]).sx)
    .attr("y1", d => edgePoints(d[0], d[1]).sy)
    .attr("x2", d => edgePoints(d[0], d[1]).sx)  // starts collapsed
    .attr("y2", d => edgePoints(d[0], d[1]).sy)
    .attr("stroke", "#7a6a50").attr("stroke-width", 1.6)
    .attr("stroke-dasharray", d => d[2] ? "6,4" : null)
    .attr("marker-end", "url(#arrowhead)")
    .style("opacity", 0);

  // Edge labels
  const edgeLabelSel = gEdges.selectAll("text").data(EDGES.filter(e => e[3])).enter().append("text")
    .attr("x", d => { const p = edgePoints(d[0], d[1]); return (p.sx + p.ex) / 2 + 6; })
    .attr("y", d => { const p = edgePoints(d[0], d[1]); return (p.sy + p.ey) / 2 - 4; })
    .style("font-size", "10.5px").style("font-style", "normal")
    .style("fill", "#c72929").style("font-weight", "600")
    .style("opacity", 0)
    .text(d => d[3]);

  // Build nodes (initially hidden)
  const nodeKeys = Object.keys(NODES);
  const nodeSel = gNodes.selectAll("g").data(nodeKeys).enter().append("g")
    .attr("transform", k => `translate(${NODES[k].pos[0]},${NODES[k].pos[1]})`)
    .style("opacity", 0);

  nodeSel.append("rect")
    .attr("x", k => -NODES[k].w / 2).attr("y", k => -NODES[k].h / 2)
    .attr("width", k => NODES[k].w).attr("height", k => NODES[k].h)
    .attr("rx", 8)
    .attr("fill", k => NODES[k].color)
    .attr("stroke", "#7a6a50").attr("stroke-width", 1.2);

  nodeSel.each(function (k) {
    const lines = NODES[k].label.split("\n");
    const sel = d3.select(this);
    const lh = 14;
    const startY = -((lines.length - 1) * lh) / 2 + 4;
    lines.forEach((line, i) => {
      sel.append("text")
        .attr("x", 0).attr("y", startY + i * lh)
        .attr("text-anchor", "middle")
        .style("font-size", "12px").style("font-weight", "600")
        .style("fill", NODES[k].text)
        .text(line);
    });
  });

  // Animation sequence
  const ORDER = [
    { type: "node", key: "root" },
    { type: "node", key: "housing" },
    { type: "node", key: "digital" },
    { type: "edge", match: (e) => e[0] === "root" },
    { type: "node", key: "mix" },
    { type: "edge", match: (e) => (e[0] === "housing" || e[0] === "digital") && (e[1] === "mix" || e[1] === "channel") },
    { type: "node", key: "agency" },
    { type: "node", key: "channel" },
    { type: "node", key: "winter" },
    { type: "edge", match: (e) => e[0] === "mix" && e[1] !== "out" },
    { type: "node", key: "out" },
    { type: "edge", match: (e) => e[1] === "out" },
  ];

  function animateEdge(eData) {
    const p = edgePoints(eData[0], eData[1]);
    return new Promise(resolve => {
      edgeSel.filter(d => d === eData)
        .style("opacity", 1)
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr("x2", p.ex).attr("y2", p.ey)
        .on("end", resolve);
      edgeLabelSel.filter(d => d === eData)
        .transition().delay(250).duration(350).style("opacity", 1);
    });
  }

  function animateNode(key) {
    return new Promise(resolve => {
      nodeSel.filter(k => k === key)
        .transition().duration(450).ease(d3.easeCubicOut)
        .style("opacity", 1)
        .on("end", resolve);
    });
  }

  async function runAnimation() {
    for (const step of ORDER) {
      if (step.type === "node") {
        await animateNode(step.key);
      } else {
        // animate all matching edges in parallel
        const matches = EDGES.filter(step.match);
        await Promise.all(matches.map(animateEdge));
      }
      await new Promise(r => setTimeout(r, 80));
    }
  }

  if (typeof onReveal === "function") {
    onReveal("#chart-dag", runAnimation);
  } else {
    runAnimation();
  }
})();
