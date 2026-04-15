# Why Do Some New Yorkers Wait Longer for City Services?

A data-driven visual story built on 3,187,149 closed NYC 311 service requests from 2024, investigating why lower-income neighborhoods experience longer resolution times. The narrative combines statistical decomposition with interactive D3.js charts to walk readers through the evidence step by step.

**[Read the story](https://shuqihong.github.io/nyc-service-gap/)**

## Key findings

- **A real three-fold wait gap.** The poorest quartile of NYC neighborhoods (Q1) waits a median of **10.8 hours** for a 311 complaint to close, while the wealthiest quartile (Q4) waits only **3.9 hours**. Q2 and Q3 fall in between at roughly 7 hours, forming a clean income staircase.
- **Income alone explains almost none of it.** Across all 3.2 million individual complaints, the Pearson correlation between neighborhood income and wait time is just **r = 0.046** (R² ≈ 0.002). Income at the individual-complaint level is nearly uninformative.
- **Complaint type is the dominant predictor.** Nested regression lifts R² from **12.3%** (income + month + filing channel) to **79.2%** once complaint type and city agency are added. Drop-one tests show complaint type alone accounts for **12.6 percentage points** of unique R², versus 1.2 pp for city agency and 0.05 pp for filing channel.
- **Complaint mix explains 97.8% of the Q1-Q4 gap.** Oaxaca-Blinder decomposition shows that if Q1 kept its own within-type response speeds but took Q4's complaint mix, its expected wait would drop from 12.6 hours to 1.7 hours, compared with Q4's actual 1.5 hours. Within the same complaint type, wealthier neighborhoods are only faster 52.3% of the time, essentially a coin flip.
- **A year-round baseline plus a winter spike.** Q4 is the fastest quartile in nearly every month. On top of that baseline, Q1 waits **25.3 hours** in January while Q4 waits **3.1**, a gap of over 22 hours that shrinks to roughly 1 hour by June. A single complaint type, **HEAT/HOT WATER**, drives the spike. In December, Q1 files 88.2 complaints per 10,000 residents, more than four times Q4's rate of 21.6. Adding the heat-share interaction to a month-only model lifts R² from 42.3% to 94.2%.
- **311 sits downstream of a housing problem, not a service-delivery problem.** For public-space issues (potholes, graffiti, noise), 311 dispatches directly to a city agency. For housing issues, 311 is an escalation mechanism that activates only after a tenant's private request to their landlord has failed. Poorer neighborhoods rely on this escalation path because their buildings break more often and their landlords defer repairs; wealthier neighborhoods resolve the same issues privately and never enter the dataset. The equity gap in 311 resolution time is, at its root, a housing-infrastructure crisis.

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
| 4 | `00_eda.py` | Neighborhood-level exploratory analysis covering resolution time by quartile, variable associations, nested regression, and complaint-category rollups |
| 5 | `00b_decomposition.py` | Oaxaca-Blinder decomposition of the Q1-Q4 wait gap into complaint-mix effect and within-type effect |
| 6 | `04_analyze.py` | Produces story-specific data slices (seasonal patterns, HEAT/HOT WATER surge, interior vs public infrastructure split) |
| 7 | `05_export.py` | Converts all analysis outputs to web-ready JSON / GeoJSON for the D3 charts |
| 8 | `generate_website_data.py` | Generates additional website JSON from EDA outputs |

## Website

The interactive story lives in `docs/`. It uses D3.js v7 for all visualizations, no build step required.

To run locally.

```bash
cd docs
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Methods

### Nested OLS regression with drop-one-block tests

**Goal.** Identify which variables actually explain the variation in resolution time, after controlling for the others. A naive correlation between income and wait time is noisy; a nested model isolates each predictor's unique contribution.

**Unit of analysis.** Cell-level medians at (modified ZCTA × month × complaint type × agency × channel), weighted by complaint count. Working in medians rather than raw rows collapses extreme right-tail noise and matches the scale at which the policy question is asked ("how long does a typical complaint of this kind wait in this neighborhood?").

**Specification.** I fit an ordinary least squares (OLS) linear regression of the form

```
median_wait ~ income_quartile + month + channel + agency + complaint_type
```

and add the predictors in blocks, one block at a time. The categorical variables (month, channel, agency, complaint_type) enter as sets of dummy variables. At each step I record R², the share of variance explained.

**Nested sequence.**

| Step | Blocks in the model | R² |
|---|---|---|
| 1 | income only | 0.001 |
| 2 | + month | 0.005 |
| 3 | + filing channel | 0.123 |
| 4 | + city agency | 0.666 |
| 5 | + complaint type | 0.792 |

**Drop-one-block test.** After fitting the full model, I refit it once with each block removed and record the drop in R². The difference, `R²_full − R²_without_block`, is that block's **unique contribution**, the variance only it can explain once the other variables are in. Complaint type contributes 12.6 percentage points, agency 1.2 pp, channel 0.05 pp. Income-quartile dummies contribute essentially nothing once complaint type is in the model.

**Interpretation.** Complaint type is not just the strongest predictor. It is the only predictor that matters at this scale. The gap looks like an income story at the aggregate, but once I hold the type of complaint constant, the income signal disappears. Whatever is driving the Q1-Q4 gap must operate *through* the composition of complaints, not through how quickly the same complaint gets handled.

### Oaxaca-Blinder decomposition

**Goal.** Quantify how much of the Q1-Q4 wait gap is driven by **what** Q1 and Q4 residents report (composition effect) versus **how fast** the same complaint gets handled in each (within-type effect). This is the standard labor-economics decomposition from Oaxaca (1973) and Blinder (1973).

**Setup.** Let `T` index complaint types, `s_q(T)` be the share of Q's complaints that are of type T, and `m_q(T)` be Q's median resolution time for type T. Observed median wait for quartile Q is approximately

```
W_q = Σ_T s_q(T) · m_q(T)
```

**Counterfactual.** I construct a synthetic Q1 that keeps its own within-type speeds `m_Q1(T)` but takes Q4's mix `s_Q4(T)`.

```
W_Q1^cf = Σ_T s_Q4(T) · m_Q1(T)
```

The gap then splits into

- **Composition effect** = `W_Q1 − W_Q1^cf` (how much faster Q1 would be if it had Q4's types)
- **Within-type effect** = `W_Q1^cf − W_Q4` (residual gap that survives even after fixing the mix)

**Result.** Q1's observed wait is 12.6 h, its counterfactual wait with Q4's mix is 1.7 h, and Q4's actual wait is 1.5 h. Composition accounts for (12.6 − 1.7) / (12.6 − 1.5) = **97.8%** of the gap; within-type speeds account for the remaining ~2%.

**Interpretation.** If Q1 filed the same kinds of complaints Q4 files, it would wait about as long as Q4 does. The equity gap is almost entirely a **mix problem**, not a treatment problem. The city is not meaningfully slower in poorer neighborhoods for the same job; poorer neighborhoods are reporting a harder mix of jobs.

### Complaint taxonomy and the interior/public split

**Goal.** Reduce roughly 200 raw complaint strings into a small set of categories that are analytically useful (stable sample sizes, interpretable labels) without hiding the mechanism that matters for the wait gap.

**Top-level categories.** Complaints are grouped into **Infrastructure**, **Health & Safety**, **Quality of Life**, and **Other**. Mapping is based on the underlying public-service function, not the NYC 311 agency routing.

**Why Infrastructure is split further.** Early EDA showed that "Infrastructure" is bimodal. Some infrastructure complaints close in hours, others take weeks. The split runs along a clean line, whether the problem is inside a building (private property) or out in public space. Median resolution times in 2024 (from [data/eda/decomp_E6_infra_subtype_by_quartile.csv](data/eda/decomp_E6_infra_subtype_by_quartile.csv)) illustrate the gap.

| Subtype | Example complaint | Median wait (Q1, hours) |
|---|---|---|
| Interior housing repair | PLUMBING | 189 |
| Interior housing repair | PAINT/PLASTER | 165 |
| Interior housing repair | ELECTRIC | 175 |
| Interior housing repair | DOOR/WINDOW | 241 |
| Interior housing repair | Elevator | 778 |
| Public infrastructure | Street Condition | 35 |
| Public infrastructure | Water System | 24 |
| Public infrastructure | Traffic Signal Condition | 2 |
| Public infrastructure | Sewer | 4 |

Interior housing repairs are typically **10 to 100× slower** than public-infrastructure repairs. Lumping them together would hide the most important mechanism in the dataset. Q1 is slow because its infrastructure complaints are overwhelmingly *interior housing repairs*, which are slow for **everyone**, including wealthier neighborhoods in the rare cases they file them.

**How the split is used.** The interior-vs-public distinction is not a statistical control, it is a lens. It motivates the final framing of the story. 311 acts as a **dispatch** system for public-space problems (complaint → agency → fix) and as an **escalation** system for housing problems (tenant → landlord fails → 311 → inspection → enforcement), and the second path is fundamentally slower by design.

### Seasonal interaction model

**Goal.** Explain why the Q1-Q4 gap widens dramatically in winter. Two competing hypotheses. (a) winter is a calendar effect, agencies slow down in cold months for everyone, and poor neighborhoods happen to get hit harder. (b) winter is a mix effect, poor neighborhoods file far more HEAT/HOT WATER complaints in winter, and that complaint type is inherently slow.

**Model type.** An ordinary least squares (OLS) linear regression fit at the cell level. Same estimator as the nested regression above, but on a different unit of analysis and with different predictors.

**Unit of analysis.** The 48 month-by-quartile cells (12 months × 4 income quartiles), with median wait computed per cell. Working at this aggregated scale lets me include `heat_share` as a cell-level mix variable, something that cannot exist at the complaint level where each row is either a heat complaint or not.

**Specification.**

```
median_wait ~ month + quartile + heat_share + quartile × heat_share
```

- `month`, 11 dummy variables (December is the reference)
- `quartile`, 3 dummies (Q4 is the reference)
- `heat_share`, continuous, the fraction of complaints in that month-quartile cell that are HEAT/HOT WATER
- `quartile × heat_share`, interaction term that lets the slope of `heat_share` vary by quartile

**Why this specification.** Crucially, the model has **no complaint-type fixed effects**. If I put the full complaint-type dummies in, the HEAT/HOT WATER dummy would absorb the mechanism and `heat_share` would look redundant. By leaving complaint_type out and putting `heat_share` in its place, the model is forced to express the seasonal mechanism through a single, interpretable coefficient, which is the whole point of this step.

**Fit.** A baseline model with month dummies only explains **42.3%** of the variation across the 48 cells. Adding `heat_share` and its interaction with quartile raises R² to **94.2%**.

**Interpretation.** The 52-percentage-point jump comes almost entirely from a single variable. The calendar explanation (option a) can only take the model from 0% to 42.3%; everything beyond that requires knowing what share of each cell's complaints are HEAT/HOT WATER. And the interaction coefficient is the clincher. The effect of heat_share on wait time is much stronger in Q1 than in Q4, meaning that in poorer neighborhoods, a larger heat share makes the queue worse than it would in wealthier ones (likely because those same neighborhoods are also the slowest to respond to the sheer volume of backlogged heat complaints). The winter spike is not a calendar phenomenon. It is a **mix phenomenon**, and the mix is concentrated in Q1 housing.

## References

- Blinder, A. S. (1973). Wage discrimination, reduced form and structural estimates. *Journal of Human Resources*, 8(4), 436-455. [https://doi.org/10.2307/144855](https://doi.org/10.2307/144855)
- Oaxaca, R. (1973). Male-female wage differentials in urban labor markets. *International Economic Review*, 14(3), 693-709. [https://doi.org/10.2307/2525981](https://doi.org/10.2307/2525981)
- Desmond, M. (2016). *Evicted, Poverty and Profit in the American City*. Crown Publishers. [https://www.evictedbook.com](https://www.evictedbook.com)
- NYU Furman Center. *State of New York City's Housing and Neighborhoods* (annual report series). [https://furmancenter.org/stateofthecity](https://furmancenter.org/stateofthecity)
- Rothstein, R. (2017). *The Color of Law, A Forgotten History of How Our Government Segregated America*. Liveright Publishing.
- U.S. Census Bureau. American Community Survey 5-Year Estimates, Table S1903 (Median Income in the Past 12 Months). [https://data.census.gov/table/ACSST5Y2022.S1903](https://data.census.gov/table/ACSST5Y2022.S1903)
- NYC Open Data. 311 Service Requests from 2010 to Present. [https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9)
