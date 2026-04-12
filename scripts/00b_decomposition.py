"""
00b_decomposition.py — Causal Decomposition Analysis
=====================================================
Part of the NYC 311 Urban Inequality pipeline.
Run after 00_eda.py.  See REPORT.md §4 for full findings,
METHODOLOGY.md §11 for method details, AGENTS.md for agent description.

Six competing explanations for the income–resolution-time gap:

  E1. COMPLAINT MIX      — Q1 files inherently slower complaint types
                           (Oaxaca decomposition; explains 97.8% of gap)
  E2. AGENCY SORTING     — slow agencies are concentrated in poor areas
                           (Oaxaca decomposition; explains 0% of gap)
  E3. CONGESTION         — high complaint density overwhelms agencies
                           (partial correlation; not a driver)
  E4. WITHIN-CELL BIAS   — same agency + type + borough + month,
                           income still predicts wait time
                           (within-cell test; median gap ≈ 0h — no bias)
  E5. CHANNEL            — Q1 uses phone (slower) vs Q4 uses online
                           (channel decomposition; explains ~28% of
                           channel-adjusted gap — digital divide signal)
  E6. WITHIN-INFRA SUBTYPE — Q1's infrastructure = housing maintenance;
                           Q4's = streets/signals (different agencies,
                           different inherent fix times; subsumed by E1)

Key result: the raw 11.1h Q1–Q4 median gap is almost entirely driven by
WHAT lower-income residents need to call about (housing maintenance failures
from worse housing stock), not by HOW FAST the city responds to identical
complaints.

Outputs: data/eda/decomp_*.csv  |  logs/00b_decomposition.log
"""

import glob
import logging
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy import stats

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT         = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENRICHED_DIR = os.path.join(ROOT, "data", "processed", "parts")
ZIP_STATS    = os.path.join(ROOT, "data", "processed", "zip_stats.csv")
OUT_DIR      = os.path.join(ROOT, "data", "eda")
LOG_PATH     = os.path.join(ROOT, "logs", "00b_decomposition.log")

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, mode="w"),
              logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

Q_ORDER  = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"]
BOROUGHS = ["BRONX", "BROOKLYN", "MANHATTAN", "QUEENS", "STATEN ISLAND"]
COLS     = ["modzcta", "resolution_hours", "complaint_category", "complaint_type",
            "borough", "agency", "created_date", "open_data_channel_type"]


def save(df, name):
    path = os.path.join(OUT_DIR, name)
    df.to_csv(path, index=False)
    log.info(f"  saved  {name}  ({len(df)} rows)")


def section(title):
    log.info(f"\n{'='*70}\n  {title}\n{'='*70}")


def wt_median(values, weights):
    """Weighted median (for standardisation)."""
    order = np.argsort(values)
    values, weights = np.array(values)[order], np.array(weights)[order]
    cum = np.cumsum(weights)
    cutoff = weights.sum() / 2
    return float(values[cum >= cutoff][0])


# ── Streaming ────────────────────────────────────────────────────────────────

def stream(q_lookup):
    """One pass — accumulate every dimension needed."""
    # --- accumulators ---
    # E1: complaint type composition
    ctype_q   = defaultdict(list)      # (complaint_type, quartile) → hours

    # E2: agency sorting
    agency_q  = defaultdict(list)      # (agency, quartile) → hours

    # E4: within-cell (agency × category × borough × month)
    cell_q    = defaultdict(list)      # (agency,cat,bor,month,quartile) → hours

    # E5: channel
    chan_q    = defaultdict(list)      # (channel, quartile) → hours

    # E6: within-infrastructure subtypes
    infra_type_q = defaultdict(list)   # (complaint_type, quartile) → hours
    #   only for complaint_category == 'infrastructure'

    # for congestion: we need zip-level counts — already in zip_stats
    # but also: for each (agency, borough, month) bucket, zip-level count
    zip_agency_bor_mo_q = defaultdict(list)  # for volume analysis we'll do at zip_stats level

    files = sorted(glob.glob(os.path.join(ENRICHED_DIR, "*_enriched.parquet")))
    log.info(f"Streaming {len(files)} chunks …")
    total = 0

    for i, f in enumerate(files, 1):
        chunk = pd.read_parquet(f, columns=COLS)
        chunk = chunk.dropna(subset=["modzcta", "resolution_hours"])
        chunk = chunk[chunk["borough"].isin(BOROUGHS)]
        chunk["modzcta"] = chunk["modzcta"].astype("Int64")
        chunk["quartile"] = chunk["modzcta"].map(q_lookup)
        chunk = chunk.dropna(subset=["quartile"])
        chunk["month"] = chunk["created_date"].dt.to_period("M").astype(str)
        total += len(chunk)

        for row in chunk.itertuples(index=False):
            h   = row.resolution_hours
            q   = row.quartile
            ct  = row.complaint_type
            cat = row.complaint_category
            bor = row.borough
            ag  = row.agency
            mo  = row.month
            ch  = row.open_data_channel_type

            ctype_q[(ct, q)].append(h)
            agency_q[(ag, q)].append(h)
            cell_q[(ag, cat, bor, mo, q)].append(h)
            chan_q[(ch, q)].append(h)
            if cat == "infrastructure":
                infra_type_q[(ct, q)].append(h)

        if i % 10 == 0:
            log.info(f"  chunk {i:3d}  —  {total:,} rows")

    log.info(f"  Done. {total:,} total rows.")
    # Convert to numpy
    for d in (ctype_q, agency_q, cell_q, chan_q, infra_type_q):
        for k in d:
            d[k] = np.array(d[k], dtype=np.float64)

    return ctype_q, agency_q, cell_q, chan_q, infra_type_q


# ── E1: Complaint-type composition decomposition ─────────────────────────────

def e1_composition(ctype_q):
    section("E1 · Complaint-type composition decomposition (Oaxaca-style)")

    types = sorted({k[0] for k in ctype_q})

    # For each (type, quartile): count and median
    rows = []
    for ct in types:
        for q in Q_ORDER:
            arr = ctype_q[(ct, q)]
            rows.append({
                "complaint_type": ct,
                "quartile"      : q,
                "n"             : len(arr),
                "median_h"      : float(np.median(arr)) if len(arr) else np.nan,
            })
    df = pd.DataFrame(rows)
    save(df, "decomp_E1_ctype_by_quartile.csv")

    # Oaxaca decomposition: Q1 vs Q4
    # weights = complaint-type share within each quartile
    q1_rows = df[df["quartile"] == "Q1 (lowest)"].dropna(subset=["median_h"])
    q4_rows = df[df["quartile"] == "Q4 (highest)"].dropna(subset=["median_h"])

    q1_n  = q1_rows.set_index("complaint_type")["n"]
    q4_n  = q4_rows.set_index("complaint_type")["n"]
    q1_med = q1_rows.set_index("complaint_type")["median_h"]
    q4_med = q4_rows.set_index("complaint_type")["median_h"]

    # Only types with data in both quartiles
    common = q1_med.index.intersection(q4_med.index)
    q1_n   = q1_n[common]; q4_n = q4_n[common]
    q1_med = q1_med[common]; q4_med = q4_med[common]

    w1 = q1_n / q1_n.sum()   # Q1 weights
    w4 = q4_n / q4_n.sum()   # Q4 weights

    actual_q1  = wt_median(q1_med.values, w1.values)
    actual_q4  = wt_median(q4_med.values, w4.values)

    # Counterfactual: Q1 type-specific medians, but Q4's type weights
    counterfactual = wt_median(q1_med.values, w4.values)

    raw_gap        = actual_q4 - actual_q1          # negative = Q4 faster
    composition    = counterfactual - actual_q1     # how much of gap is mix
    within_type    = actual_q4 - counterfactual     # residual
    explained_pct  = abs(composition) / abs(raw_gap) * 100 if raw_gap != 0 else 0

    log.info(f"\n  Actual Q1 median (type-weighted)   : {actual_q1:>8.2f} h")
    log.info(f"  Actual Q4 median (type-weighted)   : {actual_q4:>8.2f} h")
    log.info(f"  Raw gap (Q4 − Q1)                  : {raw_gap:>+8.2f} h")
    log.info(f"")
    log.info(f"  Counterfactual Q1 (Q4 mix, Q1 speed): {counterfactual:>8.2f} h")
    log.info(f"  Composition effect (mix explains)  : {composition:>+8.2f} h  ({explained_pct:.1f}% of gap)")
    log.info(f"  Within-type residual gap           : {within_type:>+8.2f} h  ({100-explained_pct:.1f}% of gap)")
    log.info(f"")
    log.info(f"  Interpretation: even if Q1 neighborhoods filed the SAME")
    log.info(f"  complaint types as Q4, they would still experience a")
    log.info(f"  {within_type:+.2f} h difference in median resolution time.")

    # Top types contributing to Q1's disadvantage
    type_contrib = (w1 - w4) * q1_med   # over-represented types × Q1 speed
    top_excess   = type_contrib.sort_values(ascending=False).head(10)
    log.info(f"\n  Top complaint types over-represented in Q1 (weight × median_h):")
    for ct, v in top_excess.items():
        q1_share = w1[ct] * 100
        q4_share = w4.get(ct, 0) * 100
        log.info(f"    {ct:<40}  Q1={q1_share:.1f}%  Q4={q4_share:.1f}%  median_h={q1_med[ct]:.1f}h")

    result = {
        "actual_q1_h": actual_q1, "actual_q4_h": actual_q4,
        "raw_gap_h": raw_gap, "composition_effect_h": composition,
        "within_type_residual_h": within_type, "composition_explained_pct": explained_pct,
    }
    pd.DataFrame([result]).to_csv(os.path.join(OUT_DIR, "decomp_E1_summary.csv"), index=False)
    return result


# ── E2: Agency-sorting decomposition ─────────────────────────────────────────

def e2_agency_sorting(agency_q):
    section("E2 · Agency-sorting decomposition (Oaxaca-style)")

    agencies = sorted({k[0] for k in agency_q})
    rows = []
    for ag in agencies:
        for q in Q_ORDER:
            arr = agency_q[(ag, q)]
            rows.append({
                "agency"  : ag,
                "quartile": q,
                "n"       : len(arr),
                "median_h": float(np.median(arr)) if len(arr) else np.nan,
            })
    df = pd.DataFrame(rows)
    save(df, "decomp_E2_agency_by_quartile.csv")

    q1_rows = df[df["quartile"] == "Q1 (lowest)"].dropna(subset=["median_h"])
    q4_rows = df[df["quartile"] == "Q4 (highest)"].dropna(subset=["median_h"])

    q1_n   = q1_rows.set_index("agency")["n"]
    q4_n   = q4_rows.set_index("agency")["n"]
    q1_med = q1_rows.set_index("agency")["median_h"]
    q4_med = q4_rows.set_index("agency")["median_h"]

    common = q1_med.index.intersection(q4_med.index)
    q1_n   = q1_n[common]; q4_n = q4_n[common]
    q1_med = q1_med[common]; q4_med = q4_med[common]

    w1 = q1_n / q1_n.sum()
    w4 = q4_n / q4_n.sum()

    actual_q1    = wt_median(q1_med.values, w1.values)
    actual_q4    = wt_median(q4_med.values, w4.values)
    counterfact  = wt_median(q1_med.values, w4.values)   # Q1 speed, Q4 agency mix

    raw_gap       = actual_q4 - actual_q1
    sorting_effect = counterfact - actual_q1
    within_agency  = actual_q4 - counterfact
    sort_pct       = abs(sorting_effect) / abs(raw_gap) * 100 if raw_gap != 0 else 0

    log.info(f"\n  Actual Q1 (agency-weighted)          : {actual_q1:>8.2f} h")
    log.info(f"  Actual Q4 (agency-weighted)          : {actual_q4:>8.2f} h")
    log.info(f"  Raw gap (Q4 − Q1)                    : {raw_gap:>+8.2f} h")
    log.info(f"")
    log.info(f"  Counterfactual Q1 (Q4 agency mix)    : {counterfact:>8.2f} h")
    log.info(f"  Agency-sorting effect                : {sorting_effect:>+8.2f} h  ({sort_pct:.1f}% of gap)")
    log.info(f"  Within-agency residual gap           : {within_agency:>+8.2f} h  ({100-sort_pct:.1f}% of gap)")

    # Agency share table
    share_tbl = pd.DataFrame({
        "agency"        : list(q1_n.index),
        "q1_share_pct"  : (w1 * 100).round(1).values,
        "q4_share_pct"  : (w4 * 100).round(1).values,
        "q1_median_h"   : q1_med.values.round(1),
        "q4_median_h"   : q4_med.values.round(1),
    }).sort_values("q1_share_pct", ascending=False)
    log.info("\n  Agency share Q1 vs Q4:\n" + share_tbl.to_string(index=False))
    save(share_tbl, "decomp_E2_agency_shares.csv")

    result = {
        "actual_q1_h": actual_q1, "actual_q4_h": actual_q4,
        "raw_gap_h": raw_gap, "sorting_effect_h": sorting_effect,
        "within_agency_residual_h": within_agency, "sorting_explained_pct": sort_pct,
    }
    pd.DataFrame([result]).to_csv(os.path.join(OUT_DIR, "decomp_E2_summary.csv"), index=False)
    return result


# ── E3: Volume / congestion ───────────────────────────────────────────────────

def e3_congestion(zs):
    section("E3 · Volume / congestion — does complaint density slow service?")

    zs = zs.copy()
    zs["complaints_per_1k"] = zs["total_complaints"] / zs["population"] * 1000

    # Partial correlation: income vs resolution, controlling for complaint rate
    # r_partial(income, resolution | complaint_rate)
    def partial_corr(x, y, z):
        """Partial correlation of x and y controlling for z."""
        rx_z  = stats.pearsonr(x, z)[0]
        ry_z  = stats.pearsonr(y, z)[0]
        rx_y  = stats.pearsonr(x, y)[0]
        denom = np.sqrt((1 - rx_z**2) * (1 - ry_z**2))
        return (rx_y - rx_z * ry_z) / denom if denom else np.nan

    valid = zs.dropna(subset=["median_income","median_resolution_hours","complaints_per_1k"])
    inc = valid["median_income"].values
    res = valid["median_resolution_hours"].values
    vol = valid["complaints_per_1k"].values

    r_raw    = stats.pearsonr(inc, res)[0]
    r_partial_vol  = partial_corr(inc, res, vol)
    r_vol_res = stats.pearsonr(vol, res)[0]

    log.info(f"\n  r(income, resolution)                          = {r_raw:.3f}")
    log.info(f"  r(income, resolution | controlling for volume) = {r_partial_vol:.3f}")
    log.info(f"  r(volume, resolution)                          = {r_vol_res:.3f}")
    log.info(f"")
    if abs(r_partial_vol) < abs(r_raw):
        chg = (abs(r_raw) - abs(r_partial_vol)) / abs(r_raw) * 100
        log.info(f"  Controlling for complaint volume reduces the income-resolution")
        log.info(f"  correlation by {chg:.1f}% — congestion explains a portion of the gap.")
    else:
        log.info(f"  Controlling for complaint volume does NOT reduce the correlation.")
        log.info(f"  Volume/congestion is NOT the main driver of the gap.")

    # Within each quartile: does higher volume → slower service?
    log.info(f"\n  Within-quartile correlation: complaint_rate vs resolution:")
    rows = []
    for q in Q_ORDER:
        sub = valid[valid["income_quartile"] == q]
        if len(sub) < 5:
            continue
        r, p = stats.pearsonr(sub["complaints_per_1k"], sub["median_resolution_hours"])
        log.info(f"    {q:<18}  r = {r:>+.3f}  p = {p:.3f}  n = {len(sub)}")
        rows.append({"quartile": q, "n_zips": len(sub), "r_volume_resolution": round(r, 3), "p": round(p, 3)})
    save(pd.DataFrame(rows), "decomp_E3_within_quartile_volume_corr.csv")

    # Volume decile: does service speed vary monotonically with volume?
    zs["vol_decile"] = pd.qcut(zs["complaints_per_1k"], q=10, labels=False) + 1
    vol_dec = (
        zs.groupby("vol_decile")
          .agg(
              n_zips          = ("modzcta",                 "count"),
              avg_rate_per1k  = ("complaints_per_1k",       "mean"),
              median_income   = ("median_income",           "median"),
              median_res_h    = ("median_resolution_hours", "median"),
              pct_24h         = ("pct_resolved_24h",        "median"),
          ).reset_index()
    )
    save(vol_dec, "decomp_E3_volume_decile.csv")
    log.info(f"\n  Volume decile → service speed:\n" + vol_dec.to_string(index=False))


# ── E4: Within-cell analysis (cleanest test for systematic bias) ──────────────

def e4_within_cell(cell_q):
    section("E4 · Within-cell analysis — residual gap after controlling for "
            "agency × category × borough × month")

    MIN_N = 20   # minimum observations per (cell, quartile) to include

    # For each cell, compare Q1 and Q4 medians
    cells = {}
    for (ag, cat, bor, mo, q), arr in cell_q.items():
        key = (ag, cat, bor, mo)
        if key not in cells:
            cells[key] = {}
        cells[key][q] = arr

    results = []
    for (ag, cat, bor, mo), qdict in cells.items():
        for q1, q4 in [("Q1 (lowest)", "Q4 (highest)"),
                        ("Q1 (lowest)", "Q2"),
                        ("Q2", "Q3"),
                        ("Q3", "Q4 (highest)")]:
            a1 = qdict.get(q1, np.array([]))
            a4 = qdict.get(q4, np.array([]))
            if len(a1) < MIN_N or len(a4) < MIN_N:
                continue
            m1, m4 = np.median(a1), np.median(a4)
            results.append({
                "agency"   : ag,
                "category" : cat,
                "borough"  : bor,
                "month"    : mo,
                "q_low"    : q1,
                "q_high"   : q4,
                "n_low"    : len(a1),
                "n_high"   : len(a4),
                "median_low_h"  : round(m1, 2),
                "median_high_h" : round(m4, 2),
                "gap_h"    : round(m4 - m1, 2),   # negative = wealthier is faster
            })

    df = pd.DataFrame(results)
    save(df, "decomp_E4_within_cell_gaps.csv")

    # Focus on Q1 vs Q4
    q1q4 = df[df["q_low"] == "Q1 (lowest)"]

    n_cells        = len(q1q4)
    n_q1_slower    = (q1q4["gap_h"] < 0).sum()   # Q4 faster
    n_q1_faster    = (q1q4["gap_h"] > 0).sum()
    pct_q1_slower  = n_q1_slower / n_cells * 100 if n_cells else 0
    median_gap     = q1q4["gap_h"].median()
    mean_gap       = q1q4["gap_h"].mean()

    log.info(f"\n  Comparing Q1 (lowest) vs Q4 (highest) within identical cells")
    log.info(f"  Cell definition: agency × complaint_category × borough × month")
    log.info(f"  Minimum observations per quartile per cell: {MIN_N}")
    log.info(f"")
    log.info(f"  Number of cells with both Q1 and Q4 data : {n_cells:,}")
    log.info(f"  Cells where Q4 is faster (gap < 0)       : {n_q1_slower:,}  ({pct_q1_slower:.1f}%)")
    log.info(f"  Cells where Q1 is faster (gap > 0)       : {n_q1_faster:,}  ({100-pct_q1_slower:.1f}%)")
    log.info(f"  Median within-cell gap (Q4 − Q1)         : {median_gap:>+.2f} h")
    log.info(f"  Mean   within-cell gap (Q4 − Q1)         : {mean_gap:>+.2f} h")
    log.info(f"")
    if pct_q1_slower > 60:
        log.info(f"  *** Q4 neighborhoods receive faster service in {pct_q1_slower:.0f}% of comparable")
        log.info(f"      cells — evidence of systematic gap beyond complaint-type/agency sorting.")
    elif pct_q1_slower < 40:
        log.info(f"  *** Q1 neighborhoods actually receive faster service in most cells —")
        log.info(f"      the raw gap is driven by composition/sorting, NOT prioritization bias.")
    else:
        log.info(f"  *** Mixed evidence — within comparable cells the direction is inconsistent.")

    # Breakdown by category
    log.info(f"\n  Within-cell gap by complaint category:")
    cat_summary = (
        q1q4.groupby("category")
            .agg(
                n_cells       = ("gap_h", "count"),
                median_gap_h  = ("gap_h", "median"),
                pct_q4_faster = ("gap_h", lambda x: (x < 0).mean() * 100),
            )
            .reset_index()
    )
    log.info("\n" + cat_summary.round(2).to_string(index=False))
    save(cat_summary, "decomp_E4_by_category.csv")

    # Breakdown by borough
    log.info(f"\n  Within-cell gap by borough:")
    bor_summary = (
        q1q4.groupby("borough")
            .agg(
                n_cells       = ("gap_h", "count"),
                median_gap_h  = ("gap_h", "median"),
                pct_q4_faster = ("gap_h", lambda x: (x < 0).mean() * 100),
            )
            .reset_index()
    )
    log.info("\n" + bor_summary.round(2).to_string(index=False))
    save(bor_summary, "decomp_E4_by_borough.csv")

    # Worst cells (largest gap against Q1)
    worst = q1q4.nsmallest(15, "gap_h")[
        ["agency","category","borough","month","n_low","n_high","median_low_h","median_high_h","gap_h"]
    ]
    log.info(f"\n  15 cells with largest Q4-faster gap (Q1 waits most vs Q4):")
    log.info("\n" + worst.to_string(index=False))
    save(q1q4.sort_values("gap_h"), "decomp_E4_all_cells_ranked.csv")


# ── E5: Reporting channel ─────────────────────────────────────────────────────

def e5_channel(chan_q):
    section("E5 · Reporting channel — does phone vs online explain the gap?")

    channels = sorted({k[0] for k in chan_q})
    rows = []
    for ch in channels:
        for q in Q_ORDER:
            arr = chan_q[(ch, q)]
            rows.append({
                "channel" : ch,
                "quartile": q,
                "n"       : len(arr),
                "median_h": float(np.median(arr)) if len(arr) else np.nan,
            })
    df = pd.DataFrame(rows)
    save(df, "decomp_E5_channel_by_quartile.csv")

    # Channel share per quartile
    log.info(f"\n  Channel share (%) by income quartile:")
    for q in Q_ORDER:
        sub = df[df["quartile"] == q]
        total = sub["n"].sum()
        shares = {row["channel"]: row["n"] / total * 100 for _, row in sub.iterrows()}
        log.info(f"    {q:<18}  " +
                 "  ".join(f"{ch}={shares.get(ch, 0):.1f}%" for ch in channels))

    # Channel speed
    log.info(f"\n  Median resolution by channel:")
    chan_speed = df.groupby("channel").apply(
        lambda g: pd.Series({"median_h": g["median_h"].median(), "n_total": g["n"].sum()})
    ).reset_index()
    log.info("\n" + chan_speed.to_string(index=False))

    # Does channel mix explain the gap?
    # Counterfactual: Q1 with Q4's channel mix
    q1_ch = df[df["quartile"] == "Q1 (lowest)"].set_index("channel")
    q4_ch = df[df["quartile"] == "Q4 (highest)"].set_index("channel")
    common = q1_ch.index.intersection(q4_ch.index)
    q1_ch = q1_ch.loc[common]; q4_ch = q4_ch.loc[common]
    q1_ch = q1_ch.dropna(subset=["median_h"]); q4_ch = q4_ch.dropna(subset=["median_h"])
    common2 = q1_ch.index.intersection(q4_ch.index)
    q1_ch = q1_ch.loc[common2]; q4_ch = q4_ch.loc[common2]

    w1 = q1_ch["n"] / q1_ch["n"].sum()
    w4 = q4_ch["n"] / q4_ch["n"].sum()
    act_q1 = (q1_ch["median_h"] * w1).sum()
    act_q4 = (q4_ch["median_h"] * w4).sum()
    cft    = (q1_ch["median_h"] * w4).sum()   # Q1 speed, Q4 channel mix

    channel_effect = cft - act_q1
    raw_gap        = act_q4 - act_q1
    expl_pct       = abs(channel_effect) / abs(raw_gap) * 100 if raw_gap != 0 else 0

    log.info(f"\n  Channel-sorting decomposition:")
    log.info(f"    Raw gap (Q4 − Q1)              : {raw_gap:>+7.2f} h")
    log.info(f"    Channel-mix effect             : {channel_effect:>+7.2f} h  ({expl_pct:.1f}% of gap)")
    log.info(f"    Residual (after channel adjust): {raw_gap - channel_effect:>+7.2f} h")


# ── E6: Within-infrastructure subtypes ───────────────────────────────────────

def e6_infra_subtypes(infra_type_q):
    section("E6 · Within-infrastructure complaint-type breakdown")

    types = sorted({k[0] for k in infra_type_q})
    rows = []
    for ct in types:
        for q in Q_ORDER:
            arr = infra_type_q[(ct, q)]
            rows.append({
                "complaint_type": ct,
                "quartile"      : q,
                "n"             : len(arr),
                "median_h"      : float(np.median(arr)) if len(arr) else np.nan,
            })
    df = pd.DataFrame(rows)
    save(df, "decomp_E6_infra_subtype_by_quartile.csv")

    # Top infra types by Q1 volume
    q1_infra = df[df["quartile"] == "Q1 (lowest)"].sort_values("n", ascending=False).head(15)
    q4_infra = df[df["quartile"] == "Q4 (highest)"].sort_values("n", ascending=False).head(15)

    log.info(f"\n  Top infrastructure complaint types in Q1 (lowest income):")
    log.info("\n" + q1_infra[["complaint_type","n","median_h"]].to_string(index=False))

    log.info(f"\n  Top infrastructure complaint types in Q4 (highest income):")
    log.info("\n" + q4_infra[["complaint_type","n","median_h"]].to_string(index=False))

    # Within each subtype: Q1 vs Q4 median
    pivot = df.pivot_table(index="complaint_type", columns="quartile",
                           values="median_h", aggfunc="first").reindex(columns=Q_ORDER)
    pivot["n_q1"] = df[df["quartile"]=="Q1 (lowest)"].set_index("complaint_type")["n"]
    pivot["n_q4"] = df[df["quartile"]=="Q4 (highest)"].set_index("complaint_type")["n"]
    pivot["gap_Q4_minus_Q1"] = (pivot["Q4 (highest)"] - pivot["Q1 (lowest)"]).round(1)
    pivot = pivot.dropna(subset=["Q1 (lowest)","Q4 (highest)"])
    pivot = pivot.sort_values("gap_Q4_minus_Q1")

    log.info(f"\n  Within-subtype Q4−Q1 gap (top 15 largest gaps against Q1):")
    log.info("\n" + pivot.head(15)[["Q1 (lowest)","Q4 (highest)","n_q1","n_q4","gap_Q4_minus_Q1"]].to_string())
    save(pivot.reset_index(), "decomp_E6_infra_gap_table.csv")


# ── Grand summary ─────────────────────────────────────────────────────────────

def grand_summary(e1, e2):
    section("GRAND SUMMARY — Decomposing the Q1 vs Q4 resolution gap")

    raw = e1["raw_gap_h"]
    log.info(f"\n  Raw median gap (Q4 − Q1) = {raw:>+.2f} h  (Q4 is faster when negative)")
    log.info(f"")
    log.info(f"  Causal channels identified:")
    log.info(f"")
    log.info(f"  E1  Complaint-type mix   : {e1['composition_effect_h']:>+7.2f} h  "
             f"({e1['composition_explained_pct']:>5.1f}% of gap)")
    log.info(f"  E2  Agency sorting       : {e2['sorting_effect_h']:>+7.2f} h  "
             f"({e2['sorting_explained_pct']:>5.1f}% of gap)")
    log.info(f"  E4  Within-cell residual : see above (% of cells Q4 is faster)")
    log.info(f"")
    log.info(f"  E3  Volume/congestion    : partial correlation analysis — see above")
    log.info(f"  E5  Reporting channel    : channel-mix decomposition — see above")
    log.info(f"  E6  Infra sub-types      : Q1 files harder infra types — see above")
    log.info(f"")
    log.info(f"  NOTE: E1 + E2 effects are not fully additive (both use the same")
    log.info(f"  raw gap as denominator). The key finding is the within-cell residual.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 70)
    log.info("  00b_decomposition.py  —  Causal Decomposition Analysis")
    log.info("=" * 70)

    zs = pd.read_csv(ZIP_STATS)
    q_lookup = dict(zip(zs["modzcta"], zs["income_quartile"]))

    # Stream once, collect all dimensions
    ctype_q, agency_q, cell_q, chan_q, infra_type_q = stream(q_lookup)

    # Run each decomposition
    e1 = e1_composition(ctype_q)
    e2 = e2_agency_sorting(agency_q)
    e3_congestion(zs)
    e4_within_cell(cell_q)
    e5_channel(chan_q)
    e6_infra_subtypes(infra_type_q)
    grand_summary(e1, e2)

    log.info(f"\nAll outputs saved to  {OUT_DIR}")
    log.info("Done.")


if __name__ == "__main__":
    main()
