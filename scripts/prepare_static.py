#!/usr/bin/env python3
"""
Makes the static files in data/ that build_data.py and the site rely on.
These were built once and committed; this script records exactly how, so they
can be rebuilt or changed. It is not part of the monthly workflow.

Requires: pip install shapely pyproj pyreadr

Inputs (downloaded by hand into the working folder):
  geojson-counties-fips.json   https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json
                               (U.S. Census cartographic boundary counties)
  county2020.rda               https://raw.githubusercontent.com/cran/USpopcenters/master/data/county2020.rda
                               (copy of the Census 2020 county centers of population file,
                               CenPop2020_Mean_CO, with 2020 Census population)
  ne_10m_roads.geojson         https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_roads.geojson
  us-cities-top-1k.csv         https://raw.githubusercontent.com/plotly/datasets/master/us-cities-top-1k.csv

Outputs: data/counties.geojson, query_geometry.json, states.geojson,
         interstates.geojson, cities.json, covariates.json
"""
import csv, json, re
from pathlib import Path
import pyproj, pyreadr
from shapely import make_valid, STRtree, wkt as W
from shapely.geometry import shape, mapping, Point, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union, transform

OUT = Path(__file__).resolve().parent.parent / "data"
EXCLUDE = {"02", "15", "72"}           # Alaska, Hawaii, Puerto Rico
CITY_MIN = 100_000
ST = {'01':'AL','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'}
albers = pyproj.Transformer.from_crs(4326, 5070, always_xy=True).transform   # CONUS Albers, meters


def polys_only(g):
    if g.geom_type == "GeometryCollection":
        g = unary_union([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    return g


def rnd(c, n=3):
    if isinstance(c[0], (float, int)):
        return [round(c[0], n), round(c[1], n)]
    return [rnd(x, n) for x in c]


src = json.load(open("geojson-counties-fips.json"))
feats = [f for f in src["features"] if f["properties"]["STATE"] not in EXCLUDE]
geoms, disp, query = {}, [], {}
for f in feats:
    fips = f["id"]
    g = polys_only(make_valid(shape(f["geometry"])))
    geoms[fips] = g
    s = mapping(g.simplify(0.004, preserve_topology=True))
    disp.append({"type": "Feature",
                 "properties": {"f": fips, "n": f["properties"]["NAME"], "s": ST[f["properties"]["STATE"]]},
                 "geometry": {"type": s["type"], "coordinates": rnd(s["coordinates"])}})
    # GBIF query polygon: valid, counterclockwise, short enough for a URL
    for tol in (0.005, 0.01, 0.02, 0.04, 0.08):
        q = polys_only(make_valid(g.simplify(tol, preserve_topology=True)))
        if q.geom_type == "MultiPolygon":
            parts = [orient(p, 1.0) for p in q.geoms if p.area > 0.01 * q.area]
            q = parts[0] if len(parts) == 1 else MultiPolygon(parts)
        else:
            q = orient(q, 1.0)
        w = re.sub(r"(-?\d+\.\d{4})\d+", r"\1", q.wkt)
        if W.loads(w).is_valid and len(w) < 5000:
            break
    query[fips] = w
json.dump({"type": "FeatureCollection", "features": disp}, open(OUT / "counties.geojson", "w"), separators=(",", ":"))
json.dump(query, open(OUT / "query_geometry.json", "w"), separators=(",", ":"))

# State outlines: counties merged by state, kept as boundary lines only
by_state = {}
for f in feats:
    by_state.setdefault(f["properties"]["STATE"], []).append(geoms[f["id"]].buffer(0.0005))
lines = []
for st, gs in by_state.items():
    b = mapping(unary_union(gs).buffer(-0.0005).simplify(0.01).boundary)
    lines.append({"type": "Feature", "properties": {"s": ST[st]},
                  "geometry": {"type": b["type"], "coordinates": rnd(b["coordinates"])}})
json.dump({"type": "FeatureCollection", "features": lines}, open(OUT / "states.geojson", "w"), separators=(",", ":"))

conus = unary_union(list(geoms.values())).buffer(0.05)
roads = json.load(open("ne_10m_roads.geojson"))
inter = unary_union([shape(x["geometry"]) for x in roads["features"]
                     if x["properties"].get("sov_a3") == "USA" and x["properties"].get("level") == "Interstate"
                     and shape(x["geometry"]).intersects(conus)])
m = mapping(inter.simplify(0.01))
json.dump({"type": "Feature", "properties": {"source": "Natural Earth 10m roads, level=Interstate"},
           "geometry": {"type": m["type"], "coordinates": rnd(m["coordinates"])}},
          open(OUT / "interstates.geojson", "w"), separators=(",", ":"))
inter_m = transform(albers, inter)

cities = [{"name": r["City"], "state": r["State"], "pop": int(r["Population"]),
           "lat": round(float(r["lat"]), 4), "lon": round(float(r["lon"]), 4)}
          for r in csv.DictReader(open("us-cities-top-1k.csv")) if int(r["Population"]) >= CITY_MIN]
cities = [c for c in cities if conus.contains(Point(c["lon"], c["lat"]))]
json.dump(cities, open(OUT / "cities.json", "w"), separators=(",", ":"))
cpts = [Point(*albers(c["lon"], c["lat"])) for c in cities]
tree = STRtree(cpts)

pc = pyreadr.read_r("county2020.rda")["county2020"]
centers = {r.STATEFP + r.COUNTYFP: (r.POPULATION, r.LATITUDE, r.LONGITUDE) for r in pc.itertuples()}
area = {f["id"]: f["properties"]["CENSUSAREA"] * 2.58999 for f in feats}   # sq mi -> km2
cov = {}
for fips, g in geoms.items():
    if fips in centers:
        pop, lat, lon = centers[fips]
    else:                      # county code changed since the boundary file was made
        p = g.representative_point(); pop, lat, lon = None, p.y, p.x
    pt = Point(*albers(lon, lat))
    i = tree.nearest(pt)
    cov[fips] = {
        "pop": int(pop) if pop is not None else None,
        "area_km2": round(area[fips], 1),
        "density": round(pop / area[fips], 2) if pop and area[fips] else None,
        "pc_lat": round(lat, 4), "pc_lon": round(lon, 4),
        "interstate_km_in_county": round(transform(albers, g).intersection(inter_m).length / 1000, 1),
        "dist_interstate_km": round(pt.distance(inter_m) / 1000, 1),
        "dist_city100k_km": round(pt.distance(cpts[i]) / 1000, 1),
        "nearest_city100k": f"{cities[i]['name']}, {cities[i]['state']}",
    }
json.dump(cov, open(OUT / "covariates.json", "w"), separators=(",", ":"))
print(len(disp), "counties;", len(cities), "cities")
