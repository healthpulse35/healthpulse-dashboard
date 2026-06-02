// Runtime JS for the training-trends dashboard.
//
// Loaded by index.ts inside a <script type="module"> tag. Imports React +
// Recharts from esm.sh. Uses htm (Hyperscript Tagged Markup) so we get
// JSX-like template literals at runtime without a Babel build step.
//
// Server passes the dataset in window.__DASHBOARD_DATA__:
//   { days: [...], ae: [...], daysBack: number }

import React, { useState, useMemo } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import {
  ComposedChart, LineChart, BarChart, Area, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, Cell,
} from "https://esm.sh/recharts@2.12.7?deps=react@18.3.1,react-dom@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const h = React.createElement;

// ---------- theme + constants ----------
const C = {
  bg: "#0a0d12", card: "#12161e", border: "#222a36", muted: "#7c8696",
  text: "#e6eaf0", cyan: "#2dd4ee", green: "#34d399", red: "#f87171",
  amber: "#fbbf24", violet: "#a78bfa", teal: "#5eead4", grid: "#1b212b",
};
const sportColor = { Run: "#34d399", Bike: "#2dd4ee", Swim: "#818cf8", Strength: "#fbbf24", Other: "#9aa6b6" };
const zoneColor = ["#5b6b82", "#34d399", "#fbbf24", "#fb923c", "#f87171"];
const zoneKeys = ["Z1", "Z2", "Z3", "Z4", "Z5"];
const zoneName = ["Z1 Recovery", "Z2 Endurance", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max"];
const SPORTS = ["Run", "Bike", "Swim", "Strength"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtDate = (d) => d.getDate() + " " + MON[d.getMonth()] + " " + String(d.getFullYear()).slice(2);

// ---------- normalize incoming server data ----------
// In Storage-hosted mode, window.__DASHBOARD_DATA__ is set by index.html
// AFTER fetching the JSON from the Edge Function. Legacy mode (data inlined
// at server-render time) still works.
const RAW = window.__DASHBOARD_DATA__;

const DAYS = RAW.days.map((d) => {
  const dt = parseISO(d.date);
  return {
    date: dt,
    label: fmtDate(dt),
    loadTotal: d.loadTotal,
    perSport: {
      Run: { load: d.perSport.Run.load, dist: d.perSport.Run.dist_km, dur: d.perSport.Run.dur_h * 60 },
      Bike: { load: d.perSport.Bike.load, dist: d.perSport.Bike.dist_km, dur: d.perSport.Bike.dur_h * 60 },
      Swim: { load: d.perSport.Swim.load, dist: d.perSport.Swim.dist_km, dur: d.perSport.Swim.dur_h * 60 },
      Strength: { load: d.perSport.Strength.load, dist: d.perSport.Strength.dist_km, dur: d.perSport.Strength.dur_h * 60 },
    },
    zones: d.zones_s.map((s) => s / 60),
    sleep: d.sleep,
    hrvRaw: d.hrvRaw,
    rhrRaw: d.rhr,
    fitness: d.ctl,
    fatigue: d.atl,
    form: d.tsb,
  };
});

// 7-day rolling HRV + RHR; ACWR (7d / 28d load ratio)
DAYS.forEach((day, i) => {
  const w = DAYS.slice(Math.max(0, i - 6), i + 1);
  const hrvVals = w.map((x) => x.hrvRaw).filter((v) => v != null);
  day.hrv = hrvVals.length ? r1(hrvVals.reduce((s, x) => s + x, 0) / hrvVals.length) : null;
  const rhrVals = w.map((x) => x.rhrRaw).filter((v) => v != null);
  day.rhr = rhrVals.length ? r1(rhrVals.reduce((s, x) => s + x, 0) / rhrVals.length) : null;

  const a7 = DAYS.slice(Math.max(0, i - 6), i + 1);
  const a28 = DAYS.slice(Math.max(0, i - 27), i + 1);
  const acute = a7.reduce((s, x) => s + x.loadTotal, 0) / a7.length;
  const chronic = a28.reduce((s, x) => s + x.loadTotal, 0) / a28.length;
  day.acwr = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : 0;
});

// Aerobic efficiency: per-session points + 10-session rolling trend.
const AE_SESSIONS = RAW.ae
  .map((r) => ({
    date: parseISO(r.date),
    ef: r.ef_adjusted != null ? Number(r.ef_adjusted) : null,
    avg_hr: r.avg_hr,
    notes: r.notes,
  }))
  .filter((r) => r.ef != null)
  .sort((a, b) => a.date - b.date);
const TREND_WIN = 10;
AE_SESSIONS.forEach((s, i) => {
  const w = AE_SESSIONS.slice(Math.max(0, i - TREND_WIN + 1), i + 1);
  s.trend = r2(w.reduce((sum, x) => sum + x.ef, 0) / w.length);
});

// ---------- bucketize ----------
function bucketize(view, gran) {
  if (gran === "Daily") return view.map((d) => ({ label: d.label, days: [d] }));
  if (gran === "Weekly") {
    const out = [];
    for (let i = 0; i < view.length; i += 7) out.push({ label: fmtDate(view[i].date), days: view.slice(i, i + 7) });
    return out;
  }
  const map = {}, order = [];
  for (const d of view) {
    const k = d.date.getFullYear() + "-" + d.date.getMonth();
    if (!map[k]) { map[k] = []; order.push(k); }
    map[k].push(d);
  }
  return order.map((k) => {
    const d0 = map[k][0].date;
    return { label: MON[d0.getMonth()] + " " + String(d0.getFullYear()).slice(2), days: map[k] };
  });
}

const axis = { stroke: C.muted, fontSize: 11 };

// Pick out a representative label for each year transition in `series`.
// Works for any series whose items carry either a `.date` (view rows, AE)
// or `.days[]` (bucket rows). Returns [{label, year}], one per distinct
// year that appears in the window.
function yearMarkers(series) {
  const out = [];
  let prevYear = null;
  for (const item of series) {
    const d = item.date || (item.days && item.days[0] && item.days[0].date);
    if (!d) continue;
    const y = d.getFullYear();
    if (y !== prevYear) {
      out.push({ label: item.label, year: y });
      prevYear = y;
    }
  }
  return out;
}

// Vertical reference lines at each year boundary, labelled with the year.
// Renders directly inside a recharts chart (returns an array of elements).
function yearLines(series) {
  return yearMarkers(series).map((m) =>
    h(ReferenceLine, {
      key: "yr" + m.year,
      x: m.label,
      stroke: C.muted,
      strokeDasharray: "2 4",
      strokeOpacity: 0.55,
      ifOverflow: "extendDomain",
      label: {
        value: String(m.year),
        position: "insideTopLeft",
        fill: C.muted,
        fontSize: 11,
        offset: 4,
      },
    })
  );
}

// ---------- race markers ----------
// Find the label in `series` whose date best matches a given race date.
// Works for both raw view rows (`.date`) and bucket rows (`.days[]`).
const DAYMS = 86400000;
function labelForDate(series, raceDate) {
  const t = raceDate.getTime();
  for (const item of series) {
    if (item.date) {
      if (Math.abs(item.date.getTime() - t) < DAYMS / 2) return item.label;
    } else if (item.days && item.days.length) {
      const a = item.days[0].date.getTime();
      const z = item.days[item.days.length - 1].date.getTime();
      if (t >= a - DAYMS / 2 && t <= z + DAYMS / 2) return item.label;
    }
  }
  return null;
}

// Amber dashed reference lines for every visible race in the current chart.
// Labels are rendered above the chart; multiple races in a small window
// would overlap, so labels are kept short and we accept that.
function raceLines(series, races) {
  return races
    .filter((r) => r.show)
    .map((r) => {
      const x = labelForDate(series, r.date);
      if (!x) return null;
      const shortName = r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name;
      return h(ReferenceLine, {
        key: "race" + r.id,
        x,
        stroke: C.amber,
        strokeDasharray: "4 3",
        strokeOpacity: 0.85,
        ifOverflow: "extendDomain",
        label: { value: shortName, position: "top", fill: C.amber, fontSize: 10, offset: 6 },
      });
    })
    .filter(Boolean);
}

// LocalStorage-backed race list. Stored as { id, name, dateISO, show }.
const RACES_KEY = "healthpulse_races_v1";
function loadRaces() {
  try {
    const raw = localStorage.getItem(RACES_KEY);
    if (!raw) return [];
    return JSON.parse(raw).map((r) => ({
      id: r.id, name: r.name, show: r.show !== false,
      date: new Date(r.dateISO),
    }));
  } catch { return []; }
}
function saveRaces(races) {
  try {
    localStorage.setItem(RACES_KEY, JSON.stringify(
      races.map((r) => ({ id: r.id, name: r.name, dateISO: r.date.toISOString(), show: r.show }))
    ));
  } catch { /* ignore quota errors */ }
}

// ---------- ui primitives ----------
const Card = ({ title, sub, right, children }) =>
  html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 14 }} className="p-3 sm:p-5 mb-4">
    <div className="flex items-start justify-between mb-4 gap-3">
      <div>
        <div style=${{ color: C.muted, letterSpacing: "0.13em" }} className="text-xs font-semibold uppercase">${title}</div>
        ${sub ? html`<div style=${{ color: C.muted }} className="text-xs mt-1">${sub}</div>` : null}
      </div>
      ${right}
    </div>
    ${children}
  </div>`;

const Pills = ({ options, value, onChange }) =>
  html`<div className="flex flex-wrap gap-1.5">
    ${options.map((o) => {
      const on = o === value;
      return html`<button key=${o} onClick=${() => onChange(o)}
        style=${{ background: on ? C.cyan : "transparent", color: on ? "#06212a" : C.muted, border: "1px solid " + (on ? C.cyan : C.border) }}
        className="px-2.5 py-1 rounded-full text-xs font-semibold transition-colors">${o}</button>`;
    })}
  </div>`;

const TT = ({ active, payload, label, fmt }) => {
  if (!active || !payload || !payload.length) return null;
  return html`<div style=${{ background: "#0c1117", border: "1px solid " + C.border, borderRadius: 8 }} className="px-3 py-2 text-xs">
    <div style=${{ color: C.muted }} className="mb-1">${label}</div>
    ${payload.filter((p) => p.value != null).map((p, i) =>
      html`<div key=${i} style=${{ color: p.color || p.stroke || p.fill }}>${p.name}: <span className="font-semibold">${fmt ? fmt(p.value) : p.value}</span></div>`
    )}
  </div>`;
};

const ZoneTT = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return html`<div style=${{ background: "#0c1117", border: "1px solid " + C.border, borderRadius: 8 }} className="px-3 py-2 text-xs">
    <div style=${{ color: C.muted }} className="mb-1">${label}</div>
    ${payload.slice().reverse().map((p, i) =>
      html`<div key=${i} style=${{ color: p.fill }}>${p.name}: <span className="font-semibold">${p.value.toFixed(1)} h</span></div>`
    )}
    <div style=${{ borderTop: "1px solid " + C.border, color: C.text }} className="mt-1 pt-1 font-semibold">Total: ${total.toFixed(1)} h</div>
  </div>`;
};

// ---------- status tiles ----------
// Each statusXxx() reads the current dataset and returns
// { value, unit, label, status: "good"|"watch"|"bad" } — null if there's
// not enough data to score. Rules per Kevin's spec:
//
//   Fitness    — CTL > 7d moving avg → trending up = good
//   Form       — green only when -30 to -10 (Optimal zone)
//   ACWR       — sweet spot 0.8-1.3 = good; 1.3-1.5 or 0.7-0.8 = watch; else bad
//   Aerobic EF — mean(last 3 sessions) > mean(last 8) = improving
//   HRV 7d     — vs the longer-term average (not a ±σ band)
//   Resting HR — same but lower is better
//   Sleep 7d   — ≥7.5 good · 7-7.5 watch · <7 bad
const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;

function statusFitness(days) {
  const cur = days.length ? days[days.length - 1].fitness : null;
  if (cur == null) return null;
  const recent7 = days.slice(-8, -1).map((d) => d.fitness).filter((v) => v != null);
  const avg7 = mean(recent7);
  const val = Math.round(cur * 10) / 10;
  const ref = avg7 != null ? `vs 7d avg ${avg7.toFixed(1)}` : "no 7d avg";
  if (avg7 == null) return { value: val, unit: "CTL", label: "Holding", status: "watch", ref };
  const diff = cur - avg7;
  if (diff > 0.3) return { value: val, unit: "CTL", label: "Trending up", status: "good", ref };
  if (diff < -0.3) return { value: val, unit: "CTL", label: "Declining", status: "bad", ref };
  return { value: val, unit: "CTL", label: "Plateau", status: "watch", ref };
}

function statusForm(days) {
  const v = days.length ? days[days.length - 1].form : null;
  if (v == null) return null;
  const ref = "optimal −30 to −10";
  let status = "watch", label;
  if (v >= -30 && v <= -10) { status = "good"; label = "Optimal"; }
  else if (v > -10 && v <= 5) { label = "Grey zone"; }
  else if (v > 5 && v <= 20) { label = "Fresh"; }
  else if (v > 20 && v <= 50) { label = "Transition"; }
  else if (v > 50) { status = "bad"; label = "Detrained"; }
  else { status = "bad"; label = "High risk"; }
  return { value: Math.round(v * 10) / 10, unit: "TSB", label, status, ref };
}

function statusACWR(days) {
  const v = days.length ? days[days.length - 1].acwr : null;
  if (v == null) return null;
  const ref = "sweet spot 0.8–1.3";
  let status, label;
  if (v >= 0.8 && v <= 1.3) { status = "good"; label = "Optimal"; }
  else if (v > 1.3 && v <= 1.5) { status = "watch"; label = "Elevated"; }
  else if (v >= 0.6 && v < 0.8) { status = "watch"; label = "Low"; }
  else if (v > 1.5) { status = "bad"; label = "High risk"; }
  else { status = "bad"; label = "Detrained"; }
  return { value: v.toFixed(2), unit: "", label, status, ref };
}

function statusHRV(days) {
  const recent = days.slice(-7).map((d) => d.hrvRaw).filter((v) => v != null);
  const cur7 = mean(recent);
  if (cur7 == null) return null;
  const older = days.slice(0, -7).map((d) => d.hrvRaw).filter((v) => v != null);
  const baseline = mean(older);
  const val = Math.round(cur7);
  const ref = baseline != null ? `baseline ${Math.round(baseline)} ms` : "no baseline";
  if (baseline == null) return { value: val, unit: "ms", label: "Insufficient history", status: "watch", ref };
  if (cur7 >= baseline) return { value: val, unit: "ms", label: "Above baseline", status: "good", ref };
  if (cur7 >= baseline * 0.95) return { value: val, unit: "ms", label: "Near baseline", status: "watch", ref };
  return { value: val, unit: "ms", label: "Below baseline", status: "bad", ref };
}

function statusRHR(days) {
  const recent = days.slice(-7).map((d) => d.rhrRaw).filter((v) => v != null);
  const cur7 = mean(recent);
  if (cur7 == null) return null;
  const older = days.slice(0, -7).map((d) => d.rhrRaw).filter((v) => v != null);
  const baseline = mean(older);
  const val = Math.round(cur7);
  const ref = baseline != null ? `baseline ${Math.round(baseline)} bpm` : "no baseline";
  if (baseline == null) return { value: val, unit: "bpm", label: "Insufficient history", status: "watch", ref };
  if (cur7 <= baseline) return { value: val, unit: "bpm", label: "Below baseline", status: "good", ref };
  if (cur7 <= baseline + 3) return { value: val, unit: "bpm", label: "Near baseline", status: "watch", ref };
  return { value: val, unit: "bpm", label: "Elevated", status: "bad", ref };
}

function statusAE(sessions) {
  const efs = sessions.map((s) => s.ef).filter((v) => v != null);
  if (efs.length < 3) return null;
  const last3 = mean(efs.slice(-3));
  const last8 = mean(efs.slice(-Math.min(8, efs.length)));
  const val = last3.toFixed(2);
  const ref = `8-sess avg ${last8.toFixed(2)}`;
  if (last3 > last8 + 0.02) return { value: val, unit: "run", label: "Improving", status: "good", ref };
  if (last3 < last8 - 0.02) return { value: val, unit: "run", label: "Declining", status: "bad", ref };
  return { value: val, unit: "run", label: "Steady", status: "watch", ref };
}

function statusSleep(days) {
  const recent = days.slice(-7).map((d) => d.sleep).filter((v) => v != null);
  const cur7 = mean(recent);
  if (cur7 == null) return null;
  const val = cur7.toFixed(1);
  const ref = "target ≥ 7.5h";
  if (cur7 >= 7.5) return { value: val, unit: "h", label: "Good", status: "good", ref };
  if (cur7 >= 7.0) return { value: val, unit: "h", label: "Suboptimal", status: "watch", ref };
  return { value: val, unit: "h", label: "Bad", status: "bad", ref };
}

const STATUS_COLOR = { good: C.green, watch: C.amber, bad: C.red };

const StatusTile = ({ title, info }) => {
  const col = info ? STATUS_COLOR[info.status] : C.muted;
  return html`<div style=${{
      background: C.card,
      border: "1px solid " + C.border,
      borderLeft: "3px solid " + col,
      borderRadius: 10,
    }} className="px-3 py-2">
    <div style=${{ color: C.muted, letterSpacing: "0.12em" }} className="text-[8px] font-semibold uppercase">${title}</div>
    ${info ? [
      html`<div key="v" className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-2xl font-bold leading-none">${info.value}</span>
        ${info.unit ? html`<span style=${{ color: C.muted }} className="text-[10px]">${info.unit}</span>` : null}
      </div>`,
      html`<div key="l" className="flex items-center gap-1 mt-1">
        <span style=${{ color: col, fontSize: 8 }}>●</span>
        <span style=${{ color: col }} className="text-[11px]">${info.label}</span>
      </div>`,
      info.ref ? html`<div key="r" style=${{ color: C.muted }} className="text-[10px] mt-0.5">${info.ref}</div>` : null,
    ] : html`<div style=${{ color: C.muted }} className="text-xs mt-2">No data yet</div>`}
  </div>`;
};

// ---------- main ----------
function App() {
  const [range, setRange] = useState("6M");
  const [volGran, setVolGran] = useState("Weekly");
  const [zoneGran, setZoneGran] = useState("Weekly");
  const [sleepGran, setSleepGran] = useState("Weekly");
  const [sport, setSport] = useState("All");
  const [metric, setMetric] = useState("Load");
  const [showRaw, setShowRaw] = useState(false);
  const [loadView, setLoadView] = useState("Acute load"); // "Acute load" | "Ratio"

  // Races: persisted to localStorage so they survive reloads / re-tokens.
  const [races, setRaces] = useState(loadRaces);
  const [rName, setRName] = useState("");
  const [rDate, setRDate] = useState("");
  React.useEffect(() => { saveRaces(races); }, [races]);
  const addRace = () => {
    if (!rName.trim() || !rDate) return;
    const [y, m, d] = rDate.split("-").map(Number);
    setRaces((rs) => [...rs, { id: Date.now(), name: rName.trim(), date: new Date(y, m - 1, d), show: true }]);
    setRName(""); setRDate("");
  };
  const toggleRace = (id) => setRaces((rs) => rs.map((r) => (r.id === id ? { ...r, show: !r.show } : r)));
  const removeRace = (id) => setRaces((rs) => rs.filter((r) => r.id !== id));

  const granOpts = {
    "3M": ["Daily", "Weekly"],
    "6M": ["Weekly", "Monthly"],
    "1Y": ["Weekly", "Monthly"],
    "2Y": ["Weekly", "Monthly"],
    "All": ["Monthly"],
  };
  const granDefault = { "3M": "Weekly", "6M": "Weekly", "1Y": "Monthly", "2Y": "Monthly", "All": "Monthly" };
  const onRange = (r) => { setRange(r); const d = granDefault[r]; setVolGran(d); setZoneGran(d); setSleepGran(d); };

  const nDays = { "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "All": DAYS.length }[range];
  const view = DAYS.slice(-nDays);
  const cur = DAYS[DAYS.length - 1] || {};

  const volBuckets = useMemo(() => bucketize(view, volGran), [view, volGran]);
  const zoneBuckets = useMemo(() => bucketize(view, zoneGran), [view, zoneGran]);
  const sleepBuckets = useMemo(() => bucketize(view, sleepGran), [view, sleepGran]);

  const volSeries = useMemo(() => volBuckets.map((b) => {
    let load = 0, dist = 0, dur = 0;
    for (const d of b.days) {
      if (sport === "All") { load += d.loadTotal; for (const s of SPORTS) { dist += d.perSport[s].dist; dur += d.perSport[s].dur; } }
      else { const ps = d.perSport[sport]; load += ps.load; dist += ps.dist; dur += ps.dur; }
    }
    return { label: b.label, Load: Math.round(load), Distance: r1(dist), Time: r1(dur / 60) };
  }), [volBuckets, sport]);

  const zoneSeries = useMemo(() => zoneBuckets.map((b) => {
    const z = [0, 0, 0, 0, 0];
    for (const d of b.days) for (let i = 0; i < 5; i++) z[i] += d.zones[i];
    return { label: b.label, Z1: r1(z[0] / 60), Z2: r1(z[1] / 60), Z3: r1(z[2] / 60), Z4: r1(z[3] / 60), Z5: r1(z[4] / 60) };
  }), [zoneBuckets]);

  const sleepSeries = useMemo(() => sleepBuckets.map((b) => {
    const vals = b.days.map((d) => d.sleep).filter((v) => v != null);
    return { label: b.label, sleep: vals.length ? r1(vals.reduce((s, x) => s + x, 0) / vals.length) : 0 };
  }), [sleepBuckets]);

  // HRV series — value is the 7-day rolling avg of nightly HRV. Band is a
  // PERSONAL baseline that moves day-by-day: trailing-60-day mean of
  // nightly HRV ± 1σ. This matches the methodology Garmin / HRV4Training /
  // Marco Altini use ("baseline" range), where the band is computed from
  // the user's own history rather than population norms.
  const HRV_BASELINE_DAYS = 60;
  const HRV_MIN_WINDOW = 14;
  const hrvSeries = useMemo(() => {
    const startIdx = Math.max(0, DAYS.length - nDays);
    return view.map((d, i) => {
      const absIdx = startIdx + i;
      const winStart = Math.max(0, absIdx - (HRV_BASELINE_DAYS - 1));
      const win = DAYS.slice(winStart, absIdx + 1)
        .map((x) => x.hrvRaw).filter((v) => v != null);
      let band = null;
      if (win.length >= HRV_MIN_WINDOW) {
        const m = win.reduce((s, x) => s + x, 0) / win.length;
        const sd = Math.sqrt(win.reduce((s, x) => s + (x - m) ** 2, 0) / win.length);
        band = [r1(m - sd), r1(m + sd)];
      }
      return {
        label: d.label,
        hrv: d.hrv,
        raw: d.hrvRaw != null ? r1(d.hrvRaw) : null,
        band,
      };
    });
  }, [view, nDays]);
  const hrvDomain = useMemo(() => {
    const vals = [];
    for (const s of hrvSeries) {
      if (s.hrv != null) vals.push(s.hrv);
      if (showRaw && s.raw != null) vals.push(s.raw);
      if (s.band) { vals.push(s.band[0]); vals.push(s.band[1]); }
    }
    if (!vals.length) return [0, 100];
    return [Math.floor(Math.min(...vals) - 6), Math.ceil(Math.max(...vals) + 6)];
  }, [hrvSeries, showRaw]);

  const efSeries = AE_SESSIONS.map((s) => ({ label: fmtDate(s.date), session: s.ef, trend: s.trend, date: s.date }));
  const efDomain = (() => {
    const v = efSeries.flatMap((x) => [x.session, x.trend]).filter((x) => x != null);
    if (!v.length) return [1, 3];
    return [Math.floor((Math.min(...v) - 0.1) * 20) / 20, Math.ceil((Math.max(...v) + 0.1) * 20) / 20];
  })();

  // Acute-load series: ATL line + an "optimal" band that floats at
  // 0.8–1.3 × the current chronic load (CTL). Same 0.8–1.3 thresholds as
  // the ratio view — Gabbett / Banister ACWR research — just visualised
  // in absolute load units instead of as a ratio.
  const acuteSeries = useMemo(() => view.map((d) => {
    const ctl = d.fitness, atl = d.fatigue;
    if (ctl == null || ctl <= 0 || atl == null) {
      return { label: d.label, atl: null, ctl: null, optimal: null };
    }
    return {
      label: d.label,
      atl: r1(atl),
      ctl: r1(ctl),
      optimal: [r1(0.8 * ctl), r1(1.3 * ctl)],
    };
  }), [view]);
  const acuteDomain = useMemo(() => {
    const vals = [];
    for (const s of acuteSeries) {
      if (s.atl != null) vals.push(s.atl);
      if (s.optimal) { vals.push(s.optimal[0]); vals.push(s.optimal[1]); }
    }
    if (!vals.length) return [0, 80];
    return [Math.max(0, Math.floor(Math.min(...vals) - 5)), Math.ceil(Math.max(...vals) + 5)];
  }, [acuteSeries]);

  const rhrSeries = useMemo(() => view.map((d) => ({ label: d.label, rhr: d.rhr })), [view]);
  const rhrDomain = useMemo(() => {
    const v = rhrSeries.map((x) => x.rhr).filter((x) => x != null);
    if (!v.length) return [40, 70];
    return [Math.floor(Math.min(...v) - 3), Math.ceil(Math.max(...v) + 3)];
  }, [rhrSeries]);

  const metricMeta = { Load: { u: "", f: (v) => Math.round(v) }, Distance: { u: " km", f: (v) => v }, Time: { u: " h", f: (v) => v } };
  const mm = metricMeta[metric];
  const barColor = sport === "All" ? C.cyan : sportColor[sport];
  const sleepColor = (v) => (v >= 7.5 ? C.green : v >= 6.5 ? C.amber : C.red);
  const totLabel = (g) => (g === "Daily" ? "Daily" : g + " totals");
  // Chart margins: pull both sides in tight. Left is negative to absorb
  // the Y-axis label gutter; right is 0 since there's no right axis to
  // make room for.
  const topMargin = { top: 16, right: 0, left: -12, bottom: 0 };

  const stat = (label, value, color) =>
    html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 12 }} className="px-4 py-3 flex-1 min-w-[110px]">
      <div style=${{ color: C.muted, letterSpacing: "0.1em" }} className="text-[10px] font-semibold uppercase">${label}</div>
      <div style=${{ color }} className="text-2xl font-bold mt-0.5">${value}</div>
    </div>`;

  const today = new Date();
  const todayStr = today.getDate() + " " + MON[today.getMonth()] + " " + today.getFullYear();

  return html`<div style=${{ background: C.bg, color: C.text, minHeight: "100%" }} className="p-2 sm:p-6">
    <!-- Desktop: floating vertical range selector pinned to the left edge -->
    <div className="hidden sm:flex fixed left-3 top-1/2 -translate-y-1/2 flex-col gap-2 z-10">
      ${["3M", "6M", "1Y", "2Y", "All"].map((o) => {
        const on = o === range;
        return html`<button key=${o} onClick=${() => onRange(o)}
          style=${{
            background: on ? C.cyan : C.card,
            color: on ? "#06212a" : C.muted,
            border: "1px solid " + (on ? C.cyan : C.border),
            minWidth: 52,
          }}
          className="px-3 py-2 rounded-full text-xs font-semibold transition-colors shadow-md">${o}</button>`;
      })}
    </div>

    <div className="max-w-7xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <div style=${{ color: C.muted, letterSpacing: "0.18em" }} className="text-xs font-semibold uppercase">Training Overview</div>
          <h1 className="text-2xl font-bold mt-1">Long-Term Trends</h1>
          <div style=${{ color: C.muted }} className="text-xs mt-1">${todayStr}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <${StatusTile} title="Fitness"             info=${statusFitness(DAYS)} />
        <${StatusTile} title="Form"                info=${statusForm(DAYS)} />
        <${StatusTile} title="ACWR"                info=${statusACWR(DAYS)} />
        <${StatusTile} title="Aerobic Eff."        info=${statusAE(AE_SESSIONS)} />
        <${StatusTile} title="HRV (7d avg)"        info=${statusHRV(DAYS)} />
        <${StatusTile} title="Resting HR (7d avg)" info=${statusRHR(DAYS)} />
        <${StatusTile} title="Sleep (7d avg)"      info=${statusSleep(DAYS)} />
      </div>
      <div className="flex flex-wrap gap-4 mb-3 text-[11px]" style=${{ color: C.muted }}>
        <span><span style=${{ color: C.green }}>●</span> Healthy</span>
        <span><span style=${{ color: C.amber }}>●</span> Watch / suboptimal</span>
        <span><span style=${{ color: C.red }}>●</span> Needs attention</span>
      </div>
      <div className="sm:hidden mb-4">
        <${Pills} options=${["3M", "6M", "1Y", "2Y", "All"]} value=${range} onChange=${onRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-4">

        <${Card} title="Fitness & Fatigue" sub="Blue = fitness (CTL, 42-day EWMA). Purple = fatigue (ATL, 7-day EWMA). Form = blue − purple.">
          <${ResponsiveContainer} width="100%" height=${260}>
            <${ComposedChart} data=${view} margin=${topMargin}>
              <defs>
                <linearGradient id="gFit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor=${C.cyan} stopOpacity=${0.32} />
                  <stop offset="100%" stopColor=${C.cyan} stopOpacity=${0.02} />
                </linearGradient>
              </defs>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${48} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} />
              <${Tooltip} content=${h(TT)} />
              ${yearLines(view)}
              ${raceLines(view, races)}
              <${Area} type="monotone" dataKey="fitness" name="Fitness" stroke=${C.cyan} strokeWidth=${2} fill="url(#gFit)" dot=${false} />
              <${Line} type="monotone" dataKey="fatigue" name="Fatigue" stroke=${C.violet} strokeWidth=${1.6} dot=${false} />
            <//>
          <//>
          <div className="text-[11px] mt-3" style=${{ color: C.muted, lineHeight: 1.5 }}>
            Keep purple above blue to drive fitness up. Form (blue − purple) optimal when slightly positive; very negative = high injury risk; very positive = ready to race. Schedule rest weeks to clear fatigue before key events.
          </div>
        <//>

        <${Card} title="Form (TSB)" sub="Fitness − Fatigue. Negative = loaded; very negative = high injury risk.">
          <${ResponsiveContainer} width="100%" height=${260}>
            <${LineChart} data=${view} margin=${topMargin}>
              <${ReferenceArea} y1=${20} y2=${60} fill=${C.amber} fillOpacity=${0.06} />
              <${ReferenceArea} y1=${5} y2=${20} fill=${C.cyan} fillOpacity=${0.06} />
              <${ReferenceArea} y1=${-10} y2=${5} fill=${C.muted} fillOpacity=${0.06} />
              <${ReferenceArea} y1=${-30} y2=${-10} fill=${C.green} fillOpacity=${0.10} />
              <${ReferenceArea} y1=${-60} y2=${-30} fill=${C.red} fillOpacity=${0.10} />
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${48} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${[-45, 35]} />
              <${Tooltip} content=${h(TT)} />
              <${ReferenceLine} y=${0} stroke=${C.border} />
              ${yearLines(view)}
              ${raceLines(view, races)}
              <${Line} type="monotone" dataKey="form" name="Form" stroke="#e6eaf0" strokeWidth=${1.8} dot=${false} />
            <//>
          <//>
          <div className="flex flex-wrap gap-3 mt-3 text-[11px]" style=${{ color: C.muted }}>
            <span><span style=${{ color: C.amber }}>■</span> Transition</span>
            <span><span style=${{ color: C.cyan }}>■</span> Fresh</span>
            <span><span style=${{ color: C.muted }}>■</span> Grey zone</span>
            <span><span style=${{ color: C.green }}>■</span> Optimal</span>
            <span><span style=${{ color: C.red }}>■</span> High risk</span>
          </div>
        <//>

        <${Card}
          title=${loadView === "Acute load" ? "Acute Load" : "Acute : Chronic Load Ratio"}
          sub=${loadView === "Acute load"
            ? "ATL (7-day EWMA) vs your current chronic load. Green band = 0.8–1.3 × CTL — the same sweet spot, expressed in absolute units."
            : "Acute load ÷ chronic load. Sweet spot 0.8–1.3."}
          right=${html`<${Pills} options=${["Acute load", "Ratio"]} value=${loadView} onChange=${setLoadView} />`}>
          ${loadView === "Acute load"
            ? html`<${ResponsiveContainer} width="100%" height=${220}>
                <${ComposedChart} data=${acuteSeries} margin=${topMargin}>
                  <${CartesianGrid} stroke=${C.grid} vertical=${false} />
                  <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${48} />
                  <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${acuteDomain} />
                  <${Tooltip} content=${h(TT, { fmt: (v) => Math.round(v) })} />
                  ${yearLines(view)}
                  ${raceLines(view, races)}
                  <${Area} type="monotone" dataKey="optimal" name="Optimal (0.8–1.3 × CTL)" stroke="none" fill=${C.green} fillOpacity=${0.15} connectNulls=${true} isAnimationActive=${false} />
                  <${Line} type="monotone" dataKey="ctl" name="Chronic load (CTL)" stroke=${C.muted} strokeWidth=${1} strokeDasharray="3 3" dot=${false} connectNulls=${true} />
                  <${Line} type="monotone" dataKey="atl" name="Acute load (ATL)" stroke=${C.cyan} strokeWidth=${1.8} dot=${false} connectNulls=${true} />
                <//>
              <//>`
            : html`<${ResponsiveContainer} width="100%" height=${220}>
                <${LineChart} data=${view} margin=${topMargin}>
                  <${ReferenceArea} y1=${1.5} y2=${2.2} fill=${C.red} fillOpacity=${0.10} />
                  <${ReferenceArea} y1=${1.3} y2=${1.5} fill=${C.amber} fillOpacity=${0.08} />
                  <${ReferenceArea} y1=${0.8} y2=${1.3} fill=${C.green} fillOpacity=${0.10} />
                  <${ReferenceArea} y1=${0} y2=${0.8} fill=${C.cyan} fillOpacity=${0.06} />
                  <${CartesianGrid} stroke=${C.grid} vertical=${false} />
                  <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${48} />
                  <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${[0, 2]} />
                  <${Tooltip} content=${h(TT, { fmt: (v) => v.toFixed(2) })} />
                  ${yearLines(view)}
                  ${raceLines(view, races)}
                  <${Line} type="monotone" dataKey="acwr" name="ACWR" stroke=${C.cyan} strokeWidth=${1.8} dot=${false} />
                <//>
              <//>`}
        <//>

        <${Card} title="Aerobic Efficiency" sub="Run · pace-per-heartbeat (adjusted for temp/humidity/elevation) · higher = fitter aerobic engine">
          <${ResponsiveContainer} width="100%" height=${220}>
            <${LineChart} data=${efSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${40} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${efDomain} />
              <${Tooltip} content=${h(TT, { fmt: (v) => v.toFixed(2) })} />
              ${yearLines(efSeries)}
              ${raceLines(efSeries, races)}
              <${Line} type="monotone" dataKey="session" name="Per session" stroke="#9aa6b6" strokeWidth=${1} strokeOpacity=${0.4} dot=${{ r: 2.5, fill: "#9aa6b6" }} connectNulls=${true} isAnimationActive=${false} />
              <${Line} type="monotone" dataKey="trend" name="10-session trend" stroke=${C.cyan} strokeWidth=${2} dot=${false} connectNulls=${true} />
            <//>
          <//>
          <div className="flex flex-wrap gap-4 mt-3 text-[11px]" style=${{ color: C.muted }}>
            <span style=${{ color: C.cyan }}>— rolling trend</span>
            <span style=${{ color: "#9aa6b6" }}>— per session</span>
          </div>
        <//>

        <${Card} title="Training Volume" sub=${totLabel(volGran) + " · all sports · " + metric.toLowerCase()}
          right=${html`<div className="flex flex-col items-end gap-2">
            <${Pills} options=${["Load", "Distance", "Time"]} value=${metric} onChange=${setMetric} />
            <${Pills} options=${granOpts[range]} value=${volGran} onChange=${setVolGran} />
          </div>`}>
          <${ResponsiveContainer} width="100%" height=${250}>
            <${BarChart} data=${volSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${36} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} />
              <${Tooltip} cursor=${{ fill: "#ffffff08" }} content=${h(TT, { fmt: (v) => mm.f(v) + mm.u })} />
              ${yearLines(volBuckets)}
              ${raceLines(volBuckets, races)}
              <${Bar} dataKey=${metric} name=${metric} fill=${barColor} radius=${[3, 3, 0, 0]} />
            <//>
          <//>
        <//>

        <${Card} title="Time in Training Zones" sub=${totLabel(zoneGran) + " · stacked by HR zone (all sports)"}
          right=${html`<${Pills} options=${granOpts[range]} value=${zoneGran} onChange=${setZoneGran} />`}>
          <${ResponsiveContainer} width="100%" height=${260}>
            <${BarChart} data=${zoneSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${36} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} />
              <${Tooltip} cursor=${{ fill: "#ffffff08" }} content=${h(ZoneTT)} />
              ${yearLines(zoneBuckets)}
              ${raceLines(zoneBuckets, races)}
              ${zoneKeys.map((k, i) =>
                html`<${Bar} key=${k} dataKey=${k} name=${zoneName[i]} stackId="z" fill=${zoneColor[i]} radius=${i === 4 ? [3, 3, 0, 0] : 0} />`
              )}
            <//>
          <//>
          <div className="flex flex-wrap gap-3 mt-3 text-[11px]" style=${{ color: C.muted }}>
            ${zoneName.map((n, i) => html`<span key=${n}><span style=${{ color: zoneColor[i] }}>■</span> ${n}</span>`)}
          </div>
        <//>

        <${Card} title="Sleep Duration" sub=${sleepGran === "Daily" ? "Hours per night" : "Average hours per " + (sleepGran === "Weekly" ? "week" : "month")}
          right=${html`<${Pills} options=${granOpts[range]} value=${sleepGran} onChange=${setSleepGran} />`}>
          <${ResponsiveContainer} width="100%" height=${220}>
            <${BarChart} data=${sleepSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${40} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${[0, 10]} />
              <${Tooltip} cursor=${{ fill: "#ffffff08" }} content=${h(TT, { fmt: (v) => v.toFixed(1) + " h" })} />
              <${ReferenceLine} y=${7.5} stroke=${C.green} strokeDasharray="3 3" strokeOpacity=${0.5} />
              ${yearLines(sleepBuckets)}
              ${raceLines(sleepBuckets, races)}
              <${Bar} dataKey="sleep" name="Sleep" radius=${[2, 2, 0, 0]}>
                ${sleepSeries.map((d, i) => html`<${Cell} key=${i} fill=${sleepColor(d.sleep)} />`)}
              <//>
            <//>
          <//>
        <//>

        <${Card} title=${"HRV Trend · " + range} sub="7-day rolling avg · shaded band = your trailing 60-day mean ± 1σ (personal baseline)"
          right=${html`<button onClick=${() => setShowRaw((s) => !s)}
            style=${{ background: showRaw ? C.muted : "transparent", color: showRaw ? "#0a0d12" : C.muted, border: "1px solid " + (showRaw ? C.muted : C.border), borderRadius: 999 }}
            className="px-3 py-1 text-xs font-semibold">Overnight values</button>`}>
          <${ResponsiveContainer} width="100%" height=${220}>
            <${ComposedChart} data=${hrvSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${40} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${hrvDomain} />
              <${Tooltip} content=${h(TT, { fmt: (v) => v + " ms" })} />
              ${yearLines(view)}
              ${raceLines(view, races)}
              <${Area} type="monotone" dataKey="band" name="Normal range" stroke="none" fill=${C.muted} fillOpacity=${0.18} connectNulls=${true} isAnimationActive=${false} />
              ${showRaw ? html`<${Line} type="monotone" dataKey="raw" name="Overnight" stroke="#9aa6b6" strokeWidth=${1} strokeDasharray="2 3" strokeOpacity=${0.7} dot=${false} isAnimationActive=${false} connectNulls=${true} />` : null}
              <${Line} type="monotone" dataKey="hrv" name="7-day avg" stroke=${C.green} strokeWidth=${2} dot=${false} connectNulls=${true} />
            <//>
          <//>
        <//>

        <${Card} title=${"Resting Heart Rate · " + range} sub="7-day rolling avg · lower trend = more recovered / fitter">
          <${ResponsiveContainer} width="100%" height=${220}>
            <${LineChart} data=${rhrSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${40} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${rhrDomain} />
              <${Tooltip} content=${h(TT, { fmt: (v) => v + " bpm" })} />
              ${yearLines(view)}
              ${raceLines(view, races)}
              <${Line} type="monotone" dataKey="rhr" name="Resting HR" stroke=${C.teal} strokeWidth=${2} dot=${false} connectNulls=${true} />
            <//>
          <//>
        <//>

      </div>

      <${Card} title="Key Races" sub="Amber markers appear on every chart. Stored in this browser only.">
        <div className="flex flex-wrap gap-2 mb-4">
          <input value=${rName} onChange=${(e) => setRName(e.target.value)} placeholder="Race name (e.g. HYROX Bali)"
            style=${{ background: C.bg, border: "1px solid " + C.border, color: C.text, borderRadius: 8 }}
            className="px-3 py-2 text-sm flex-1 min-w-[160px]" />
          <input type="date" value=${rDate} onChange=${(e) => setRDate(e.target.value)}
            style=${{ background: C.bg, border: "1px solid " + C.border, color: C.text, borderRadius: 8, colorScheme: "dark" }}
            className="px-3 py-2 text-sm" />
          <button onClick=${addRace} style=${{ background: C.cyan, color: "#06212a", borderRadius: 8 }} className="px-4 py-2 text-sm font-semibold">Add race</button>
        </div>
        <div className="flex flex-col gap-2">
          ${races.length === 0
            ? html`<div style=${{ color: C.muted }} className="text-sm">No races added yet.</div>`
            : races.slice().sort((a, b) => a.date - b.date).map((r) =>
              html`<div key=${r.id} style=${{ background: C.bg, border: "1px solid " + C.border, borderRadius: 10 }} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span style=${{ color: r.show ? C.amber : C.muted }}>▎</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style=${{ color: r.show ? C.text : C.muted }}>${r.name}</div>
                    <div style=${{ color: C.muted }} className="text-xs">${r.date.getDate()} ${MON[r.date.getMonth()]} ${r.date.getFullYear()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick=${() => toggleRace(r.id)}
                    style=${{ background: r.show ? C.amber : "transparent", color: r.show ? "#2a1d02" : C.muted, border: "1px solid " + (r.show ? C.amber : C.border), borderRadius: 999 }}
                    className="px-3 py-1 text-xs font-semibold">${r.show ? "Shown" : "Hidden"}</button>
                  <button onClick=${() => removeRace(r.id)} style=${{ color: C.muted }} className="px-2 py-1 text-sm">✕</button>
                </div>
              </div>`)}
        </div>
      <//>

      <div style=${{ color: C.muted }} className="text-[11px] text-center mt-2 mb-4">
        Live data · ${DAYS.length} days · ${AE_SESSIONS.length} aerobic-efficiency sessions · ${races.length} race${races.length === 1 ? "" : "s"}
      </div>
    </div>
  </div>`;
}

createRoot(document.getElementById("root")).render(h(App));
