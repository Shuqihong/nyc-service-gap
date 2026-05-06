# Why Do Some New Yorkers Wait Longer for City Services?

A data-driven visual story built on 3,187,149 closed NYC 311 service requests from 2024, investigating why lower-income neighborhoods experience longer resolution times. The narrative combines statistical decomposition with interactive D3.js charts to walk readers through the evidence step by step.

**[Read the story](https://shuqihong.github.io/nyc-service-gap/)**

## Key findings

- **A real three-fold wait gap.** The poorest quartile of NYC neighborhoods (Q1) waits a median of 10.8 hours for a 311 complaint to close, while the wealthiest (Q4) waits 3.9 hours. Q2 and Q3 sit between them at roughly seven hours each, descending step by step from the poorest neighborhoods to the richest.
- **Income alone explains almost none of it.** Across all 3.2 million individual complaints, the Pearson correlation between neighborhood income and resolution time is r = 0.046, very close to zero. The staircase emerges only when complaints are aggregated to the quartile level; at the per-complaint level, income is nearly uninformative.
- **Complaint type is the dominant predictor.** A nested regression on five candidate predictors (income, neighborhood complaint volume, complaint type, filing channel, city agency) lifts R² from 0.2% (income + complaint volume) to 77.8% the moment complaint type enters, and only to 78.9% with the remaining variables. Once complaint type is in the model, nothing else carries meaningful new information.
- **Complaint mix explains 97.8% of the Q1–Q4 gap.** Oaxaca-Blinder decomposition shows that if Q1 kept its own within-type response speeds but took Q4's complaint mix, its expected wait would fall from 12.6 hours to 1.7 hours, almost indistinguishable from Q4's actual 1.5.
- **A year-round gap with a winter spike concentrated in Q1.** Q2, Q3, and Q4 stay within a relatively narrow monthly band, with only a slight winter rise. Q1's monthly median swings dramatically, climbing well above the rest in December and January and dropping substantially through late spring and summer. HEAT/HOT WATER complaints drive the spike: in December, Q1 files 88.2 complaints per 10,000 residents, more than four times Q4's rate of 21.6. The seasonal pattern reflects heating-related housing problems concentrated in poorer neighborhoods during the coldest months.
- **311 sits downstream of a housing problem, not a service-delivery problem.** For public-space issues (potholes, graffiti, noise), 311 dispatches directly to a city agency. For housing issues, 311 is an escalation mechanism that activates only after a tenant's private request to a landlord has been ignored. Poorer neighborhoods rely on that escalation path because their buildings break more often and their landlords defer repairs; wealthier neighborhoods resolve the same issues privately, before any complaint is filed, and never enter the dataset. The equity gap in 311 resolution time is, at its root, a housing-infrastructure crisis made visible through the city's own records.

## Data sources

- **NYC Open Data**, [311 Service Requests](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9), 2024 closed complaints (3,187,149 rows)
- **U.S. Census Bureau**, [American Community Survey 5-Year Estimates](https://data.census.gov/table/ACSST5Y2022.S1903) (median household income, population by ZCTA)
- **NYC DOHMH**, [Modified ZCTA shapefile](https://github.com/nychealth/coronavirus-data/blob/master/Geography-resources/MODZCTA_2010_WGS1984.geo.json) for the choropleth map

Raw data files are not included in this repo due to size (~3.7 GB). To reproduce, download the 311 dataset from NYC Open Data and place the CSV parts in `datasets/`.

## Pipeline

Scripts run in order. Each reads from the previous step's output.

| Step | Script | What it does |
|---|---|---|
| 1 | `01_ingest.py` | Converts raw NYC 311 CSV chunks to Parquet |
| 2 | `02_clean.py` | Filters to closed complaints, validates fields, drops malformed rows, computes resolution time |
| 3 | `03_enrich.py` | Joins Census household-income and population data by ZIP / modified ZCTA, assigns each complaint to an income quartile (Q1-Q4) |
| 4 | `00_eda.py` | Quartile medians, variable associations, complaint-category rollups |
| 5 | `00b_decomposition.py` | Oaxaca-Blinder decomposition of the Q1-Q4 wait gap into complaint-mix effect and within-type effect |
| 6 | `04_analyze.py` | Story-specific data slices (seasonal patterns, HEAT/HOT WATER surge) |
| 7 | `05_export.py` | Converts analysis outputs to web-ready JSON / GeoJSON for the D3 charts |
| 8 | `generate_website_data.py` | Generates additional website JSON from EDA outputs |
| 9 | `06_recategorize.py` | Rebuilds complaint taxonomy along interior-vs-public lines and refreshes the category-bar and complaint-mix JSON |

## Website

The interactive story lives in `docs/`. It uses D3.js v7 for all visualizations, no build step required.

To run locally.

```bash
cd docs
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Methods

The analysis layers four methods on top of the same dataset. The first two — headline medians and Pearson correlation — establish the gap exists. The third (nested regression) shows which variable drives it. The fourth (Oaxaca decomposition) quantifies how much of the gap is attributable to that driver. A separate seasonal model handles the winter amplifier. A complaint taxonomy is used only for visualization and does not feed into any of the regressions or the decomposition.

### Headline median resolution time

**Goal.** Show whether wait time differs across income quartiles at the per-complaint level.

**Unit of analysis.** Single complaint. Each closed 311 complaint contributes one number (`resolution_hours`) to its quartile's pool.

**How it's computed.** Group all 3.17 M closed 2024 complaints by their neighborhood's income quartile, and take the population median of `resolution_hours` within each group.

**Result.** Q1 = 10.8 h, Q2 ≈ 7 h, Q3 ≈ 7 h, Q4 = 3.9 h. A clean staircase from poorest to wealthiest neighborhoods.

### Pearson correlation (income vs. resolution time)

**Goal.** Test whether neighborhood income, on its own, predicts how long an individual complaint takes to resolve.

**Unit of analysis.** Single complaint. Each row contributes one income value (its neighborhood's median household income) and one resolution time.

**How it's computed.** Standard Pearson correlation between log income and log resolution time across all 3.17 M complaints.

**Result.** r = 0.046 — almost zero linear relationship at the individual level. The clean Q1 → Q4 staircase from the headline view is real but only emerges after averaging within quartiles; at the per-complaint level it's drowned by within-quartile variation in complaint type, agency, and channel.

### Nested regression

**Goal.** Identify which variable actually drives resolution time when several plausible drivers are correlated with each other. Each step in the nested sequence shows how much *new* variance the added predictor block explains over what was already in.

**Unit of analysis.** Single complaint. The model is fit on a random sample of 500 K of the 3.17 M closed 2024 complaints (chosen for tractability with the wide categorical encoding).

**Target variable.** `log_resolution_hours` — log of resolution time. Logs reduce the influence of the long right tail (a single 4 000-hour complaint won't pull every coefficient toward itself).

**Predictors.** Five blocks added in this order:

1. `log_income` — log of the neighborhood's median household income. Continuous.
2. `total_complaints` — total 311 complaints filed in that neighborhood across 2024. Continuous, log-transformed.
3. `complaint_type` — the raw complaint string (HEAT/HOT WATER, PLUMBING, Noise — Residential, etc.). 158 distinct values; sparse types collapsed into `__OTHER__`. One-hot encoded.
4. `channel` — how the complaint was filed (PHONE, ONLINE, MOBILE, etc.). One-hot encoded.
5. `agency` — the city agency the complaint was routed to (HPD, DOT, NYPD, etc.). One-hot encoded.

`log_income` and `total_complaints` are neighborhood-level — every complaint filed in the same modified ZCTA carries the same value. The other three vary per complaint.

**Estimator.** Ridge regression (regularized least squares) with α = 1.0, fit on a sparse design matrix.

**Why complaint_type is added third.** Order matters for the *step-by-step* readout: each step's R² gain reflects what the new block adds *given everything before it*. Putting complaint_type third lets the chart visually carry the headline — once it enters, R² jumps from 0.002 to 0.778, and the two remaining additions (channel, agency) add 0.000 and 0.012. The reader sees the cliff directly.

**Nested sequence.**

| Step | Blocks in the model | R² |
|---|---|---|
| 1 | income only | 0.001 |
| 2 | + total complaints | 0.002 |
| 3 | + complaint type | 0.778 |
| 4 | + filing channel | 0.778 |
| 5 | + city agency | 0.789 |

**Interpretation.** Complaint type is not just the strongest predictor — it is essentially the only predictor that matters at the per-complaint level. Once you know what kind of problem you're looking at, neighborhood income, neighborhood complaint volume, filing channel, and city agency add almost no new information. The Q1–Q4 gap must operate *through* the composition of complaints filed, not through how quickly the same complaint gets handled.

### Oaxaca-Blinder decomposition

**Goal.** Quantify how much of the Q1–Q4 wait gap is driven by **what** Q1 and Q4 residents report (composition effect) versus **how fast** the same complaint gets handled in each (within-type effect). The standard labor-economics decomposition from Oaxaca (1973) and Blinder (1973).

**Unit of analysis.** Aggregated to the **complaint-type level**. For each of the ~158 raw complaint-type strings, the decomposition uses two numbers per quartile: how common that type is in the quartile (its share), and how long that type typically takes in the quartile (its median resolution time).

The decomposition uses the raw type strings, not the four-category taxonomy below. The result is independent of how the taxonomy is drawn.

**How it's computed (in plain English).**

1. **Per-type medians.** For every (complaint_type, quartile) pair, compute the median resolution time. Q1's HEAT/HOT WATER has its own median, Q4's HEAT/HOT WATER has its own, and so on across all ~158 types.
2. **Per-type shares.** For each quartile, count complaints of each type and convert to shares (e.g., Illegal Parking is 13 % of Q1's complaints, 24 % of Q4's).
3. **Build three "typical wait" numbers.**
   - **Q1 actual** — sort Q1's type-medians ascending, weight each by Q1's share of that type, and take the weighted median (the type-median where cumulative Q1-share crosses 50 %). Result: **12.6 h**.
   - **Q4 actual** — same procedure with Q4's medians and Q4's shares. Result: **1.5 h**.
   - **Counterfactual: Q1 with Q4's mix** — Q1's type-medians (so Q1's speeds), but Q4's shares (so Q4's mix). Result: **1.7 h**.
4. **Decompose the gap.**
   - Composition effect = 12.6 − 1.7 = **10.9 h** (gap closed by switching Q1's mix to Q4's).
   - Within-type effect = 1.7 − 1.5 = **0.2 h** (gap that remains even after the mix is fixed).
   - Composition share = 10.9 / 11.1 = **97.8 %**.

**Why these numbers don't equal the headline medians.** The Oaxaca "Q1 actual" of 12.6 h is *not* the same statistic as the headline 10.8 h. The headline is a flat population median across individual complaints; Oaxaca's "actual" is a weighted median computed over type-level medians. They measure related things at different aggregation levels, and the decomposition needs the type-level view to construct the counterfactual.

**Interpretation.** If Q1 filed the same kinds of complaints Q4 files, it would wait about as long as Q4 does. The equity gap is almost entirely a **mix problem**, not a treatment problem.

### Complaint taxonomy

**Goal.** Reduce ~200 raw complaint strings into a small, interpretable set of categories for the visualizations (the bar chart and the stacked complaint-mix chart). The taxonomy is a labeling layer for charts; it does *not* enter the regression or the Oaxaca decomposition.

**Top-level categories.** The mapping carves on **where the broken asset sits and which agency owns it**, since that's what drives resolution time:

- **Interior Housing** — problems inside someone's apartment, mostly routed to HPD: HEAT/HOT WATER, plumbing, water leaks, electrical, paint & plaster, doors & windows, flooring, appliances, elevators, pests, mold, lead, asbestos.
- **Public Infrastructure** — physical assets in the public realm, routed to DOT, DEP, or DPR: street conditions, potholes, sidewalks, street lights, traffic signals, water mains, sewers, street trees.
- **Quality of Life** — nuisances in shared space, mostly NYPD or DSNY: noise (residential, street, vehicle, etc.), dirty conditions, graffiti, encampments, illegal dumping, panhandling.
- **Other** — everything else: parking violations, abandoned vehicles, missed sanitation pickups, food-establishment inspections.

**Why this carve.** An earlier version used "Health & Safety" and "Infrastructure" as separate top-level buckets, but the cut mixed interior and public assets — HEAT/HOT WATER (interior, slow) sat under Health & Safety while PLUMBING (also interior, also slow) sat under Infrastructure, even though the two behave identically. The new taxonomy splits along the axis that actually matches the agency-routing mechanism driving resolution time.

**Within-category resolution times.** Median resolution time is broadly similar across quartiles within each category — what changes from Q1 to Q4 is not how fast each kind of complaint is handled, but how often each kind is filed. Approximate per-category medians (see [docs/public/data/category_resolution.json](docs/public/data/category_resolution.json) for the exact numbers and per-quartile breakdown):

| Category | Overall median |
|---|---|
| Interior Housing | ~117 h |
| Public Infrastructure | ~65 h |
| Quality of Life | ~1 h |
| Other | ~3 h |

### Monthly view of the gap

**Goal.** See whether the cross-sectional mix story holds up across the calendar year, and where the seasonal pattern is concentrated.

**Unit of analysis.** **48 cells** = 12 months × 4 income quartiles. For each cell, compute the median resolution time of all closed 311 complaints filed that month in that quartile.

**How it's computed.** No regression — just descriptive monthly medians. The two charts on the page plot:

1. Median resolution time by month and quartile (the seasonal-trend line chart).
2. HEAT/HOT WATER complaint rate per 10,000 residents by month and quartile (the heat-rate chart that explains the seasonal pattern).

**Result.** Q2, Q3, and Q4 stay in a relatively narrow band throughout the year with only a slight winter rise; Q4 is consistently the fastest in nearly every month. Q1 swings dramatically, with monthly medians stretching much longer in December and January and dropping substantially in late spring and summer. The heat-rate chart explains it: HEAT/HOT WATER complaints rise sharply in winter, and the rise is much steeper in lower-income neighborhoods (Q1 December rate ≈ 88.2 per 10K residents vs. Q4's 21.6).

**Interpretation.** The seasonal swing in Q1 isn't a generic winter slowdown — it's the same complaint-mix mechanism playing out over time. Heating-related housing problems concentrate in poorer neighborhoods during the coldest months, and they flow into 311 as the slow Interior Housing complaints already established in the cross-sectional view.

## References

- Blinder, A. S. (1973). Wage discrimination, reduced form and structural estimates. *Journal of Human Resources*, 8(4), 436-455. [https://doi.org/10.2307/144855](https://doi.org/10.2307/144855)
- Oaxaca, R. (1973). Male-female wage differentials in urban labor markets. *International Economic Review*, 14(3), 693-709. [https://doi.org/10.2307/2525981](https://doi.org/10.2307/2525981)
- Desmond, M. (2016). *Evicted, Poverty and Profit in the American City*. Crown Publishers. [https://www.evictedbook.com](https://www.evictedbook.com)
- NYU Furman Center. *State of New York City's Housing and Neighborhoods* (annual report series). [https://furmancenter.org/stateofthecity](https://furmancenter.org/stateofthecity)
- Rothstein, R. (2017). *The Color of Law, A Forgotten History of How Our Government Segregated America*. Liveright Publishing.
- U.S. Census Bureau. American Community Survey 5-Year Estimates, Table S1903 (Median Income in the Past 12 Months). [https://data.census.gov/table/ACSST5Y2022.S1903](https://data.census.gov/table/ACSST5Y2022.S1903)
- NYC Open Data. 311 Service Requests from 2010 to Present. [https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9)
