/* Introduced species in the contiguous United States (starting with the Mediterranean house gecko).
   Static inputs: data/counties.geojson, covariates.json, interstates.geojson, cities.json
   Built by scripts/build_data.py: data/records.json, county_year.json, meta.json */
(async function () {
  "use strict";

  const INK = "#1E2622", MUTED = "#5E6A63", RULE = "#C9CFC7", COUNTY = "#D6DAD3",
        GECKO = "#B8336A", EFFORT = "#7C8C80";
  const VIRIDIS = ["#440154","#472D7B","#3B528B","#2C728E","#21918C","#28AE80","#5EC962","#ADDC30","#FDE725"];
  const CIVIDIS = ["#00224E","#123570","#3B496C","#575D6D","#707173","#8A8779","#A69D75","#C4B56C","#E4CF5B","#FEE838"];
  const DIVERGING = ["#2166AC","#67A9CF","#D1E5F0","#F7F7F7","#FDDBC7","#EF8A62","#B2182B"];
  const GREENS = ["#EEF3EC","#C4DCC3","#8CBF91","#4F9A63","#1B6B3F"];
  const SVGNS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------ helpers --
  const $ = (id) => document.getElementById(id);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function ramp(stops, t) {
    if (t == null || isNaN(t)) return COUNTY;
    t = Math.max(0, Math.min(1, t));
    const x = t * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    return "rgb(" + a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",") + ")";
  }
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svgCanvas(svg) {
    svg.innerHTML = "";
    const w = svg.clientWidth || 300, h = svg.clientHeight || 150;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    return { w, h };
  }
  const fmtC = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + " °C");
  const fmtKm = (v) => (v == null ? "—" : v < 10 ? v.toFixed(1) + " km" : Math.round(v) + " km");
  const fmtN = (v) => (v == null ? "—" : v.toLocaleString("en-US"));
  const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });

  function spearman(xs, ys) {
    const n = xs.length; if (n < 5) return null;
    const rank = (a) => {
      const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(n);
      for (let i = 0; i < n;) {
        let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
        for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(xs), ry = rank(ys), mx = (n + 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - mx; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy);
  }

  // --------------------------------------------------------------- data --
  const [countiesGJ, cov, interGJ, cities, statesGJ] = await Promise.all(
    ["data/counties.geojson", "data/covariates.json", "data/interstates.geojson", "data/cities.json",
     "data/states.geojson"].map(getJSON));
  let SPX = null, CLIM = null;
  try {
    [SPX, CLIM] = await Promise.all(["data/species.json", "data/climate.json"].map(getJSON));
  } catch (e) { $("empty").hidden = false; }

  const T0 = CLIM ? CLIM.t0 : 1895;
  const info = {};           // fips -> merged county info
  countiesGJ.features.forEach((f) => {
    const p = f.properties, v = cov[p.f] || {}, cl = (CLIM && CLIM.counties[p.f]) || { t: [], tn: null };
    info[p.f] = {
      fips: p.f, name: p.n, state: p.s, first: null, g: {}, e: {}, t: cl.t, tn: cl.tn,
      pop: v.pop, pd: v.density, di: v.dist_interstate_km, ik: v.interstate_km_in_county,
      dc: v.dist_city100k_km, city: v.nearest_city100k, lat: v.pc_lat, lon: v.pc_lon,
    };
  });
  const allFips = Object.keys(info);
  const STATE_NAMES = { AL: "Alabama", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", ID: "Idaho", IL: "Illinois", IN: "Indiana",
    IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
    MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
    NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  [...new Set(allFips.map((f) => info[f].state))]
    .sort((a, b) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b)).forEach((s) => {
      const o = document.createElement("option"); o.value = s; o.textContent = STATE_NAMES[s] || s; $("region").appendChild(o);
    });
  const tempAt = (c, y) => (c.t && c.t[y - T0] != null ? c.t[y - T0] : null);

  // Temperature ranges over the whole country, computed once.
  let tAbs = 1, tMin = 0, tMax = 0;
  allFips.forEach((f) => (info[f].t || []).forEach((v) => {
    if (v != null) { tAbs = Math.max(tAbs, Math.abs(v)); tMin = Math.min(tMin, v); tMax = Math.max(tMax, v); }
  }));
  tAbs = Math.ceil(tAbs); tMin = Math.floor(tMin / 5) * 5; tMax = Math.ceil(tMax / 5) * 5;

  // Species-dependent state, set by loadSpecies().
  let SP = { common: "Species", name: "", effort_label: "lizard and snake" };
  let rows = [], firstRec = null, Y0 = 1950, Y1 = new Date().getFullYear(), years = [], maxCountyEffort = 1;
  const effortFiles = {};
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  // Species menu, grouped (Lizards, Snakes, Frogs and toads, Insects) in the order the build lists them.
  const groups = {};
  (SPX ? SPX.species : []).forEach((sp) => {
    const name = sp.group || "Species";
    if (!groups[name]) {
      groups[name] = document.createElement("optgroup"); groups[name].label = name; $("species").appendChild(groups[name]);
    }
    const o = document.createElement("option"); o.value = sp.slug; o.textContent = sp.common; groups[name].appendChild(o);
  });
  if (SPX) $("built").textContent = `Data built ${SPX.built_utc.slice(0, 10)}.`;

  async function loadSpecies(slug) {
    SP = SPX.species.find((s) => s.slug === slug);
    const base = `data/species/${slug}/`;
    const [rec, county] = await Promise.all([getJSON(base + "records.json"), getJSON(base + "county.json")]);
    if (!effortFiles[SP.effort]) {
      try { effortFiles[SP.effort] = await getJSON(`data/effort_${SP.effort}.json`); }
      catch (e) { effortFiles[SP.effort] = {}; }
    }
    const eff = effortFiles[SP.effort];
    rows = rec.rows;
    allFips.forEach((f) => {
      const c = info[f], g = county[f] || {};
      c.g = g; c.e = eff[f] || {};
      const ys = Object.keys(g).map(Number);
      c.first = ys.length ? Math.min(...ys) : null;
    });
    firstRec = rows.length ? rows[0][2] : null;
    Y1 = parseInt(SPX.built_utc.slice(0, 4), 10);
    Y0 = firstRec ? Math.max(1900, Math.min(1990, Math.floor((firstRec - 5) / 10) * 10)) : 1950;
    years = []; for (let y = Y0; y <= Y1; y++) years.push(y);
    maxCountyEffort = 1;
    allFips.forEach((f) => Object.values(info[f].e).forEach((v) => { maxCountyEffort = Math.max(maxCountyEffort, v); }));
    // labels that name the species or its effort group
    document.title = `${SP.common} in the United States`;
    $("title").textContent = `${SP.common} in the United States`;
    $("sci").textContent = SP.name;
    $("effort-mode").textContent = `${cap(SP.effort_label)} records that year`;
    $("downloads").innerHTML = `<a href="${base}county_summary.csv">county summary</a>, ` +
      `<a href="${base}county_year.csv.gz">county-by-year table</a>, <a href="${base}occurrences.csv.gz">all records</a>`;
    state.year = Y1; state.selected = null;
    computeAgg();
    render();
  }

  const XVARS = {
    tn: { label: "Winter minimum, 1991–2020 mean (°C)", get: (c) => c.tn, lo: -20, hi: 20, ticks: [-20, -10, 0, 10, 20], fmt: (v) => v },
    di: { label: "Distance to nearest Interstate (km)", get: (c) => c.di, lo: 0, hi: 300, ticks: [0, 100, 200, 300], fmt: (v) => v },
    dc: { label: "Distance to nearest city of 100,000+ (km)", get: (c) => c.dc, lo: 0, hi: 550, ticks: [0, 100, 200, 300, 400, 500], fmt: (v) => v },
    pd: { label: "People per km² (log scale)", get: (c) => (c.pd ? Math.log10(c.pd) : null), lo: -1, hi: 4.5, ticks: [-1, 0, 1, 2, 3, 4], fmt: (v) => (v < 0 ? "0.1" : String(10 ** v)) },
  };

  // Region-dependent aggregates (recomputed only when the region changes).
  const agg = {};
  function computeAgg() {
    const r = state.region;
    agg.fips = r ? allFips.filter((f) => info[f].state === r) : allFips;
    agg.gecko = {}; agg.effort = {};
    agg.fips.forEach((f) => {
      const c = info[f];
      years.forEach((y) => {
        agg.gecko[y] = (agg.gecko[y] || 0) + (c.g[y] || 0);
        agg.effort[y] = (agg.effort[y] || 0) + (c.e[y] || 0);
      });
    });
    agg.maxGecko = Math.max(1, ...years.map((y) => agg.gecko[y]));
    agg.maxEffort = Math.max(1, ...years.map((y) => agg.effort[y]));
    agg.firsts = agg.fips.map((f) => info[f].first).filter(Boolean).sort((a, b) => a - b);
    const top = Math.max(5, agg.firsts.length);
    const mag = 10 ** Math.floor(Math.log10(top));
    agg.countMax = Math.ceil(top / mag) * mag;
    agg.recIdx = rows.map((_, i) => i).filter((i) => !r || info[rows[i][3]].state === r);
  }

  const state = { mode: "first", year: Y1, selected: null, timer: null, region: "", xvar: "tn" };
  computeAgg();


  // ---------------------------------------------------------------- map --
  const map = L.map("map", { zoomSnap: 0.25, scrollWheelZoom: false, preferCanvas: true, minZoom: 3 });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 12,
  }).addTo(map);
  const countyRenderer = L.canvas({ padding: 0.2 });

  function fillFor(f) {
    const c = info[f], y = state.year;
    switch (state.mode) {
      case "first": return c.first && c.first <= y ? ramp(VIRIDIS, (c.first - Y0) / (Y1 - Y0)) : COUNTY;
      case "winter": { const t = tempAt(c, y); return t == null ? COUNTY : ramp(DIVERGING, (t + tAbs) / (2 * tAbs)); }
      case "effort": { const e = c.e[y] || 0; return e ? ramp(GREENS, Math.log1p(e) / Math.log1p(maxCountyEffort)) : COUNTY; }
      case "interstate": return c.di == null ? COUNTY : ramp(CIVIDIS, c.di / 150);
      case "city": return c.dc == null ? COUNTY : ramp(CIVIDIS, c.dc / 300);
      case "density": return c.pd ? ramp(CIVIDIS, 1 - (Math.log10(c.pd) + 1) / 4.5) : COUNTY;
    }
  }
  function tipFor(f) {
    const c = info[f], y = state.year;
    let line;
    switch (state.mode) {
      case "first": line = c.first && c.first <= y ? `First record ${c.first}` : `No record by ${y}`; break;
      case "winter": line = `Winter ending ${y}: ${fmtC(tempAt(c, y))}`; break;
      case "effort": line = `${fmtN(c.e[y] || 0)} ${SP.effort_label} records in ${y}`; break;
      case "interstate": line = `${fmtKm(c.di)} to nearest Interstate`; break;
      case "city": line = `${fmtKm(c.dc)} to ${c.city || "—"}`; break;
      case "density": line = `${c.pd == null ? "—" : c.pd.toFixed(1)} people per km²`; break;
    }
    return `<b>${c.name}, ${c.state}</b><br>${line}`;
  }

  const layers = {};
  const countyLayer = L.geoJSON(countiesGJ, {
    renderer: countyRenderer,
    style: (ft) => ({ color: "#FFFFFF", weight: 0.4, fillColor: fillFor(ft.properties.f), fillOpacity: 0.85 }),
    onEachFeature: (ft, layer) => {
      layers[ft.properties.f] = layer;
      layer.bindTooltip(() => tipFor(ft.properties.f), { sticky: true });
      layer.on("click", () => select(ft.properties.f));
    },
  }).addTo(map);
  const usBounds = countyLayer.getBounds();
  map.fitBounds(usBounds, { padding: [8, 8] });
  window.addEventListener("resize", () => map.invalidateSize());

  map.createPane("roads").style.zIndex = 420;
  map.createPane("records").style.zIndex = 450;
  map.createPane("citypane").style.zIndex = 460;
  map.createPane("statelines").style.zIndex = 425;
  map.getPane("statelines").style.pointerEvents = "none";
  map.createPane("labels").style.zIndex = 470;
  map.getPane("labels").style.pointerEvents = "none";

  const stateLayer = L.geoJSON(statesGJ, { pane: "statelines", renderer: L.canvas({ pane: "statelines" }),
    style: { color: "#2E3531", weight: 1.1, opacity: 0.75 }, interactive: false }).addTo(map);

  // City names, thinned by zoom so the national view shows only the largest cities.
  const labelLayer = L.layerGroup().addTo(map);
  const labels = cities.slice().sort((a, b) => b.pop - a.pop).map((c) => ({
    pop: c.pop, lat: c.lat, lon: c.lon, w: c.name.length * 6.3 + 12,
    marker: L.marker([c.lat, c.lon], { pane: "labels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "city-label", html: `<i></i>${c.name}`, iconSize: null, iconAnchor: [3, 7] }) }),
  }));
  // Largest cities are placed first; a smaller city is skipped if its name would overlap one already placed.
  function updateLabels() {
    labelLayer.clearLayers();
    if (!$("show-names").checked) return;
    const z = map.getZoom();
    const minPop = z < 4.75 ? 1e6 : z < 5.75 ? 5e5 : z < 6.75 ? 2.5e5 : 1e5;
    const placed = [], view = map.getBounds().pad(0.1);
    for (const l of labels) {
      if (l.pop < minPop || !view.contains([l.lat, l.lon])) continue;
      const p = map.latLngToContainerPoint([l.lat, l.lon]);
      const box = [p.x - 4, p.y - 8, p.x + l.w, p.y + 8];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      labelLayer.addLayer(l.marker);
    }
  }
  map.on("moveend", updateLabels);
  updateLabels();
  const interLayer = L.geoJSON(interGJ, { pane: "roads", renderer: L.canvas({ pane: "roads" }),
    style: { color: "#3A3F3C", weight: 1.2, opacity: 0.8 }, interactive: false });
  const cityRenderer = L.canvas({ pane: "citypane" });
  const cityLayer = L.layerGroup(cities.map((c) => L.circleMarker([c.lat, c.lon],
    { pane: "citypane", renderer: cityRenderer, radius: 3.5, color: "#fff", weight: 1, fillColor: INK, fillOpacity: 1 })
    .bindTooltip(`${c.name}, ${c.state}<br>${fmtN(c.pop)} people`)));

  // Gecko records drawn on one canvas (tens of thousands of points).
  const RecordLayer = L.Layer.extend({
    onAdd(m) {
      this._c = L.DomUtil.create("canvas", "rec-canvas");
      m.getPane("records").appendChild(this._c);
      m.on("moveend resize viewreset", this.redraw, this);
      m.on("zoomstart", this._hide, this);
      this.redraw();
    },
    onRemove(m) {
      L.DomUtil.remove(this._c);
      m.off("moveend resize viewreset", this.redraw, this);
      m.off("zoomstart", this._hide, this);
    },
    _hide() { this._c.style.display = "none"; },
    redraw() {
      const m = this._map; if (!m) return;
      const c = this._c, size = m.getSize(), dpr = window.devicePixelRatio || 1;
      c.style.display = "";
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
      c.width = size.x * dpr; c.height = size.y * dpr;
      c.style.width = size.x + "px"; c.style.height = size.y + "px";
      const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
      const z = m.getZoom(), r = z < 5 ? 1.6 : z < 7 ? 2.4 : 3.2;
      ctx.fillStyle = GECKO; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = z < 5 ? 0.4 : 0.8;
      const b = m.getBounds().pad(0.05);
      for (const i of agg.recIdx) {
        const row = rows[i];
        if (row[2] > state.year) break;
        if (!b.contains([row[0], row[1]])) continue;
        const p = m.latLngToContainerPoint([row[0], row[1]]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill(); ctx.stroke();
      }
    },
  });
  const recordLayer = new RecordLayer();
  recordLayer.addTo(map);

  $("show-states").addEventListener("change", (e) => e.target.checked ? stateLayer.addTo(map) : stateLayer.remove());
  $("show-names").addEventListener("change", updateLabels);
  $("show-interstates").addEventListener("change", (e) => e.target.checked ? interLayer.addTo(map) : interLayer.remove());
  $("show-cities").addEventListener("change", (e) => e.target.checked ? cityLayer.addTo(map) : cityLayer.remove());
  $("show-records").addEventListener("change", (e) => e.target.checked ? recordLayer.addTo(map) : recordLayer.remove());

  function updateMap() {
    for (const f of allFips) {
      const sel = f === state.selected;
      layers[f].setStyle({ fillColor: fillFor(f), color: sel ? INK : "#FFFFFF", weight: sel ? 2.2 : 0.4 });
    }
    if (state.selected) layers[state.selected].bringToFront();
    recordLayer.redraw();
    $("map-year-value").textContent = state.year;
  }

  // ------------------------------------------------------------- legend --
  function drawLegend() {
    const box = $("legend"); box.innerHTML = "";
    const svg = el("svg", {}, box); svg.style.height = "46px";
    const { w } = svgCanvas(svg);
    const gid = "lg-" + state.mode;
    const grad = el("linearGradient", { id: gid }, el("defs", {}, svg));
    let stops, ticks, title, rev = false;
    switch (state.mode) {
      case "first": stops = VIRIDIS; title = "Year of first record"; ticks = [[0, Y0], [0.5, Math.round((Y0 + Y1) / 2)], [1, Y1]]; break;
      case "winter": stops = DIVERGING; title = `Dec–Feb mean minimum, winter ending ${state.year}`; ticks = [[0, `−${tAbs} °C`], [0.5, "0 °C"], [1, `+${tAbs} °C`]]; break;
      case "effort": stops = GREENS; title = `${cap(SP.effort_label)} records per county, ${state.year} (log)`; ticks = [[0, "1"], [1, fmtN(maxCountyEffort)]]; break;
      case "interstate": stops = CIVIDIS; title = "Population center to nearest Interstate"; ticks = [[0, "0 km"], [0.5, "75"], [1, "150+ km"]]; break;
      case "city": stops = CIVIDIS; title = "Population center to nearest city of 100,000+"; ticks = [[0, "0 km"], [0.5, "150"], [1, "300+ km"]]; break;
      case "density": stops = CIVIDIS.slice().reverse(); title = "People per km², 2020 (log)"; ticks = [[0, "0.1"], [2 / 4.5, "10"], [4 / 4.5, "1,000"]]; break;
    }
    stops.forEach((c, i) => el("stop", { offset: i / (stops.length - 1), "stop-color": c }, grad));
    const x1 = w - 90;
    el("text", { x: 0, y: 10, class: "strip-label" }, svg, title);
    el("rect", { x: 0, y: 16, width: x1, height: 12, fill: `url(#${gid})` }, svg);
    ticks.forEach(([t, lab]) => el("text", { x: t * x1, y: 42, "text-anchor": t === 0 ? "start" : t === 1 ? "end" : "middle" }, svg, lab));
    el("rect", { x: x1 + 12, y: 16, width: 12, height: 12, fill: COUNTY }, svg);
    el("text", { x: x1 + 28, y: 26 }, svg, state.mode === "first" ? "none yet" : "no data");
    el("circle", { cx: x1 + 18, cy: 38, r: 3, fill: GECKO, stroke: "#fff" }, svg);
    el("text", { x: x1 + 28, y: 42 }, svg, "record");
  }

  // ------------------------------------------------------------- charts --
  function yearAxis(svg, x, h) {
    const step = Y1 - Y0 > 70 ? 20 : 10;
    const g = el("g", { class: "axis" }, svg);
    el("line", { x1: x(Y0), x2: x(Y1), y1: h, y2: h }, g);
    for (let yr = Math.ceil(Y0 / step) * step; yr <= Y1; yr += step) {
      el("line", { x1: x(yr), x2: x(yr), y1: h, y2: h + 4 }, g);
      el("text", { x: x(yr), y: h + 15, "text-anchor": "middle" }, g, yr);
    }
  }

  function drawCountiesChart() {
    const svg = $("chart-counties"), { w, h } = svgCanvas(svg);
    const m = { l: 40, r: 8, t: 8, b: 20 };
    const x = lin(Y0, Y1, m.l, w - m.r), y = lin(0, agg.countMax, h - m.b, m.t);
    [0, 0.5, 1].forEach((f) => {
      const v = Math.round(agg.countMax * f);
      el("line", { x1: m.l, x2: w - m.r, y1: y(v), y2: y(v), stroke: RULE, "stroke-dasharray": v ? "2 3" : "" }, svg);
      el("text", { x: m.l - 4, y: y(v) + 4, "text-anchor": "end" }, svg, fmtN(v));
    });
    yearAxis(svg, x, h - m.b);
    let d = "", n = 0, k = 0;
    years.filter((yr) => yr <= state.year).forEach((yr, i) => {
      while (k < agg.firsts.length && agg.firsts[k] <= yr) k++;
      n = k;
      d += i === 0 ? `M${x(yr)},${y(n)}` : `H${x(yr)}V${y(n)}`;
    });
    el("path", { d, fill: "none", stroke: INK, "stroke-width": 2 }, svg);
    el("line", { x1: x(state.year), x2: x(state.year), y1: m.t, y2: h - m.b, stroke: GECKO }, svg);
    const t = el("text", { x: Math.min(x(state.year) + 4, w - 90), y: Math.max(y(n) - 6, 12) }, svg,
      `${fmtN(n)} of ${fmtN(agg.fips.length)}`);
    t.style.fill = INK;
  }

  const sc = $("chart-scatter");
  let scPts = [];
  function drawScatter() {
    const dpr = window.devicePixelRatio || 1, w = sc.clientWidth || 300, h = sc.clientHeight || 260;
    sc.width = w * dpr; sc.height = h * dpr;
    const ctx = sc.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const V = XVARS[state.xvar];
    const m = { l: 40, r: 10, t: 30, b: 32 };
    const x = lin(V.lo, V.hi, m.l, w - m.r), y = lin(Y0, Y1, h - m.b, m.t);
    const clampX = (v) => Math.max(m.l, Math.min(w - m.r, x(v)));
    ctx.font = "11px 'Public Sans', system-ui, sans-serif";
    // grid and axes
    ctx.strokeStyle = RULE; ctx.fillStyle = MUTED; ctx.lineWidth = 1;
    ctx.textAlign = "right";
    const step = Y1 - Y0 > 70 ? 20 : 10;
    for (let yr = Math.ceil(Y0 / step) * step; yr <= Y1; yr += step) {
      ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(m.l, y(yr)); ctx.lineTo(w - m.r, y(yr)); ctx.stroke();
      ctx.fillText(yr, m.l - 4, y(yr) + 4);
    }
    ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(m.l, h - m.b); ctx.lineTo(w - m.r, h - m.b); ctx.stroke();
    ctx.textAlign = "center";
    V.ticks.forEach((t) => { ctx.beginPath(); ctx.moveTo(x(t), h - m.b); ctx.lineTo(x(t), h - m.b + 4); ctx.stroke(); ctx.fillText(V.fmt(t), x(t), h - m.b + 15); });
    ctx.fillText(V.label, (m.l + w - m.r) / 2, h - 3);
    if (state.xvar === "tn") { ctx.strokeStyle = MUTED; ctx.beginPath(); ctx.moveTo(x(0), m.t - 14); ctx.lineTo(x(0), h - m.b); ctx.stroke(); }
    // not-yet-recorded band
    ctx.fillStyle = "rgba(94,106,99,0.10)"; ctx.fillRect(m.l, m.t - 22, w - m.l - m.r, 14);
    ctx.fillStyle = MUTED; ctx.textAlign = "left"; ctx.fillText("no record yet", m.l + 2, m.t - 24);
    // points
    scPts = [];
    const xs = [], ys = [];
    for (const f of agg.fips) {
      const c = info[f], v = V.get(c);
      if (v == null) continue;
      const rec = c.first && c.first <= state.year;
      const px = clampX(v), py = rec ? y(c.first) : m.t - 15 + (parseInt(f, 10) % 7) - 3;
      scPts.push([px, py, f]);
      if (rec) {
        xs.push(v); ys.push(c.first);
        ctx.fillStyle = ramp(VIRIDIS, (c.first - Y0) / (Y1 - Y0)); ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 6.283); ctx.fill();
      } else {
        ctx.fillStyle = MUTED; ctx.globalAlpha = 0.35; ctx.fillRect(px - 0.6, py - 2, 1.2, 4);
      }
    }
    ctx.globalAlpha = 1;
    if (state.selected && info[state.selected]) {
      const hit = scPts.find((p) => p[2] === state.selected);
      if (hit) { ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hit[0], hit[1], 6, 0, 6.283); ctx.stroke(); }
    }
    const rho = spearman(xs, ys);
    $("rho").textContent = rho == null ? "Too few counties with a record for a correlation."
      : `Spearman rank correlation ρ = ${(Math.abs(rho) < 0.005 ? 0 : rho).toFixed(2)} across ${fmtN(xs.length)} counties with a record by ${state.year}.`;
  }
  sc.addEventListener("click", (ev) => {
    const r = sc.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = 64;
    for (const p of scPts) { const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2; if (d < bd) { bd = d; best = p[2]; } }
    if (best) select(best, true);
  });

  function drawCounty() {
    const box = $("county");
    if (!state.selected) { box.hidden = true; return; }
    box.hidden = false;
    const c = info[state.selected], y = state.year;
    const total = Object.values(c.g).reduce((a, b) => a + b, 0);
    const through = Object.entries(c.g).filter(([k]) => +k <= y).reduce((a, [, v]) => a + v, 0);
    $("county-name").textContent = `${c.name}, ${c.state}`;
    const facts = [
      ["First record", c.first || "none"],
      [`Records through ${y}`, `${fmtN(through)} (all years: ${fmtN(total)})`],
      [`${cap(SP.effort_label)} records, ${y}`, fmtN(c.e[y] || 0)],
      [`Winter minimum, ${y}`, fmtC(tempAt(c, y))],
      ["Winter minimum, 1991–2020", fmtC(c.tn)],
      ["Population, 2020", fmtN(c.pop)],
      ["People per km²", c.pd == null ? "—" : c.pd.toFixed(1)],
      ["Nearest Interstate", fmtKm(c.di)],
      ["Interstate inside county", fmtKm(c.ik)],
      ["Nearest city of 100,000+", `${c.city || "—"}, ${fmtKm(c.dc)}`],
    ];
    $("county-facts").innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    const svg = $("chart-county"), { w, h } = svgCanvas(svg);
    const m = { l: 32, r: 8, t: 8, b: 30 };
    const x = lin(Y0, Y1, m.l, w - m.r), yy = lin(tMin, tMax, h - m.b - 8, m.t);
    for (let t = tMin; t <= tMax; t += 10) {
      el("line", { x1: m.l, x2: w - m.r, y1: yy(t), y2: yy(t), stroke: t === 0 ? MUTED : RULE, "stroke-dasharray": t === 0 ? "" : "2 3" }, svg);
      el("text", { x: m.l - 4, y: yy(t) + 4, "text-anchor": "end" }, svg, t);
    }
    yearAxis(svg, x, h - m.b);
    let d = "";
    years.forEach((yr) => { const t = tempAt(c, yr); if (t != null) d += (d ? "L" : "M") + x(yr) + "," + yy(t); });
    el("path", { d, fill: "none", stroke: "#2166AC", "stroke-width": 1.2 }, svg);
    Object.keys(c.g).map(Number).filter((yr) => yr >= Y0 && yr <= y).forEach((yr) =>
      el("line", { x1: x(yr), x2: x(yr), y1: h - m.b - 7, y2: h - m.b, stroke: GECKO, "stroke-width": 2 }, svg));
    el("line", { x1: x(y), x2: x(y), y1: m.t, y2: h - m.b, stroke: INK, "stroke-width": 0.8 }, svg);
  }

  // ----------------------------------------------------------- timeline --
  const tl = $("timeline");
  let tlX = null;
  function drawTimeline() {
    const { w, h } = svgCanvas(tl);
    const m = { l: 8, r: 8, b: 20 };
    const band = (w - m.l - m.r) / years.length;
    tlX = lin(Y0 - 0.5, Y1 + 0.5, m.l, w - m.r);
    [
      { top: 18, hgt: 52, vals: agg.gecko, max: agg.maxGecko, color: GECKO, label: `${SP.common} records` },
      { top: 92, hgt: 36, vals: agg.effort, max: agg.maxEffort, color: EFFORT, label: `All ${SP.effort_label} records` },
    ].forEach((s) => {
      const base = s.top + s.hgt;
      el("line", { x1: m.l, x2: w - m.r, y1: base, y2: base, stroke: RULE }, tl);
      years.forEach((yr) => {
        const v = s.vals[yr] || 0; if (!v) return;
        const bh = (v / s.max) * s.hgt;
        el("rect", { x: tlX(yr) - band * 0.4, y: base - bh, width: Math.max(1, band * 0.8), height: bh,
          fill: s.color, opacity: yr <= state.year ? 1 : 0.25 }, tl);
      });
      el("text", { x: m.l, y: s.top - 5, class: "strip-label" }, tl, s.label);
      el("text", { x: w - m.r, y: s.top - 5, "text-anchor": "end" }, tl, `max ${fmtN(s.max)}/yr`);
    });
    yearAxis(tl, tlX, h - m.b);
    const cx = tlX(state.year);
    el("line", { x1: cx, x2: cx, y1: 12, y2: h - m.b, stroke: INK, "stroke-width": 1.5 }, tl);
    el("path", { d: `M${cx - 6},${h - m.b}l6,-8l6,8z`, fill: INK }, tl);
    tl.setAttribute("aria-valuemin", Y0); tl.setAttribute("aria-valuemax", Y1); tl.setAttribute("aria-valuenow", state.year);
    $("year-value").textContent = state.year;
    $("timeline-region").textContent = state.region ? `Counts for ${STATE_NAMES[state.region] || state.region}` : "Counts for all contiguous states";
  }
  function yearFromEvent(ev) {
    const r = tl.getBoundingClientRect();
    const xpx = ((ev.clientX - r.left) / r.width) * (tl.viewBox.baseVal.width || r.width);
    const x0 = tlX(Y0 - 0.5), x1 = tlX(Y1 + 0.5);
    return Math.round(Y0 - 0.5 + ((xpx - x0) / (x1 - x0)) * (Y1 - Y0 + 1));
  }
  tl.addEventListener("pointerdown", (ev) => {
    stop(); tl.setPointerCapture(ev.pointerId); setYear(yearFromEvent(ev));
    const move = (e) => setYear(yearFromEvent(e));
    const up = () => { tl.removeEventListener("pointermove", move); tl.removeEventListener("pointerup", up); };
    tl.addEventListener("pointermove", move); tl.addEventListener("pointerup", up);
  });
  tl.addEventListener("keydown", (ev) => {
    const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[ev.key];
    if (k) { setYear(state.year + k); ev.preventDefault(); }
    if (ev.key === "Home") { setYear(Y0); ev.preventDefault(); }
    if (ev.key === "End") { setYear(Y1); ev.preventDefault(); }
  });

  // ---------------------------------------------------------- controls --
  function stop() {
    clearInterval(state.timer); state.timer = null;
    $("play").textContent = "Play"; $("play").setAttribute("aria-pressed", "false");
  }
  $("play").addEventListener("click", () => {
    if (state.timer) return stop();
    if (state.year >= Y1) setYear(firstRec ? Math.max(Y0, firstRec - 3) : Y0);
    $("play").textContent = "Pause"; $("play").setAttribute("aria-pressed", "true");
    state.timer = setInterval(() => (state.year >= Y1 ? stop() : setYear(state.year + 1)), 300);
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => { state.mode = r.value; updateMap(); drawLegend(); }));
  $("xvar").addEventListener("change", (e) => { state.xvar = e.target.value; drawScatter(); });
  $("region").addEventListener("change", (e) => {
    state.region = e.target.value;
    computeAgg();
    if (state.region) {
      const b = L.latLngBounds([]);
      agg.fips.forEach((f) => b.extend(layers[f].getBounds()));
      map.fitBounds(b, { padding: [10, 10] });
    } else map.fitBounds(usBounds, { padding: [8, 8] });
    render();
  });

  function select(f, pan) {
    state.selected = state.selected === f ? null : f;
    if (pan && state.selected) map.fitBounds(layers[f].getBounds(), { maxZoom: 8, padding: [60, 60] });
    render();
  }
  function setYear(y) {
    y = Math.max(Y0, Math.min(Y1, y));
    if (y === state.year) return;
    state.year = y; render();
  }
  function render() {
    updateMap(); drawLegend(); drawTimeline(); drawCountiesChart(); drawScatter(); drawCounty();
  }
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  $("species").addEventListener("change", (e) => { stop(); loadSpecies(e.target.value); });
  if (SPX && SPX.species.length) {
    try { await loadSpecies(SPX.species[0].slug); }
    catch (e) { $("empty").hidden = false; render(); }
  } else render();
})();
