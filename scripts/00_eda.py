"""
00_eda.py — Exploratory Data Analysis
======================================
Part of the NYC 311 Urban Inequality pipeline.
Run after 03_enrich.py.  See REPORT.md §3 for full findings,
METHODOLOGY.md §10 for design choices, AGENTS.md for agent description.

Questions addressed:
  A1. Complaint rate per 1,000 residents by income quartile
  A2. Zip-level Pearson correlation: income vs resolution time
  A3. Population-weighted resolution time by quartile
  B1. Full percentile distribution (p10–p99) by quartile
  B2. Complaint-type category mix and median by quartile
  B3. Resolution by borough × income quartile
  B4. Within-borough lower vs upper income half comparison
  B5. Agency breakdown: volume, speed, and quartile concentration
  B6. Borough × category × quartile triple interaction
  B7. Monthly resolution patterns by income quartile (seasonal)
  B8. Complaint rate decile vs service speed (civic engagement test)
  B9. Borough summary with population-adjusted metrics

Outputs:
  data/eda/A*_*.csv  — zip_stats-level analyses (no streaming needed)
  data/eda/B*_*.csv  — streaming analyses over 3.2M complaint rows
  logs/00_eda.log    — timestamped run log
"""

import glob
import logging
import os
import sys
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT         = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENRICHED_DIR = os.path.join(ROOT, "data", "processed", "parts")
ZIP_STATS    = os.path.join(ROOT, "data", "processed", "zip_stats.csv")
OUT_DIR      = os.path.join(ROOT, "data", "eda")
LOG_PATH     = os.path.join(ROOT, "logs", "00_eda.log")

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, mode="w"),
              logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────
Q_ORDER   = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"]
BOROUGHS  = ["BRONX", "BROOKLYN", "MANHATTAN", "QUEENS", "STATEN ISLAND"]
PCTS      = [10, 25, 50, 75, 90, 95, 99]
COLS_NEED = ["modzcta", "resolution_hours", "complaint_category",
             "borough", "agency", "created_date"]

# ── Helpers ──────────────────────────────────────────────────────────────────

def percentile_row(arr: np.ndarray, label: str) -> dict:
    """Return a dict of descriptive stats for a 1-D array of hours."""
    if len(arr) == 0:
        return {"group": label, "n": 0}
    return {
        "group"   : label,
        "n"       : len(arr),
        "mean_h"  : round(float(arr.mean()), 2),
        "p10"     : round(float(np.percentile(arr, 10)), 2),
        "p25"     : round(float(np.percentile(arr, 25)), 2),
        "median_h": round(float(np.median(arr)), 2),
        "p75"     : round(float(np.percentile(arr, 75)), 2),
        "p90"     : round(float(np.percentile(arr, 90)), 2),
        "p95"     : round(float(np.percentile(arr, 95)), 2),
        "p99"     : round(float(np.percentile(arr, 99)), 2),
        "pct_1h"  : round(float((arr <= 1).mean()   * 100), 1),
        "pct_4h"  : round(float((arr <= 4).mean()   * 100), 1),
        "pct_24h" : round(float((arr <= 24).mean()  * 100), 1),
        "pct_72h" : round(float((arr <= 72).mean()  * 100), 1),
        "pct_7d"  : round(float((arr <= 168).mean() * 100), 1),
        "pct_30d" : round(float((arr <= 720).mean() * 100), 1),
    }


def save(df: pd.DataFrame, name: str):
    path = os.path.join(OUT_DIR, name)
    df.to_csv(path, index=False)
    log.info(f"  saved  {name}  ({len(df)} rows)")


def print_section(title: str):
    bar = "=" * 70
    log.info(f"\n{bar}\n  {title}\n{bar}")


# ── Load enriched chunks (lazy) ──────────────────────────────────────────────
def iter_chunks():
    files = sorted(glob.glob(os.path.join(ENRICHED_DIR, "*_enriched.parquet")))
    log.info(f"Found {len(files)} enriched parquet chunks")
    for f in files:
        yield pd.read_parquet(f, columns=COLS_NEED)


# ── Part A: zip_stats-only analyses (no streaming needed) ────────────────────

def analysis_zip_stats(zs: pd.DataFrame):
    """
    Sections that only need the 177-row zip_stats table:
      - Per-capita complaint rate vs income
      - Population-weighted service metrics
      - Within-borough income comparison
    """

    # ── A1: Per-capita complaint rate ─────────────────────────────────────
    print_section("A1 · Per-capita complaint rate vs income quartile")

    zs["complaints_per_1k"] = (zs["total_complaints"] / zs["population"] * 1000).round(2)

    rate_by_q = (
        zs.groupby("income_quartile")
          .agg(
              n_zips            = ("modzcta",              "count"),
              total_pop         = ("population",           "sum"),
              total_complaints  = ("total_complaints",     "sum"),
              median_income_q   = ("median_income",        "median"),
              median_rate_per1k = ("complaints_per_1k",    "median"),
              mean_rate_per1k   = ("complaints_per_1k",    "mean"),
          )
          .reindex(Q_ORDER)
          .reset_index()
    )
    rate_by_q["agg_rate_per1k"] = (
        rate_by_q["total_complaints"] / rate_by_q["total_pop"] * 1000
    ).round(2)
    save(rate_by_q, "A1_complaint_rate_by_quartile.csv")
    log.info("\n" + rate_by_q[["income_quartile","n_zips","median_income_q",
                                "median_rate_per1k","agg_rate_per1k"]].to_string(index=False))

    # Pearson correlation: income vs complaint rate
    corr_rate = zs["median_income"].corr(zs["complaints_per_1k"])
    log.info(f"\n  Pearson r (median_income vs complaints_per_1k) = {corr_rate:.3f}")

    # ── A2: Income vs median resolution time (zip level) ──────────────────
    print_section("A2 · Income vs resolution time (zip-level Pearson r)")

    corr_res = zs["median_income"].corr(zs["median_resolution_hours"])
    corr_pct24 = zs["median_income"].corr(zs["pct_resolved_24h"])
    log.info(f"  r(income, median_resolution_hours) = {corr_res:.3f}")
    log.info(f"  r(income, pct_resolved_24h)        = {corr_pct24:.3f}")

    # Resolution metrics table by quartile (from zip_stats)
    res_by_q = (
        zs.groupby("income_quartile")
          .agg(
              n_zips              = ("modzcta",                 "count"),
              median_resolution_h = ("median_resolution_hours", "median"),
              mean_resolution_h   = ("mean_resolution_hours",   "mean"),
              median_pct_24h      = ("pct_resolved_24h",        "median"),
              median_pct_7d       = ("pct_resolved_7d",         "median"),
              median_pct_30d      = ("pct_pending_30d",         "median"),
          )
          .reindex(Q_ORDER)
          .reset_index()
    )
    save(res_by_q, "A2_resolution_by_quartile_zipstats.csv")
    log.info("\n" + res_by_q.to_string(index=False))

    # ── A3: Population-weighted average resolution time by quartile ────────
    print_section("A3 · Population-weighted resolution time by quartile")

    zs["pop_x_res"] = zs["population"] * zs["median_resolution_hours"]
    popw = (
        zs.groupby("income_quartile")
          .agg(
              total_pop      = ("population",  "sum"),
              total_pop_x_res= ("pop_x_res",   "sum"),
          )
          .reindex(Q_ORDER)
          .reset_index()
    )
    popw["popwt_resolution_h"] = (popw["total_pop_x_res"] / popw["total_pop"]).round(2)
    save(popw[["income_quartile","total_pop","popwt_resolution_h"]],
         "A3_popweighted_resolution_by_quartile.csv")
    log.info("\n" + popw[["income_quartile","total_pop","popwt_resolution_h"]].to_string(index=False))

    # ── A4: Within-borough income comparison ──────────────────────────────
    print_section("A4 · Within-borough income comparison (using zip_stats)")

    # We need a borough column — derive it from the streaming data later.
    # Return zs for merging with borough info.
    return zs


# ── Part B: Streaming analyses ────────────────────────────────────────────────

def stream_and_accumulate(zs: pd.DataFrame):
    """
    Single streaming pass over enriched chunks.
    Accumulates resolution hours for every analysis dimension.
    """
    # Build quick-lookup dicts from zip_stats
    q_lookup  = dict(zip(zs["modzcta"], zs["income_quartile"]))
    pop_lookup = dict(zip(zs["modzcta"], zs["population"]))

    # Accumulators (key → list of resolution_hours floats)
    q_hours          = defaultdict(list)          # quartile
    cat_q_hours      = defaultdict(list)          # (category, quartile)
    bor_q_hours      = defaultdict(list)          # (borough, quartile)
    bor_cat_q_hours  = defaultdict(list)          # (borough, category, quartile)
    agency_q_hours   = defaultdict(list)          # (agency, quartile)
    month_q_hours    = defaultdict(list)          # (month_str, quartile)

    # For dominant-borough-per-MODZCTA
    mod_borough = defaultdict(Counter)            # modzcta → Counter(borough)

    total_rows = 0
    for i, chunk in enumerate(iter_chunks(), 1):
        # Drop rows with missing modzcta or unknown borough
        chunk = chunk.dropna(subset=["modzcta", "resolution_hours"])
        chunk = chunk[chunk["borough"].isin(BOROUGHS)]
        chunk["modzcta"] = chunk["modzcta"].astype("Int64")

        # Map quartile
        chunk["quartile"] = chunk["modzcta"].map(q_lookup)
        chunk = chunk.dropna(subset=["quartile"])

        # Month string  (e.g. "2024-03")
        chunk["month"] = chunk["created_date"].dt.to_period("M").astype(str)

        total_rows += len(chunk)

        for row in chunk.itertuples(index=False):
            h   = row.resolution_hours
            q   = row.quartile
            cat = row.complaint_category
            bor = row.borough
            ag  = row.agency
            mo  = row.month
            mod = int(row.modzcta)

            q_hours[q].append(h)
            cat_q_hours[(cat, q)].append(h)
            bor_q_hours[(bor, q)].append(h)
            bor_cat_q_hours[(bor, cat, q)].append(h)
            agency_q_hours[(ag, q)].append(h)
            month_q_hours[(mo, q)].append(h)
            mod_borough[mod][bor] += 1

        if i % 10 == 0:
            log.info(f"  streamed {i} chunks  ({total_rows:,} rows so far)")

    log.info(f"  streaming done — {total_rows:,} total rows")
    return (q_hours, cat_q_hours, bor_q_hours, bor_cat_q_hours,
            agency_q_hours, month_q_hours, mod_borough, total_rows)


# ── Part C: Build output tables from accumulators ────────────────────────────

def build_outputs(zs, q_hours, cat_q_hours, bor_q_hours, bor_cat_q_hours,
                  agency_q_hours, month_q_hours, mod_borough):

    # ── B1: Full resolution-time distribution by quartile ─────────────────
    print_section("B1 · Resolution-time percentile distribution by income quartile")

    rows = []
    for q in Q_ORDER:
        arr = np.array(q_hours[q], dtype=np.float64)
        rows.append(percentile_row(arr, q))
    df_b1 = pd.DataFrame(rows)
    save(df_b1, "B1_resolution_distribution_by_quartile.csv")
    log.info("\n" + df_b1[["group","n","median_h","p90","pct_24h","pct_7d"]].to_string(index=False))

    # Gap statistics
    med_q1 = float(np.median(q_hours["Q1 (lowest)"]))
    med_q4 = float(np.median(q_hours["Q4 (highest)"]))
    p90_q1 = float(np.percentile(q_hours["Q1 (lowest)"], 90))
    p90_q4 = float(np.percentile(q_hours["Q4 (highest)"], 90))
    log.info(f"\n  Median gap Q4−Q1 : {med_q4 - med_q1:+.2f} h  "
             f"({(med_q4/med_q1 - 1)*100:+.1f}%)")
    log.info(f"  P90 gap Q4−Q1   : {p90_q4 - p90_q1:+.2f} h")

    # ── B2: Complaint-type MIX by income quartile ─────────────────────────
    print_section("B2 · Complaint-type mix by income quartile")

    cats = sorted({k[0] for k in cat_q_hours})
    mix_rows = []
    for q in Q_ORDER:
        total_q = sum(len(cat_q_hours[(c, q)]) for c in cats)
        for c in cats:
            n = len(cat_q_hours[(c, q)])
            med = float(np.median(cat_q_hours[(c, q)])) if n else np.nan
            mix_rows.append({
                "quartile"     : q,
                "category"     : c,
                "n_complaints" : n,
                "share_pct"    : round(n / total_q * 100, 1) if total_q else 0,
                "median_h"     : round(med, 2),
            })
    df_b2 = pd.DataFrame(mix_rows)
    save(df_b2, "B2_category_mix_by_quartile.csv")
    # Pivot for readability
    pivot_mix = df_b2.pivot_table(
        index="category", columns="quartile",
        values="share_pct", aggfunc="first"
    ).reindex(columns=Q_ORDER)
    log.info("\nComplaint-type share (%) by income quartile:\n" + pivot_mix.to_string())

    pivot_med = df_b2.pivot_table(
        index="category", columns="quartile",
        values="median_h", aggfunc="first"
    ).reindex(columns=Q_ORDER)
    log.info("\nMedian resolution (h) by category × quartile:\n" + pivot_med.round(1).to_string())

    # ── B3: Within-borough income comparison ─────────────────────────────
    print_section("B3 · Within-borough income comparison")

    bor_rows = []
    for bor in BOROUGHS:
        for q in Q_ORDER:
            arr = np.array(bor_q_hours[(bor, q)], dtype=np.float64)
            r   = percentile_row(arr, q)
            r["borough"] = bor
            bor_rows.append(r)
    df_b3 = pd.DataFrame(bor_rows)
    save(df_b3, "B3_resolution_by_borough_quartile.csv")

    # Print compact table: borough × quartile median
    pivot_bor = df_b3.pivot_table(
        index="borough", columns="group",
        values="median_h", aggfunc="first"
    ).reindex(columns=Q_ORDER)
    log.info("\nMedian resolution (h) — borough × income quartile:\n"
             + pivot_bor.round(1).to_string())

    # Gap within each borough
    log.info("\n  Within-borough Q4 vs Q1 median gap:")
    for bor in BOROUGHS:
        row = pivot_bor.loc[bor]
        gap = row["Q4 (highest)"] - row["Q1 (lowest)"]
        pct = (row["Q4 (highest)"] / row["Q1 (lowest)"] - 1) * 100 if row["Q1 (lowest)"] else np.nan
        log.info(f"    {bor:<15}  Q1={row['Q1 (lowest)']:>7.1f}h  "
                 f"Q4={row['Q4 (highest)']:>7.1f}h  gap={gap:+.1f}h ({pct:+.1f}%)")

    # ── B4: Attach dominant borough to zip_stats & within-borough income ranks
    print_section("B4 · Within-borough income ranking (zip-level)")

    dom_bor = {mod: c.most_common(1)[0][0] for mod, c in mod_borough.items()}
    zs["dom_borough"] = zs["modzcta"].map(dom_bor)
    zs_clean = zs.dropna(subset=["dom_borough"])
    zs_clean = zs_clean[zs_clean["dom_borough"].isin(BOROUGHS)]

    # Within each borough, rank by income and split into two halves
    zs_clean = zs_clean.copy()
    zs_clean["within_bor_rank"] = (
        zs_clean.groupby("dom_borough")["median_income"]
                .rank(method="first", ascending=True)
    )
    zs_clean["within_bor_total"] = zs_clean.groupby("dom_borough")["modzcta"].transform("count")
    zs_clean["within_bor_half"] = np.where(
        zs_clean["within_bor_rank"] <= zs_clean["within_bor_total"] / 2,
        "lower_half", "upper_half"
    )

    half_rows = (
        zs_clean.groupby(["dom_borough", "within_bor_half"])
        .agg(
            n_zips            = ("modzcta",                 "count"),
            median_income     = ("median_income",           "median"),
            median_res_h      = ("median_resolution_hours", "median"),
            median_pct_24h    = ("pct_resolved_24h",        "median"),
            total_pop         = ("population",              "sum"),
        )
        .reset_index()
    )
    save(half_rows, "B4_within_borough_income_half.csv")
    log.info("\nWithin-borough lower vs upper income half — median resolution (h):")
    pivot_half = half_rows.pivot_table(
        index="dom_borough", columns="within_bor_half",
        values="median_res_h", aggfunc="first"
    )
    pivot_half["gap_lower_minus_upper"] = (
        pivot_half["lower_half"] - pivot_half["upper_half"]
    ).round(2)
    log.info("\n" + pivot_half.round(2).to_string())
    save(half_rows, "B4_within_borough_income_half.csv")

    # ── B5: Agency-level breakdown ────────────────────────────────────────
    print_section("B5 · Agency-level breakdown by income quartile")

    agencies = sorted({k[0] for k in agency_q_hours})
    ag_rows = []
    for ag in agencies:
        total_ag = sum(len(agency_q_hours[(ag, q)]) for q in Q_ORDER)
        for q in Q_ORDER:
            arr = np.array(agency_q_hours[(ag, q)], dtype=np.float64)
            n   = len(arr)
            med = float(np.median(arr)) if n else np.nan
            ag_rows.append({
                "agency"    : ag,
                "quartile"  : q,
                "n"         : n,
                "share_pct" : round(n / total_ag * 100, 1) if total_ag else 0,
                "median_h"  : round(med, 2),
            })
    df_b5 = pd.DataFrame(ag_rows)
    save(df_b5, "B5_agency_by_quartile.csv")

    # Which quartile does each agency primarily serve?
    dominant_q = (
        df_b5.loc[df_b5.groupby("agency")["n"].idxmax()]
             [["agency", "quartile", "n"]]
             .rename(columns={"quartile": "dominant_quartile", "n": "n_in_dominant_q"})
    )
    # Overall median resolution per agency
    ag_overall = []
    for ag in agencies:
        all_h = []
        for q in Q_ORDER:
            all_h.extend(agency_q_hours[(ag, q)])
        arr = np.array(all_h, dtype=np.float64)
        ag_overall.append({
            "agency"          : ag,
            "n_total"         : len(arr),
            "overall_median_h": round(float(np.median(arr)), 2) if len(arr) else np.nan,
            "overall_p90_h"   : round(float(np.percentile(arr, 90)), 2) if len(arr) else np.nan,
        })
    df_ag_overall = pd.DataFrame(ag_overall).merge(dominant_q, on="agency")
    df_ag_overall = df_ag_overall.sort_values("n_total", ascending=False)
    save(df_ag_overall, "B5_agency_overall.csv")
    log.info("\n" + df_ag_overall.to_string(index=False))

    # ── B6: Within-category × within-borough income effect ───────────────
    print_section("B6 · Within-category × within-borough income effect")

    cb_rows = []
    for bor in BOROUGHS:
        for cat in cats:
            for q in Q_ORDER:
                arr = np.array(bor_cat_q_hours[(bor, cat, q)], dtype=np.float64)
                n   = len(arr)
                med = float(np.median(arr)) if n else np.nan
                cb_rows.append({
                    "borough"   : bor,
                    "category"  : cat,
                    "quartile"  : q,
                    "n"         : n,
                    "median_h"  : round(med, 2),
                })
    df_b6 = pd.DataFrame(cb_rows)
    save(df_b6, "B6_borough_category_quartile.csv")

    # Compute Q4−Q1 gap within each (borough, category)
    pivot_b6 = df_b6.pivot_table(
        index=["borough", "category"], columns="quartile",
        values="median_h", aggfunc="first"
    ).reindex(columns=Q_ORDER)
    pivot_b6["gap_Q4_minus_Q1"] = (
        pivot_b6["Q4 (highest)"] - pivot_b6["Q1 (lowest)"]
    ).round(2)
    pivot_b6 = pivot_b6.sort_values("gap_Q4_minus_Q1", ascending=False)
    log.info("\nMedian resolution gap Q4−Q1 within borough × category:\n"
             + pivot_b6[["Q1 (lowest)","Q4 (highest)","gap_Q4_minus_Q1"]].to_string())
    save(pivot_b6.reset_index(), "B6_gap_borough_category.csv")

    # ── B7: Seasonal / monthly patterns ──────────────────────────────────
    print_section("B7 · Monthly resolution time by income quartile")

    months = sorted({k[0] for k in month_q_hours})
    mo_rows = []
    for mo in months:
        for q in Q_ORDER:
            arr = np.array(month_q_hours[(mo, q)], dtype=np.float64)
            n   = len(arr)
            med = float(np.median(arr)) if n else np.nan
            mo_rows.append({
                "month"    : mo,
                "quartile" : q,
                "n"        : n,
                "median_h" : round(med, 2),
            })
    df_b7 = pd.DataFrame(mo_rows)
    save(df_b7, "B7_monthly_by_quartile.csv")

    pivot_mo = df_b7.pivot_table(
        index="month", columns="quartile",
        values="median_h", aggfunc="first"
    ).reindex(columns=Q_ORDER)
    pivot_mo["gap_Q4_minus_Q1"] = (
        pivot_mo["Q4 (highest)"] - pivot_mo["Q1 (lowest)"]
    ).round(2)
    log.info("\n" + pivot_mo.to_string())

    # ── B8: Complaint rate (per 1k) vs resolution time ───────────────────
    print_section("B8 · Does complaint rate correlate with faster service?")

    zs2 = zs.copy()
    zs2["complaints_per_1k"] = (zs2["total_complaints"] / zs2["population"] * 1000).round(2)
    corr_rate_res = zs2["complaints_per_1k"].corr(zs2["median_resolution_hours"])
    corr_rate_24h = zs2["complaints_per_1k"].corr(zs2["pct_resolved_24h"])
    log.info(f"  r(complaints_per_1k, median_resolution_hours) = {corr_rate_res:.3f}")
    log.info(f"  r(complaints_per_1k, pct_resolved_24h)        = {corr_rate_24h:.3f}")

    # Decile breakdown
    zs2["rate_decile"] = pd.qcut(zs2["complaints_per_1k"], q=10, labels=False) + 1
    decile_tbl = (
        zs2.groupby("rate_decile")
           .agg(
               n_zips            = ("modzcta",                 "count"),
               avg_rate_per1k    = ("complaints_per_1k",       "mean"),
               median_income     = ("median_income",           "median"),
               median_res_h      = ("median_resolution_hours", "median"),
               median_pct_24h    = ("pct_resolved_24h",        "median"),
           )
           .reset_index()
    )
    save(decile_tbl, "B8_complaint_rate_decile_vs_service.csv")
    log.info("\nComplaint-rate decile vs service speed:\n"
             + decile_tbl.to_string(index=False))

    # ── B9: Report-rate summary table (for paper / slide) ────────────────
    print_section("B9 · Summary: complaint-rate + resolution by borough (population-adjusted)")

    zs3 = zs_clean.copy()
    zs3["complaints_per_1k"] = (zs3["total_complaints"] / zs3["population"] * 1000).round(2)
    zs3["pop_x_res"] = zs3["population"] * zs3["median_resolution_hours"]

    bor_summary = (
        zs3.groupby("dom_borough")
           .agg(
               n_zips               = ("modzcta",              "count"),
               total_pop            = ("population",           "sum"),
               total_complaints     = ("total_complaints",     "sum"),
               median_income        = ("median_income",        "median"),
               median_res_h         = ("median_resolution_hours","median"),
               sum_pop_x_res        = ("pop_x_res",            "sum"),
               median_pct_24h       = ("pct_resolved_24h",     "median"),
           )
           .reset_index()
    )
    bor_summary["complaints_per_1k"]   = (
        bor_summary["total_complaints"] / bor_summary["total_pop"] * 1000
    ).round(2)
    bor_summary["popwt_resolution_h"] = (
        bor_summary["sum_pop_x_res"] / bor_summary["total_pop"]
    ).round(2)
    bor_summary = bor_summary.sort_values("median_income")
    save(bor_summary.drop(columns="sum_pop_x_res"), "B9_borough_summary.csv")
    log.info("\n" + bor_summary[
        ["dom_borough","median_income","complaints_per_1k",
         "median_res_h","popwt_resolution_h","median_pct_24h"]
    ].to_string(index=False))


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 70)
    log.info("  00_eda.py  —  311 Exploratory Data Analysis")
    log.info("=" * 70)

    # ── Load zip_stats ────────────────────────────────────────────────────
    zs = pd.read_csv(ZIP_STATS)
    log.info(f"zip_stats: {len(zs)} rows  |  "
             f"total complaints: {zs['total_complaints'].sum():,}  |  "
             f"total population: {zs['population'].sum():,}")

    # ── Part A (zip_stats only) ───────────────────────────────────────────
    zs = analysis_zip_stats(zs)

    # ── Part B (streaming) ───────────────────────────────────────────────
    print_section("Streaming enriched chunks …")
    (q_hours, cat_q_hours, bor_q_hours, bor_cat_q_hours,
     agency_q_hours, month_q_hours, mod_borough, _) = stream_and_accumulate(zs)

    # Convert lists to numpy arrays in-place (saves repeated conversions)
    for d in (q_hours, cat_q_hours, bor_q_hours, bor_cat_q_hours,
              agency_q_hours, month_q_hours):
        for k in d:
            d[k] = np.array(d[k], dtype=np.float64)

    # ── Part C (build outputs) ────────────────────────────────────────────
    build_outputs(zs, q_hours, cat_q_hours, bor_q_hours, bor_cat_q_hours,
                  agency_q_hours, month_q_hours, mod_borough)

    log.info(f"\nAll outputs saved to  {OUT_DIR}")
    log.info("Done.")


if __name__ == "__main__":
    main()
