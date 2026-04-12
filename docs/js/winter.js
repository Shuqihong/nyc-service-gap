/**
 * winter.js — Monthly resolution time line chart with hover tooltips.
 * Scroll-triggered: lines draw in + dots fade in when chart enters viewport.
 */
(async function initWinterChart() {
  try {
    const data = await d3.json("public/data/winter_monthly.json");
    const el = document.getElementById("winter-chart");
    if (!el) return;

    const Q_META = {
      "Q1 (lowest)":  { color: "#d96459", label: "Q1 (lowest income)" },
      "Q2":           { color: "#f2a553", label: "Q2" },
      "Q3":           { color: "#7bc8a4", label: "Q3" },
      "Q4 (highest)": { color: "#5b93c5", label: "Q4 (highest income)" },
    };
    const Q_ORDER = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"];
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const margin = { top: 32, right: 130, bottom: 40, left: 55 };
    const W = el.clientWidth || 760;
    const H = 380;
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const svg = d3.select("#winter-chart")
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("font-family", "'Source Sans 3', sans-serif");

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([1, 12]).range([0, w]);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.median_h) * 1.1]).range([h, 0]);

    g.append("g").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(12).tickFormat((d) => MONTHS[d - 1]))
      .selectAll("text").style("font-size", "11px");

    g.append("g").call(d3.axisLeft(y).ticks(6))
      .selectAll("text").style("font-size", "11px");

    g.append("text").attr("transform", "rotate(-90)")
      .attr("x", -h / 2).attr("y", -42).attr("text-anchor", "middle")
      .style("font-size", "12px").style("fill", "#444")
      .text("Median resolution time (hours)");

    svg.append("text").attr("x", W / 2).attr("y", 20).attr("text-anchor", "middle")
      .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
      .text("Monthly resolution time by income quartile");

    g.append("g").selectAll("line").data(y.ticks(6)).enter().append("line")
      .attr("x1", 0).attr("x2", w).attr("y1", d => y(d)).attr("y2", d => y(d))
      .attr("stroke", "#e8e4dc").attr("stroke-dasharray", "3,3");

    const line = d3.line().x(d => x(d.month)).y(d => y(d.median_h)).curve(d3.curveMonotoneX);

    const paths = [];
    const dots = [];

    Q_ORDER.forEach(q => {
      const qData = data.filter(d => d.quartile === q).sort((a, b) => a.month - b.month);
      const meta = Q_META[q];

      const path = g.append("path").datum(qData)
        .attr("fill", "none").attr("stroke", meta.color).attr("stroke-width", 2.5)
        .attr("d", line);

      /* Set up for draw-in animation */
      const totalLen = path.node().getTotalLength();
      path.attr("stroke-dasharray", totalLen).attr("stroke-dashoffset", totalLen);
      paths.push(path);

      const qDots = g.selectAll(`.dot-${q.replace(/[^a-z0-9]/gi, "")}`)
        .data(qData).enter().append("circle")
        .attr("cx", d => x(d.month)).attr("cy", d => y(d.median_h))
        .attr("r", 5).attr("fill", meta.color).attr("stroke", "#fff").attr("stroke-width", 1.5)
        .style("cursor", "pointer").style("opacity", 0)
        .on("mouseover", function(event, d) {
          d3.select(this).attr("r", 7);
          showTip(event,
            `<strong>${meta.label}</strong><br>${MONTHS[d.month - 1]} 2024<br>` +
            `Median: <strong>${d.median_h.toFixed(1)} hours</strong><br>` +
            `Complaints: ${d.n.toLocaleString()}`);
        })
        .on("mousemove", moveTip)
        .on("mouseout", function() { d3.select(this).attr("r", 5); hideTip(); });
      dots.push(qDots);
    });

    /* Legend */
    const legend = svg.append("g").attr("transform", `translate(${W - margin.right + 12}, ${margin.top + 8})`);
    Q_ORDER.forEach((q, i) => {
      const meta = Q_META[q];
      const row = legend.append("g").attr("transform", `translate(0, ${i * 22})`);
      row.append("line").attr("x1", 0).attr("x2", 18).attr("y1", 0).attr("y2", 0)
        .attr("stroke", meta.color).attr("stroke-width", 2.5);
      row.append("circle").attr("cx", 9).attr("cy", 0).attr("r", 3.5).attr("fill", meta.color);
      row.append("text").attr("x", 24).attr("y", 4).style("font-size", "11px").style("fill", "#555").text(q);
    });

    /* Scroll-triggered draw-in */
    onReveal(el, () => {
      paths.forEach(p => {
        p.transition().duration(1200).ease(d3.easeLinear).attr("stroke-dashoffset", 0);
      });
      dots.forEach(d => {
        d.transition().delay(400).duration(600).style("opacity", 1);
      });
    });

  } catch (err) {
    console.error("Winter chart error:", err);
  }
})();
