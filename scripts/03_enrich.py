"""
03_enrich.py — Join Census data and aggregate per-MODZCTA.

Memory strategy: stream one cleaned chunk at a time.
- Lookup tables (income, MODZCTA map) are tiny (~1 MB) and loaded once.
- Per-chunk: map ZIP → MODZCTA, attach income/population, write enriched chunk.
- Running accumulators (lists of resolution_hours per MODZCTA) held in memory:
  ~3M floats × 8 bytes = 24 MB — well within limits.
- Final aggregation computed from accumulators; saved as zip_stats.csv.

Input:  data/processed/parts/*_cleaned.parquet
        appendix/income.csv, appendix/population.csv, appendix/shapefile.csv
Output: data/processed/parts/*_enriched.parquet  (per-chunk, with modzcta + income)
        data/processed/zip_stats.csv              (MODZCTA-level summary)
        data/processed/category_accumulators.json (for 04_analyze.py)
"""

import glob
import json
import logging
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

ROOT          = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLEANED_DIR   = os.path.join(ROOT, "data", "processed", "parts")
INCOME_PATH   = os.path.join(ROOT, "appendix", "income.csv")
POP_PATH      = os.path.join(ROOT, "appendix", "population.csv")
SHAPEFILE_PATH= os.path.join(ROOT, "appendix", "shapefile.csv")
ZIP_STATS_OUT = os.path.join(ROOT, "data", "processed", "zip_stats.csv")
LOG_PATH      = os.path.join(ROOT, "logs", "03_enrich.log")
MIN_COMPLAINTS= 10

os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


def parse_acs_wide(path, col):
    df = pd.read_csv(path)
    est = [c for c in df.columns if "!!Estimate" in c]
    row = df[est].iloc[0]
    result = pd.DataFrame({
        "zcta": [c.split(" ")[1].replace("!!Estimate", "") for c in est],
        col:    row.values,
    })
    result[col] = (
        result[col].astype(str)
        .str.replace(",", "", regex=False)
        .str.replace("+", "", regex=False)
        .str.strip()
    )
    result[col] = pd.to_numeric(result[col], errors="coerce")
    return result


def build_zip_modzcta(shapefile_path):
    df = pd.read_csv(shapefile_path)
    df["zcta_list"] = df["ZCTA"].str.split(", ")
    df2 = df.explode("zcta_list").copy()
    df2["zcta"] = df2["zcta_list"].str.strip()
    return df2.set_index("zcta")["MODZCTA"].to_dict()


def main():
    # ── Load lookups (small, fit in memory) ──────────────────────────────
    log.info("Loading Census and MODZCTA lookup tables")
    income = parse_acs_wide(INCOME_PATH, "median_income")
    pop    = parse_acs_wide(POP_PATH,    "population")
    census = income.merge(pop, on="zcta")
    census["modzcta"] = pd.to_numeric(census["zcta"], errors="coerce").astype("Int64")
    income_map = census.set_index("modzcta")["median_income"].to_dict()
    pop_map    = census.set_index("modzcta")["population"].to_dict()

    zip_to_mod = build_zip_modzcta(SHAPEFILE_PATH)
    log.info("ZIP→MODZCTA lookup: %d entries", len(zip_to_mod))

    # ── Streaming accumulators ────────────────────────────────────────────
    mod_hours = defaultdict(list)                        # modzcta → [hours]
    mod_cat   = defaultdict(lambda: defaultdict(list))   # modzcta → cat → [hours]

    files = sorted(glob.glob(os.path.join(CLEANED_DIR, "*_cleaned.parquet")))
    if not files:
        log.error("No cleaned parquets in %s. Run 02_clean.py first.", CLEANED_DIR)
        sys.exit(1)

    log.info("Streaming enrichment across %d chunks", len(files))

    for i, path in enumerate(files, 1):
        out_path = path.replace("_cleaned.parquet", "_enriched.parquet")

        if os.path.exists(out_path):
            # Accumulate from already-enriched file
            df = pd.read_parquet(out_path, columns=[
                "modzcta", "resolution_hours", "complaint_category"
            ])
            df["modzcta"] = pd.to_numeric(df["modzcta"], errors="coerce")
            valid = df[df["modzcta"].notna()]
            for row in valid.itertuples(index=False):
                m = int(row.modzcta)
                mod_hours[m].append(float(row.resolution_hours))
                mod_cat[m][str(row.complaint_category)].append(float(row.resolution_hours))
            log.info("  [%d/%d] already enriched — accumulated %d rows", i, len(files), len(valid))
            del df
            continue

        df = pd.read_parquet(path)

        df["modzcta"] = df["zip"].map(zip_to_mod)
        df["modzcta"] = pd.to_numeric(df["modzcta"], errors="coerce").astype("Int64")
        df["median_income"] = df["modzcta"].map(income_map)
        df["population"]    = df["modzcta"].map(pop_map)

        matched   = df["modzcta"].notna().sum()
        unmatched = df["modzcta"].isna().sum()

        valid = df[df["modzcta"].notna()]
        for row in valid.itertuples(index=False):
            m = int(row.modzcta)
            mod_hours[m].append(float(row.resolution_hours))
            mod_cat[m][str(row.complaint_category)].append(float(row.resolution_hours))

        df.to_parquet(out_path, index=False, compression="snappy")
        log.info("  [%d/%d] %-35s  rows=%d  matched=%d  unmatched=%d",
                 i, len(files), os.path.basename(path), len(df), matched, unmatched)
        del df

    # ── Aggregate ─────────────────────────────────────────────────────────
    log.info("Computing per-MODZCTA aggregates (%d MODZCTAs seen)", len(mod_hours))

    rows = []
    for m, hours in mod_hours.items():
        if len(hours) < MIN_COMPLAINTS:
            continue
        h = np.array(hours, dtype=np.float64)
        rows.append({
            "modzcta":                  m,
            "total_complaints":         len(h),
            "median_resolution_hours":  round(float(np.median(h)), 3),
            "mean_resolution_hours":    round(float(np.mean(h)), 3),
            "pct_resolved_24h":         round(float((h <= 24).mean() * 100), 1),
            "pct_resolved_7d":          round(float((h <= 168).mean() * 100), 1),
            "pct_pending_30d":          round(float((h > 720).mean() * 100), 1),
            "median_income":            income_map.get(m),
            "population":               pop_map.get(m),
        })

    zip_stats = pd.DataFrame(rows)
    zip_stats["income_quartile"] = pd.qcut(
        zip_stats["median_income"], q=4,
        labels=["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"],
        duplicates="drop",
    )
    zip_stats.to_csv(ZIP_STATS_OUT, index=False)
    log.info("Saved zip_stats → %s  (%d MODZCTAs)", ZIP_STATS_OUT, len(zip_stats))

    r = zip_stats["median_income"].corr(zip_stats["median_resolution_hours"])
    log.info("Pearson r (income vs. median resolution hours): %.4f", r)
    log.info("Quartile distribution:\n%s",
             zip_stats["income_quartile"].value_counts().sort_index().to_string())

    # ── Category accumulators → summary JSON for 04_analyze.py ───────────
    quartile_lookup = zip_stats.set_index("modzcta")["income_quartile"].to_dict()
    cat_quartile = defaultdict(lambda: defaultdict(list))
    for m, cats in mod_cat.items():
        q = str(quartile_lookup.get(m, ""))
        if not q or q == "nan":
            continue
        for cat, hrs in cats.items():
            cat_quartile[cat][q].extend(hrs)

    cat_summary = {}
    for cat, qs in cat_quartile.items():
        cat_summary[cat] = {}
        for q, hrs in qs.items():
            h = np.array(hrs, dtype=np.float64)
            cat_summary[cat][q] = {
                "median": round(float(np.median(h)), 3),
                "mean":   round(float(np.mean(h)), 3),
                "count":  int(len(h)),
            }

    cat_path = os.path.join(ROOT, "data", "processed", "category_accumulators.json")
    with open(cat_path, "w") as f:
        json.dump(cat_summary, f, indent=2)
    log.info("Saved category accumulators → %s", cat_path)
    log.info("=== 03_enrich.py complete ===")


if __name__ == "__main__":
    main()
