// ─── Constants ───────────────────────────────────────────────────────────────

const FOLDER = 'route_jsons';

const FREQ_SCALE = [
  { max: 10,       bg: '#671415', label: '≤ 10 min' },
  { max: 15,       bg: '#a62624', label: '≤ 15 min' },
  { max: 20,       bg: '#642d91', label: '≤ 20 min' },
  { max: 30,       bg: '#2c8ab8', label: '≤ 30 min' },
  { max: 60,       bg: '#5d9a9d', label: '≤ 60 min' },
  { max: Infinity, bg: '#8d6f32', label: '> 60 min' },
];

const GAP_COLOUR = {
  10:  '#671415',
  15:  '#a62624',
  20:  '#642d91',
  30:  '#2c8ab8',
  60:  '#5d9a9d',
};
const NO_SERVICE_COLOUR = '#666666';

// ─── Cached summary ───────────────────────────────────────────────────────────

let summaryCache = null;

function loadSummary() {
  return fetch(`${FOLDER}/summary.json`)
    .then(r => { if (!r.ok) throw new Error('summary.json not found'); return r.json(); })
    .then(data => { summaryCache = data; return data; });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freqStyle(mins) {
  if (mins == null) return null;
  return FREQ_SCALE.find(s => mins <= s.max) ?? FREQ_SCALE[FREQ_SCALE.length - 1];
}

function pill(val) {
  if (val == null) return '<span style="color:#888">—</span>';
  const s = freqStyle(val);
  return `<span class="freq-pill" style="background:${s.bg};color:#fff">${val} min</span>`;
}

function normaliseColor(c) {
  if (!c) return '#185FA5';
  return c.startsWith('#') ? c : '#' + c;
}

function contrastText(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0,2),16);
  const g = parseInt(c.slice(2,4),16);
  const b = parseInt(c.slice(4,6),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.55 ? '#1a1a18' : '#ffffff';
}

function minsToTimeStr(m) {
  const h   = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

// slider index (0-47) → snapshot_m value (30, 60, … 1440)
function sliderToSnapshot(idx) { return (idx + 1) * 30; }

// ─── Legend ──────────────────────────────────────────────────────────────────

function buildLegend() {
  document.getElementById('freq-legend').innerHTML = FREQ_SCALE.map(s =>
    `<div class="legend-item">
       <span class="legend-swatch" style="background:${s.bg}"></span>
       <span>${s.label}</span>
     </div>`
  ).join('');
}

// ─── Span chart ──────────────────────────────────────────────────────────────
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

let spanChart = null;
function buildSpanChart(spanStats, routeColour) {
  const DAY_ORDER  = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const sorted = DAY_ORDER.map(d => spanStats.find(r => r.day === d)).filter(Boolean);
  const spanData     = sorted.map(r => [r.span_start / 60, r.span_end / 60]);
  const coverageData = sorted.map(r => [r.full_coverage_start / 60, r.full_coverage_end / 60]);
  if (spanChart) spanChart.destroy();
  const ctx = document.getElementById('span-chart').getContext('2d');
  spanChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: DAY_LABELS,
      datasets: [
        { label: 'Full Span',        data: spanData,     backgroundColor: routeColour + '80', barPercentage: 1, categoryPercentage: 0.6 },
        { label: 'All Stops Served', data: coverageData, backgroundColor: routeColour,        barPercentage: 1, categoryPercentage: 0.6 },
      ]
    },
    options: {
      animation: false,
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, color: '#5F5E5A' } },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (!ctx.raw) return null;
              const [start, end] = ctx.raw;
              const fmt = (h, dataIndex) => {
                const hh  = Math.floor(h) % 24;
                const min = Math.round((h - Math.floor(h)) * 60);
                const time = `${String(hh).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
                if (h >= 24) {
                  // dataIndex is 0=Mon, 1=Tue... wrap around Sunday→Monday
                  const nextDay = DAY_NAMES[(dataIndex + 1) % 7];
                  return `${time} (${nextDay})`;
                }
                return time;
              };
              const i = ctx.dataIndex;
              return `${ctx.dataset.label}: ${fmt(start, i)} – ${fmt(end, i)}`;
            }
          }
        }
      },
      scales: {
        x: {
          min: 3, max: 27,
          ticks: {
            stepSize: 3,
            callback: v => `${String(Math.floor(v) % 24).padStart(2,'0')}:00`,
            color: '#888780',
            font: { size: 11 }
          },
          grid: { color: '#f0ede6' }
        },
        x2: {
          type: 'linear',
          position: 'bottom',
          min: 3, max: 27,
          offset: false,
          ticks: {
            callback: v => v === 24 ? '← today    tomorrow →' : '',
            color: '#888780',
            font: { size: 10 },
          },
          grid: {
            color: ctx => ctx.tick.value === 24 ? '#c8c5be' : 'transparent',
            lineWidth: ctx => ctx.tick.value === 24 ? 1.5 : 0,
            drawTicks: false,
          },
          border: { display: false },
        },
        y: { ticks: { color: '#1a1a18', font: { size: 12 } }, grid: { display: false } }
      }
    }
  });
}
// ─── Interactive map ─────────────────────────────────────────────────────────

let leafletMap      = null;
let mapPolylines    = [];
let currentMapData  = null;
let currentDay      = 1;
let currentSnapshot = 390;
let currentDirection = 0;

/**
 * Parse nested data structure into a lookup:
 *   pairLookup[stop_pair_id].byDaySnapshot[day][snapshot_m][direction] = { gg, gap }
 *
 * Input data shape per item:
 *   item.data[direction_id][day] = { gap: [...], gap_group: [...] }
 *   snapshot_m is reconstructed as (index + 1) * 30
 */

function buildPairLookup(interactive) {
  const lookup = {};

  for (const item of interactive) {
    const id = item.stop_pair_id;
    if (!id || !item.geometry || item.geometry.type !== 'LineString') continue;

    lookup[id] = { geometry: item.geometry, byDaySnapshot: {} };

    for (const [dir, dayObj] of Object.entries(item.data)) {
      const dirNum = parseInt(dir);
      if (isNaN(dirNum)) continue; // skip NA direction keys

      for (const [day, arrays] of Object.entries(dayObj)) {
        const dayNum = parseInt(day);
        const { gap, gap_group } = arrays;

        for (let i = 0; i < gap.length; i++) {
          const sm  = (i + 1) * 30; // reconstruct snapshot_m from index
          const gg  = (gap_group[i] == null) ? null : Number(gap_group[i]);
          const g   = (gap[i]       == null) ? null : Number(gap[i]);

          if (!lookup[id].byDaySnapshot[dayNum])      lookup[id].byDaySnapshot[dayNum] = {};
          if (!lookup[id].byDaySnapshot[dayNum][sm])  lookup[id].byDaySnapshot[dayNum][sm] = {};
          lookup[id].byDaySnapshot[dayNum][sm][dirNum] = { gg, gap: g };
        }
      }
    }
  }

  return lookup;
}

function gapColour(gapGroup) {
  if (gapGroup == null) return NO_SERVICE_COLOUR;
  return GAP_COLOUR[gapGroup] ?? '#8d6f32';
}

function gapWeight(gapGroup) {
  if (gapGroup == null)  return 2;
  if (gapGroup <= 10)    return 6;
  if (gapGroup <= 15)    return 5;
  if (gapGroup <= 20)    return 4;
  if (gapGroup <= 30)    return 3;
  return 2.5;
}

function gapDash(gapGroup) {
  return gapGroup == null ? '6, 6' : null;
}

function initMap(centre) {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    mapPolylines = [];
  }

  leafletMap = L.map('interactive-map', { zoomControl: true, scrollWheelZoom: true });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(leafletMap);

  if (centre) leafletMap.setView(centre, 14);
}

function getGG(entry, day, snapshot, direction) {
  return entry?.byDaySnapshot?.[day]?.[snapshot]?.[direction]?.gg ?? null;
}

function getGap(entry, day, snapshot, direction) {
  return entry?.byDaySnapshot?.[day]?.[snapshot]?.[direction]?.gap ?? null;
}

// Returns true if this pair has any data for the given direction on the given day
function hasDirection(entry, day, direction) {
  const dayData = entry?.byDaySnapshot?.[day];
  if (!dayData) return false;
  return Object.values(dayData).some(snap => direction in snap);
}

function drawPairLookup(pairLookup, day, snapshot, direction) {
  for (const { layer } of mapPolylines) leafletMap.removeLayer(layer);
  mapPolylines = [];
  const bounds = [];

  for (const [id, entry] of Object.entries(pairLookup)) {
    // Skip pairs that don't belong to this direction on this day
    if (!hasDirection(entry, day, direction)) continue;

    const coords = entry.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    bounds.push(...coords);

    const gg  = getGG(entry, day, snapshot, direction);
    const gap = getGap(entry, day, snapshot, direction);

    const layer = L.polyline(coords, {
      color:     gapColour(gg),
      weight:    gapWeight(gg),
      opacity:   gg == null ? 0.35 : 0.85,
      lineJoin:  'round',
      lineCap:   'round',
    });

    layer.bindTooltip(
      gg == null ? 'No regular service' : `${gap} min wait`,
      { sticky: true, className: 'freq-tooltip' }
    );
    layer.addTo(leafletMap);
    mapPolylines.push({ id, layer });
  }

  return bounds;
}

function updateMapColours(pairLookup, day, snapshot, direction) {
  for (const { id, layer } of mapPolylines) {
    const entry = pairLookup[id];
    const gg    = getGG(entry, day, snapshot, direction);
    const gap   = getGap(entry, day, snapshot, direction);
    layer.setStyle({
      color:     gapColour(gg),
      weight:    gapWeight(gg),
      opacity:   gg == null ? 0.35 : 0.85
    });
    layer.bindTooltip(
      gg == null ? 'No regular service' : `${gap} min wait`,
      { sticky: true, className: 'freq-tooltip' }
    );
  }
}

// fullRedraw = true when the set of visible polylines may change (direction or day switch)
// fullRedraw = false for time slider (only colours/weights change, same set of lines)
function refreshMap(fullRedraw = false) {
  if (!currentMapData) return;
  if (fullRedraw) {
    drawPairLookup(currentMapData, currentDay, currentSnapshot, currentDirection);
  } else {
    updateMapColours(currentMapData, currentDay, currentSnapshot, currentDirection);
  }
}

function buildMap(interactive) {
  const pairLookup = buildPairLookup(interactive);
  currentMapData = pairLookup;

  let centre = [-37.81, 144.96];
  for (const entry of Object.values(pairLookup)) {
    if (entry.geometry.coordinates.length > 0) {
      const [lng, lat] = entry.geometry.coordinates[0];
      if (!isNaN(lat) && !isNaN(lng)) { centre = [lat, lng]; break; }
    }
  }

  initMap(centre);
  const bounds = drawPairLookup(pairLookup, currentDay, currentSnapshot, currentDirection);
  if (bounds.length > 0) {
    try { leafletMap.fitBounds(L.latLngBounds(bounds), { padding: [20, 20] }); } catch(e) {}
  }
}

// ─── Controls ────────────────────────────────────────────────────────────────

document.getElementById('direction-controls').addEventListener('click', e => {
  const btn = e.target.closest('.dir-btn');
  if (!btn) return;
  document.querySelectorAll('.dir-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = '';
    b.style.color = '';
  });
  btn.classList.add('active');
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--route-colour').trim();
  btn.style.background = getComputedStyle(document.documentElement)
    .getPropertyValue('--route-colour').trim();
  btn.style.color = contrastText(colour);
  currentDirection = parseInt(btn.dataset.dir);
  refreshMap(true); // full redraw — different set of pairs for this direction
});

document.getElementById('time-slider').addEventListener('input', e => {
  const idx = parseInt(e.target.value);
  currentSnapshot = sliderToSnapshot(idx);
  document.getElementById('time-display').textContent = minsToTimeStr(currentSnapshot);
  refreshMap(false); // colours only — same set of pairs
});

document.getElementById('day-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.day-tab');
  if (!tab) return;
  document.querySelectorAll('.day-tab').forEach(t => {
    t.classList.remove('active');
    t.style.background = '';
    t.style.color = '';
  });
  tab.classList.add('active');
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--route-colour').trim();
  tab.style.background = getComputedStyle(document.documentElement)
    .getPropertyValue('--route-colour').trim();
  tab.style.color = contrastText(colour);
  currentDay = parseInt(tab.dataset.day);
  refreshMap(true); // full redraw — direction availability can differ by day
});

// ─── Main render ─────────────────────────────────────────────────────────────
function displayNumber(data) {
  return data.route_display ?? data.route_number;
}

function render(data) {

  const colour  = normaliseColor(data.route_colour);
  const textCol = contrastText(colour);

  document.documentElement.style.setProperty('--route-colour', colour);

  const badge = document.getElementById('route-badge');
  badge.style.background = colour;
  badge.style.color = textCol;

  const modeName = modeLabel(data.route_number);
  const shown = displayNumber(data);
  badge.textContent = data.route_bullet_code ?? data.route_display ?? data.route_number;
  document.getElementById('route-title').textContent = `${shown} (${modeName})`;

  const subtitleEl = document.getElementById('route-subtitle');
  subtitleEl.textContent = data.is_combined_corridor
    ? 'Frequency Summary (Combined Corridor)'
    : 'Frequency Summary';

  document.getElementById('corridor-note').style.display =
    data.is_combined_corridor ? 'block' : 'none';

  const peak   = data.peak_medians?.[0] ?? {};
  const amVal  = peak['Median AM Peak Wait'];
  const pmVal  = peak['Median PM Peak Wait'];
  const amStyle = freqStyle(amVal);
  const pmStyle = freqStyle(pmVal);

  document.getElementById('peak-grid').innerHTML = `
    <div class="peak-card">
      <div class="label">AM Peak Median Gap</div>
      <div class="value" style="color:${amStyle ? amStyle.bg : colour}">${amVal ?? '—'}<span class="unit">min</span></div>
      <div style="font-size:12px;color:#888780;margin-top:4px">7:00 – 9:00 am</div>
    </div>
    <div class="peak-card">
      <div class="label">PM Peak Median Gap</div>
      <div class="value" style="color:${pmStyle ? pmStyle.bg : colour}">${pmVal ?? '—'}<span class="unit">min</span></div>
      <div style="font-size:12px;color:#888780;margin-top:4px">4:00 – 7:00 pm</div>
    </div>`;

  const weekly = data.weekly_stats?.[0] ?? {};
  const weeklyFields = [
    { key: 'Weekly Trip Count',     label: 'Total Services',   unit: '' },
    { key: 'Weekly Distance (km)',  label: 'Distance Traveled', unit: 'km' },
    { key: 'Weekly Time (hr)',      label: 'Service Hours ',    unit: 'hr' },
    { key: 'Average Speed (km/hr)', label: 'Avg Speed',      unit: 'km/h' },
  ];
  document.getElementById('weekly-grid').innerHTML = weeklyFields.map(f => {
    const val = weekly[f.key];
    return `
    <div class="peak-card">
      <div class="label">${f.label}</div>
      <div class="value" style="color:#5F5E5A">${val ?? '—'}<span class="unit">${f.unit}</span></div>
    </div>`;
  }).join('');

  document.getElementById('freq-body').innerHTML = (data.frequency_summary ?? []).map(row => `
    <tr>
      <td class="day-label">${row.day}</td>
      <td>${pill(row.morning)}</td>
      <td>${pill(row.daytime)}</td>
      <td>${pill(row.evening)}</td>
    </tr>`).join('');

  buildLegend();

  if (data.span_stats?.length) buildSpanChart(data.span_stats, colour);

  // Style active day tab with route colour
  document.querySelectorAll('.day-tab.active').forEach(t => {
    t.style.background = colour;
    t.style.color = contrastText(colour);
  });

  // Set direction button labels
  document.getElementById('dir-btn-0').textContent = data.route_destination_0 ?? 'Direction 0';
  document.getElementById('dir-btn-1').textContent = data.route_destination_1 ?? 'Direction 1';

  // Hide the direction buttons when there's only one direction
  if (!data.route_destination_0 || !data.route_destination_1) {
    document.getElementById('direction-controls').style.height = "0px";
    document.getElementById('direction-controls').style.visibility = "collapse";
  } else {
    document.getElementById('direction-controls').style.height = "unset";
    document.getElementById('direction-controls').style.visibility = "visible";
  }

  // Reset direction state and button styles
  currentDirection = 0;
  document.querySelectorAll('.dir-btn').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
    b.style.background = i === 0 ? colour : '';
    b.style.color      = i === 0 ? contrastText(colour) : '';
  });

  // Build interactive map
  if (data.interactive?.length) {
    setTimeout(() => buildMap(data.interactive), 50);
  }

  document.getElementById('placeholder').style.display = 'none';
  document.getElementById('content').style.display     = 'block';
}

// ─── Route loading ────────────────────────────────────────────────────────────

function loadRoute(num) {
  fetch(`${FOLDER}/${num}.json`)
    .then(r => { if (!r.ok) throw new Error(`${num}.json not found`); return r.json(); })
    .then(interactive => {
      const routeSummary = summaryCache[num];
      if (!routeSummary) throw new Error(`Route ${num} not found in summary.json`);
      render({ ...routeSummary, ...interactive });
    })
    .catch(err => {
      document.getElementById('placeholder').style.display = 'block';
      document.getElementById('placeholder').innerHTML =
        `<div class="error">Could not load route ${num}: ${err.message}</div>`;
      document.getElementById('content').style.display = 'none';
    });
}

// ─── Mode label helper ────────────────────────────────────────────────────────

function modeLabel(routeNum) {
  const mode = summaryCache?.[routeNum]?.mode_type;
  if (mode == '3' || mode === 3) return 'Tram';
  if (mode == '4' || mode === 4) return 'Bus';
  if (mode == '2' || mode === 2) return 'Train';
  return 'Route';
}

// ─── Search / dropdown ────────────────────────────────────────────────────────

let allRoutes = [];

function buildDropdownItem(r) {
  const shown = summaryCache?.[r]?.route_display ?? r;
  const label = ` ${shown} (${modeLabel(r)})`;
  const el = document.createElement('div');
  el.textContent = label;
  el.dataset.route = r;
  el.style.cssText = 'padding:9px 14px; font-size:14px; color:#1a1a18; cursor:pointer;';
  el.addEventListener('mouseenter', () => el.style.background = '#f5f5f3');
  el.addEventListener('mouseleave', () => el.style.background = '');
  el.addEventListener('mousedown', () => {
    selectRoute(r, label);
  });
  return el;
}

function filterDropdown(query) {
  const dd = document.getElementById('route-dropdown');
  dd.innerHTML = '';
  const q = query.trim().toLowerCase();
  const filtered = q
    ? allRoutes.filter(r => {
        const display = (summaryCache?.[r]?.route_display ?? r).toLowerCase();
        const label = `${modeLabel(r)} ${r}`.toLowerCase();
        return label.startsWith(q) || r.toLowerCase().startsWith(q) || display.includes(q);
      })
    : allRoutes;
  if (!filtered.length) {
    dd.innerHTML = '<div style="padding:9px 14px;font-size:13px;color:#888780;">No routes found</div>';
  } else {
    filtered.forEach(r => dd.appendChild(buildDropdownItem(r)));
  }
  dd.style.display = 'block';
}

function selectRoute(routeNum, label) {
  document.getElementById('route-search').value = label;
  document.getElementById('route-dropdown').style.display = 'none';

  const url = new URL(window.location);
  url.searchParams.set('route', routeNum);
  window.history.replaceState({}, '', url);

  // Reset controls
  currentDay = 1;
  currentSnapshot = 390;
  document.getElementById('time-slider').value = 13;
  document.getElementById('time-display').textContent = minsToTimeStr(390);
  document.querySelectorAll('.day-tab').forEach((t, i) => {
    t.classList.toggle('active', i === 0);
    t.style.background = '';
    t.style.color = '';
  });
  loadRoute(routeNum);
}

function populateSelect(routes) {
  routes.sort((a, b) => {
    // Sort trams first, then buses; within each group sort numerically
    const mA = summaryCache?.[a]?.mode_type;
    const mB = summaryCache?.[b]?.mode_type;
    if (mA !== mB) return (mA == 3 ? 0 : 1) - (mB == 3 ? 0 : 1);
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  allRoutes = routes;

  const input = document.getElementById('route-search');
  const dd    = document.getElementById('route-dropdown');

  input.addEventListener('focus', () => {
    input.value = '';
    filterDropdown('');
  });
  input.addEventListener('input', () => filterDropdown(input.value));
  input.addEventListener('blur',  () => {
    // small delay so mousedown on an item fires first
    setTimeout(() => { dd.style.display = 'none'; }, 150);
  });
}

// ─── Startup: load manifest + summary in parallel ────────────────────────────

Promise.all([
  fetch(`${FOLDER}/manifest.json`).then(r => r.ok ? r.json() : Promise.reject('manifest')),
  loadSummary()
])
  .then(([manifest]) => {
    populateSelect(manifest.routes);
    const urlParams = new URLSearchParams(window.location.search);
    const routeParam = urlParams.get('route');
    if (routeParam && manifest.routes.includes(routeParam)) {
      const shown = summaryCache?.[routeParam]?.route_display ?? routeParam;
      const label = ` ${shown} (${modeLabel(routeParam)})`;
      selectRoute(routeParam, label);
    }
  })
  .catch(() => {
    document.getElementById('placeholder').innerHTML =
      `<div class="error">Could not load <code>route_jsons/manifest.json</code> or <code>summary.json</code>.</div>`;
  });

// Load date range

function fmt(d) {
  return new Date(d).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

fetch("date_range.json")
  .then(r => r.json())
  .then(range => {
    const [firstDate, lastDate] = range;

    const subtitleEl = document.querySelector(".subtitle");

    subtitleEl.innerHTML =
      `DTP GTFS data from the week starting on ${fmt(firstDate)} - Metro Trains, Trams and Buses<br>Unofficial - by Adam Bain`;

  });