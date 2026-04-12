/**
 * section1.js — Opening story: timeline graphic comparing two complaints.
 * Scroll-triggered: bars animate from zero width when the chart enters viewport.
 */
(async function initSection1() {
  try {
    const s1 = await d3.json("public/data/section1.json");
    const hi = s1.high_income_complaint;
    const lo = s1.low_income_complaint;

    const el = document.getElementById("opening-timeline");
    if (!el) return;

    const W = el.clientWidth || 860;
    const compact = W < 680;
    const H = compact ? 420 : 340;

    const svg = d3.select("#opening-timeline")
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%");

    const hiCreated = new Date(hi.created_date);
    const hiClosed  = new Date(hi.closed_date);
    const loCreated = new Date(lo.created_date);
    const loClosed  = new Date(lo.closed_date);

    function fmtTime(d) {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).toLowerCase();
    }
    function fmtDateShort(d) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    }

    const margin = { left: compact ? 14 : 24, right: compact ? 14 : 24, top: compact ? 64 : 50, bottom: 30 };
    const innerW = W - margin.left - margin.right;
    const rowH = compact ? 66 : 60;
    const rowGap = compact ? 64 : 50;
    const labelW = compact ? 122 : 200;
    const barLeft = labelW + 14;
    const barW = innerW - barLeft;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const storyDate = hiCreated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
    g.append("text").attr("x", innerW / 2).attr("y", compact ? -28 : -20)
      .attr("text-anchor", "middle").attr("font-family", "Newsreader, Georgia, serif")
      .attr("font-size", compact ? "13px" : "15px").attr("fill", "#444")
      .text(`${storyDate} — Same complaint, same agency`);

    const earliest = new Date(Math.min(loCreated, hiCreated));
    const latest = loClosed;
    const xScale = d3.scaleTime().domain([earliest, latest]).range([barLeft, barLeft + barW]);

    function drawRow(yCenter, created, closed, label, sub, color, resText) {
      const y = yCenter;
      const barY = y - 10;
      const barH = 20;
      const minVisibleBarPx = compact ? 10 : 12;

      g.append("text").attr("x", 0).attr("y", y - 8)
        .attr("font-size", compact ? "12px" : "13px").attr("font-weight", "700").attr("fill", color)
        .attr("font-family", "Source Sans 3, sans-serif").text(label);
      g.append("text").attr("x", 0).attr("y", y + 10)
        .attr("font-size", compact ? "10px" : "11px").attr("fill", "#888")
        .attr("font-family", "Source Sans 3, sans-serif").text(sub);

      /* Track */
      g.append("rect").attr("x", barLeft).attr("y", barY)
        .attr("width", barW).attr("height", barH).attr("rx", 4).attr("fill", "#f0ede8");

      /* Active bar — starts at 0 width, animated later */
      const x1 = xScale(created);
      const x2 = xScale(closed);
      const displayX2 = Math.min(Math.max(x2, x1 + minVisibleBarPx), barLeft + barW - 5);
      const activeBar = g.append("rect").attr("x", x1).attr("y", barY)
        .attr("width", 0).attr("height", barH).attr("rx", 4)
        .attr("fill", color).attr("fill-opacity", 0.8);

      /* Filed marker */
      g.append("circle").attr("cx", x1).attr("cy", y).attr("r", 4)
        .attr("fill", "#fff").attr("stroke", color).attr("stroke-width", 2);
      g.append("text").attr("x", x1).attr("y", barY - 8).attr("text-anchor", "middle")
        .attr("font-size", "10px").attr("fill", "#666")
        .text("Filed " + fmtTime(created));

      /* Closed marker (hidden until animated) */
      const closedX = displayX2;
      const closedDot = g.append("circle").attr("cx", closedX).attr("cy", y).attr("r", 4)
        .attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 2).style("opacity", 0);

      /* Resolution label */
      const anchorSide = closedX > barLeft + barW * 0.85 ? "end" : "start";
      const lx = anchorSide === "end" ? closedX - 8 : closedX + 8;
      const resLabel = g.append("text").attr("x", lx).attr("y", y + barH + 16)
        .attr("text-anchor", anchorSide)
        .attr("font-size", compact ? "10.5px" : "11.5px").attr("font-weight", "700").attr("fill", color)
        .text(resText).style("opacity", 0);

      return { activeBar, closedDot, resLabel, targetWidth: Math.max(displayX2 - x1, 4), closedX };
    }

    const row1Y = 40;
    const hiRow = drawRow(row1Y, hiCreated, hiClosed,
      compact ? "Queens (Q4)" : "Cambria Heights, Queens",
      compact ? `ZIP ${hi.zip} · $147k` : `ZIP ${hi.zip} · Median income: $147,000 (Q4)`,
      "#1a9850", `Resolved at ${fmtTime(hiClosed)} — 2.3 hours`);

    const row2Y = row1Y + rowH + rowGap;
    const loRow = drawRow(row2Y, loCreated, loClosed,
      compact ? "Bronx (Q1)" : "Soundview, Bronx",
      compact ? `ZIP ${lo.zip} · $38k` : `ZIP ${lo.zip} · Median income: $38,000 (Q1)`,
      "#c72929", `Resolved ${fmtDateShort(loClosed)} — 17 days`);

    /* Gap annotation (hidden until animated) */
    const gapY = row2Y + rowH + (compact ? 42 : 30);
    const midX = (hiRow.closedX + loRow.closedX) / 2;

    const gapLine1 = g.append("line").attr("x1", hiRow.closedX).attr("y1", row1Y + 4)
      .attr("x2", hiRow.closedX).attr("y2", gapY - 30)
      .attr("stroke", "#ccc").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").style("opacity", 0);
    const gapLine2 = g.append("line").attr("x1", loRow.closedX).attr("y1", row2Y + 4)
      .attr("x2", loRow.closedX).attr("y2", gapY - 30)
      .attr("stroke", "#ccc").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").style("opacity", 0);
    const gapLine3 = g.append("line").attr("x1", hiRow.closedX + 4).attr("y1", gapY - 30)
      .attr("x2", loRow.closedX - 4).attr("y2", gapY - 30)
      .attr("stroke", "#ccc").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").style("opacity", 0);
    const gapLabel = g.append("text").attr("x", midX).attr("y", gapY - 34)
      .attr("text-anchor", "middle")
      .attr("font-size", compact ? "12px" : "13px").attr("font-weight", "700").attr("fill", "#c72929")
      .attr("font-family", "Newsreader, Georgia, serif")
      .text("408 hours apart").style("opacity", 0);

    /* ── Scroll-triggered animation ── */
    onReveal(el, () => {
      /* Queens bar grows fast */
      hiRow.activeBar.transition().duration(600).ease(d3.easeCubicOut)
        .attr("width", hiRow.targetWidth);
      hiRow.closedDot.transition().delay(500).duration(300).style("opacity", 1);
      hiRow.resLabel.transition().delay(600).duration(400).style("opacity", 1);

      /* Bronx bar grows slowly */
      loRow.activeBar.transition().delay(700).duration(1200).ease(d3.easeLinear)
        .attr("width", loRow.targetWidth);
      loRow.closedDot.transition().delay(1800).duration(300).style("opacity", 1);
      loRow.resLabel.transition().delay(1900).duration(400).style("opacity", 1);

      /* Gap annotation appears last */
      gapLine1.transition().delay(2200).duration(400).style("opacity", 1);
      gapLine2.transition().delay(2200).duration(400).style("opacity", 1);
      gapLine3.transition().delay(2400).duration(400).style("opacity", 1);
      gapLabel.transition().delay(2500).duration(500).style("opacity", 1);
    });

  } catch (err) {
    console.error("Section 1 error:", err);
  }
})();
