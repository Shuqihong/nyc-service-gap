"""
05_export.py — Convert analysis outputs to web-ready files.

Reads the WKT geometry from appendix/shapefile.csv, merges per-MODZCTA
stats into GeoJSON properties, and copies/transforms all analysis JSONs
into website/public/data/ for direct consumption by D3.js.

Inputs:
  appendix/shapefile.csv
  data/processed/zip_stats.csv
  data/analysis/section1_spotlight.json
  data/analysis/section2_citywide.json
  data/analysis/section3_categories.json

Outputs (all in website/public/data/):
  zip_map.geojson      — MODZCTA boundaries with stats in properties
  section1.json        — spotlight pair (pass-through)
  section2.json        — citywide data (pass-through)
  section3.json        — category data (pass-through)
"""

import json
import logging
import os
import sys

import pandas as pd
from shapely import wkt as shapely_wkt

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHAPEFILE_PATH  = os.path.join(ROOT, "appendix", "shapefile.csv")
ZIP_STATS_PATH  = os.path.join(ROOT, "data", "processed", "zip_stats.csv")
ANALYSIS_DIR    = os.path.join(ROOT, "data", "analysis")
OUT_DIR         = os.path.join(ROOT, "website", "public", "data")
LOG_PATH        = os.path.join(ROOT, "logs", "05_export.log")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


def save_json(obj, filename, minify=False):
    path = os.path.join(OUT_DIR, filename)
    with open(path, "w") as f:
        if minify:
            json.dump(obj, f, separators=(",", ":"), default=str)
        else:
            json.dump(obj, f, indent=2, default=str)
    size_kb = os.path.getsize(path) / 1024
    log.info("Saved → %s  (%.1f KB)", path, size_kb)


def main():
    # ------------------------------------------------------------------
    # Load zip_stats — keyed by modzcta
    # ------------------------------------------------------------------
    zip_stats = pd.read_csv(ZIP_STATS_PATH)
    # Build a dict: modzcta (int) → property dict
    stats_dict = {}
    for _, row in zip_stats.iterrows():
        m = int(row["modzcta"])
        stats_dict[m] = {
            "total_complaints":         int(row["total_complaints"]),
            "median_resolution_hours":  round(float(row["median_resolution_hours"]), 3),
            "mean_resolution_hours":    round(float(row["mean_resolution_hours"]), 3),
            "pct_resolved_24h":         round(float(row["pct_resolved_24h"]), 1),
            "pct_resolved_7d":          round(float(row["pct_resolved_7d"]), 1),
            "pct_pending_30d":          round(float(row["pct_pending_30d"]), 1),
            "median_income":            int(row["median_income"]) if pd.notna(row["median_income"]) else None,
            "population":               int(row["population"]) if pd.notna(row["population"]) else None,
            "income_quartile":          str(row["income_quartile"]) if pd.notna(row["income_quartile"]) else None,
        }
    log.info("Loaded stats for %d MODZCTAs", len(stats_dict))

    # ------------------------------------------------------------------
    # Build GeoJSON from shapefile WKT
    # ------------------------------------------------------------------
    log.info("Loading shapefile from %s", SHAPEFILE_PATH)
    df_shp = pd.read_csv(SHAPEFILE_PATH)
    log.info("Shapefile rows: %d", len(df_shp))

    features = []
    matched = 0
    unmatched = []

    for _, row in df_shp.iterrows():
        modzcta = int(row["MODZCTA"])

        # Parse WKT geometry
        try:
            geom = shapely_wkt.loads(row["the_geom"])
            geom_json = geom.__geo_interface__
        except Exception as e:
            log.warning("Failed to parse geometry for MODZCTA %s: %s", modzcta, e)
            continue

        # Build properties
        props = {
            "modzcta": modzcta,
            "label":   str(row["label"]),
            "zcta":    str(row["ZCTA"]),
        }

        if modzcta in stats_dict:
            props.update(stats_dict[modzcta])
            matched += 1
        else:
            # MODZCTA has geometry but no 311 data (too few complaints or none)
            props["total_complaints"] = 0
            unmatched.append(modzcta)

        features.append({
            "type":       "Feature",
            "geometry":   geom_json,
            "properties": props,
        })

    geojson = {"type": "FeatureCollection", "features": features}
    log.info("GeoJSON features: %d  (matched with stats: %d, no stats: %d)",
             len(features), matched, len(unmatched))
    if unmatched:
        log.info("MODZCTAs with geometry but no stats: %s", unmatched)

    # Save GeoJSON — minified since it can be large
    save_json(geojson, "zip_map.geojson", minify=True)

    # ------------------------------------------------------------------
    # Pass-through analysis JSONs to web output directory
    # ------------------------------------------------------------------
    for src_name, dst_name in [
        ("section1_spotlight.json", "section1.json"),
        ("section2_citywide.json",  "section2.json"),
        ("section3_categories.json","section3.json"),
    ]:
        src_path = os.path.join(ANALYSIS_DIR, src_name)
        with open(src_path) as f:
            data = json.load(f)
        save_json(data, dst_name)

    log.info("=== 05_export.py complete ===")
    log.info("Web data directory: %s", OUT_DIR)
    log.info("Files written: %s", sorted(os.listdir(OUT_DIR)))


if __name__ == "__main__":
    main()
