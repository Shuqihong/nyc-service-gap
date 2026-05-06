/**
 * heat_chart.js — HEAT/HOT WATER complaints per 10,000 residents by month and quartile.
 * Scroll-triggered: bars grow upward when chart enters viewport.
 */
(async function initHeatChart() {
  try {
    const data = await d3.json("public/data/heat_monthly.json");
    const el = document.getElementById("heat-chart");
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

    const svg = d3.select("#heat-chart")
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("font-family", "'Source Sans 3', sans-serif");

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x0 = d3.scaleBand().domain(MONTHS).range([0, w]).paddingInner(0.2).paddingOuter(0.1);
    const x1 = d3.scaleBand().domain(Q_ORDER).range([0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.per_10k) * 1.08]).range([h, 0]);

    g.append("g").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x0).tickSize(0)).selectAll("text").style("font-size", "11px");
    g.select(".domain").attr("stroke", "#ccc");

    g.append("g").call(d3.axisLeft(y).ticks(6)).selectAll("text").style("font-size", "11px");

    g.append("text").attr("transform", "rotate(-90)")
      .attr("x", -h / 2).attr("y", -42).attr("text-anchor", "middle")
      .style("font-size", "12px").style("fill", "#444")
      .text("Complaints per 10,000 residents");

    svg.append("text").attr("x", W / 2).attr("y", 20).attr("text-anchor", "middle")
      .style("font-size", "14px").style("font-weight", "bold").style("fill", "#222")
      .text("HEAT/HOT WATER complaints per capita by income quartile");

    g.append("g").selectAll("line").data(y.ticks(6)).enter().append("line")
      .attr("x1", 0).attr("x2", w).attr("y1", d => y(d)).attr("y2", d => y(d))
      .attr("stroke", "#e8e4dc").attr("stroke-dasharray", "3,3");

    /* Bars — start at zero height */
    const allBars = [];
    const monthGroups = g.selectAll(".month-group").data(MONTHS).enter().append("g")
      .attr("transform", d => `translate(${x0(d)},0)`);

    monthGroups.each(function(month, mi) {
      const monthIdx = mi + 1;
      const monthData = data.filter(d => d.month === monthIdx);

      d3.select(this).selectAll("rect")
        .data(Q_ORDER.map(q => {
          const row = monthData.find(d => d.quartile === q);
          return row || { quartile: q, per_10k: 0, n: 0, heat_share_of_quartile_pct: 0, month: monthIdx };
        }))
        .enter().append("rect")
        .attr("x", d => x1(d.quartile))
        .attr("y", h).attr("height", 0)
        .attr("width", x1.bandwidth())
        .attr("fill", d => Q_META[d.quartile].color)
        .attr("rx", 1.5).style("cursor", "pointer")
        .on("mouseover", function(event, d) {
          d3.select(this).attr("opacity", 0.8);
          showTip(event,
            `<strong>${Q_META[d.quartile].label}</strong><br>${MONTHS[mi]} 2024<br>` +
            `<strong>${d.per_10k} per 10k residents</strong><br>` +
            `Total: ${d.n.toLocaleString()} complaints<br>` +
            `${d.heat_share_of_quartile_pct}% of quartile's complaints`);
        })
        .on("mousemove", moveTip)
        .on("mouseout", function() { d3.select(this).attr("opacity", 1); hideTip(); })
        .each(function() { allBars.push(d3.select(this)); });
    });

    /* Legend */
    const legend = svg.append("g").attr("transform", `translate(${W - margin.right + 12}, ${margin.top + 8})`);
    Q_ORDER.forEach((q, i) => {
      const meta = Q_META[q];
      const row = legend.append("g").attr("transform", `translate(0, ${i * 22})`);
      row.append("rect").attr("width", 14).attr("height", 14).attr("rx", 2).attr("fill", meta.color);
      row.append("text").attr("x", 20).attr("y", 11).style("font-size", "11px").style("fill", "#555").text(q);
    });

    /* Scroll-triggered animation */
    onReveal(el, () => {
      g.selectAll("rect[rx='1.5']").transition().duration(800).ease(d3.easeCubicOut)
        .attr("y", function() { const d = d3.select(this).datum(); return y(d.per_10k); })
        .attr("height", function() { const d = d3.select(this).datum(); return h - y(d.per_10k); });
    });

  } catch (err) {
    console.error("Heat chart error:", err);
  }
})();
