"""
01_ingest.py — Convert raw 311 CSV chunks to individual Parquet files.

Strategy (memory-safe for 70 × 50k rows):
  - Process one CSV at a time; never hold more than one file in memory
  - Save each as a typed Parquet file in data/raw/parts/
  - Parquet uses columnar compression → ~10x smaller than CSV-as-strings
  - Later scripts (02_clean.py) read the parts directory as a dataset,
    which loads typed binary data instead of Python string objects,
    making the full 3.5M row dataset manageable in memory.

Cross-chunk deduplication on unique_key is done in 02_clean.py after
all parts are loaded, since a key appearing in two chunks is rare but
possible at the boundary between adjacent files.

Output: data/raw/parts/part_NNN.parquet  (one per CSV)
        data/raw/ingest_summary.csv       (row counts per file)
"""

import glob
import logging
import os
import sys

import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASETS_DIR = os.path.join(ROOT, "datasets")
PARTS_DIR    = os.path.join(ROOT, "data", "raw", "parts")
SUMMARY_PATH = os.path.join(ROOT, "data", "raw", "ingest_summary.csv")
LOG_PATH     = os.path.join(ROOT, "logs", "01_ingest.log")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
os.makedirs(PARTS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


def main():
    pattern = os.path.join(DATASETS_DIR, "erm2-nwe9_2024_part_*.csv")
    files   = sorted(glob.glob(pattern))
    if not files:
        log.error("No CSV files found matching: %s", pattern)
        sys.exit(1)

    log.info("Found %d CSV file(s). Converting to Parquet one at a time.", len(files))

    summary_rows = []
    total_rows   = 0

    for i, csv_path in enumerate(files, start=1):
        basename  = os.path.basename(csv_path)
        part_name = f"part_{i:03d}.parquet"
        out_path  = os.path.join(PARTS_DIR, part_name)

        # Skip if already converted (allows resuming interrupted runs)
        if os.path.exists(out_path):
            existing = pd.read_parquet(out_path, columns=["unique_key"])
            n = len(existing)
            log.info("  [%d/%d] %s — already exists (%d rows), skipping",
                     i, len(files), basename, n)
            total_rows += n
            summary_rows.append({"file": basename, "part": part_name, "rows": n, "status": "skipped"})
            continue

        # Read CSV as strings (safe, no type coercion)
        df = pd.read_csv(csv_path, dtype=str, low_memory=False)
        n  = len(df)
        log.info("  [%d/%d] %-55s  rows=%d", i, len(files), basename, n)

        # Save as Parquet (columnar, compressed — much smaller and faster to read)
        df.to_parquet(out_path, index=False, compression="snappy")

        total_rows += n
        summary_rows.append({"file": basename, "part": part_name, "rows": n, "status": "converted"})

        # Free memory immediately
        del df

    log.info("Done. Total rows across all files: %d", total_rows)
    log.info("Parts directory: %s", PARTS_DIR)

    # Save summary
    pd.DataFrame(summary_rows).to_csv(SUMMARY_PATH, index=False)
    log.info("Summary saved → %s", SUMMARY_PATH)


if __name__ == "__main__":
    main()
