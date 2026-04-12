# Why Do Some New Yorkers Wait Longer for City Services?

A data-driven visual story built on 3.2 million closed NYC 311 service requests from 2024, investigating why lower-income neighborhoods experience longer resolution times. The narrative combines statistical decomposition with interactive D3.js charts to walk readers through the evidence step by step.

**[Read the story](https://shuqihong.github.io/nyc-service-gap/)**

## Key finding

97.8% of the resolution-time gap between the poorest and wealthiest neighborhoods is explained by complaint mix alone. Lower-income areas file more Infrastructure and Health & Safety complaints — types that are inherently slow to resolve — driven by aging housing stock. Within the same complaint type, wealthier neighborhoods sometimes wait even longer.

## Data sources

- **NYC Open Data** — [311 Service Requests](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9), 2024 closed complaints
- **U.S. Census Bureau** — [American Community Survey 5-Year Estimates](https://data.census.gov/table/ACSST5Y2022.S1903) (median household income, population by ZCTA)
- **NYC DOHMH** — [Modified ZCTA shapefile](https://github.com/nychealth/coronavirus-data/blob/master/Geography-resources/MODZCTA_2010_WGS1984.geo.json)

Raw data files are not included in this repo due to size (~3.7 GB). To reproduce, download the 311 dataset from NYC Open Data and place the CSV parts in `datasets/`.

## Pipeline

Scripts run in order. Each reads from the previous step's output.

| Script | What it does |
|---|---|
| `01_ingest.py` | Converts raw CSV chunks to Parquet |
| `02_clean.py` | Filters, validates, and cleans each chunk |
| `03_enrich.py` | Joins Census income/population data by ZIP |
| `04_analyze.py` | Produces story-specific data slices |
| `05_export.py` | Converts analysis outputs to web-ready JSON/GeoJSON |
| `00_eda.py` | Exploratory data analysis (run after `03_enrich.py`) |
| `00b_decomposition.py` | Oaxaca-Blinder decomposition (run after `00_eda.py`) |
| `generate_website_data.py` | Generates additional website JSON from EDA outputs |

## Website

The interactive story lives in `docs/`. It uses D3.js v7 for all visualizations — no build step required.

To run locally:

```bash
cd docs
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Methods

- **Oaxaca-Blinder decomposition** to quantify how much of the Q1-Q4 gap is explained by complaint type composition vs. within-type treatment differences
- **Pearson correlation** (r = 0.046, R² = 0.002) across 3.2M complaints showing income explains < 0.2% of individual resolution time variation
- **Seasonal gap analysis** across 177 neighborhoods revealing winter amplification driven by HEAT/HOT WATER complaints in aging buildings
