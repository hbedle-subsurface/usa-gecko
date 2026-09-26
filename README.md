# Introduced species in the United States

An interactive map of introduced species across the contiguous United States, by county and year, alongside county winter minimum temperatures, observer effort, distance to the nearest Interstate, distance to the nearest large city, and population density.

| Group | Species | Scientific name | Effort group |
|---|---|---|---|
| Lizards | Mediterranean house gecko | *Hemidactylus turcicus* | all lizards and snakes (Squamata) |
| | Tropical house gecko | *Hemidactylus mabouia* | Squamata |
| | Indo-Pacific gecko | *Hemidactylus garnotii* | Squamata |
| | Brown anole | *Anolis sagrei* | Squamata |
| | Northern curly-tailed lizard | *Leiocephalus carinatus* | Squamata |
| | Italian wall lizard | *Podarcis siculus* | Squamata |
| | Common wall lizard | *Podarcis muralis* | Squamata |
| Snakes | Brahminy blind snake | *Indotyphlops braminus* | Squamata |
| Frogs and toads | Cuban treefrog | *Osteopilus septentrionalis* | all frogs and toads (Anura) |
| | Cane toad | *Rhinella marina* | Anura |
| Insects | Spotted lanternfly | *Lycorma delicatula* | all insects (Insecta) |

The site grew out of an Oklahoma-only version for the Mediterranean house gecko ([ok-gecko](https://github.com/hbedle-subsurface/ok-gecko)).

Authors: _add names here_

## What the site shows

- **Species.** The menu at the top of the panel switches the whole site to another species.
- **Map.** About 3,100 counties in the 48 contiguous states and the District of Columbia, colored by one of six quantities: year of first record, December–February mean minimum temperature for the selected winter, effort-group records that year, distance to the nearest Interstate, distance to the nearest city of 100,000 or more, or 2020 population density. Records up to the selected year appear as points. State outlines and city names are shown by default; the national view names only cities of a million or more, and smaller cities appear on zooming in. Interstates and markers for every city of 100,000+ can be switched on as overlays.
- **Region.** Choosing a state zooms the map to it and limits the timeline, the county count and the scatter plot to that state's counties.
- **Timeline.** Records of the species per year and all effort-group records per year for the chosen region. Dragging along it, or using the arrow keys, sets the year; Play steps through the years.
- **Counties with a record.** The running count of counties with at least one record.
- **First record against a county property.** One point per county, with the year of its first record on the vertical axis and a choice of horizontal axis: 1991–2020 mean winter minimum temperature, distance to the nearest Interstate, distance to the nearest city of 100,000+, or population density. Counties without a record by the selected year sit in a band along the top. The Spearman rank correlation below the plot is computed over the counties that have a record.
- **County detail.** Clicking a county on the map or in the scatter plot shows its values and its winter temperature through time, with the years of records marked.

Axes and color scales are fixed across years. The timeline and county-count axes are set per species and region, so they change when either changes but not as the year changes.

## How the human-movement measures are defined

All distances are straight-line distances in kilometers, measured in an equal-area projection (EPSG:5070, CONUS Albers).

| Measure | Definition |
|---|---|
| Distance to nearest Interstate | From the county's 2020 center of population to the nearest Interstate segment |
| Interstate inside county | Length of Interstate within the county outline |
| Distance to nearest city of 100,000+ | From the county's center of population to the nearest listed city of 100,000 or more |
| Population density | 2020 Census population divided by county land area |

The center of population is the point where a county's population would balance if each person had equal weight, as published by the Census Bureau. It sits where people live, which in large western counties can be far from the geometric center.

## Data sources

| Source | What is used |
|---|---|
| [GBIF](https://www.gbif.org) occurrence API | Records of each species with coordinates in the US; Squamata and Insecta record counts per county and year |
| [NOAA NCEI nClimDiv](https://www.ncei.noaa.gov/pub/data/cirs/climdiv/), county file `climdiv-tmincy` | Monthly mean minimum temperature per county, 1895–present |
| U.S. Census Bureau cartographic county boundaries (via the plotly `geojson-counties-fips` file) | County outlines, state outlines (counties merged by state) and land area |
| U.S. Census Bureau 2020 county centers of population (`CenPop2020_Mean_CO`, via the `USpopcenters` R package) | 2020 population and population center of each county |
| [Natural Earth](https://www.naturalearthdata.com/) 1:10m roads, `level = Interstate` | Interstate lines |
| plotly `us-cities-top-1k` list | Cities of 100,000 or more with coordinates |

## Building the data

Everything that changes over time is made by `scripts/build_data.py`, which uses only the Python standard library. The species list is the `SPECIES` table at the top of the script; adding a species means adding a line there (scientific name, common name, phylum, and which effort group it uses).

**On GitHub.** Open the **Actions** tab, choose **Build data**, and press **Run workflow**. It commits its results to `data/` and reruns on the first of each month. If the commit step fails with a permissions error, set **Settings → Actions → General → Workflow permissions** to "Read and write permissions".

Two things keep each run inside GitHub's time limit:

- A species' records are downloaded at most once a month. Later runs in the same month reuse the saved county counts.
- The effort counts need one GBIF request per county for each effort group, about 3,100 per group, and GBIF answers these slowly. Counts are saved in `data/effort_cache.json` as they arrive, and a run stops starting new requests about 115 minutes after it began. The first full build therefore takes several runs. The end of each run's log lists how many counties are still without counts for each group, and running the workflow again continues from there. Counties not yet counted show zero effort and are marked "not yet queried" in `county_summary.csv`.

**On a computer.**

```
python scripts/build_data.py
python -m http.server 8000
```

then open http://localhost:8000.

The static files (county and state outlines, GBIF query polygons, Interstates, cities, county covariates) were made once with `scripts/prepare_static.py`, which lists its inputs and needs `shapely`, `pyproj` and `pyreadr`.

### Files produced

| File | Contents |
|---|---|
| `data/species/<species>/county_summary.csv` | One row per county: first record year, record total, effort total, normal winter minimum, population, density, the distance measures, effort status |
| `data/species/<species>/county_year.csv.gz` | One row per county and year from 1950: records, effort records, winter minima |
| `data/species/<species>/occurrences.csv.gz` | Every record, with county, state, coordinates, basis of record, dataset and license |
| `data/species/<species>/records.json` | Points for the map: one per grid cell per year (0.01° cells, or 0.05° for species with more than 50,000 records) |
| `data/species/<species>/meta.json` | GBIF taxon key and matched name, record counts, download date |
| `data/climate.json`, `data/effort_<group>.json`, `data/species.json` | Shared temperature and effort files, and the species list the site reads |

`county_summary.csv` holds one value per county for each variable in the scatter plot, so it is the table to start from for a statistical model. The `.gz` files open directly in Python (`pandas.read_csv`) and R, or can be unzipped for a spreadsheet.

## Things built into the data that affect interpretation

- **Observer effort.** iNaturalist use grew sharply after about 2010, and it grew faster near cities and along roads. Distance to an Interstate and distance to a city are therefore linked both to how a species travels and to where people look for it. The effort counts (all lizards and snakes for the lizards and the snake, all frogs and toads for the two amphibians, all insects for the lanternfly) measure the second of these, and a model that includes them can begin to separate the two.
- **First record is not arrival.** A county's first record is the first time someone documented the species there.
- **Correlated predictors.** Warm winters, large cities and dense Interstate networks occur together across the southern states, so each variable's correlation with first-record year partly reflects the others. The scatter plot shows one variable at a time.
- **Rank correlation.** The Spearman value is computed only over counties with a record, so it describes the order in which recorded counties were reached, not which counties were reached at all.
- **Microclimate.** The Mediterranean house gecko and brown anole often live on and around buildings, and the Italian wall lizard on walls and rock piles, all of which stay warmer than the air that county temperatures describe.
- **Native populations.** The cane toad is native to the Rio Grande Valley of southern Texas, where GBIF lists it as *Rhinella marina* or as the closely related *Rhinella horribilis* depending on the source. Records there mark a native population, not a spread, and the name split means some Texas records may be missing from the download.
- **Reporting campaigns.** The spotted lanternfly has been the subject of public campaigns asking people to report and destroy it, so its records reflect those campaigns as well as the insect's spread.
- **Boundary vintages.** County outlines predate a few recent changes. South Dakota's Shannon County (now Oglala Lakota) and Bedford city, Virginia have no 2020 population center, so their distances use a point inside the county and population is blank. Connecticut uses its former counties rather than the planning regions adopted in 2022.
- **City list.** The city list gives populations from about 2013. A handful of cities have crossed 100,000 since then.
- **Contiguous states only.** nClimDiv covers the lower 48 states, so records from Hawaii, Alaska and Puerto Rico are dropped.

## Citing the data

The GBIF search API does not issue a DOI. Before publishing any result, make a GBIF download with the same filters (a free GBIF account is required, https://www.gbif.org/occurrence/search) and cite the DOI GBIF assigns to it. Cite NOAA nClimDiv as:

Vose, R. S., et al. (2014). NOAA's Gridded Climate Divisional Dataset (CLIMDIV). NOAA National Centers for Environmental Information. doi:10.7289/V5M32STR

## Publishing the site

Upload the contents of this folder to a GitHub repository so that `index.html` is at the top level, including the hidden `.github` folder and `.nojekyll` file. Under **Settings → Pages** choose "Deploy from a branch", branch `main`, folder `/ (root)`.

## License

Site text and code: CC BY-SA 4.0 (see `LICENSE.md`). Occurrence records keep the licenses set by their original publishers, listed per record in `occurrences.csv`. Natural Earth data are in the public domain. Leaflet is included under its BSD 2-clause license (`js/vendor/LEAFLET-LICENSE`).
