"""Rebuild complaint categorization along interior/public lines.

The original 4-bucket grouping (health_safety / infrastructure /
quality_of_life / other) carved by *nature of issue* (hazard, built
system, nuisance) but mixed *interior* and *public* assets inside the
same buckets. That mismatched the agency-routing mechanism that
actually drives resolution time.

This script defines a new top-level taxonomy by *asset location +
issue nature* and recomputes the artifacts the website reads:

  - docs/public/data/category_resolution.json
  - docs/public/data/complaint_mix.json
  - docs/public/data/oaxaca.json
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd

INPUT = "draft/results/analysis_df.parquet"
OUT_DIR = "docs/public/data"

# ── Categorization ────────────────────────────────────────────────────────────
# Interior Housing: private interior building issues (HPD-routed, slow)
INTERIOR_HOUSING = {
    "HEAT/HOT WATER", "UNSANITARY CONDITION", "WATER LEAK",
    "PAINT/PLASTER", "PLUMBING", "DOOR/WINDOW", "FLOORING/STAIRS",
    "ELECTRIC", "APPLIANCE", "Elevator", "General Construction/Plumbing",
    "GENERAL", "SAFETY", "Rodent", "Asbestos", "Indoor Air Quality",
    "Lead", "Mold",
    # DOB interior
    "Building/Use", "Construction Safety Enforcement",
    # NYCHA misc
    "HPD Literature Request",
}

# Public Infrastructure: public realm physical assets (DOT/DEP/DPR, fast)
PUBLIC_INFRA = {
    "Street Condition", "Pothole", "Street Light Condition",
    "Sidewalk Condition", "Traffic Signal Condition",
    "Water System", "Sewer", "Damaged Tree", "Overgrown Tree/Branches",
    "New Tree Request", "Root/Sewer/Sidewalk Condition",
    "Maintenance or Facility", "Curb Condition", "Highway Condition",
    "Bike Rack Condition", "Street Sign - Damaged", "Street Sign - Missing",
    "Street Sign - Dangling", "Snow", "Highway Sign", "Bridge Condition",
    "Bus Stop Shelter Complaint", "Broken Muni Meter", "ELECTRICAL",
    "PARK MAINTENANCE", "Park Maintenance Facilities",
}

# Quality of Life / Nuisance: behavior in public/shared space
QUALITY_OF_LIFE = {
    "Noise - Residential", "Noise - Street/Sidewalk", "Noise - Commercial",
    "Noise - Vehicle", "Noise - Helicopter", "Noise - Park", "Noise",
    "Noise - House of Worship", "Collection Truck Noise",
    "Dirty Condition", "Graffiti", "Encampment", "Illegal Dumping",
    "Illegal Fireworks", "Homeless Person Assistance", "Panhandling",
    "Drug Activity", "Non-Emergency Police Matter", "Drinking", "Smoking",
    "Vendor Enforcement", "Animal-Abuse", "Disorderly Youth",
    "Urinating in Public", "Posting Advertisement", "Bike/Roller/Skate Chronic",
}

# Everything else (vehicles, sanitation pickup, regulatory) → Other
# (no explicit set — anything not in the three above is "other")


def categorize(ct: str) -> str:
    if ct in INTERIOR_HOUSING:
        return "interior_housing"
    if ct in PUBLIC_INFRA:
        return "public_infra"
    if ct in QUALITY_OF_LIFE:
        return "quality_of_life"
    return "other"


CATEGORY_ORDER = ["interior_housing", "public_infra", "quality_of_life", "other"]
CATEGORY_LABEL = {
    "interior_housing": "Interior Housing",
    "public_infra":     "Public Infrastructure",
    "quality_of_life":  "Quality of Life",
    "other":            "Other",
}
QUARTILE_LABEL = {"Q1": "Q1 (lowest)", "Q2": "Q2", "Q3": "Q3", "Q4": "Q4 (highest)"}


def main():
    d = pd.read_parquet(INPUT)
    d["cat2"] = d["complaint_type"].map(categorize).fillna("other")

    # ── Sanity check on coverage ──
    cov = d.groupby("cat2").size()
    cov_pct = (cov / len(d) * 100).round(2)
    print("New category shares (overall):")
    for k in CATEGORY_ORDER:
        print(f"  {CATEGORY_LABEL[k]:24s} {cov.get(k,0):>10,d}  {cov_pct.get(k,0):.2f}%")

    # ── 1) category_resolution.json (per-quartile median per cat) ──
    rows = []
    for q in ["Q1", "Q2", "Q3", "Q4"]:
        dq = d[d["income_quartile"] == q]
        n_q = len(dq)
        for cat in CATEGORY_ORDER:
            sub = dq[dq["cat2"] == cat]
            n = len(sub)
            if n == 0:
                continue
            rh = sub["resolution_hours"].values
            rows.append({
                "quartile":   QUARTILE_LABEL[q],
                "category":   cat,
                "n":          int(n),
                "share_pct":  round(n / n_q * 100, 1),
                "median_h":   round(float(np.median(rh)), 2),
                "p5_h":       round(float(np.percentile(rh, 5)), 1),
                "p95_h":      round(float(np.percentile(rh, 95)), 1),
            })
    with open(f"{OUT_DIR}/category_resolution.json", "w") as f:
        json.dump(rows, f, indent=2)
    print(f"\nWrote {OUT_DIR}/category_resolution.json ({len(rows)} rows)")

    # ── 2) complaint_mix.json (shares + medians per quartile, all 4 cats) ──
    mix_rows = []
    for q in ["Q1", "Q2", "Q3", "Q4"]:
        dq = d[d["income_quartile"] == q]
        n_q = len(dq)
        shares, medians = {}, {}
        for cat in CATEGORY_ORDER:
            sub = dq[dq["cat2"] == cat]
            shares[cat]  = round(len(sub) / n_q * 100, 1)
            medians[cat] = round(float(sub["resolution_hours"].median()), 1) if len(sub) else None
        mix_rows.append({
            "quartile": QUARTILE_LABEL[q],
            "shares":   shares,
            "medians":  medians,
        })
    with open(f"{OUT_DIR}/complaint_mix.json", "w") as f:
        json.dump(mix_rows, f, indent=2)
    print(f"Wrote {OUT_DIR}/complaint_mix.json")

    # NOTE: Oaxaca-Blinder decomposition is computed at the complaint_type
    # level (in scripts/00b_decomposition.py), not at the category level, so
    # the new top-level taxonomy doesn't change those numbers. oaxaca.json is
    # left untouched here.

    # Compute share table for quartile mix sanity check
    cell_share = (
        d.groupby(["income_quartile", "cat2"]).size().unstack(fill_value=0)
    )
    for cat in CATEGORY_ORDER:
        if cat not in cell_share.columns:
            cell_share[cat] = 0
    cell_share = cell_share[CATEGORY_ORDER]
    row_totals = cell_share.sum(axis=1)
    cell_share = cell_share.div(row_totals, axis=0)

    print("\nNew category mix by quartile (shares, %):")
    print(f"{'quartile':14s}" + "".join(f"{CATEGORY_LABEL[c][:18]:>20s}" for c in CATEGORY_ORDER))
    for q in ["Q1", "Q2", "Q3", "Q4"]:
        line = f"{QUARTILE_LABEL[q]:14s}"
        for c in CATEGORY_ORDER:
            line += f"{cell_share.loc[q, c]*100:>20.1f}"
        print(line)


if __name__ == "__main__":
    main()
