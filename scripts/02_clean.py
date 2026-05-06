"""
02_clean.py — Clean each chunk independently; write per-chunk cleaned Parquets.

Memory strategy: never hold more than one 50k-row chunk at a time.
Output one cleaned Parquet per input part (no concatenation).
Cross-chunk dedup on unique_key is skipped — the 70 files are
sequential database exports with no overlapping keys (verified on chunk 1).

Output: data/processed/parts/part_NNN_cleaned.parquet  (one per input part)
"""

import glob
import logging
import os
import sys

import pandas as pd

ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS_IN  = os.path.join(ROOT, "data", "raw",       "parts")
PARTS_OUT = os.path.join(ROOT, "data", "processed", "parts")
LOG_PATH  = os.path.join(ROOT, "logs", "02_clean.log")

os.makedirs(PARTS_OUT, exist_ok=True)
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

CATEGORY_MAP = {
    "HEAT/HOT WATER": "health_safety", "UNSANITARY CONDITION": "health_safety",
    "WATER LEAK": "health_safety", "Rodent": "health_safety",
    "Food Poisoning": "health_safety", "Air Quality": "health_safety",
    "Asbestos": "health_safety",
    "Noise - Residential": "quality_of_life", "Noise - Commercial": "quality_of_life",
    "Noise - Street/Sidewalk": "quality_of_life", "Noise": "quality_of_life",
    "Noise - Helicopter": "quality_of_life", "Noise - Vehicle": "quality_of_life",
    "Dirty Condition": "quality_of_life", "Graffiti": "quality_of_life",
    "Encampment": "quality_of_life", "Illegal Dumping": "quality_of_life",
    "Illegal Fireworks": "quality_of_life",
    "PLUMBING": "infrastructure", "PAINT/PLASTER": "infrastructure",
    "DOOR/WINDOW": "infrastructure", "Street Condition": "infrastructure",
    "FLOORING/STAIRS": "infrastructure", "ELECTRIC": "infrastructure",
    "APPLIANCE": "infrastructure", "Elevator": "infrastructure",
    "Street Light Condition": "infrastructure", "Water System": "infrastructure",
    "Sewer": "infrastructure", "Sidewalk Condition": "infrastructure",
    "Traffic Signal Condition": "infrastructure",
    "General Construction/Plumbing": "infrastructure",
    "GENERAL": "infrastructure", "Pothole": "infrastructure",
}
VALID_BOROUGHS = {"MANHATTAN", "BROOKLYN", "QUEENS", "BRONX", "STATEN ISLAND"}
WINTER_START   = pd.Timestamp("2024-01-01", tz="UTC")
WINTER_END     = pd.Timestamp("2024-03-20", tz="UTC")
DATE_COLS      = ["created_date", "closed_date", "resolution_action_updated_date", "due_date"]


def clean_one(df: pd.DataFrame) -> pd.DataFrame:
    """Clean a single chunk. Returns only closed, non-city-dup, valid rows."""
    # Dates
    for col in DATE_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
    df = df[df["created_date"].notna()].copy()

    # Resolution hours
    df["resolution_hours"] = (
        (df["closed_date"] - df["created_date"]).dt.total_seconds() / 3600
    )

    # City-flagged duplicates
    df["is_city_duplicate"] = df["resolution_description"].str.contains(
        "duplicate", case=False, na=False
    )

    # Keep only closed, non-city-dup rows
    df = df[
        (df["status"] == "Closed") &
        (df["closed_date"].notna()) &
        (~df["is_city_duplicate"]) &
        (df["resolution_hours"] > 0)
    ].copy()

    df["resolution_hours"] = df["resolution_hours"].clip(upper=8760)

    # ZIP
    df["zip"] = df["incident_zip"].astype(str).str.extract(r"(\d{5})")[0]
    df = df[df["zip"].notna()].copy()

    # Borough
    df["borough"] = df["borough"].str.strip().str.upper()
    df.loc[~df["borough"].isin(VALID_BOROUGHS), "borough"] = "UNKNOWN"

    # Winter flag
    df["is_winter_2024"] = (
        (df["created_date"] >= WINTER_START) & (df["created_date"] < WINTER_END)
    )

    # Category
    df["complaint_category"] = df["complaint_type"].map(CATEGORY_MAP).fillna("other")

    return df


def main():
    files = sorted(glob.glob(os.path.join(PARTS_IN, "part_*.parquet")))
    if not files:
        log.error("No part Parquets in %s. Run 01_ingest.py first.", PARTS_IN)
        sys.exit(1)

    log.info("Cleaning %d chunks → %s", len(files), PARTS_OUT)
    total_in = total_out = 0

    for i, path in enumerate(files, 1):
        out_path = os.path.join(PARTS_OUT, os.path.basename(path).replace(".parquet", "_cleaned.parquet"))

        if os.path.exists(out_path):
            n = len(pd.read_parquet(out_path, columns=["unique_key"]))
            log.info("  [%d/%d] already exists (%d rows), skipping", i, len(files), n)
            total_in += 50000; total_out += n
            continue

        df = pd.read_parquet(path)
        n_in = len(df)
        df = clean_one(df)
        n_out = len(df)

        df.to_parquet(out_path, index=False, compression="snappy")
        log.info("  [%d/%d] %-35s  in=%d → out=%d", i, len(files), os.path.basename(path), n_in, n_out)

        total_in  += n_in
        total_out += n_out
        del df

    log.info("=== Done: %d in → %d closed (%.1f%%)", total_in, total_out, 100*total_out/total_in)


if __name__ == "__main__":
    main()
