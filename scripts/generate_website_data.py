"""
generate_website_data.py
Generates JSON data files for website sections 4, 5, and 6.

Reads from data/eda/ CSV files and writes to website/public/data/.

Usage:
    python scripts/generate_website_data.py
"""

import json
import os
import csv
import statistics
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent.parent
EDA_DIR    = BASE_DIR / "data" / "eda"
OUTPUT_DIR = BASE_DIR / "website" / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def read_csv(filename):
    """Return list of dicts from a CSV file in EDA_DIR."""
    path = EDA_DIR / filename
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_json(filename, data):
    """Write data as pretty JSON to OUTPUT_DIR."""
    path = OUTPUT_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"  Wrote {path}")


# ── Section 4: Oaxaca composition story ───────────────────────────────────────
def generate_section4():
    print("Generating section4.json...")

    # --- Oaxaca summary ---
    summary_rows = read_csv("decomp_E1_summary.csv")
    s = summary_rows[0]
    actual_q1_h          = float(s["actual_q1_h"])
    actual_q4_h          = float(s["actual_q4_h"])
    composition_effect_h = float(s["composition_effect_h"])
    composition_pct      = float(s["composition_explained_pct"])

    # counterfactual: what Q1 would look like if it had Q4's complaint mix
    counterfactual_h = actual_q1_h + composition_effect_h

    oaxaca = {
        "actual_q1_h":      round(actual_q1_h, 3),
        "counterfactual_h": round(counterfactual_h, 3),
        "actual_q4_h":      round(actual_q4_h, 3),
        "composition_pct":  round(composition_pct, 1),
    }

    # --- Category mix ---
    mix_rows = read_csv("B2_category_mix_by_quartile.csv")

    # Build lookup: (quartile, category) -> row
    mix_lookup = {}
    for row in mix_rows:
        key = (row["quartile"], row["category"])
        mix_lookup[key] = row

    category_order = ["health_safety", "infrastructure", "quality_of_life", "other"]
    category_labels = {
        "health_safety":   "Health & Safety",
        "infrastructure":  "Infrastructure",
        "quality_of_life": "Quality of Life",
        "other":           "Other",
    }

    category_mix = []
    for cat in category_order:
        q1 = mix_lookup.get(("Q1 (lowest)", cat), {})
        q4 = mix_lookup.get(("Q4 (highest)", cat), {})
        category_mix.append({
            "category":    cat,
            "label":       category_labels[cat],
            "q1_share":    float(q1.get("share_pct", 0)),
            "q4_share":    float(q4.get("share_pct", 0)),
            "q1_count":    int(q1.get("n_complaints", 0)),
            "q4_count":    int(q4.get("n_complaints", 0)),
            "median_h_q1": float(q1.get("median_h", 0)),
            "median_h_q4": float(q4.get("median_h", 0)),
        })

    write_json("section4.json", {"oaxaca": oaxaca, "category_mix": category_mix})


# ── Section 5: Seasonal / monthly chart ───────────────────────────────────────
def generate_section5():
    print("Generating section5.json...")

    month_rows = read_csv("B7_monthly_by_quartile.csv")

    month_labels = {
        "2024-01": "Jan", "2024-02": "Feb", "2024-03": "Mar",
        "2024-04": "Apr", "2024-05": "May", "2024-06": "Jun",
        "2024-07": "Jul", "2024-08": "Aug", "2024-09": "Sep",
        "2024-10": "Oct", "2024-11": "Nov", "2024-12": "Dec",
    }

    # Build (month_key, quartile) -> median_h
    lookup = {}
    for row in month_rows:
        lookup[(row["month"], row["quartile"])] = float(row["median_h"])

    quartiles = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"]
    months_sorted = sorted(month_labels.keys())

    monthly = []
    gap = []
    for mk in months_sorted:
        label = month_labels[mk]
        entry = {"month": label}
        for q in quartiles:
            entry[q] = lookup.get((mk, q), None)
        monthly.append(entry)

        q1_val = lookup.get((mk, "Q1 (lowest)"), None)
        q4_val = lookup.get((mk, "Q4 (highest)"), None)
        gap_h  = round(q1_val - q4_val, 2) if (q1_val is not None and q4_val is not None) else None
        gap.append({"month": label, "gap_h": gap_h})

    write_json("section5.json", {"monthly": monthly, "gap": gap})


# ── Section 6: Within-cell no-discrimination evidence ─────────────────────────
def generate_section6():
    print("Generating section6.json...")

    cell_rows = read_csv("decomp_E4_within_cell_gaps.csv")

    # Filter to Q1 vs Q4 rows only
    q1_q4_rows = [
        r for r in cell_rows
        if r["q_low"] == "Q1 (lowest)" and r["q_high"] == "Q4 (highest)"
    ]

    raw_gaps = [float(r["gap_h"]) for r in q1_q4_rows]

    # Cap at ±100h for display
    capped_gaps = [max(-100, min(100, g)) for g in raw_gaps]

    n_cells = len(raw_gaps)

    # pct_q4_faster: gap_h < 0 means Q4 (high) median < Q1 (low) median = Q4 faster
    n_q4_faster = sum(1 for g in raw_gaps if g < 0)
    n_q1_faster = n_cells - n_q4_faster

    pct_q4_faster = round(100 * n_q4_faster / n_cells, 1) if n_cells > 0 else 0
    pct_q1_faster = round(100 * n_q1_faster / n_cells, 1) if n_cells > 0 else 0

    median_gap_h   = round(statistics.median(raw_gaps), 3)
    median_gap_min = round(median_gap_h * 60, 1)

    summary = {
        "n_cells":       n_cells,
        "pct_q4_faster": pct_q4_faster,
        "pct_q1_faster": pct_q1_faster,
        "median_gap_h":  median_gap_h,
        "median_gap_min": median_gap_min,
    }

    write_json("section6.json", {"gaps": capped_gaps, "summary": summary})


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    generate_section4()
    generate_section5()
    generate_section6()
    print("Done.")
