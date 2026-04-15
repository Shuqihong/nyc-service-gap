# Why Do Some New Yorkers Wait Longer for City Services?

A data-driven visual story built on 3,187,149 closed NYC 311 service requests from 2024, investigating why lower-income neighborhoods experience longer resolution times. The narrative combines statistical decomposition with interactive D3.js charts to walk readers through the evidence step by step.

**[Read the story](https://shuqihong.github.io/nyc-service-gap/)**

## Key findings

- **A real three-fold wait gap.** The poorest quartile of NYC neighborhoods (Q1) waits a median of **10.8 hours** for a 311 complaint to close, while the wealthiest quartile (Q4) waits only **3.9 hours**. Q2 and Q3 fall in between at roughly 7 hours, forming a clean income staircase.
- **Income alone explains almost none of it.** Across all 3.2 million individual complaints, the Pearson correlation between neighborhood income and wait time is just **r = 0.046** (R² ≈ 0.002). Income at the individual-complaint level is nearly uninformative.
- **Complaint type is the dominant predictor.** Nested regression lifts R² from **12.3%** (income + month + filing channel) to **79.2%** once complaint type and city agency are added. Drop-one tests show complaint type alone accounts for **12.6 percentage points** of unique R², versus 1.2 pp for city agency and 0.05 pp for filing channel.
- **Complaint mix explains 97.8% of the Q1-Q4 gap.** Oaxaca-Blinder decomposition shows that if Q1 kept its own within-type response speeds but took Q4's complaint mix, its expected wait would drop from 12.6 hours to 1.7 hours, compared with Q4's actual 1.5 hours. Within the same complaint type, wealthier neighborhoods are only faster 52.3% of the time, essentially a coin flip.
- **A year-round baseline plus a winter spike.** Q4 is the fastest quartile in nearly every month. On top of that baseline, Q1 waits **25.3 hours** in January while Q4 waits **3.1**, a gap of over 22 hours that shrinks to roughly 1 hour by June. A single complaint type, **HEAT/HOT WATER**, drives the spike: in December, Q1 files 88.2 complaints per 10,000 residents, more than four times Q4's rate of 21.6. Adding the heat-share interaction to a month-only model lifts R² from 42.3% to 94.2%.
- **311 sits downstream of a housing problem, not a service-delivery problem.** For public-space issues (potholes, graffiti, noise), 311 dispatches directly to a city agency. For housing issues, 311 is an escalation mechanism that activates only after a tenant's private request to their landlord has failed. Poorer neighborhoods rely on this escalation path because their buildings break more often and their landlords defer repairs; wealthier neighborhoods resolve the same issues privately and never enter the dataset. The equity gap in 311 resolution time is, at its root, a housing-infrastructure crisis.

## Data sources

- **NYC Open Data** — [311 Service Requests](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9), 2024 closed complaints (3,187,149 rows)
- **U.S. Census Bureau** — [American Community Survey 5-Year Estimates](https://data.census.gov/table/ACSST5Y2022.S1903) (median household income, population by ZCTA)
- **NYC DOHMH** — [Modified ZCTA shapefile](https://github.com/nychealth/coronavirus-data/blob/master/Geography-resources/MODZCTA_2010_WGS1984.geo.json) for the choropleth map

Raw data files are not included in this repo due to size (~3.7 GB). To reproduce, download the 311 dataset from NYC Open Data and place the CSV parts in `datasets/`.

## Pipeline

Scripts run in order. Each reads from the previous step's output.

| Step | Script | What it does |
|---|---|---|
| 1 | `01_ingest.py` | Converts raw NYC 311 CSV chunks to Parquet |
| 2 | `02_clean.py` | Filters to closed complaints, validates fields, drops malformed rows, computes resolution time |
| 3 | `03_enrich.py` | Joins Census household-income and population data by ZIP / modified ZCTA, assigns each complaint to an income quartile (Q1-Q4) |
| 4 | `00_eda.py` | Neighborhood-level exploratory analysis: resolution time by quartile, heat map of variable associations, nested regression, complaint-category rollups |
| 5 | `00b_decomposition.py` | Oaxaca-Blinder decomposition of the Q1-Q4 wait gap into complaint-mix effect and within-type effect |
| 6 | `04_analyze.py` | Produces story-specific data slices (seasonal patterns, HEAT/HOT WATER surge, interior vs public infrastructure split) |
| 7 | `05_export.py` | Converts all analysis outputs to web-ready JSON / GeoJSON for the D3 charts |
| 8 | `generate_website_data.py` | Generates additional website JSON from EDA outputs |

## Website

The interactive story lives in `docs/`. It uses D3.js v7 for all visualizations, no build step required.

To run locally:

```bash
cd docs
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Methods

- **Pearson correlation** on all 3.2 million individual complaints to test the naive hypothesis that neighborhood income predicts resolution time. Result: r = 0.046, R² = 0.002. Income at the complaint level is essentially uninformative.
- **Variable-association heat map** across seven candidate predictors (income quartile, month, filing channel, city agency, complaint type, population, borough) to surface which pairs are correlated before fitting any model.
- **Nested OLS regression** on neighborhood-month medians, adding predictor blocks one at a time (income + month + channel → + agency → + complaint type). R² is tracked at each step, and a **drop-one-block test** on the full model isolates each variable's unique contribution after controlling for the others.
- **Oaxaca-Blinder decomposition** (Oaxaca 1973; Blinder 1973) to split the Q1-Q4 gap into the portion explained by differences in complaint-type composition and a residual that survives after holding the mix fixed. A counterfactual Q1 with Q4's mix but Q1's within-type speeds quantifies the composition effect.
- **Complaint taxonomy.** Raw complaint strings (roughly 200 distinct values) are grouped into four categories: Infrastructure, Health & Safety, Quality of Life, and Other. Infrastructure is further split into **interior housing repairs** (plumbing, elevators, etc.) and **public infrastructure** (street conditions, sewers, etc.) because the two behave very differently in resolution time.
- **Seasonal interaction model** fit on the 48 month-by-quartile cells:
  `median_wait ~ month + quartile + heat_share + quartile × heat_share`.
  A month-only baseline explains 42.3% of variation; adding HEAT/HOT WATER share and its interaction with quartile raises R² to 94.2%, indicating the winter spike is a mix effect concentrated in lower-income housing rather than a calendar effect.
- **Within-cell comparison.** For every (borough × agency × complaint category × month) cell present in both Q1 and Q4, we check which quartile is faster. Q4 is faster in only 52.3% of such matched cells, confirming that speed differences within comparable cases are near zero.

## References

- Blinder, A. S. (1973). Wage discrimination: reduced form and structural estimates. *Journal of Human Resources*, 8(4), 436-455. [https://doi.org/10.2307/144855](https://doi.org/10.2307/144855)
- Oaxaca, R. (1973). Male-female wage differentials in urban labor markets. *International Economic Review*, 14(3), 693-709. [https://doi.org/10.2307/2525981](https://doi.org/10.2307/2525981)
- Desmond, M. (2016). *Evicted: Poverty and Profit in the American City*. Crown Publishers. [https://www.evictedbook.com](https://www.evictedbook.com)
- NYU Furman Center. *State of New York City's Housing and Neighborhoods* (annual report series). [https://furmancenter.org/stateofthecity](https://furmancenter.org/stateofthecity)
- Rothstein, R. (2017). *The Color of Law: A Forgotten History of How Our Government Segregated America*. Liveright Publishing.
- U.S. Census Bureau. American Community Survey 5-Year Estimates, Table S1903 (Median Income in the Past 12 Months). [https://data.census.gov/table/ACSST5Y2022.S1903](https://data.census.gov/table/ACSST5Y2022.S1903)
- NYC Open Data. 311 Service Requests from 2010 to Present. [https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9)
