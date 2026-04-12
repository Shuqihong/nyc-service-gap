"""
04_analyze.py — Produce all story-specific data slices for the website.

Memory strategy: stream enriched chunks for spotlight/borough analysis;
use pre-computed category_accumulators.json for Section 3.

Outputs (all in data/analysis/):
  section1_spotlight.json  — Two contrasting real complaints for the opening story
  section2_citywide.json   — Per-MODZCTA data for choropleth + scatter + borough bars
  section3_categories.json — Median resolution by complaint category × income quartile

Inputs:
  data/processed/parts/*_enriched.parquet
  data/processed/zip_stats.csv
  data/processed/category_accumulators.json
"""

import glob
import json
import logging
import os
import sys

import pandas as pd
from scipy import stats as scipy_stats

ROOT          = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENRICHED_DIR  = os.path.join(ROOT, "data", "processed", "parts")
ZIP_STATS_PATH= os.path.join(ROOT, "data", "processed", "zip_stats.csv")
CAT_ACC_PATH  = os.path.join(ROOT, "data", "processed", "category_accumulators.json")
OUT_DIR       = os.path.join(ROOT, "data", "analysis")
LOG_PATH      = os.path.join(ROOT, "logs", "04_analyze.log")

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


def save_json(obj, filename):
    path = os.path.join(OUT_DIR, filename)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, default=str)
    log.info("Saved → %s", path)


# ── Section 1: Spotlight pair ─────────────────────────────────────────────────
def find_spotlight_pair(enriched_files, zip_stats):
    log.info("--- Section 1: Finding spotlight pair (streaming) ---")

    quartile_lookup = zip_stats.set_index("modzcta")["income_quartile"].to_dict()

    COLS = [
        "unique_key", "created_date", "closed_date", "resolution_hours",
        "complaint_type", "descriptor", "incident_address", "borough",
        "zip", "modzcta", "agency", "agency_name", "status",
        "resolution_description", "is_winter_2024", "latitude", "longitude",
    ]

    best_gap   = -1
    best_q4_row = None
    best_q1_row = None

    for i, path in enumerate(enriched_files, 1):
        # Read only needed columns; avoid loading entire chunk
        available = pd.read_parquet(path, columns=["complaint_type"]).columns  # just to get schema
        load_cols = [c for c in COLS if c in pd.read_parquet(path, columns=COLS[:1]).columns or True]
        try:
            df = pd.read_parquet(path, columns=COLS)
        except Exception:
            df = pd.read_parquet(path)
            df = df[[c for c in COLS if c in df.columns]]

        # Filter to HEAT/HOT WATER winter 2024
        heat = df[
            (df["complaint_type"] == "HEAT/HOT WATER") &
            (df.get("is_winter_2024", pd.Series(False, index=df.index)) == True) &
            (df["modzcta"].notna()) &
            (df["resolution_hours"] < 720)    # cap at 30 days for a credible story pair
        ].copy()

        if len(heat) == 0:
            del df
            continue

        heat["modzcta"] = pd.to_numeric(heat["modzcta"], errors="coerce")
        heat["income_quartile"] = heat["modzcta"].map(quartile_lookup)
        heat["date"] = pd.to_datetime(heat["created_date"], errors="coerce", utc=True).dt.date

        q4 = heat[heat["income_quartile"] == "Q4 (highest)"]
        q1 = heat[heat["income_quartile"] == "Q1 (lowest)"]

        q1_by_date = {d: grp for d, grp in q1.groupby("date")}

        for _, row_q4 in q4.iterrows():
            d = row_q4["date"]
            if d not in q1_by_date:
                continue
            q1_on_day = q1_by_date[d].copy()
            q1_on_day["gap"] = abs(q1_on_day["resolution_hours"] - row_q4["resolution_hours"])
            max_row = q1_on_day.loc[q1_on_day["gap"].idxmax()]
            gap = float(max_row["gap"])
            if gap > best_gap:
                best_gap    = gap
                best_q4_row = row_q4
                best_q1_row = max_row

        log.info("  [%d/%d] chunk processed — current best gap=%.1fh", i, len(enriched_files), best_gap)
        del df, heat

    if best_q4_row is None:
        log.warning("No spotlight pair found.")
        return {}

    def row_to_dict(row):
        return {c: row.get(c) if hasattr(row, "get") else getattr(row, c, None)
                for c in COLS if c != "is_winter_2024"}

    result = {
        "high_income_complaint": row_to_dict(best_q4_row),
        "low_income_complaint":  row_to_dict(best_q1_row),
        "gap_hours":             round(best_gap, 2),
        "note": "Maximum resolution-time gap among all same-day Q4/Q1 HEAT/HOT WATER pairs in winter 2024.",
    }
    save_json(result, "section1_spotlight.json")
    log.info("Spotlight: Q4 ZIP=%s (%.1fh) vs Q1 ZIP=%s (%.1fh) — gap=%.1fh",
             best_q4_row.get("zip"), float(best_q4_row.get("resolution_hours", 0)),
             best_q1_row.get("zip"), float(best_q1_row.get("resolution_hours", 0)),
             best_gap)
    return result


# ── Section 2: Citywide choropleth + scatter data ─────────────────────────────
def build_citywide_data(zip_stats):
    log.info("--- Section 2: Building citywide data ---")
    valid = zip_stats[zip_stats["median_income"].notna() & zip_stats["median_resolution_hours"].notna()].copy()

    r, p = scipy_stats.pearsonr(valid["median_income"], valid["median_resolution_hours"])
    slope, intercept, _, _, stderr = scipy_stats.linregress(
        valid["median_income"], valid["median_resolution_hours"]
    )
    log.info("Pearson r=%.4f  p=%.6f  slope=%.8f  intercept=%.4f", r, p, slope, intercept)

    valid["z_score"] = valid.groupby("income_quartile")["median_resolution_hours"].transform(
        lambda x: (x - x.mean()) / x.std()
    )
    valid["is_outlier"] = valid["z_score"].abs() > 2
    log.info("Outlier MODZCTAs: %d", valid["is_outlier"].sum())

    records = []
    for _, row in valid.iterrows():
        records.append({
            "modzcta":                  int(row["modzcta"]),
            "total_complaints":         int(row["total_complaints"]),
            "median_resolution_hours":  round(float(row["median_resolution_hours"]), 3),
            "mean_resolution_hours":    round(float(row["mean_resolution_hours"]), 3),
            "pct_resolved_24h":         round(float(row["pct_resolved_24h"]), 1),
            "pct_resolved_7d":          round(float(row["pct_resolved_7d"]), 1),
            "pct_pending_30d":          round(float(row["pct_pending_30d"]), 1),
            "median_income":            int(row["median_income"]) if pd.notna(row["median_income"]) else None,
            "population":               int(row["population"])    if pd.notna(row["population"])    else None,
            "income_quartile":          str(row["income_quartile"]),
            "is_outlier":               bool(row["is_outlier"]),
            "z_score":                  round(float(row["z_score"]), 3) if pd.notna(row["z_score"]) else None,
        })

    quartile_ranges = (
        valid.groupby("income_quartile")["median_income"]
        .agg(["min","max"]).round(0).astype(int).reset_index()
        .rename(columns={"min":"income_min","max":"income_max"})
        .to_dict(orient="records")
    )

    outlier_list = [r for r in records if r["is_outlier"]]
    for o in outlier_list:
        log.info("  Outlier MODZCTA %s | q=%s | res=%.1fh | inc=%s | z=%.2f",
                 o["modzcta"], o["income_quartile"], o["median_resolution_hours"],
                 o["median_income"], o["z_score"] or 0)

    result = {
        "modzcta_data":    records,
        "correlation": {
            "pearson_r":       round(float(r), 4),
            "p_value":         round(float(p), 6),
            "slope":           round(float(slope), 8),
            "intercept":       round(float(intercept), 4),
            "stderr":          round(float(stderr), 8),
            "n":               int(len(valid)),
            "interpretation":  (
                "Negative r = lower-income MODZCTAs wait longer on average. "
                f"r={r:.4f}, p={p:.6f} (n={len(valid)} neighbourhoods, full 2024 dataset)."
            ),
        },
        "quartile_ranges": quartile_ranges,
        "outliers":        outlier_list,
    }
    save_json(result, "section2_citywide.json")
    return result


# ── Section 3: Category × quartile (from pre-computed accumulators) ───────────
def build_category_data(cat_acc_path):
    log.info("--- Section 3: Building category data from accumulators ---")
    with open(cat_acc_path) as f:
        cat_summary = json.load(f)

    quartile_order = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"]
    cat_labels = {
        "health_safety":  "Health & Safety",
        "quality_of_life":"Quality of Life",
        "infrastructure": "Infrastructure",
        "other":          "Other",
    }

    chart_data = []
    for cat in sorted(cat_summary.keys()):
        entry = {"category": cat, "label": cat_labels.get(cat, cat), "quartiles": {}}
        for q in quartile_order:
            entry["quartiles"][q] = cat_summary[cat].get(q)
        q1 = entry["quartiles"].get("Q1 (lowest)")
        q4 = entry["quartiles"].get("Q4 (highest)")
        entry["q1_q4_gap_hours"] = (
            round(q1["median"] - q4["median"], 3) if q1 and q4 else None
        )
        chart_data.append(entry)

    log.info("Category × quartile breakdown:")
    for e in chart_data:
        log.info("  %-20s  Q1 median=%.1fh  Q4 median=%.1fh  gap=%.1fh",
                 e["category"],
                 e["quartiles"].get("Q1 (lowest)", {}).get("median", 0) or 0,
                 e["quartiles"].get("Q4 (highest)", {}).get("median", 0) or 0,
                 e.get("q1_q4_gap_hours") or 0)

    result = {
        "chart_data":     chart_data,
        "quartile_order": quartile_order,
        "note": "q1_q4_gap_hours: positive = Q1 (lowest income) takes longer than Q4.",
    }
    save_json(result, "section3_categories.json")
    return result


# ── Borough summary (streaming) ───────────────────────────────────────────────
def build_borough_summary(enriched_files):
    log.info("--- Borough summary (streaming) ---")
    from collections import defaultdict
    import numpy as np

    bor_hours = defaultdict(list)
    VALID = {"MANHATTAN", "BROOKLYN", "QUEENS", "BRONX", "STATEN ISLAND"}

    for path in enriched_files:
        df = pd.read_parquet(path, columns=["borough", "resolution_hours"])
        for row in df.itertuples(index=False):
            if str(row.borough) in VALID:
                bor_hours[row.borough].append(float(row.resolution_hours))
        del df

    rows = []
    for b, hrs in sorted(bor_hours.items()):
        h = np.array(hrs)
        rows.append({
            "borough":               b,
            "total_complaints":      int(len(h)),
            "median_resolution_hours": round(float(np.median(h)), 3),
            "mean_resolution_hours":   round(float(np.mean(h)), 3),
            "pct_resolved_24h":        round(float((h <= 24).mean() * 100), 1),
        })
    rows.sort(key=lambda x: x["pct_resolved_24h"], reverse=True)
    log.info("Borough summary:\n%s",
             "\n".join(f"  {r['borough']}: {r['pct_resolved_24h']}% in 24h" for r in rows))
    return rows


def main():
    log.info("Loading zip_stats from %s", ZIP_STATS_PATH)
    zip_stats = pd.read_csv(ZIP_STATS_PATH)
    log.info("MODZCTAs: %d", len(zip_stats))

    enriched_files = sorted(glob.glob(os.path.join(ENRICHED_DIR, "*_enriched.parquet")))
    log.info("Enriched chunk files: %d", len(enriched_files))

    # Section 1 — spotlight pair (streams chunks)
    find_spotlight_pair(enriched_files, zip_stats)

    # Section 2 — citywide (from zip_stats only, no streaming needed)
    citywide = build_citywide_data(zip_stats)

    # Section 3 — category breakdown (from pre-computed accumulators)
    build_category_data(CAT_ACC_PATH)

    # Borough summary (streams chunks) — append into section2 JSON
    borough_summary = build_borough_summary(enriched_files)
    s2_path = os.path.join(OUT_DIR, "section2_citywide.json")
    with open(s2_path) as f:
        s2 = json.load(f)
    s2["borough_summary"] = borough_summary
    with open(s2_path, "w") as f:
        json.dump(s2, f, indent=2, default=str)
    log.info("Updated section2_citywide.json with borough summary.")

    log.info("=== 04_analyze.py complete ===")


if __name__ == "__main__":
    main()
