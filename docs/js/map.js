/**
 * map.js — Choropleth map colored by median resolution time.
 * Bold borough boundaries. Rich hover tooltips with top 5 complaint types.
 * Includes ZIP search for "Find Your Neighborhood" engagement.
 */
(async function initMap() {
  try {
    const [geo, boroughs, topComplaints] = await Promise.all([
      d3.json("public/data/zip_map.geojson"),
      d3.json("public/data/borough_boundaries.geojson"),
      d3.json("public/data/zip_top_complaints.json"),
    ]);

    const el = document.getElementById("map-svg");
    if (!el) return;

    const W = el.clientWidth || 960;
    const H = 600;

    const svg = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("font-family", "'Source Sans 3', sans-serif");

    const projection = d3.geoMercator().fitSize([W - 20, H - 20], geo);
    const pathGen = d3.geoPath().projection(projection);
    const features = geo.features;

    /* ── Color scale: median resolution hours ── */
    const resVals = features
      .map(d => d.properties.median_resolution_hours)
      .filter(v => v != null && !isNaN(v))
      .sort(d3.ascending);
    const p5 = d3.quantile(resVals, 0.05);
    const p95 = d3.quantile(resVals, 0.95);
    const colorScale = d3.scaleLinear()
      .domain([p5, p95])
      .range([0, 1])
      .clamp(true);

    function getColor(d) {
      const v = d.properties.median_resolution_hours;
      if (v == null || isNaN(v)) return "#f0ede8";
      return d3.interpolateOrRd(colorScale(v));
    }

    /* ── Build tooltip HTML ── */
    function tipHTML(d) {
      const p = d.properties;
      const top5 = topComplaints[String(p.modzcta)];
      let html = `<strong>ZIP ${p.modzcta}</strong>`;
      if (p.borough) html += ` · ${p.borough}`;
      html += `<br>`;
      html += `<span style="color:#888">${p.income_quartile || "N/A"}</span><br>`;
      html += `Income: <strong>$${p.median_income ? (p.median_income / 1000).toFixed(0) + "k" : "N/A"}</strong><br>`;
      html += `Population: ${p.population ? p.population.toLocaleString() : "N/A"}<br>`;
      html += `<hr style="margin:4px 0;border:none;border-top:1px solid #eee">`;
      html += `Complaints: <strong>${p.total_complaints ? p.total_complaints.toLocaleString() : "N/A"}</strong>`;
      if (p.complaints_per_10k != null) html += ` (${p.complaints_per_10k} per 10k)`;
      html += `<br>`;
      html += `Median resolution: <strong style="color:#c72929">${p.median_resolution_hours != null ? p.median_resolution_hours.toFixed(1) + " hrs" : "N/A"}</strong><br>`;
      html += `Resolved within 24h: ${p.pct_resolved_24h != null ? p.pct_resolved_24h + "%" : "N/A"}<br>`;
      if (top5 && top5.length) {
        html += `<hr style="margin:4px 0;border:none;border-top:1px solid #eee">`;
        html += `<span style="font-size:.85em;color:#888">Top complaints:</span><br>`;
        top5.forEach((c, i) => {
          html += `<span style="${i === 0 ? "font-weight:700" : ""}">${c.type}: ${c.pct}%</span><br>`;
        });
      }
      return html;
    }

    /* ── Draw ZIP paths ── */
    const paths = svg.selectAll("path.zip")
      .data(features)
      .enter().append("path")
      .attr("class", "zip")
      .attr("d", pathGen)
      .attr("stroke", "#ccc")
      .attr("stroke-width", 0.5)
      .attr("fill", d => getColor(d))
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        d3.select(this).attr("stroke", "#333").attr("stroke-width", 1.5);
        showTip(event, tipHTML(d));
      })
      .on("mousemove", moveTip)
      .on("mouseout", function() {
        d3.select(this).attr("stroke", "#ccc").attr("stroke-width", 0.5);
        hideTip();
      });

    /* ── Draw bold borough boundaries ── */
    svg.selectAll("path.borough")
      .data(boroughs.features)
      .enter().append("path")
      .attr("class", "borough")
      .attr("d", pathGen)
      .attr("fill", "none")
      .attr("stroke", "#555")
      .attr("stroke-width", 1.2)
      .style("pointer-events", "none");

    /* ── Legend ── */
    const legendEl = document.getElementById("map-legend");
    if (legendEl) {
      const steps = 10;
      const stops = [];
      for (let i = 0; i <= steps; i++) stops.push(d3.interpolateOrRd(i / steps));
      legendEl.innerHTML =
        `<span>Faster (${p5.toFixed(1)}h)</span>` +
        `<div class="map-legend-bar" style="background: linear-gradient(to right, ${stops.join(", ")})"></div>` +
        `<span>Slower (${p95.toFixed(1)}h+)</span>`;
    }

    /* ── ZIP search ("Find Your Neighborhood") ── */
    const searchInput = document.getElementById("zip-search");
    const resultDiv = document.getElementById("zip-result");
    let highlighted = null;

    function clearHighlight() {
      if (highlighted) {
        highlighted.attr("stroke", "#ccc").attr("stroke-width", 0.5);
        highlighted = null;
      }
    }

    function highlightZip(modzcta) {
      clearHighlight();
      const match = features.find(f => String(f.properties.modzcta) === String(modzcta));
      if (!match) {
        if (resultDiv) resultDiv.innerHTML = `<span style="color:#c72929">ZIP code not found in NYC data.</span>`;
        return;
      }
      /* Highlight on map */
      paths.each(function(d) {
        if (d === match) {
          highlighted = d3.select(this);
          highlighted.attr("stroke", "#c72929").attr("stroke-width", 3).raise();
          /* Re-raise borough borders above */
          svg.selectAll("path.borough").raise();
        }
      });

      /* Show result card */
      if (resultDiv) resultDiv.innerHTML = tipHTML(match);
    }

    if (searchInput) {
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") highlightZip(searchInput.value.trim());
      });
      const searchBtn = document.getElementById("zip-search-btn");
      if (searchBtn) searchBtn.addEventListener("click", () => highlightZip(searchInput.value.trim()));
    }

    /* ── Scroll-triggered entrance ── */
    onReveal(document.getElementById("map-container"), () => {
      paths.attr("fill-opacity", 0)
        .transition().duration(800).ease(d3.easeCubicOut)
        .attr("fill-opacity", 1);
    });

  } catch (err) {
    console.error("Map error:", err);
  }
})();
