/**
 * stat_analysis.js — Statistical Analysis section
 *
 * Three D3 visualizations using the page's color palette:
 *   1. chart-heatmap       — static 7x7 variable association heatmap
 *   2. chart-nested-models — static nested R² bar chart
 *   3. chart-dag           — animated causal DAG (nodes fade in, arrows draw)
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

  // Diagnostic notes shown only where they add information beyond the plotted bars/line.
  const data = [
    { name: "income only",      r2: 0.001, phone: null },
    { name: "+ month",          r2: 0.005, phone: null },
    {
      name: "+ filing channel", r2: 0.123, phone: 1.79,
      note: [
        "Drop-one ΔR²: 0.0005",
      ],
    },
    {
      name: "+ city agency", r2: 0.666, phone: 0.06,
      note: [
        "Drop-one ΔR²: 0.0117",
      ],
    },
    {
      name: "+ complaint type", r2: 0.792, phone: -0.02,
      note: [
        "Drop-one ΔR²: 0.1255",
      ],
    },
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
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".3f")))
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
    .style("cursor", d => d.note ? "pointer" : "default")
    .on("mouseover", (evt, d) => {
      if (!d.note) return;
      const lines = (d.note || []).map(t => `<span>${t}</span>`).join("<br>");
      showTip(evt, `<strong>${d.name}</strong><br>${lines}`);
    })
    .on("mousemove", (evt, d) => { if (d.note) moveTip(evt); })
    .on("mouseout", hideTip);

  g.selectAll(".rlab").data(data).enter().append("text")
    .attr("x", d => x(d.name) + x.bandwidth() / 2)
    .attr("y", d => y(d.r2) - 6)
    .attr("text-anchor", "middle")
    .style("font-size", "11px").style("font-weight", "700").style("fill", "#333")
    .text(d => d.r2.toFixed(3));

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
   CHART 3: Animated causal DAG
   ══════════════════════════════════ */
(function () {
  const el = document.getElementById("chart-dag");
  if (!el) return;

  const W = el.clientWidth || 820;
  const H = 560;

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("text").attr("x", W / 2).attr("y", 24).attr("text-anchor", "middle")
    .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
    .text("Causal DAG — how inequality produces the resolution-time gap");

  const sx = W / 820;
  function P(x, y) { return [x * sx, y]; }

  const NODES = {
    root: {
      pos: P(410, 60), w: 260, h: 46,
      label: "Economic inequality",
      color: "#d96459", text: "#fff",
    },
    housing: {
      pos: P(220, 190), w: 280, h: 68,
      label: "Older rental housing with\ndeferred maintenance\n(boilers, plumbing, pests)",
      color: "#f2a553", text: "#3a2a10",
    },
    digital: {
      pos: P(600, 190), w: 260, h: 68,
      label: "Unequal digital access\n(broadband, smartphones,\ntech fluency)",
      color: "#f2a553", text: "#3a2a10",
    },
    mix: {
      pos: P(280, 330), w: 320, h: 68,
      label: "Different complaint mix\n(more slow, housing-interior\nissues; heat, plumbing, pests)",
      color: "#d96459", text: "#fff",
    },
    channel: {
      pos: P(620, 330), w: 240, h: 68,
      label: "More phone-filed\ncomplaints\n(vs. online portal / app)",
      color: "#c9b9a0", text: "#3a2a10",
    },
    winter: {
      pos: P(260, 450), w: 260, h: 56,
      label: "Winter surge in\nHEAT/HOT WATER",
      color: "#c9b9a0", text: "#3a2a10",
    },
    out: {
      pos: P(560, 500), w: 360, h: 48,
      label: "Longer 311 resolution time",
      color: "#8a1f1f", text: "#fff",
    },
  };

  // Edges: [from, to, dashed?, label, strong?]
  const EDGES = [
    ["root",    "housing", false, null,              false],
    ["root",    "digital", false, null,              false],
    ["housing", "mix",     false, "primary path",    true ],
    ["digital", "channel", false, null,              false],
    ["mix",     "winter",  false, "seasonal surge",  false],
    ["mix",     "out",     false, "97.8% of gap",    true ],
    ["winter",  "out",     false, "amplifier",       false],
    ["channel", "out",     true,  "≈0 after controls", false],
  ];

  // Arrow markers (normal + strong)
  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "arrowhead").attr("viewBox", "0 -5 10 10")
    .attr("refX", 10).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#7a6a50");
  defs.append("marker")
    .attr("id", "arrowhead-strong").attr("viewBox", "0 -5 10 10")
    .attr("refX", 10).attr("refY", 0)
    .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#8a1f1f");

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
    .attr("stroke", d => d[4] ? "#8a1f1f" : "#7a6a50")
    .attr("stroke-width", d => d[4] ? 2.8 : 1.5)
    .attr("stroke-dasharray", d => d[2] ? "6,4" : null)
    .attr("marker-end", d => d[4] ? "url(#arrowhead-strong)" : "url(#arrowhead)")
    .style("opacity", 0);

  // Edge labels
  const edgeLabelSel = gEdges.selectAll("text").data(EDGES.filter(e => e[3])).enter().append("text")
    .attr("x", d => { const p = edgePoints(d[0], d[1]); return (p.sx + p.ex) / 2 + 6; })
    .attr("y", d => { const p = edgePoints(d[0], d[1]); return (p.sy + p.ey) / 2 - 4; })
    .style("font-size", "10.5px").style("font-style", "normal")
    .style("fill", d => d[4] ? "#8a1f1f" : "#6a6558").style("font-weight", "600")
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
    { type: "node", key: "channel" },
    { type: "edge", match: (e) => e[0] === "housing" || e[0] === "digital" },
    { type: "node", key: "winter" },
    { type: "edge", match: (e) => e[0] === "mix" && e[1] === "winter" },
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
