#!/usr/bin/env python3
"""
Build the data files for the contiguous-US species site.

For each species in SPECIES, fetched from the GBIF occurrence API
(https://api.gbif.org/v1):
  - its records with coordinates in the US, assigned to counties
For each observer-effort group in EFFORT_TAXA (lizards and snakes; insects):
  - record counts per county and year, one GBIF request per county
From NOAA NCEI nClimDiv (climdiv-tmincy):
  - monthly mean minimum temperature for every contiguous-US county

Static inputs already in data/ (see prepare_static.py): counties.geojson,
query_geometry.json, covariates.json, states.geojson, interstates.geojson,
cities.json.

Outputs
  data/species.json                 list of species and when each was built
  data/climate.json                 county winter minimum temperatures
  data/effort_<group>.json          observer-effort counts per county and year
  data/species/<slug>/records.json  points for the map (one per grid cell per year)
  data/species/<slug>/county.json   records per county and year
  data/species/<slug>/meta.json     GBIF key, counts, build date
  data/species/<slug>/occurrences.csv.gz   every record
  data/species/<slug>/county_summary.csv   one row per county
  data/species/<slug>/county_year.csv.gz   one row per county and year, 1950 on

Two things keep each run inside GitHub's time limit. A species' records are
downloaded at most once a month; later runs that month reuse the saved county
counts. Effort counts are saved in data/effort_cache.json as they arrive, and a
run stops starting new effort requests RUN_BUDGET_MIN minutes after it began,
so the first full build takes several runs, each continuing where the last one
stopped.

Standard library only (Python 3.8+).
"""

import csv
import os
import subprocess
import datetime as dt
import gzip
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SPDIR = DATA / "species"

GBIF = "https://api.gbif.org/v1"

SPECIES = [
    {"slug": "mediterranean-house-gecko", "name": "Hemidactylus turcicus",
     "common": "Mediterranean house gecko", "phylum": "Chordata", "effort": "squamata"},
    {"slug": "brown-anole", "name": "Anolis sagrei",
     "common": "Brown anole", "phylum": "Chordata", "effort": "squamata"},
    {"slug": "italian-wall-lizard", "name": "Podarcis siculus",
     "common": "Italian wall lizard", "phylum": "Chordata", "effort": "squamata"},
    {"slug": "spotted-lanternfly", "name": "Lycorma delicatula",
     "common": "Spotted lanternfly", "phylum": "Arthropoda", "effort": "insecta"},
]
EFFORT_TAXA = {
    "squamata": {"name": "Squamata", "phylum": "Chordata", "label": "lizard and snake"},
    "insecta": {"name": "Insecta", "phylum": "Arthropoda", "label": "insect"},
}

WORKERS = 4                       # parallel requests when downloading records
EFFORT_PAUSE_SEC = 0.5            # effort requests go one at a time, with this pause between them
CHECKPOINT_MIN = 15               # on GitHub, commit progress this often
RUN_BUDGET_MIN = 115              # stop starting new effort requests this many minutes into a run
RUN_START = time.time()
EFFORT_CACHE = DATA / "effort_cache.json"
SPLIT_YEAR_ABOVE = 5000           # years with more records than this are downloaded month by month
DOWNLOAD_STOP_MIN = 100           # no new species download starts after this many minutes into a run

CLIMDIV = "https://www.ncei.noaa.gov/pub/data/cirs/climdiv/"
NORMAL_YEARS = range(1991, 2021)
FIRST_TEMP_YEAR = 1895
CSV_FIRST_YEAR = 1950

COMMON_FILTERS = {
    "hasCoordinate": "true",
    "hasGeospatialIssue": "false",
    "occurrenceStatus": "PRESENT",
}

# nClimDiv numbers the 48 contiguous states alphabetically; convert to FIPS.
NCEI_TO_FIPS = {
    "01": "01", "02": "04", "03": "05", "04": "06", "05": "08", "06": "09",
    "07": "10", "08": "12", "09": "13", "10": "16", "11": "17", "12": "18",
    "13": "19", "14": "20", "15": "21", "16": "22", "17": "23", "18": "24",
    "19": "25", "20": "26", "21": "27", "22": "28", "23": "29", "24": "30",
    "25": "31", "26": "32", "27": "33", "28": "34", "29": "35", "30": "36",
    "31": "37", "32": "38", "33": "39", "34": "40", "35": "41", "36": "42",
    "37": "44", "38": "45", "39": "46", "40": "47", "41": "48", "42": "49",
    "43": "50", "44": "51", "45": "53", "46": "54", "47": "55", "48": "56",
}

UA = "usa-gecko/2.0 (educational project; GitHub Pages)"


# ---------------------------------------------------------------- network --

REQUEST_WALL_SEC = 90             # give up on any single request after this long and retry


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def get(url, params=None, as_json=True, tries=8):
    """GET with retries. Each attempt runs in a background thread with a hard
    wall-clock limit, because a server that sends a response very slowly can
    keep an ordinary socket timeout from ever firing."""
    if params:
        url = url + "?" + urllib.parse.urlencode(params, doseq=True)
    for attempt in range(tries):
        box = {}

        def work():
            try:
                box["body"] = _fetch(url)
            except Exception as e:
                box["error"] = e

        t = threading.Thread(target=work, daemon=True)
        t.start()
        t.join(REQUEST_WALL_SEC)
        if "body" in box:
            body = box["body"]
            return json.loads(body) if as_json else body.decode("utf-8", "replace")
        e = box.get("error", TimeoutError(f"no complete response after {REQUEST_WALL_SEC} s"))
        code = getattr(e, "code", None)
        if attempt == tries - 1 or (code and 400 <= code < 500 and code != 429):
            raise RuntimeError(f"Request failed: {url[:300]}\n{e}")
        if code == 429:
            # GBIF is asking us to slow down: wait as long as it says, or longer each time
            try:
                wait = int(e.headers.get("Retry-After"))
            except (TypeError, ValueError, AttributeError):
                wait = 20 * (attempt + 1)
            print(f"  GBIF asked to slow down; waiting {wait} s", flush=True)
            time.sleep(wait)
        else:
            print(f"  retrying after: {str(e)[:120]}", flush=True)
            time.sleep(2 ** attempt)


# ---------------------------------------------------------------- geometry --

def load_counties():
    gj = json.loads((DATA / "counties.geojson").read_text())
    counties = []
    for f in gj["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        xs = [p[0] for poly in polys for p in poly[0]]
        ys = [p[1] for poly in polys for p in poly[0]]
        counties.append({
            "fips": f["properties"]["f"],
            "name": f["properties"]["n"],
            "state": f["properties"]["s"],
            "polys": polys,
            "bbox": (min(xs), min(ys), max(xs), max(ys)),
        })
    return counties


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_polys(x, y, polys):
    for poly in polys:
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


class CountyIndex:
    """1-degree grid of candidate counties, so each record is tested against
    a handful of polygons instead of 3,100."""

    def __init__(self, counties):
        self.cells = {}
        for c in counties:
            x0, y0, x1, y1 = c["bbox"]
            for i in range(int(x0 // 1), int(x1 // 1) + 1):
                for j in range(int(y0 // 1), int(y1 // 1) + 1):
                    self.cells.setdefault((i, j), []).append(c)

    def find(self, lon, lat):
        for c in self.cells.get((int(lon // 1), int(lat // 1)), []):
            x0, y0, x1, y1 = c["bbox"]
            if x0 <= lon <= x1 and y0 <= lat <= y1 and point_in_polys(lon, lat, c["polys"]):
                return c["fips"]
        return None


# -------------------------------------------------------------- checkpoints --

_last_checkpoint = [time.time()]


def checkpoint(message, force=False):
    """On GitHub Actions, commit and push whatever is in data/ so far, so that
    progress survives a canceled or timed-out run. Does nothing elsewhere."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    if not force and (time.time() - _last_checkpoint[0]) / 60 < CHECKPOINT_MIN:
        return
    _last_checkpoint[0] = time.time()
    git = ["git", "-c", "user.name=github-actions[bot]",
           "-c", "user.email=41898299+github-actions[bot]@users.noreply.github.com"]
    try:
        subprocess.run(git + ["add", "data"], cwd=ROOT, check=True)
        if subprocess.run(git + ["diff", "--cached", "--quiet"], cwd=ROOT).returncode != 0:
            subprocess.run(git + ["commit", "-q", "-m", message], cwd=ROOT, check=True)
            subprocess.run(git + ["push", "-q"], cwd=ROOT, check=True)
            print(f"  saved progress to the repository ({message})", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"  WARNING: could not save progress: {e}", flush=True)


# -------------------------------------------------------------------- GBIF --

def match_taxon(name, phylum):
    params = {"name": name, "kingdom": "Animalia", "phylum": phylum, "verbose": "true"}
    m = get(f"{GBIF}/species/match", params)
    key = m.get("acceptedUsageKey") or m.get("usageKey")
    if not key:
        for alt in m.get("alternatives", []):
            if alt.get("kingdom") == "Animalia" and alt.get("canonicalName") == name:
                key = alt.get("acceptedUsageKey") or alt.get("usageKey")
                m = alt
                break
    if not key:
        sys.exit(f"GBIF could not match the name '{name}': {m}")
    print(f"  {name} -> GBIF key {key} ({m.get('scientificName')}, {m.get('rank')})", flush=True)
    return key, m


def facet_counts(res, field):
    for fct in res.get("facets", []):
        if fct["field"].upper() == field:
            return {int(x["name"]): x["count"] for x in fct["counts"]}
    return {}


def fetch_records(taxon_key, index):
    """All US records with a year, downloaded in small pieces (one year, or one
    month for busy years), several at a time. Progress is logged every 5,000
    records so a stalled download is visible in the log."""
    base = dict(COMMON_FILTERS, taxonKey=taxon_key, country="US")
    head = get(f"{GBIF}/occurrence/search", dict(base, limit=0, facet="year", facetLimit=400))
    total = head["count"]
    years = facet_counts(head, "YEAR")
    no_year = total - sum(years.values())
    want = total - no_year
    print(f"  GBIF reports {total} US records in {len(years)} years ({no_year} without a year)", flush=True)

    chunks = []
    for y, n in years.items():
        if n > SPLIT_YEAR_ABOVE:
            chunks += [(y, m) for m in range(1, 13)]
        else:
            chunks.append((y, None))

    lock = threading.Lock()
    progress = {"seen": 0, "last": 0}

    def one(chunk):
        y, m = chunk
        p = dict(base, year=y, limit=300)
        if m:
            p["month"] = m
        out, offset = [], 0
        while True:
            page = get(f"{GBIF}/occurrence/search", dict(p, offset=offset))
            out.extend(page["results"])
            offset += len(page["results"])
            with lock:
                progress["seen"] += len(page["results"])
                if progress["seen"] - progress["last"] >= 5000:
                    progress["last"] = progress["seen"]
                    print(f"  records read: {progress['seen']} of {want}, "
                          f"{(time.time() - RUN_START) / 60:.0f} min into run", flush=True)
            if page.get("endOfRecords") or not page["results"] or offset >= 100000:
                return out

    records, outside = [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for results in pool.map(one, chunks):
            for r in results:
                lat, lon = r.get("decimalLatitude"), r.get("decimalLongitude")
                fips = index.find(lon, lat) if lat is not None and lon is not None else None
                if fips is None:
                    outside += 1   # Alaska, Hawaii, Puerto Rico, offshore, or bad coordinates
                    continue
                records.append({
                    "gbifID": r.get("key"), "year": r.get("year"), "month": r.get("month"),
                    "lat": round(lat, 4), "lon": round(lon, 4), "fips": fips,
                    "basis": r.get("basisOfRecord"), "institution": r.get("institutionCode"),
                    "dataset": r.get("datasetName") or r.get("datasetKey"),
                    "uncertainty_m": r.get("coordinateUncertaintyInMeters"), "license": r.get("license"),
                })
    print(f"  records read: {progress['seen']} of {want} (done), "
          f"{(time.time() - RUN_START) / 60:.0f} min into run", flush=True)
    records.sort(key=lambda r: (r["year"] or 0, r["month"] or 0))
    return records, outside, no_year


def load_effort_cache():
    try:
        cache = json.loads(EFFORT_CACHE.read_text())
    except FileNotFoundError:
        return {}
    if "counties" in cache:          # older single-group format: lizards and snakes only
        cache = {"squamata": cache}
    return cache


def update_effort(cache, group, taxon_key, counties, query_wkt):
    """Query counties with no counts this month for one effort group, oldest
    first, until the run's time budget is used. Saves as it goes."""
    entry = cache.get(group)
    if not entry or entry.get("taxon_key") != taxon_key:
        entry = cache[group] = {"taxon_key": taxon_key, "counties": {}}
    saved = entry["counties"]
    month = dt.date.today().isoformat()[:7]
    todo = sorted((c for c in counties if saved.get(c["fips"], {}).get("fetched", "")[:7] != month),
                  key=lambda c: saved.get(c["fips"], {}).get("fetched", ""))
    print(f"  {EFFORT_TAXA[group]['name']}: {len(counties) - len(todo)} counties counted this month, "
          f"{len(todo)} to query", flush=True)
    failed = []

    def one(c):
        params = dict(COMMON_FILTERS, taxonKey=taxon_key, geometry=query_wkt[c["fips"]],
                      facet="year", facetLimit=400, limit=0)
        try:
            res = get(f"{GBIF}/occurrence/search", params)
        except RuntimeError as e:
            print(f"  WARNING: effort request failed for {c['name']}, {c['state']} ({c['fips']}): "
                  f"{str(e).splitlines()[-1]}", flush=True)
            return c["fips"], None
        return c["fips"], {str(y): n for y, n in facet_counts(res, "YEAR").items()}

    done = 0
    for c in todo:
        if (time.time() - RUN_START) / 60 > RUN_BUDGET_MIN:
            print(f"  Time budget reached; {len(todo) - done} counties left for the next run.", flush=True)
            break
        fips, counts = one(c)
        if counts is None:
            failed.append(fips)
        else:
            saved[fips] = {"fetched": dt.date.today().isoformat(), "counts": counts}
        done += 1
        if done % 100 == 0 or done == len(todo):
            EFFORT_CACHE.write_text(json.dumps(cache, separators=(",", ":")))
            print(f"  {EFFORT_TAXA[group]['name']}: {done} of {len(todo)} queried, "
                  f"{(time.time() - RUN_START) / 60:.0f} min into run", flush=True)
            checkpoint(f"Effort counts: {EFFORT_TAXA[group]['name']} {done}/{len(todo)}")
        time.sleep(EFFORT_PAUSE_SEC)
    EFFORT_CACHE.write_text(json.dumps(cache, separators=(",", ":")))
    effort = {f: {int(y): n for y, n in v["counts"].items()} for f, v in saved.items()}
    pending = [c["fips"] for c in counties if c["fips"] not in saved]
    return effort, failed, pending


# ------------------------------------------------------------------ nClimDiv --

def fetch_winter_tmin():
    """Return {fips: {winter_year: (djf_mean_C, coldest_month_C)}}.
    Winter Y = December of Y-1 plus January and February of Y."""
    listing = get(CLIMDIV, as_json=False)
    names = sorted(set(re.findall(r"climdiv-tmincy-v[\d.]+-\d{8}", listing)))
    if not names:
        sys.exit("Could not find the climdiv-tmincy file in the NCEI listing.")
    fname = names[-1]
    print(f"  NOAA file: {fname}", flush=True)
    text = get(CLIMDIV + fname, as_json=False)

    monthly = {}
    for line in text.splitlines():
        if len(line) < 95 or line[5:7] != "28":
            continue
        st = NCEI_TO_FIPS.get(line[0:2])
        if not st:
            continue
        fips = st + line[2:5]
        vals = []
        for m in range(12):
            v = float(line[11 + 7 * m: 18 + 7 * m])
            vals.append(None if v < -99 else v)
        monthly.setdefault(fips, {})[int(line[7:11])] = vals

    f2c = lambda f: round((f - 32) * 5 / 9, 1)
    out = {}
    for fips, years in monthly.items():
        out[fips] = {}
        for y in years:
            dec = years.get(y - 1, [None] * 12)[11]
            jan, feb = years[y][0], years[y][1]
            if None in (dec, jan, feb):
                continue
            out[fips][y] = (f2c((dec + jan + feb) / 3), f2c(min(dec, jan, feb)))
    return out, fname


# -------------------------------------------------------------------- main --

def thin(records):
    """One map point per grid cell per year; the CSV keeps every record."""
    cell = 0.01 if len(records) < 50000 else 0.05
    seen, rows = set(), []
    for r in records:
        if not r["year"]:
            continue
        k = (round(r["lat"] / cell), round(r["lon"] / cell), r["year"])
        if k not in seen:
            seen.add(k)
            rows.append([r["lat"], r["lon"], r["year"], r["fips"]])
    return rows, cell


def build_species(sp, index, names):
    """Download a species if it has not been downloaded this month. Returns
    {fips: {year: count}} and the species' meta dictionary."""
    d = SPDIR / sp["slug"]
    d.mkdir(parents=True, exist_ok=True)
    month = dt.date.today().isoformat()[:7]
    try:
        meta = json.loads((d / "meta.json").read_text())
        if meta.get("records_fetched", "")[:7] == month:
            county = json.loads((d / "county.json").read_text())
            print(f"{sp['common']}: records already downloaded this month; reusing them", flush=True)
            return {f: {int(y): n for y, n in v.items()} for f, v in county.items()}, meta
    except FileNotFoundError:
        meta = None

    if (time.time() - RUN_START) / 60 > DOWNLOAD_STOP_MIN:
        print(f"{sp['common']}: too late in this run to start a download; the next run will do it", flush=True)
        return None, None
    print(f"{sp['common']}: downloading records", flush=True)
    key, match = match_taxon(sp["name"], sp["phylum"])
    records, outside, no_year = fetch_records(key, index)
    counts = {}
    for r in records:
        if r["year"]:
            counts.setdefault(r["fips"], {}).setdefault(r["year"], 0)
            counts[r["fips"]][r["year"]] += 1
    rows, cell = thin(records)
    (d / "records.json").write_text(json.dumps(
        {"cols": ["lat", "lon", "year", "fips"], "cell_deg": cell, "rows": rows}, separators=(",", ":")))
    (d / "county.json").write_text(json.dumps(counts, separators=(",", ":")))
    with gzip.open(d / "occurrences.csv.gz", "wt", newline="") as fh:
        wr = csv.DictWriter(fh, fieldnames=["gbifID", "year", "month", "lat", "lon", "fips", "county",
                                            "state", "basis", "institution", "dataset",
                                            "uncertainty_m", "license"])
        wr.writeheader()
        for r in records:
            wr.writerow(dict(r, county=names[r["fips"]]["name"], state=names[r["fips"]]["state"]))
    meta = {
        "records_fetched": dt.date.today().isoformat(),
        "name": sp["name"], "common": sp["common"],
        "gbif_taxon_key": key, "matched_as": match.get("scientificName"),
        "gbif_filters": dict(COMMON_FILTERS, country="US"),
        "records_in_contiguous_us": len(records),
        "records_without_year_not_downloaded": no_year,
        "records_outside_contiguous_us_counties": outside,
        "map_points": len(rows), "map_point_cell_deg": cell,
        "note": ("Built from the GBIF search API. This snapshot has no DOI. Before publishing, "
                 "request a GBIF download with the same filters and cite its DOI."),
    }
    (d / "meta.json").write_text(json.dumps(meta, indent=2))
    return counts, meta


def main():
    counties = load_counties()
    names = {c["fips"]: c for c in counties}
    index = CountyIndex(counties)
    query_wkt = json.loads((DATA / "query_geometry.json").read_text())
    cov = json.loads((DATA / "covariates.json").read_text())
    this_year = dt.date.today().year
    SPDIR.mkdir(exist_ok=True)

    # files from the single-species version of the site
    for old in ["records.json", "county_year.json", "meta.json", "occurrences.csv",
                "county_summary.csv", "county_year.csv"]:
        (DATA / old).unlink(missing_ok=True)

    species_counts, species_meta = {}, {}
    for sp in SPECIES:
        counts, meta = build_species(sp, index, names)
        if counts is None:           # not downloaded this run; fall back to last month's files if any
            try:
                d = SPDIR / sp["slug"]
                meta = json.loads((d / "meta.json").read_text())
                counts = {f: {int(y): n for y, n in v.items()}
                          for f, v in json.loads((d / "county.json").read_text()).items()}
            except FileNotFoundError:
                continue
        species_counts[sp["slug"]], species_meta[sp["slug"]] = counts, meta
        checkpoint(f"Records: {sp['common']}", force=True)

    cache = load_effort_cache()
    month = dt.date.today().isoformat()[:7]
    effort_done = all(
        len([v for v in cache.get(g, {}).get("counties", {}).values() if v.get("fetched", "")[:7] == month])
        >= len(counties) for g in EFFORT_TAXA)
    species_done = all((SPDIR / sp["slug"] / "meta.json").exists() and
                       json.loads((SPDIR / sp["slug"] / "meta.json").read_text())
                       .get("records_fetched", "")[:7] == month for sp in SPECIES)
    if effort_done and species_done and (DATA / "species.json").exists() and not os.environ.get("FORCE_REBUILD"):
        print("Everything is already up to date for this month; nothing to do.")
        return

    print("Counting observer effort per county")
    effort, status = {}, {}
    for group, t in EFFORT_TAXA.items():
        key, _ = match_taxon(t["name"], t["phylum"])
        effort[group], failed, pending = update_effort(cache, group, key, counties, query_wkt)
        status[group] = {"taxon_key": key, "failed": failed, "pending": pending}
        (DATA / f"effort_{group}.json").write_text(json.dumps(effort[group], separators=(",", ":")))

    print("Reading NOAA county temperatures")
    winters, climdiv_file = fetch_winter_tmin()
    climate = {}
    for c in counties:
        w = winters.get(c["fips"], {})
        normals = [w[y][0] for y in NORMAL_YEARS if y in w]
        climate[c["fips"]] = {
            "t": [w[y][0] if y in w else None for y in range(FIRST_TEMP_YEAR, this_year + 1)],
            "tn": round(sum(normals) / len(normals), 2) if normals else None,
        }
    (DATA / "climate.json").write_text(json.dumps(
        {"t0": FIRST_TEMP_YEAR, "file": climdiv_file,
         "winter_definition": "December of the previous year, January and February",
         "normal_period": f"{NORMAL_YEARS.start}-{NORMAL_YEARS.stop - 1}",
         "counties": climate}, separators=(",", ":")))

    index_out = []
    for sp in SPECIES:
        if sp["slug"] not in species_counts:
            continue
        d, g, eg = SPDIR / sp["slug"], species_counts[sp["slug"]], sp["effort"]
        e, st = effort[eg], status[eg]
        with open(d / "county_summary.csv", "w", newline="") as fh:
            wr = csv.writer(fh)
            label = EFFORT_TAXA[eg]["label"].replace(" ", "_")
            wr.writerow(["fips", "county", "state", "first_record_year", "records",
                         f"{label}_records", "normal_djf_tmin_c", "population_2020", "area_km2",
                         "density_per_km2", "dist_interstate_km", "interstate_km_in_county",
                         "dist_city100k_km", "nearest_city100k", "effort_status"])
            for c in counties:
                f, v, gc = c["fips"], cov.get(c["fips"], {}), g.get(c["fips"], {})
                tn = climate[f]["tn"]
                wr.writerow([f, c["name"], c["state"], min(gc) if gc else "", sum(gc.values()),
                             sum(e.get(f, {}).values()), "" if tn is None else tn,
                             v.get("pop") or "", v.get("area_km2", ""), v.get("density") or "",
                             v.get("dist_interstate_km", ""), v.get("interstate_km_in_county", ""),
                             v.get("dist_city100k_km", ""), v.get("nearest_city100k", ""),
                             "not yet queried" if f in st["pending"] else
                             "failed" if f in st["failed"] else ""])
        with gzip.open(d / "county_year.csv.gz", "wt", newline="") as fh:
            wr = csv.writer(fh)
            wr.writerow(["fips", "county", "state", "year", "records",
                         f"{EFFORT_TAXA[eg]['label'].replace(' ', '_')}_records",
                         "winter_djf_tmin_c", "winter_coldest_month_tmin_c"])
            for c in counties:
                f, w = c["fips"], winters.get(c["fips"], {})
                for y in range(CSV_FIRST_YEAR, this_year + 1):
                    wr.writerow([f, c["name"], c["state"], y, g.get(f, {}).get(y, 0),
                                 e.get(f, {}).get(y, 0),
                                 w[y][0] if y in w else "", w[y][1] if y in w else ""])
        m = species_meta[sp["slug"]]
        index_out.append({
            "slug": sp["slug"], "name": sp["name"], "common": sp["common"],
            "effort": eg, "effort_label": EFFORT_TAXA[eg]["label"],
            "records": m.get("records_in_contiguous_us"), "counties": len(g),
            "records_fetched": m.get("records_fetched"),
        })
    (DATA / "species.json").write_text(json.dumps({
        "built_utc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "species": index_out,
        "effort": {g: {"name": EFFORT_TAXA[g]["name"], "label": EFFORT_TAXA[g]["label"],
                       "gbif_taxon_key": s["taxon_key"], "counties_not_yet_queried": len(s["pending"]),
                       "counties_failed": len(s["failed"])} for g, s in status.items()},
    }, indent=2))

    print("Done.")
    for sp in index_out:
        print(f"  {sp['common']}: {sp['records']} records in {sp['counties']} counties")
    for g, s in status.items():
        print(f"  {EFFORT_TAXA[g]['name']} effort: {len(s['pending'])} counties not yet queried")
    if any(s["pending"] for s in status.values()):
        print("Run the workflow again to continue the effort counts.")


if __name__ == "__main__":
    main()
