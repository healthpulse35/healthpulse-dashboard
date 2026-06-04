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
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "https://esm.sh/recharts@2.12.7?deps=react@18.3.1,react-dom@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const h = React.createElement;

// ---------- theme + constants ----------
// Two named palettes; C below is a Proxy that always reads from whichever
// is active. Switching themes mutates _theme and forces a re-render at
// the App level — every component re-reads C through the Proxy and so
// picks up the new colours without any per-component refactor.
const THEMES = {
  dark: {
    bg: "#0a0d12", card: "#12161e", border: "#222a36", muted: "#7c8696",
    text: "#e6eaf0", cyan: "#2dd4ee", green: "#34d399", red: "#f87171",
    amber: "#fbbf24", violet: "#a78bfa", teal: "#5eead4", grid: "#1b212b",
  },
  light: {
    bg: "#f5f7fa", card: "#ffffff", border: "#dde3ec", muted: "#5e6b7c",
    text: "#0f1722", cyan: "#0891b2", green: "#16a34a", red: "#dc2626",
    amber: "#d97706", violet: "#7c3aed", teal: "#0d9488", grid: "#eef1f5",
  },
};
const THEME_KEY = "hp_theme_v1";
let _theme = "dark";
try {
  const saved = typeof localStorage !== "undefined" && localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") _theme = saved;
} catch { /* ignore */ }
function applyTheme(t) {
  _theme = (t === "light") ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, _theme); } catch { /* ignore */ }
  if (typeof document !== "undefined" && document.body) {
    document.body.style.background = THEMES[_theme].bg;
    document.body.style.color = THEMES[_theme].text;
    const root = document.getElementById("root");
    if (root) root.style.background = THEMES[_theme].bg;
    document.documentElement.style.background = THEMES[_theme].bg;
  }
}
const C = new Proxy({}, {
  get(_t, key) { return THEMES[_theme][key]; },
  has(_t, key) { return key in THEMES[_theme]; },
  ownKeys() { return Object.keys(THEMES[_theme]); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});
// Apply the persisted theme immediately so the first paint matches.
applyTheme(_theme);
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
    weightRaw: d.weight,
    fitness: d.ctl,
    fatigue: d.atl,
    form: d.tsb,
  };
});

// 7-day rolling HRV + RHR + weight; ACWR (7d / 28d load ratio)
DAYS.forEach((day, i) => {
  const w = DAYS.slice(Math.max(0, i - 6), i + 1);
  const hrvVals = w.map((x) => x.hrvRaw).filter((v) => v != null);
  day.hrv = hrvVals.length ? r1(hrvVals.reduce((s, x) => s + x, 0) / hrvVals.length) : null;
  const rhrVals = w.map((x) => x.rhrRaw).filter((v) => v != null);
  day.rhr = rhrVals.length ? r1(rhrVals.reduce((s, x) => s + x, 0) / rhrVals.length) : null;
  const wgtVals = w.map((x) => x.weightRaw).filter((v) => v != null);
  day.weight = wgtVals.length ? r2(wgtVals.reduce((s, x) => s + x, 0) / wgtVals.length) : null;

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

// Proxy so `stroke` re-reads from the live theme; Recharts spreads this
// onto tick props so each render picks up the current C.muted. The
// underlying object lists `stroke` so it's enumerable for spreads.
const axis = new Proxy({ fontSize: 11, stroke: "" }, {
  get(t, k) { return k === "stroke" ? C.muted : t[k]; },
});

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
// Pass `yAxisId` only when the chart explicitly uses non-default axis IDs
// (e.g. when there's also a right-side Y axis).
function yearLines(series, yAxisId) {
  return yearMarkers(series).map((m) =>
    h(ReferenceLine, {
      key: "yr" + m.year,
      x: m.label,
      yAxisId,
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
function raceLines(series, races, yAxisId) {
  return races
    .filter((r) => r.show)
    .map((r) => {
      const x = labelForDate(series, r.date);
      if (!x) return null;
      const shortName = r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name;
      return h(ReferenceLine, {
        key: "race" + r.id,
        x,
        yAxisId,
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
const Card = ({ title, sub, right, source, children }) =>
  html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 14 }} className="p-3 sm:p-5 mb-4">
    <div className="flex items-start justify-between mb-4 gap-3">
      <div>
        <div
          title=${source || undefined}
          style=${{ color: C.muted, letterSpacing: "0.13em", cursor: source ? "help" : "default" }}
          className="text-xs font-semibold uppercase inline-flex items-center gap-1.5">${title}${source ? html`<span style=${{ color: C.border, fontSize: 10 }}>ⓘ</span>` : null}</div>
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
  return html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 8 }} className="px-3 py-2 text-xs">
    <div style=${{ color: C.muted }} className="mb-1">${label}</div>
    ${payload.filter((p) => p.value != null).map((p, i) =>
      html`<div key=${i} style=${{ color: p.color || p.stroke || p.fill }}>${p.name}: <span className="font-semibold">${fmt ? fmt(p.value) : p.value}</span></div>`
    )}
  </div>`;
};

const ZoneTT = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 8 }} className="px-3 py-2 text-xs">
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
  // Build the same band the HRV chart shows: trailing-60d mean ± 0.7σ of
  // nightly HRV. Compare the recent 5-day HRV against that band.
  const baselineWin = days.slice(-60).map((d) => d.hrvRaw).filter((v) => v != null);
  if (baselineWin.length < 14) return null;
  const m = baselineWin.reduce((s, x) => s + x, 0) / baselineWin.length;
  const sd = Math.sqrt(baselineWin.reduce((s, x) => s + (x - m) ** 2, 0) / baselineWin.length);
  const lo = m - 0.7 * sd;
  const hi = m + 0.7 * sd;

  const recentWin = days.slice(-5).map((d) => d.hrvRaw).filter((v) => v != null);
  const cur5 = recentWin.length ? recentWin.reduce((s, x) => s + x, 0) / recentWin.length : null;
  if (cur5 == null) return null;
  const val = Math.round(cur5);
  const ref = `band ${Math.round(lo)}–${Math.round(hi)} ms`;

  if (cur5 >= lo) {
    // In the band or above — both healthy per user spec.
    return { value: val, unit: "ms", label: cur5 > hi ? "Above range" : "In range", status: "good", ref };
  }
  if (cur5 >= lo * 0.95) {
    return { value: val, unit: "ms", label: "Slightly below", status: "watch", ref };
  }
  return { value: val, unit: "ms", label: "Below range", status: "bad", ref };
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

// ---------- biomarkers ----------
// Translates a DB biomarker row into render-ready shape:
//   - bands[] of {name, lo, hi, color}
//   - score severity 0–4 (0 = N/A, 1 = optimal, 4 = very high/low)
//   - history series ordered by date
//
// The DB stores 14 numeric range columns (VL_lo … VH_hi). VH_hi is often
// null in the sheet — we estimate it as `vh_lo + max(span, 15% of vh_lo)`
// so the band paints visibly.
const BIO_BAND_NAMES = ["Very Low", "Low", "Mod. Low", "Optimal", "Mod. High", "High", "Very High"];
const BIO_BAND_COLORS = ["#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#6ee7b7", "#a7f3d0", "#d1fae5"];
const BIO_BAND_KEYS = [
  ["vl_lo", "vl_hi"], ["l_lo", "l_hi"], ["ml_lo", "ml_hi"],
  ["opt_lo", "opt_hi"], ["mh_lo", "mh_hi"], ["h_lo", "h_hi"],
  ["vh_lo", "vh_hi"],
];
const BIO_SCORE_SEV = {
  "Very Low": 4, "Low": 3, "Moderately Low": 2,
  "Optimal": 1,
  "Moderately High": 2, "High": 3, "Very High": 4,
};
const BIO_SCORE_COLOR = {
  "Very Low": "#ef4444", "Low": "#f97316", "Moderately Low": "#eab308",
  "Optimal": "#34d399",
  "Moderately High": "#eab308", "High": "#f97316", "Very High": "#ef4444",
};
const BIO_MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `viewMode` is "Clinical" (badge follows the rendered bands — internal
// consistency: the badge always matches where the tick visually sits) or
// "Optimized" (badge uses the curated platform_score = narrower athlete /
// longevity targets, falling back to the band-derived label when no
// platform_score is set).
function parseBio(b, viewMode) {
  const ranges = [];
  let vhHiEst = null;
  for (let i = 0; i < 7; i++) {
    const [klo, khi] = BIO_BAND_KEYS[i];
    let lo = b[klo], hi = b[khi];
    if (i === 6 && (hi == null || hi <= lo)) {
      // Estimate VH upper bound so the band renders.
      const span = lo - (b.h_lo ?? 0);
      hi = lo + Math.max(span, Math.abs(lo) * 0.15, 0.1);
      vhHiEst = hi;
    }
    ranges.push({ name: BIO_BAND_NAMES[i], lo, hi, color: BIO_BAND_COLORS[i] });
  }
  // The "current" value is the latest reading; fall back to nothing.
  const hist = (b.history || []).slice().sort((a, c) => a.test_date.localeCompare(c.test_date));
  const value = hist.length ? Number(hist[hist.length - 1].value) : null;
  // Which band does the current value fall into?
  let bandIdx = -1;
  if (value != null) {
    for (let i = 0; i < 7; i++) {
      const r = ranges[i];
      if (value >= r.lo && (value < r.hi || i === 6)) { bandIdx = i; break; }
    }
    if (bandIdx === -1) bandIdx = value < ranges[0].lo ? 0 : 6;
  }
  const clinicalScore = bandIdx >= 0
    ? ["Very Low","Low","Moderately Low","Optimal","Moderately High","High","Very High"][bandIdx]
    : "N/A";
  // Clinical view = follow the rendered bands. Optimized view = use the
  // curated platform_score when present (so longevity/athlete cutoffs can
  // flag a marker that sits in the broader clinical-Optimal band).
  const score = viewMode === "Optimized"
    ? (b.platform_score || clinicalScore)
    : clinicalScore;
  const sev = BIO_SCORE_SEV[score] ?? 0;
  const color = BIO_SCORE_COLOR[score] ?? C.muted;
  // Render-friendly history: each entry gets an x-index and a label.
  const series = hist.map((h, i) => {
    const d = parseISO(h.test_date);
    return {
      x: i,
      label: d.getDate() + " " + BIO_MON_SHORT[d.getMonth()] + " " + String(d.getFullYear()).slice(2),
      value: Number(h.value),
    };
  });
  const labelByX = {};
  series.forEach((s) => { labelByX[s.x] = s.label; });
  const xticks = series.map((s) => s.x);
  const vals = series.map((s) => s.value).filter((v) => v != null);
  const domLo = vals.length ? Math.min(b.vl_lo ?? 0, ...vals) : b.vl_lo ?? 0;
  const domHi = vals.length ? Math.max(ranges[6].hi, ...vals) : ranges[6].hi;
  // Place the latest reading at ~75% width so a future retest fits to the right.
  let xMin, xMax;
  if (series.length <= 1) { xMin = -3; xMax = 1; }
  else { xMin = -0.3; xMax = xMin + (series.length - 1 - xMin) / 0.75; }
  return {
    name: b.name, category: b.category, units: b.units,
    value, score, sev, color, ranges, bandIdx,
    series, xDomain: [xMin, xMax], yDomain: [domLo, domHi], xticks, labelByX,
    flagged: sev >= 2,
    whatItMeasures: b.what_it_measures,
    impactHigh: b.impact_high,
    impactLow: b.impact_low,
    recommendation: b.recommendation,
  };
}

function Expand({ label, children }) {
  const [open, setOpen] = useState(false);
  return html`<div className="mt-2">
    <button onClick=${() => setOpen((o) => !o)} style=${{ color: C.muted }} className="flex items-center gap-1.5 text-xs font-medium">
      <span style=${{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      ${label}
    </button>
    ${open ? html`<div style=${{ color: C.muted }} className="text-xs mt-1.5 leading-relaxed">${children}</div>` : null}
  </div>`;
}

const BioTT = ({ active, payload, label, units, labelMap }) => {
  if (!active || !payload || !payload.length || payload[0].value == null) return null;
  return html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 8 }} className="px-3 py-2 text-xs">
    <div style=${{ color: C.muted }} className="mb-0.5">${labelMap ? labelMap[label] : label}</div>
    <div style=${{ color: C.text }} className="font-semibold">${payload[0].value} <span style=${{ color: C.muted }} className="font-normal">${units}</span></div>
  </div>`;
};

// Inside-Tracker-style trend chart: a vertical gradient bar on the left
// (very-low → optimal → very-high in band colors), a single soft-green
// ReferenceArea for the Optimal zone, and bare YAxis ticks at the four
// key thresholds (domain top, optimal hi, optimal lo, domain bottom).
function BioTrend({ b }) {
  const [domLo, domHi] = b.yDomain;
  const span = (domHi - domLo) || 1;
  const pctFromTop = (v) => 100 * (domHi - v) / span;
  const optHi = b.ranges[3].hi;
  const optLo = b.ranges[3].lo;

  // Axis bar uses traffic-light colours regardless of the (softer)
  // band palette used by the MiniRange dashboard tiles.
  const AXIS_COLORS = ["#ef4444", "#f97316", "#eab308", "#34d399", "#eab308", "#f97316", "#ef4444"];
  // CSS gradient stops: screen-top = domHi, screen-bottom = domLo. Each band
  // gets a solid run from its top edge to its bottom edge.
  const stops = [];
  let cursor = 0;
  for (let i = 6; i >= 0; i--) {
    const next = i === 0 ? 100 : pctFromTop(b.ranges[i].lo);
    stops.push(AXIS_COLORS[i] + " " + cursor.toFixed(2) + "%");
    stops.push(AXIS_COLORS[i] + " " + next.toFixed(2) + "%");
    cursor = next;
  }
  const grad = "linear-gradient(to bottom, " + stops.join(", ") + ")";

  const fmtNum = (v) => Math.round(v * 100) / 100;
  const CHART_H = 220, XAXIS_H = 22;

  return html`<div className="flex mt-3" style=${{ gap: 6, height: CHART_H }}>
    <div style=${{ width: 7, borderRadius: 3, background: grad, marginTop: 4, marginBottom: XAXIS_H, flexShrink: 0 }} />
    <div style=${{ flex: 1, minWidth: 0 }}>
      <${ResponsiveContainer} width="100%" height=${CHART_H}>
        <${LineChart} data=${b.series} margin=${{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <${ReferenceArea} y1=${optLo} y2=${optHi} fill="#34d399" fillOpacity=${0.10} />
          <${ReferenceLine} y=${optHi} stroke="rgba(255,255,255,0.08)" />
          <${ReferenceLine} y=${optLo} stroke="rgba(255,255,255,0.08)" />
          <${XAxis} type="number" dataKey="x" domain=${b.xDomain} ticks=${b.xticks} interval=${0}
            tickFormatter=${(x) => b.labelByX[x] || ""} tick=${{ fill: C.muted, fontSize: 10 }}
            tickLine=${false} axisLine=${{ stroke: C.border }} height=${XAXIS_H} />
          <${YAxis} domain=${b.yDomain} ticks=${[domLo, optLo, optHi, domHi]}
            tickFormatter=${fmtNum} tick=${{ fill: C.muted, fontSize: 10 }}
            tickLine=${false} axisLine=${false} width=${42} />
          <${Tooltip} content=${h(BioTT, { units: b.units, labelMap: b.labelByX })} />
          <${Line} type="monotone" dataKey="value" stroke=${C.text} strokeWidth=${2.5} isAnimationActive=${false} connectNulls=${true}
            dot=${{ r: 4, fill: C.text, stroke: C.card, strokeWidth: 1.5 }} activeDot=${{ r: 6, fill: C.text, stroke: C.card }} />
        <//>
      <//>
    </div>
  </div>`;
}

// Performance-area groupings — biomarkers bucketed into "what they say about
// your body" themes (cross-cutting across the clinical Cardio/Endocrine/etc).
// Membership is a soft list: missing markers are filtered out at render time.
const BIO_PERF_GROUPS = [
  { name: "Heart Health", desc: "How efficiently your cardiovascular system transports oxygen, nutrients and cholesterol.", members: ["Apo B", "LDL Cholesterol", "Total Cholesterol", "HDL Cholesterol", "Triglycerides", "HS-CRP", "Thyroid Stimulating Hormone (TSH)"] },
  { name: "Metabolism", desc: "How well your body converts food into energy and manages blood sugar and lipids.", members: ["Apo B", "Fasting Blood Glucose (FBG)", "HbA1c", "Triglycerides", "ALT", "HDL Cholesterol", "LDL Cholesterol", "Thyroid Stimulating Hormone (TSH)", "Total Cholesterol"] },
  { name: "Endurance", desc: "Oxygen-carrying capacity and the blood markers behind aerobic performance.", members: ["Ferritin", "Hemoglobin", "Platelets", "% Transferrin Saturation", "Vitamin B12", "Iron", "Hematocrit", "MPV", "TIBC", "MCH", "MCHC", "MCV", "Red Blood Cell (RBC)", "RDW"] },
  { name: "Fitness", desc: "Hormonal and nutrient markers behind strength, power and recovery.", members: ["Total Testosterone", "SHBG", "Cortisol - AM", "Vitamin B12", "Folate (Serum)", "Free Testosterone"] },
  { name: "Hormone Balance", desc: "Endocrine markers that shape recovery, mood, libido and energy.", members: ["Cortisol - AM", "Vitamin D", "SHBG", "Total Testosterone", "Thyroid Stimulating Hormone (TSH)", "Calcium", "Estradiol", "Magnesium", "Free Testosterone"] },
  { name: "Inflammation", desc: "Immune and inflammatory markers reflecting how your body handles stress and infection.", members: ["HS-CRP", "White Blood Cell (WBC)", "Ferritin", "Vitamin D", "Basophils", "Eosinophils", "Lymphocytes", "Monocytes", "Neutrophils"] },
  { name: "Cognition", desc: "Markers linked to focus, memory and mood via blood sugar, stress and B-vitamins.", members: ["Cortisol - AM", "Fasting Blood Glucose (FBG)", "HbA1c", "Vitamin B12", "Folate (Serum)"] },
  { name: "Gut Health", desc: "Metabolic and inflammatory markers relevant to gut and digestive function.", members: ["Cortisol - AM", "Fasting Blood Glucose (FBG)", "HDL Cholesterol", "HbA1c", "HS-CRP", "Triglycerides"] },
];

// 0-100 group score: average of per-marker points (4=20, 3=45, 2=70, 1=100),
// so a couple of red flags drop the ring sharply without being smoothed out.
const BIO_GROUP_PTS = { 1: 100, 2: 70, 3: 45, 4: 20 };
function bioGroupScore(items) {
  const v = items.filter((i) => i.sev >= 1).map((i) => BIO_GROUP_PTS[i.sev]);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
}
function bioGroupScoreLabel(s) {
  if (s == null) return { w: "No score", c: C.muted };
  if (s >= 80) return { w: "Optimal",    c: "#34d399" };
  if (s >= 65) return { w: "Good",       c: "#7bcf7b" };
  if (s >= 50) return { w: "Fair",       c: "#eab308" };
  if (s >= 35) return { w: "Watch",      c: "#f97316" };
  return         { w: "Needs work", c: "#ef4444" };
}

function ScoreRing({ score, color }) {
  const R = 32, CC = 2 * Math.PI * R;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const off = CC * (1 - pct / 100);
  return html`<svg width="86" height="86" viewBox="0 0 86 86">
    <circle cx="43" cy="43" r=${R} fill="none" stroke=${C.border} strokeWidth="8" />
    <circle cx="43" cy="43" r=${R} fill="none" stroke=${color} strokeWidth="8" strokeLinecap="round"
      strokeDasharray=${CC} strokeDashoffset=${off} transform="rotate(-90 43 43)" />
    <text x="43" y="43" textAnchor="middle" dominantBaseline="central" fill=${C.text} fontSize="24" fontWeight="700">${score == null ? "–" : score}</text>
  </svg>`;
}

// Horizontal 7-segment band bar with a white tick at the current value.
function MiniRange({ b }) {
  let pos = null;
  if (b.bandIdx >= 0 && typeof b.value === "number") {
    const r = b.ranges[b.bandIdx], span = r.hi - r.lo;
    const frac = span > 0 ? Math.min(1, Math.max(0, (b.value - r.lo) / span)) : 0.5;
    pos = ((b.bandIdx + frac) / 7) * 100;
  }
  return html`<div style=${{ position: "relative" }} className="mt-2">
    <div className="flex" style=${{ height: 6, borderRadius: 4, overflow: "hidden", gap: 1 }}>
      ${b.ranges.map((r, i) => html`<div key=${i} style=${{ flex: 1, background: r.color, opacity: 0.85 }} />`)}
    </div>
    ${pos != null ? html`<div style=${{ position: "absolute", left: pos + "%", top: -2, width: 2, height: 10, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.55)", transform: "translateX(-50%)" }} />` : null}
  </div>`;
}

function GroupMiniCard({ b, onClick }) {
  return html`<button onClick=${onClick} style=${{ background: C.bg, border: "1px solid " + C.border, borderRadius: 10 }} className="text-left p-2.5 w-full transition-colors">
    <div className="min-w-0">
      <div className="text-[12px] font-semibold truncate" style=${{ color: C.text }}>${b.name}</div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <div className="text-[13px] font-bold leading-none" style=${{ color: C.text }}>${b.value != null ? b.value : "—"}<span className="text-[9px] font-normal" style=${{ color: C.muted }}> ${b.units || ""}</span></div>
        <span style=${{ color: b.color, border: "1px solid " + b.color, borderRadius: 999 }} className="text-[9px] font-semibold px-1.5 py-0.5">${b.score}</span>
      </div>
    </div>
    <${MiniRange} b=${b} />
  </button>`;
}

// Radar chart of the per-area scores. Lives in the top-left slot of the
// biomarker grid so the user sees overall balance at a glance — values
// shift live when the Clinical/Optimized toggle flips since they come
// straight from bioGroupScore(items).
function CategoryRadar({ data }) {
  const tickStyle = { fill: C.muted, fontSize: 10 };
  return html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 14 }} className="p-5">
    <div className="text-base font-bold" style=${{ color: C.text }}>Performance areas</div>
    <div className="text-xs mt-1 mb-2" style=${{ color: C.muted }}>0–100 score per area. Higher = more markers sitting in range.</div>
    <${ResponsiveContainer} width="100%" height=${320}>
      <${RadarChart} data=${data} margin=${{ top: 8, right: 36, bottom: 8, left: 36 }}>
        <${PolarGrid} stroke=${C.border} />
        <${PolarAngleAxis} dataKey="category" tick=${tickStyle} />
        <${PolarRadiusAxis} domain=${[0, 100]} angle=${90} tick=${{ ...tickStyle, fontSize: 9 }} stroke=${C.border} />
        <${Radar} dataKey="score" stroke=${C.cyan} strokeWidth=${2} fill=${C.cyan} fillOpacity=${0.22} isAnimationActive=${false} />
      <//>
    <//>
  </div>`;
}

function MarkerDetail({ b }) {
  if (!b) return null;
  return html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderLeft: "3px solid " + b.color, borderRadius: 14 }} className="p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-base font-semibold" style=${{ color: C.text }}>${b.name}</div>
        <div className="text-[10px] uppercase mt-0.5" style=${{ color: C.muted, letterSpacing: "0.06em" }}>${b.category}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xl font-bold" style=${{ color: C.text }}>${b.value != null ? b.value : "—"} <span className="text-xs font-normal" style=${{ color: C.muted }}>${b.units || ""}</span></div>
        <span style=${{ color: b.color, border: "1px solid " + b.color, borderRadius: 999 }} className="text-[10px] font-semibold px-2 py-0.5 inline-block mt-1">${b.score}</span>
      </div>
    </div>
    <${BioTrend} b=${b} />
    ${b.flagged && b.recommendation ? html`<div style=${{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8 }} className="mt-4 p-3">
      <div style=${{ color: C.amber }} className="text-[11px] font-semibold mb-1">How to improve</div>
      <div style=${{ color: "#d9c9a8" }} className="text-xs leading-relaxed">${b.recommendation}</div>
    </div>` : null}
    ${b.whatItMeasures ? html`<div className="mt-4">
      <div style=${{ color: C.muted, letterSpacing: "0.06em" }} className="text-[10px] uppercase font-semibold mb-1">What it measures</div>
      <div style=${{ color: "#aeb8c6" }} className="text-xs leading-relaxed">${b.whatItMeasures}</div>
    </div>` : null}
    ${(b.impactHigh || b.impactLow) ? html`<${Expand} label="Impact if high / low">
      ${b.impactHigh ? html`<div><span style=${{ color: "#aeb8c6" }} className="font-semibold">If high: </span>${b.impactHigh}</div>` : null}
      ${b.impactLow ? html`<div className="mt-1.5"><span style=${{ color: "#aeb8c6" }} className="font-semibold">If low: </span>${b.impactLow}</div>` : null}
    </${Expand}>` : null}
  </div>`;
}

function BiomarkersView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [viewMode, setViewMode] = useState("Clinical");
  React.useEffect(() => {
    if (data || err) return;
    const params = new URLSearchParams(location.search);
    const token = params.get("t") || params.get("token") || "";
    fetch("https://ptisuvfdufngdfxfrzvn.supabase.co/functions/v1/dashboard?resource=biomarkers&token=" + encodeURIComponent(token))
      .then(async (r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) => setErr(String(e.message || e)));
  }, [data, err]);

  if (err) return html`<div style=${{ color: C.red }} className="text-sm">Failed to load biomarkers: ${err}</div>`;
  if (!data) return html`<div style=${{ color: C.muted }} className="text-sm">Loading biomarkers…</div>`;

  const parsed = data.biomarkers.map((b) => parseBio(b, viewMode));
  const byName = {}; parsed.forEach((p) => { byName[p.name] = p; });
  const attention = parsed.filter((d) => d.sev >= 3).length;

  const perfGroups = BIO_PERF_GROUPS.map((g) => ({
    name: g.name, desc: g.desc,
    items: g.members.map((n) => byName[n]).filter(Boolean),
  })).filter((g) => g.items.length);

  // Anything not slotted into a performance group falls into the clinical-
  // category buckets below.
  const used = new Set();
  perfGroups.forEach((g) => g.items.forEach((i) => used.add(i.name)));
  const leftovers = parsed.filter((p) => !used.has(p.name));
  const lmap = {}, lorder = [];
  leftovers.forEach((p) => {
    if (!lmap[p.category]) { lmap[p.category] = []; lorder.push(p.category); }
    lmap[p.category].push(p);
  });
  lorder.sort();
  const extraGroups = lorder.map((cat) => ({
    name: cat,
    desc: "Additional clinical markers not tied to a performance category.",
    items: lmap[cat].slice().sort((a, b) => b.sev - a.sev || a.name.localeCompare(b.name)),
  }));

  const allDates = parsed.flatMap((p) => p.series.map((s) => s.label));
  const latestStr = allDates.length ? allDates[allDates.length - 1] : "—";

  const radarData = perfGroups.map((g) => ({
    category: g.name,
    score: bioGroupScore(g.items) ?? 0,
  }));

  const renderGroup = (g, key) => {
    const score = bioGroupScore(g.items);
    const sl = bioGroupScoreLabel(score);
    const need = g.items.filter((i) => i.sev >= 3).length;
    return html`<div key=${key} style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 14 }} className="p-5">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex flex-col items-center shrink-0" style=${{ width: 100 }}>
          <${ScoreRing} score=${score} color=${sl.c} />
          <div style=${{ color: sl.c }} className="text-sm font-semibold mt-1">${sl.w}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-base font-bold" style=${{ color: C.text }}>${g.name}</div>
            <div className="text-xs font-semibold shrink-0" style=${{ color: need ? C.amber : C.green }}>${need ? need + " need attention" : "All in range"}</div>
          </div>
          <div className="text-xs mt-1" style=${{ color: C.muted }}>${g.desc}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        ${g.items.map((b) => html`<${GroupMiniCard} key=${g.name + b.name} b=${b} onClick=${() => setModal(b)} />`)}
      </div>
    </div>`;
  };

  // Keep the open modal in sync with the active viewMode by re-resolving it
  // against the freshly-parsed list (the user may flip the toggle while a
  // detail modal is open).
  const modalBio = modal ? (parsed.find((p) => p.name === modal.name) || modal) : null;
  const viewBlurb = viewMode === "Clinical"
    ? "Clinical: badges follow the rendered bands — broader reference intervals, only flags when you're outside them."
    : "Optimized: badges apply narrower athlete / longevity targets when the panel has them, so borderline-in-range markers can still flag.";

  return html`<div>
    <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
      <div>
        <div style=${{ color: C.muted, letterSpacing: "0.18em" }} className="text-xs font-semibold uppercase">Blood Panel</div>
        <h1 className="text-2xl font-bold mt-1">Biomarkers</h1>
        <div style=${{ color: C.muted }} className="text-xs mt-1">Latest results · ${latestStr} · <span style=${{ color: C.amber }}>${attention} markers</span> flagged High/Low · grouped by performance area</div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <span style=${{ color: C.muted }} className="text-[10px] uppercase font-semibold">Scoring</span>
        <${Pills} options=${["Clinical", "Optimized"]} value=${viewMode} onChange=${setViewMode} />
      </div>
    </div>

    <div style=${{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10 }} className="p-3 mb-4 text-xs">
      <span style=${{ color: C.red }} className="font-semibold">Educational only — not medical advice. </span>
      <span style=${{ color: C.muted }}>${viewBlurb} The coloured bands behind every chart are always the clinical reference ranges; only the badge and ring scoring change with the toggle.</span>
    </div>

    <div className="flex flex-wrap gap-3 mb-4 text-[11px]" style=${{ color: C.muted }}>
      <span><span style=${{ color: "#34d399" }}>■</span> Optimal</span>
      <span><span style=${{ color: "#6ee7b7" }}>■</span> Moderately high / low</span>
      <span><span style=${{ color: "#a7f3d0" }}>■</span> High / low</span>
      <span><span style=${{ color: "#d1fae5" }}>■</span> Very high / very low</span>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <${CategoryRadar} data=${radarData} />
      ${perfGroups.map((g, i) => renderGroup(g, "p" + i))}
    </div>

    ${extraGroups.length ? html`<div style=${{ color: C.text, borderBottom: "1px solid " + C.border }} className="text-sm font-semibold mt-6 mb-3 pb-2">Additional markers</div>` : null}
    ${extraGroups.length ? html`<div style=${{ color: C.muted }} className="text-xs mb-3">Markers from your panel that aren't part of a performance category above, grouped by clinical type.</div>` : null}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${extraGroups.map((g, i) => renderGroup(g, "e" + i))}
    </div>

    ${modalBio ? html`<div onClick=${() => setModal(null)} style=${{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 50 }} className="flex items-start justify-center p-4 overflow-auto">
      <div onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: 680, width: "100%" }} className="mt-8">
        <div className="flex justify-end mb-2">
          <button onClick=${() => setModal(null)} style=${{ background: C.card, border: "1px solid " + C.border, color: C.text, borderRadius: 999 }} className="text-xs font-semibold px-3 py-1.5">✕ Close</button>
        </div>
        <${MarkerDetail} b=${modalBio} />
      </div>
    </div>` : null}
  </div>`;
}

// ---------- recommendations ----------
// Rules-based engine that turns the Optimized biomarker panel + recent
// training context into a list of recommendation cards. Each rule has
// triggers (marker names that must be flagged sev>=2 to fire) and a
// build() that produces the card; the rule reads training context so
// "deload now" advice only fires when load/TSB actually warrant it,
// avoiding the classic "exercise more" suggestion to a 10h/wk athlete.

const REC_SEV = {
  "Very High":     { c: "#ef4444", label: "Very high" },
  "High":          { c: "#f97316", label: "High" },
  "Moderately High": { c: "#fbbf24", label: "Mod. high" },
  "Optimal":       { c: "#34d399", label: "Optimal" },
  "Moderately Low":{ c: "#fbbf24", label: "Mod. low" },
  "Low":           { c: "#f97316", label: "Low" },
  "Very Low":      { c: "#ef4444", label: "Very low" },
};

const TIER_META = {
  "Top priority": { c: "#ef4444" },
  "High":         { c: "#f97316" },
  "Moderate":     { c: "#fbbf24" },
  "Monitor":      { c: "#5eead4" },
};

// Lucide icons — used as accents on recommendation cards.
const ICON = {
  heart:   "M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572",
  battery: "M22 14V10 M11 6H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8 M14 14v-4 M18 14v-4 M22 14a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2",
  pill:    "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z M8.5 8.5l7 7",
  droplet: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  shield:  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  brain:   "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
};
const IconSvg = ({ d, color, size = 18 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke=${color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">${d.split(" M").map((part, i) => html`<path key=${i} d=${(i === 0 ? "" : "M") + part} />`)}</svg>`;

function buildTrainContext(days) {
  if (!days || days.length === 0) return { weeklyHours: null, ctl: null, tsbAvg14: null };
  const last28 = days.slice(-28);
  const minutes = last28.reduce((s, d) => s
    + (d.perSport.Run.dur || 0) + (d.perSport.Bike.dur || 0)
    + (d.perSport.Swim.dur || 0) + (d.perSport.Strength.dur || 0), 0);
  const weeklyHours = (minutes / 60) / 4;
  const last = days[days.length - 1];
  const tsb14 = days.slice(-14).map((d) => d.form).filter((v) => v != null);
  const tsbAvg14 = tsb14.length ? tsb14.reduce((s, x) => s + x, 0) / tsb14.length : null;
  return { weeklyHours, ctl: last ? last.fitness : null, tsbAvg14 };
}

function isHighLoad(ctx) {
  return (ctx.weeklyHours != null && ctx.weeklyHours >= 8)
      || (ctx.tsbAvg14 != null && ctx.tsbAvg14 <= -10);
}

const RECOMMENDATION_RULES = [
  {
    id: "lipids",
    title: "Lower your atherogenic lipoproteins",
    cats: ["Nutrition", "Medical"],
    accent: "#ef4444",
    icon: ICON.heart,
    triggers: ["Apo B", "LDL Cholesterol", "Non-HDL Cholesterol", "Total Cholesterol"],
    build(byName, ctx, triggered) {
      const worstSev = Math.max(...triggered.map((n) => byName[n].sev));
      const tier = worstSev >= 4 ? "Top priority" : worstSev >= 3 ? "High" : "Moderate";
      const crp = byName["HS-CRP"], trigs = byName["Triglycerides"], hdl = byName["HDL Cholesterol"];
      const cleanInflam = crp && crp.sev <= 1;
      const cleanTrigs = trigs && trigs.sev <= 1;
      const cleanHDL = hdl && hdl.sev <= 1;
      let read = "Lipoproteins that drive plaque (LDL, ApoB, Non-HDL) are elevated.";
      if (cleanInflam && cleanTrigs && cleanHDL) {
        read += " HS-CRP, triglycerides and HDL are excellent — so this isolates the issue to lipoprotein quantity rather than inflammation or metabolic dysfunction. For a lean, high-volume endurance athlete this typically tracks with dietary saturated-fat intake or a hyper-responder phenotype; both are addressable.";
      }
      const actions = [
        "Shift saturated → unsaturated fat: trade butter, coconut oil, fatty/processed meat and full-fat cheese for olive oil, avocado, oily fish and nuts.",
        "Add 1–2 soluble-fibre sources daily — oats, legumes, chia or a psyllium scoop — which directly lowers LDL.",
        "Book a GP follow-up for ApoB and Lp(a); ApoB is the number to track over time.",
      ];
      return {
        id: this.id, tier, tierColor: TIER_META[tier].c, accent: this.accent, icon: this.icon,
        title: this.title, cats: this.cats,
        markers: triggered.map((n) => ({ name: n, b: byName[n] })),
        read, actions, impact: "High", effort: "Medium", retest: "10–12 wks",
      };
    },
  },
  {
    id: "recovery",
    title: "Reduce training stress & restore hormones",
    cats: ["Recovery", "Nutrition"],
    accent: "#f97316",
    icon: ICON.battery,
    triggers: ["SHBG", "Cortisol - AM", "Free Testosterone", "Total Testosterone", "Lymphocytes"],
    build(byName, ctx, triggered) {
      const worstSev = Math.max(...triggered.map((n) => byName[n].sev));
      const highLoad = isHighLoad(ctx);
      const tier = worstSev >= 4 ? "Top priority" : highLoad ? "High" : "Moderate";
      let read;
      if (highLoad) {
        const bits = [];
        if (ctx.weeklyHours != null) bits.push("weekly volume ~" + ctx.weeklyHours.toFixed(1) + "h");
        if (ctx.tsbAvg14 != null) bits.push("14-day form averaging " + ctx.tsbAvg14.toFixed(0));
        if (ctx.ctl != null) bits.push("CTL ~" + ctx.ctl.toFixed(0));
        read = "Cross-referencing your training log (" + bits.join(", ") + "): these endocrine markers look like accumulated training stress suppressing your HPG axis — a recovery signal, not a primary endocrine problem. The training data already supports a deload.";
      } else {
        read = "These endocrine markers suggest disrupted recovery, but your training load isn't elevated. Look first at sleep quality, total energy intake (especially around hard sessions), and life stress.";
      }
      const actions = [];
      if (highLoad) actions.push("Take a 5–7 day deload now — drop volume by ~40%, keep intensity occasional and short.");
      actions.push("Protect sleep: anchor a consistent wake time and aim for the top of your usual range during hard blocks.");
      actions.push("Fuel enough — low energy availability is a major driver of high SHBG and suppressed free T. Match intake to your bigger days, especially around training.");
      actions.push("Re-test SHBG, free T and AM cortisol after a recovery block, sampled on a rest-day morning.");
      return {
        id: this.id, tier, tierColor: TIER_META[tier].c, accent: this.accent, icon: this.icon,
        title: this.title, cats: this.cats,
        markers: triggered.map((n) => ({ name: n, b: byName[n] })),
        read, actions, impact: "High", effort: "Low", retest: "6–8 wks",
      };
    },
  },
  {
    id: "micro",
    title: "Top up vitamins & audit your supplement stack",
    cats: ["Supplements", "Nutrition"],
    accent: "#fbbf24",
    icon: ICON.pill,
    triggers: ["Vitamin B12", "Vitamin D", "Folate (Serum)", "Magnesium", "Phosphorus"],
    build(byName, ctx, triggered) {
      const tier = "Moderate";
      const high = triggered.filter((n) => byName[n].sev >= 2 && /High/i.test(byName[n].score));
      const low = triggered.filter((n) => byName[n].sev >= 2 && /Low/i.test(byName[n].score));
      let read = "";
      if (low.length) read += "Low / borderline: " + low.join(", ") + ". ";
      if (high.length) read += "High: " + high.join(", ") + " — mildly high serum levels almost always mean active supplementation, so the lever is auditing your stack rather than adding to it. ";
      if (!read) read = "Some micronutrients drifted from the optimized targets — small adjustments below.";
      const actions = [];
      if (low.includes("Vitamin B12")) actions.push("B12: add more eggs, fish or dairy, or take a modest B-complex, then recheck.");
      if (low.includes("Vitamin D")) actions.push("Vitamin D: 15–20 min of midday sun where practical + a low-dose D3 in the season you miss it, recheck after 8 weeks.");
      if (low.includes("Folate (Serum)")) actions.push("Folate: leafy greens, legumes and citrus daily; recheck with the next panel.");
      if (high.length) actions.push("Audit your supplement stack — temporarily drop anything supplying the flagged minerals to confirm they're the cause.");
      actions.push("Re-test in 8–12 weeks.");
      return {
        id: this.id, tier, tierColor: TIER_META[tier].c, accent: this.accent, icon: this.icon,
        title: this.title, cats: this.cats,
        markers: triggered.map((n) => ({ name: n, b: byName[n] })),
        read, actions, impact: "Medium", effort: "Low", retest: "8–12 wks",
      };
    },
  },
  {
    id: "glucose",
    title: "Fasting glucose — likely a false alarm",
    cats: ["Monitor"],
    accent: "#5eead4",
    icon: ICON.droplet,
    triggers: ["Fasting Blood Glucose (FBG)"],
    fire(byName) {
      const fbg = byName["Fasting Blood Glucose (FBG)"];
      const hba1c = byName["HbA1c"];
      // Only fire when fasting glucose is flagged BUT HbA1c is optimal —
      // the classic athlete-discordance pattern.
      return fbg && fbg.sev >= 2 && hba1c && hba1c.sev <= 1;
    },
    build(byName, ctx, triggered) {
      const fbg = byName["Fasting Blood Glucose (FBG)"];
      const hba1c = byName["HbA1c"];
      const read = "Discordance check: fasting glucose flagged at " + fbg.value + " " + (fbg.units || "") + ", but HbA1c is " + hba1c.value + (hba1c.units || "") + " — the 3-month average wins. That pairing means your underlying glucose control is excellent and the single reading is most likely a stress / dawn-effect / morning-training artefact rather than a metabolic concern.";
      const actions = [
        "No action needed — 90-day glucose control is genuinely excellent.",
        "Next draw: sample rested and not within ~24h of a hard or long session to avoid the morning-training spike.",
      ];
      return {
        id: this.id, tier: "Monitor", tierColor: TIER_META["Monitor"].c, accent: this.accent, icon: this.icon,
        title: this.title, cats: this.cats,
        markers: [
          { name: "Fasting Glucose", b: fbg },
          { name: "HbA1c", b: hba1c },
        ],
        read, actions, impact: "Low", effort: "Low", retest: "next draw",
      };
    },
  },
  {
    id: "iron",
    title: "Iron support for endurance",
    cats: ["Nutrition", "Medical"],
    accent: "#f97316",
    icon: ICON.shield,
    triggers: ["Ferritin", "Iron", "% Transferrin Saturation", "Hemoglobin"],
    build(byName, ctx, triggered) {
      const tier = triggered.some((n) => byName[n].sev >= 3) ? "High" : "Moderate";
      const read = "Low iron-status markers are a real endurance limiter — oxygen-delivery suffers before haemoglobin moves. Worth addressing before chasing extra training adaptation.";
      const actions = [
        "Add red meat, liver, oysters or sardines a few times per week; pair plant iron (legumes, dark greens) with vitamin C.",
        "Avoid tea/coffee within an hour of iron-rich meals — they block absorption.",
        "Discuss with a doctor before supplementing — over-supplementing iron has risks; a 3-month ferrous-sulphate course is common if confirmed.",
        "Recheck ferritin, iron and saturation in 8–12 weeks.",
      ];
      return {
        id: this.id, tier, tierColor: TIER_META[tier].c, accent: this.accent, icon: this.icon,
        title: this.title, cats: this.cats,
        markers: triggered.map((n) => ({ name: n, b: byName[n] })),
        read, actions, impact: "Medium", effort: "Low", retest: "8–12 wks",
      };
    },
  },
  {
    id: "inflammation",
    title: "Investigate elevated inflammation",
    cats: ["Medical", "Recovery"],
    accent: "#ef4444",
    icon: ICON.brain,
    triggers: ["HS-CRP", "White Blood Cell (WBC)"],
    fire(byName) {
      const crp = byName["HS-CRP"];
      return crp && crp.sev >= 3;
    },
    build(byName, ctx, triggered) {
      const tier = "High";
      const read = "HS-CRP this high is a real systemic-inflammation signal and worth a clinician's eye. Rule out recent infection, hard sessions in the last 48–72h, dental issues or chronic inflammation drivers before assuming a chronic problem.";
      const actions = [
        "Repeat HS-CRP in 3–4 weeks on a rested day, no hard training in the prior 48h.",
        "Audit obvious drivers: sleep debt, gum/dental health, gut issues, alcohol intake.",
        "If still elevated on repeat, book a GP review for further workup.",
      ];
      return {
        id: this.id, tier, tierColor: TIER_META[tier].c, accent: this.accent, icon: this.icon,
        title: this.title, cats: this.cats,
        markers: triggered.map((n) => ({ name: n, b: byName[n] })),
        read, actions, impact: "High", effort: "Low", retest: "3–4 wks",
      };
    },
  },
];

function buildRecommendations(parsedList, ctx) {
  const byName = {};
  parsedList.forEach((p) => { byName[p.name] = p; });
  const recs = [];
  for (const rule of RECOMMENDATION_RULES) {
    const triggered = rule.triggers.filter((n) => byName[n] && byName[n].sev >= 2);
    const passes = rule.fire ? rule.fire(byName) : triggered.length > 0;
    if (!passes || !triggered.length) continue;
    recs.push(rule.build(byName, ctx, triggered));
  }
  const impactScore = { "High": 3, "Medium": 2, "Low": 1 };
  recs.sort((a, b) => (impactScore[b.impact] - impactScore[a.impact])
                   || (a.tier === "Top priority" ? -1 : b.tier === "Top priority" ? 1 : 0));
  return { recs, byName };
}

// Nutrition swap suggestions, conditional on which rules fired.
const EAT_SWAPS = {
  lipids: {
    more: [
      { food: "Oats, barley & legumes", tag: "Soluble fibre → lowers LDL" },
      { food: "Olive oil & avocado", tag: "Swap for sat fat → LDL / ApoB" },
      { food: "Oily fish — salmon, sardines, mackerel", tag: "Omega-3 + B12 → ApoB, B12" },
      { food: "Nuts — almonds, walnuts", tag: "Unsaturated fat → LDL" },
    ],
    less: [
      { food: "Butter & coconut oil", tag: "Saturated fat → raises LDL / ApoB" },
      { food: "Fatty & processed meat — bacon, sausage", tag: "Saturated fat → LDL / ApoB" },
      { food: "Full-fat cheese", tag: "Saturated fat → LDL" },
      { food: "Deep-fried foods", tag: "Sat / trans fat → LDL" },
    ],
  },
  recovery: {
    more: [{ food: "Carbs around training — rice, potato, fruit", tag: "Energy availability → SHBG / Free T" }],
    less: [],
  },
  micro: {
    more: [{ food: "Eggs & dairy", tag: "Raises B12" }],
    less: [],
  },
  iron: {
    more: [{ food: "Red meat, liver, oysters", tag: "Iron + B12 → ferritin" }],
    less: [{ food: "Tea/coffee with iron-rich meals", tag: "Blocks iron absorption" }],
  },
};

// "Working" markers worth calling out (key longevity / endurance markers that
// land Optimal).
const KEY_OPTIMAL_HIGHLIGHTS = [
  { name: "HS-CRP", note: "very low systemic inflammation" },
  { name: "HDL Cholesterol", note: "healthy 'good cholesterol'" },
  { name: "Triglycerides", note: "excellent metabolic marker" },
  { name: "HbA1c", note: "excellent 3-month glucose control" },
  { name: "Ferritin", note: "iron stores dialled in" },
  { name: "Hemoglobin", note: "oxygen-carrying capacity strong" },
  { name: "Vitamin D", note: "in range" },
  { name: "Apo B", note: "atherogenic particles in range" },
];

// Common supplements / interventions we want to actively dismiss when the
// underlying marker is fine.
const EVALUATED_INTERVENTIONS = [
  { name: "Vitamin D", checkMarker: "Vitamin D",
    okReason: "Already in your optimal range — supplementing a marker that's in range adds nothing and risks overshooting." },
  { name: "Omega-3 / fish oil", checkMarker: "Triglycerides",
    okReason: "Triglycerides and HS-CRP — its main targets — are already excellent. Get omega-3 from oily fish instead of capsules." },
  { name: "Iron / ferritin", checkMarker: "Ferritin",
    okReason: "The usual endurance watch-item, but yours is strong. No iron supplement needed." },
  { name: "Magnesium", checkMarker: "Magnesium",
    okReason: "Serum magnesium is fine. Supplement only if you have symptoms (cramps, poor sleep)." },
];

const REC_FILTERS = ["All", "Nutrition", "Recovery", "Medical", "Supplements", "Monitor"];

function RecChip({ m }) {
  const sevMeta = REC_SEV[m.b.score] || REC_SEV["Optimal"];
  return html`<div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
    style=${{ background: C.bg, border: "1px solid " + C.border }}>
    <span style=${{ width: 7, height: 7, borderRadius: 99, background: sevMeta.c, flexShrink: 0 }} />
    <span className="text-xs" style=${{ color: C.text }}>${m.name}</span>
    <span className="text-xs" style=${{ color: C.muted }}>${m.b.value != null ? m.b.value : "—"}${m.b.units ? " " + m.b.units : ""}</span>
    <span className="text-xs font-medium" style=${{ color: sevMeta.c }}>${sevMeta.label}</span>
  </div>`;
}

// Impact/effort coordinates per rule (0-100, where x=effort, y=impact).
// Top-left of the grid = quick wins, top-right = big bets.
const REC_IMPACT_XY = { "High": 78, "Medium": 50, "Low": 22 };
const REC_EFFORT_XY = { "Low": 22, "Medium": 50, "High": 78 };

// When several recs share the same (impact, effort) bucket they'd overlap
// on the scatter. Distribute them around a small circle around the base.
function getRecScatterPoints(recs) {
  const buckets = {};
  recs.forEach((_, i) => {
    const key = recs[i].impact + "|" + recs[i].effort;
    (buckets[key] ??= []).push(i);
  });
  const out = new Array(recs.length);
  for (const indices of Object.values(buckets)) {
    const baseX = REC_EFFORT_XY[recs[indices[0]].effort] ?? 50;
    const baseY = REC_IMPACT_XY[recs[indices[0]].impact] ?? 50;
    if (indices.length === 1) {
      out[indices[0]] = { x: baseX, y: baseY };
    } else {
      const radius = 7;
      indices.forEach((idx, k) => {
        const angle = (k / indices.length) * 2 * Math.PI - Math.PI / 2;
        out[idx] = { x: baseX + radius * Math.cos(angle), y: baseY + radius * Math.sin(angle) };
      });
    }
  }
  return out;
}

// Smooth-scroll to a rec card by id. Cards are rendered with id="rec-<id>".
function scrollToRec(id) {
  const el = typeof document !== "undefined" && document.getElementById("rec-" + id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function ImpactEffortMap({ recs }) {
  const [hover, setHover] = useState(-1);
  const W = 600, H = 460;
  const padL = 50, padR = 30, padT = 30, padB = 70;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const px = (x) => padL + (x / 100) * plotW;
  const py = (y) => padT + ((100 - y) / 100) * plotH;
  const points = getRecScatterPoints(recs);
  const midY = padT + plotH / 2;

  // Hover label position (next to the hovered dot, flipped if near the
  // right edge so it doesn't run off the SVG).
  let tip = null;
  if (hover >= 0) {
    const cx = px(points[hover].x), cy = py(points[hover].y);
    const title = recs[hover].title;
    const w = title.length * 6.6 + 16;
    const right = cx + 24 + w < W - 8;
    const x = right ? cx + 22 : cx - 22;
    tip = { x, y: cy, title, w, right, color: recs[hover].accent };
  }

  return html`<svg viewBox=${"0 0 " + W + " " + H} className="w-full" style=${{ maxHeight: 480 }}>
    <rect x=${padL} y=${padT} width=${plotW / 2} height=${plotH / 2} fill="#5eead4" opacity=${0.06} />
    <line x1=${padL} y1=${padT + plotH} x2=${padL + plotW} y2=${padT + plotH} stroke=${C.border} strokeWidth=${1} />
    <line x1=${padL} y1=${padT} x2=${padL} y2=${padT + plotH} stroke=${C.border} strokeWidth=${1} />
    <line x1=${px(50)} y1=${padT} x2=${px(50)} y2=${padT + plotH} stroke=${C.border} strokeWidth=${1} strokeDasharray="3 4" />
    <line x1=${padL} y1=${py(50)} x2=${padL + plotW} y2=${py(50)} stroke=${C.border} strokeWidth=${1} strokeDasharray="3 4" />
    <text x=${padL + 12} y=${padT + 22} fill="#5eead4" fontSize=${12} fontWeight=${700} opacity=${0.85} letterSpacing=${1.5}>QUICK WINS</text>
    <text x=${padL + plotW - 12} y=${padT + 22} fill=${C.muted} fontSize=${12} fontWeight=${600} opacity=${0.65} letterSpacing=${1.5} textAnchor="end">BIG BETS</text>
    <text x=${padL + 12} y=${padT + plotH - 10} fill=${C.muted} fontSize=${12} fontWeight=${600} opacity=${0.65} letterSpacing=${1.5}>EASY EXTRAS</text>
    <text x=${padL + plotW - 12} y=${padT + plotH - 10} fill=${C.muted} fontSize=${12} fontWeight=${600} opacity=${0.65} letterSpacing=${1.5} textAnchor="end">LOW PRIORITY</text>
    <text x=${22} y=${midY} fill=${C.muted} fontSize=${11} letterSpacing=${1.5} textAnchor="middle" transform=${"rotate(-90, 22, " + midY + ")"}>IMPACT ↑</text>
    <text x=${padL + plotW / 2} y=${padT + plotH + 38} fill=${C.muted} fontSize=${11} letterSpacing=${1.5} textAnchor="middle">EFFORT →</text>
    ${points.map((p, i) => {
      const cx = px(p.x), cy = py(p.y);
      const r = recs[i];
      return html`<g key=${i}
          onMouseEnter=${() => setHover(i)}
          onMouseLeave=${() => setHover(-1)}
          onClick=${() => scrollToRec(r.id)}
          style=${{ cursor: "pointer" }}>
        <circle cx=${cx} cy=${cy} r=${18} fill="none" stroke=${r.accent} opacity=${0.28} strokeWidth=${2} />
        <circle cx=${cx} cy=${cy} r=${14} fill=${r.accent} />
        <text x=${cx} y=${cy + 1} fill="#ffffff" fontSize=${13} fontWeight=${700} textAnchor="middle" dominantBaseline="central" pointerEvents="none">${i + 1}</text>
      </g>`;
    })}
    ${tip ? html`<g pointerEvents="none">
      <rect x=${tip.right ? tip.x : tip.x - tip.w} y=${tip.y - 13} width=${tip.w} height=${26} rx=${5}
        fill=${C.card} stroke=${tip.color} strokeWidth=${1} opacity=${0.96} />
      <text x=${tip.right ? tip.x + 8 : tip.x - 8} y=${tip.y + 1} fill=${C.text} fontSize=${12} fontWeight=${500}
        textAnchor=${tip.right ? "start" : "end"} dominantBaseline="central">${tip.title}</text>
    </g>` : null}
  </svg>`;
}

function RecCard({ r }) {
  return html`<div id=${"rec-" + r.id} className="rounded-2xl overflow-hidden scroll-mt-4"
    style=${{ background: C.card, border: "1px solid " + C.border, borderLeft: "3px solid " + r.accent }}>
    <div className="p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-xl flex items-center justify-center" style=${{ width: 40, height: 40, background: r.accent + "1f", flexShrink: 0 }}>
          <${IconSvg} d=${r.icon} color=${r.accent} size=${20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-semibold rounded-md px-2 py-0.5"
              style=${{ background: r.tierColor + "22", color: r.tierColor }}>${r.tier}</span>
            ${r.cats.map((c) => html`<span key=${c} className="text-[11px]" style=${{ color: C.muted }}>${c}</span>`)}
          </div>
          <h3 className="text-base font-semibold" style=${{ color: C.text, letterSpacing: "-0.01em" }}>${r.title}</h3>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">${r.markers.map((m) => html`<${RecChip} key=${m.name} m=${m} />`)}</div>
      <div className="rounded-xl p-3.5 mb-4" style=${{ background: C.bg, border: "1px solid " + C.border }}>
        <div className="text-[10px] font-semibold tracking-wider mb-1.5" style=${{ color: r.accent }}>ANALYSIS</div>
        <p className="text-sm leading-relaxed" style=${{ color: C.muted }}>${r.read}</p>
      </div>
      <div className="text-[10px] font-semibold tracking-wider mb-2.5" style=${{ color: C.muted }}>WHAT TO DO</div>
      <div className="mb-4">
        ${r.actions.map((a, i) => html`<div key=${i} className="flex items-start gap-2.5 mb-2.5">
          <span style=${{ width: 5, height: 5, borderRadius: 99, background: r.accent, flexShrink: 0, marginTop: 7 }} />
          <span className="text-sm leading-snug" style=${{ color: C.text }}>${a}</span>
        </div>`)}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3" style=${{ borderTop: "1px solid " + C.border }}>
        <div><span className="text-xs" style=${{ color: C.muted }}>Impact</span> <span className="text-xs font-semibold" style=${{ color: r.accent }}>${r.impact}</span></div>
        <div><span className="text-xs" style=${{ color: C.muted }}>Effort</span> <span className="text-xs font-semibold" style=${{ color: C.text }}>${r.effort}</span></div>
        <div><span className="text-xs" style=${{ color: C.muted }}>Retest</span> <span className="text-xs font-semibold" style=${{ color: C.text }}>${r.retest}</span></div>
      </div>
    </div>
  </div>`;
}

function RecommendationsView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("All");
  React.useEffect(() => {
    if (data || err) return;
    const params = new URLSearchParams(location.search);
    const token = params.get("t") || params.get("token") || "";
    fetch("https://ptisuvfdufngdfxfrzvn.supabase.co/functions/v1/dashboard?resource=biomarkers&token=" + encodeURIComponent(token))
      .then(async (r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d) => setData(d))
      .catch((e) => setErr(String(e.message || e)));
  }, [data, err]);

  if (err) return html`<div style=${{ color: C.red }} className="text-sm">Failed to load biomarkers: ${err}</div>`;
  if (!data) return html`<div style=${{ color: C.muted }} className="text-sm">Loading recommendations…</div>`;

  // Optimized scoring drives the recs — longevity / athlete cutoffs.
  const parsed = data.biomarkers.map((b) => parseBio(b, "Optimized"));
  const ctx = buildTrainContext(DAYS);
  const { recs, byName } = buildRecommendations(parsed, ctx);

  const shown = filter === "All" ? recs : recs.filter((r) => r.cats.includes(filter));
  const allOptimal = parsed.filter((p) => p.sev <= 1);
  const flaggedCount = parsed.filter((p) => p.sev >= 2).length;

  const firedIds = new Set(recs.map((r) => r.id));
  const eatMore = [], eatLess = [];
  for (const id of firedIds) {
    if (EAT_SWAPS[id]) {
      eatMore.push(...EAT_SWAPS[id].more);
      eatLess.push(...EAT_SWAPS[id].less);
    }
  }
  const dedupe = (arr) => { const seen = new Set(); return arr.filter((x) => seen.has(x.food) ? false : (seen.add(x.food), true)); };
  const eatMoreU = dedupe(eatMore);
  const eatLessU = dedupe(eatLess);

  const working = KEY_OPTIMAL_HIGHLIGHTS
    .map((h) => byName[h.name] && byName[h.name].sev <= 1
      ? (byName[h.name].name + " (" + byName[h.name].value + (byName[h.name].units ? " " + byName[h.name].units : "") + ") — " + h.note)
      : null)
    .filter(Boolean);

  const evaluated = EVALUATED_INTERVENTIONS
    .filter((e) => byName[e.checkMarker] && byName[e.checkMarker].sev <= 1)
    .map((e) => {
      const m = byName[e.checkMarker];
      return {
        name: e.name,
        val: m.value + (m.units ? " " + m.units : "") + " · " + m.score,
        reason: e.okReason,
      };
    });

  const topRec = recs[0];
  const summary = [
    { k: String(recs.length), v: "focus area" + (recs.length === 1 ? "" : "s") },
    topRec ? { k: topRec.tier, v: topRec.title.split(" ").slice(0, 3).join(" ") + "…", c: topRec.accent } : null,
    { k: String(flaggedCount), v: "markers flagged", c: flaggedCount ? C.amber : C.green },
    ctx.weeklyHours != null ? { k: ctx.weeklyHours.toFixed(1) + "h", v: "training/wk (28d)" } : null,
  ].filter(Boolean);

  return html`<div>
    <div className="mb-5">
      <div style=${{ color: C.muted, letterSpacing: "0.18em" }} className="text-xs font-semibold uppercase">Action Plan</div>
      <h1 className="text-2xl font-bold mt-1">Recommendations</h1>
      <p className="text-xs leading-relaxed mt-2" style=${{ color: C.muted, maxWidth: 600 }}>
        Auto-generated from your latest blood panel (Optimized scoring) and your last 28 days of training. Markers are clustered by root cause and ranked by impact; the analysis reads your training context so advice like a deload only fires when the data actually warrants it.
      </p>
    </div>

    <div className="flex flex-wrap gap-2 mb-5">
      ${summary.map((s, i) => html`<div key=${i} className="rounded-xl px-4 py-2.5" style=${{ background: C.card, border: "1px solid " + C.border }}>
        <span className="text-base font-bold" style=${{ color: s.c || C.text }}>${s.k}</span>
        <span className="text-xs ml-2" style=${{ color: C.muted }}>${s.v}</span>
      </div>`)}
    </div>

    <div className="rounded-xl px-4 py-3 mb-5 flex gap-3 items-start" style=${{ background: "rgba(239,83,80,0.07)", border: "1px solid rgba(239,83,80,0.25)" }}>
      <span style=${{ color: C.red, marginTop: 1, fontSize: 14 }}>⚠</span>
      <p className="text-xs leading-relaxed" style=${{ color: "#d99" }}>
        <strong style=${{ color: C.red }}>Educational only — not medical advice.</strong> Evidence-informed suggestions auto-generated from your data. Discuss any changes — especially around lipids or medication — with a clinician.
      </p>
    </div>

    <div className="flex flex-wrap gap-2 mb-5">
      ${REC_FILTERS.map((f) => {
        const on = filter === f;
        return html`<button key=${f} onClick=${() => setFilter(f)}
          className="text-xs rounded-full px-3.5 py-1.5 transition cursor-pointer"
          style=${{ background: on ? C.cyan : C.card, color: on ? "#06212a" : C.muted, border: "1px solid " + (on ? C.cyan : C.border), fontWeight: on ? 600 : 400 }}>${f}</button>`;
      })}
    </div>

    ${recs.length >= 2 && filter === "All" ? html`<div className="rounded-2xl p-5 mb-5" style=${{ background: C.card, border: "1px solid " + C.border }}>
      <div className="text-base font-semibold" style=${{ color: C.text }}>Where to start — impact vs effort</div>
      <p className="text-xs mt-1 mb-4" style=${{ color: C.muted }}>Top-left = biggest return for the least work. Start there.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
        <${ImpactEffortMap} recs=${recs} />
        <div className="flex flex-col gap-3">
          ${recs.map((r, i) => html`<button key=${i} onClick=${() => scrollToRec(r.id)}
              className="flex items-center gap-3 text-left rounded-lg p-1 -m-1 transition-colors"
              style=${{ background: "transparent", border: "none", cursor: "pointer" }}
              onMouseEnter=${(e) => e.currentTarget.style.background = "rgba(127,127,127,0.08)"}
              onMouseLeave=${(e) => e.currentTarget.style.background = "transparent"}>
            <div style=${{ width: 30, height: 30, borderRadius: 99, background: r.accent, color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>${i + 1}</div>
            <span className="text-sm" style=${{ color: C.text }}>${r.title}</span>
          </button>`)}
        </div>
      </div>
    </div>` : null}

    ${shown.length === 0 ? html`<div style=${{ background: C.card, border: "1px solid " + C.border, borderRadius: 14 }} className="p-5 text-sm">
      <span style=${{ color: C.green }}>● </span><span style=${{ color: C.muted }}>${filter === "All" ? "No flagged markers in the Optimized panel — nothing to act on right now. Keep doing what's working." : "Nothing in this category requires action."}</span>
    </div>` : html`<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${shown.map((r) => html`<${RecCard} key=${r.id} r=${r} />`)}
    </div>`}

    ${(filter === "All" || filter === "Nutrition") && (eatMoreU.length || eatLessU.length) ? html`<div className="rounded-2xl p-5 mt-6" style=${{ background: C.card, border: "1px solid " + C.border }}>
      <div className="text-base font-semibold mb-1" style=${{ color: C.text }}>Eat more / eat less</div>
      <p className="text-xs mb-4" style=${{ color: C.muted }}>Swaps targeting your flagged markers — this is about quality, not eating less overall. Keep fuelling for training.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        ${[{ title: "Eat more", items: eatMoreU, c: "#34d399" }, { title: "Eat less", items: eatLessU, c: "#f97316" }].map((col) => col.items.length ? html`<div key=${col.title}>
          <div className="text-sm font-semibold mb-3" style=${{ color: col.c }}>${col.title}</div>
          ${col.items.map((it) => html`<div key=${it.food} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 mb-2" style=${{ background: C.bg, border: "1px solid " + C.border }}>
            <span style=${{ width: 6, height: 6, borderRadius: 99, background: col.c, flexShrink: 0, marginTop: 6 }} />
            <div>
              <div className="text-sm" style=${{ color: C.text }}>${it.food}</div>
              <div className="text-xs mt-0.5" style=${{ color: C.muted }}>${it.tag}</div>
            </div>
          </div>`)}
        </div>` : null)}
      </div>
    </div>` : null}

    ${filter === "All" && evaluated.length ? html`<div className="rounded-2xl p-5 mt-5" style=${{ background: C.card, border: "1px solid " + C.border }}>
      <div className="text-base font-semibold mb-1" style=${{ color: C.text }}>Evaluated — no action needed</div>
      <p className="text-xs mb-4" style=${{ color: C.muted }}>Common interventions ruled out against your current panel.</p>
      ${evaluated.map((e) => html`<div key=${e.name} className="rounded-xl p-3.5 mb-3" style=${{ background: C.bg, border: "1px solid " + C.border }}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-medium" style=${{ color: C.text }}>${e.name}</span>
          <span className="text-xs" style=${{ color: C.muted }}>${e.val}</span>
        </div>
        <p className="text-xs leading-relaxed" style=${{ color: C.muted }}>${e.reason}</p>
      </div>`)}
    </div>` : null}

    ${filter === "All" && working.length ? html`<div className="rounded-2xl p-5 mt-5" style=${{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.25)" }}>
      <div className="text-base font-semibold mb-3" style=${{ color: C.text }}>What's working — keep it up</div>
      ${working.map((w) => html`<div key=${w} className="flex items-center gap-2.5 mb-2">
        <span style=${{ color: C.green, fontWeight: 700 }}>✓</span>
        <span className="text-sm" style=${{ color: C.muted }}>${w}</span>
      </div>`)}
    </div>` : null}

    <p className="text-xs text-center mt-6" style=${{ color: C.muted }}>Re-run your panel after the suggested retest windows to track progress.</p>
  </div>`;
}

// ---------- main ----------
function App() {
  const [tab, setTab] = useState("Training");
  const [theme, setTheme] = useState(_theme);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };
  const [range, setRange] = useState("6M");
  const [volGran, setVolGran] = useState("Weekly");
  const [zoneGran, setZoneGran] = useState("Weekly");
  const [sleepGran, setSleepGran] = useState("Weekly");
  const [sport, setSport] = useState("All");
  const [metric, setMetric] = useState("Load");
  const [showRaw, setShowRaw] = useState(false);
  const [showRawWeight, setShowRawWeight] = useState(false);
  const [loadView, setLoadView] = useState("Acute load"); // "Acute load" | "Ratio"
  const [fitOverlay, setFitOverlay] = useState("None");

  // Optional metric overlayed on the Fitness & Fatigue chart's right Y-axis.
  // `key` is the field name on each view row.
  const FIT_OVERLAYS = {
    "None":              null,
    "Form (TSB)":        { key: "form",      color: C.text,    unit: "" },
    "ACWR":              { key: "acwr",      color: "#a78bfa", unit: "" },
    "HRV (7d)":          { key: "hrv",       color: C.green,   unit: " ms" },
    "Resting HR (7d)":   { key: "rhr",       color: C.teal,    unit: " bpm" },
    "Weight (7d)":       { key: "weight",    color: C.amber,   unit: " kg" },
    "Sleep (h)":         { key: "sleep",     color: "#818cf8", unit: " h" },
    "Daily load":        { key: "loadTotal", color: "#9aa6b6", unit: "" },
  };

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
    "1M": ["Daily", "Weekly"],
    "3M": ["Daily", "Weekly"],
    "6M": ["Weekly", "Monthly"],
    "1Y": ["Weekly", "Monthly"],
    "2Y": ["Weekly", "Monthly"],
    "All": ["Monthly"],
  };
  const granDefault = { "1M": "Daily", "3M": "Weekly", "6M": "Weekly", "1Y": "Monthly", "2Y": "Monthly", "All": "Monthly" };
  const onRange = (r) => { setRange(r); const d = granDefault[r]; setVolGran(d); setZoneGran(d); setSleepGran(d); };

  const nDays = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "All": DAYS.length }[range];
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
  // Half-width of the band in σ units. ±1σ covers ~68% of nightly
  // readings, which felt visually too wide; ±0.7σ covers ~52% and
  // narrows the band ~30% while still reflecting normal variation.
  const HRV_BAND_SIGMA = 0.7;
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
        band = [r1(m - HRV_BAND_SIGMA * sd), r1(m + HRV_BAND_SIGMA * sd)];
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

  // Y-domain for the Form chart: tight to the data on top, but always
  // shows at least down to −30 so the top of the High-Risk band is
  // visible; extends lower when data goes below.
  const formDomain = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of view) {
      if (d.form != null) {
        if (d.form < lo) lo = d.form;
        if (d.form > hi) hi = d.form;
      }
    }
    if (lo === Infinity) return [-30, 20];
    const pad = 3;
    const minY = Math.min(lo - pad, -30);
    const maxY = hi + pad;
    return [Math.floor(minY / 5) * 5, Math.ceil(maxY / 5) * 5];
  }, [view]);

  // Vertical gradient stops for the Form line so each segment is coloured
  // by the band it passes through. SVG gradient `objectBoundingBox` maps
  // offset 0→top of bbox (= line's max form value) and 100→bottom (min),
  // so we convert each band threshold within the data range into a stop.
  const formGradStops = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of view) {
      if (d.form != null) {
        if (d.form < lo) lo = d.form;
        if (d.form > hi) hi = d.form;
      }
    }
    if (lo === Infinity) return [];
    const span = (hi - lo) || 1;
    const toPct = (y) => 100 * (hi - y) / span;
    const bands = [
      { lo: 20, hi: Infinity, color: C.amber },
      { lo: 5, hi: 20, color: C.cyan },
      { lo: -10, hi: 5, color: C.muted },
      { lo: -30, hi: -10, color: C.green },
      { lo: -Infinity, hi: -30, color: C.red },
    ];
    const stops = [];
    for (const band of bands) {
      const top = Math.min(hi, band.hi);
      const bottom = Math.max(lo, band.lo);
      if (bottom >= top) continue;
      stops.push({ offset: toPct(top), color: band.color });
      stops.push({ offset: toPct(bottom), color: band.color });
    }
    return stops;
  }, [view]);

  // Tight y-domain for Fitness & Fatigue so small day-to-day moves are
  // visible — round each end to the nearest 5 with a small pad, clamped
  // at 0 (CTL/ATL can't go negative).
  const ffDomain = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of view) {
      if (d.fitness != null) { if (d.fitness < lo) lo = d.fitness; if (d.fitness > hi) hi = d.fitness; }
      if (d.fatigue != null) { if (d.fatigue < lo) lo = d.fatigue; if (d.fatigue > hi) hi = d.fatigue; }
    }
    if (lo === Infinity) return ["auto", "auto"];
    const pad = Math.max(2, (hi - lo) * 0.08);
    return [Math.max(0, Math.floor((lo - pad) / 5) * 5), Math.ceil((hi + pad) / 5) * 5];
  }, [view]);

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

  // Weight: 7-day rolling avg + optional daily values. Mirrors the HRV
  // chart's "Overnight values" toggle pattern.
  const weightSeries = useMemo(() => view.map((d) => ({
    label: d.label,
    weight: d.weight,
    raw: d.weightRaw != null ? r2(d.weightRaw) : null,
  })), [view]);
  const weightDomain = useMemo(() => {
    const vals = [];
    for (const s of weightSeries) {
      if (s.weight != null) vals.push(s.weight);
      if (showRawWeight && s.raw != null) vals.push(s.raw);
    }
    if (!vals.length) return [70, 85];
    return [Math.floor(Math.min(...vals) - 1), Math.ceil(Math.max(...vals) + 1)];
  }, [weightSeries, showRawWeight]);

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

  // Tab bar — always rendered; the Training-only floating range selector
  // is conditioned on the active tab so it doesn't show on Biomarkers.
  const TabBar = html`<div className="max-w-7xl mx-auto px-1 mb-4 flex items-center justify-between" style=${{ borderBottom: "1px solid " + C.border }}>
    <div>
      ${["Training", "Biomarkers", "Recommendations"].map((t) => {
        const on = t === tab;
        return html`<button key=${t} onClick=${() => setTab(t)}
          style=${{ color: on ? C.text : C.muted, borderBottom: "2px solid " + (on ? C.cyan : "transparent"), marginBottom: -1, background: "transparent" }}
          className="px-4 py-2.5 text-sm font-semibold transition-colors">${t}</button>`;
      })}
    </div>
    <button onClick=${toggleTheme}
      title=${theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      style=${{ background: "transparent", color: C.muted, border: "1px solid " + C.border, borderRadius: 999 }}
      className="px-3 py-1.5 text-xs font-semibold transition-colors mr-1 mb-2 flex items-center gap-1.5">
      <span style=${{ fontSize: 14 }}>${theme === "dark" ? "☀" : "☾"}</span>
      <span>${theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  </div>`;

  return html`<div style=${{ background: C.bg, color: C.text, minHeight: "100%" }} className="p-2 sm:p-6">
    ${tab === "Training" ? html`<div className="hidden sm:flex fixed left-3 top-1/2 -translate-y-1/2 flex-col gap-2 z-10">
      ${["1M", "3M", "6M", "1Y", "2Y", "All"].map((o) => {
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
    </div>` : null}

    ${TabBar}

    ${tab === "Biomarkers" ? html`<div className="max-w-7xl mx-auto"><${BiomarkersView} /></div>` : null}

    ${tab === "Recommendations" ? html`<div className="max-w-7xl mx-auto"><${RecommendationsView} /></div>` : null}

    ${tab !== "Training" ? null : html`<div className="max-w-7xl mx-auto">
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
        <${StatusTile} title="HRV (5d avg)"        info=${statusHRV(DAYS)} />
        <${StatusTile} title="Resting HR (7d avg)" info=${statusRHR(DAYS)} />
        <${StatusTile} title="Sleep (7d avg)"      info=${statusSleep(DAYS)} />
      </div>
      <div className="flex flex-wrap gap-4 mb-3 text-[11px]" style=${{ color: C.muted }}>
        <span><span style=${{ color: C.green }}>●</span> Healthy</span>
        <span><span style=${{ color: C.amber }}>●</span> Watch / suboptimal</span>
        <span><span style=${{ color: C.red }}>●</span> Needs attention</span>
      </div>
      <div className="sm:hidden mb-4">
        <${Pills} options=${["1M", "3M", "6M", "1Y", "2Y", "All"]} value=${range} onChange=${onRange} />
      </div>

      <!-- Fitness/Fatigue + Form: one card, stacked charts, synced hover cursor -->
      <${Card} title="Fitness, Fatigue & Form" sub="Blue = fitness (CTL, 42-day EWMA). Purple = fatigue (ATL, 7-day EWMA). White (lower) = form (CTL − ATL)."
        source="Source: intervals.icu wellness (Garmin Connect partnership). Form is derived (CTL − ATL). Days without a wellness row fall back to a local EWMA over Strava training-load."
        right=${html`<div className="flex items-center gap-2">
          <span style=${{ color: C.muted }} className="text-[11px]">Overlay</span>
          <select value=${fitOverlay} onChange=${(e) => setFitOverlay(e.target.value)}
            style=${{ background: C.card, border: "1px solid " + C.border, color: C.text, borderRadius: 999, colorScheme: "dark" }}
            className="px-3 py-1 text-xs font-semibold">
            ${Object.keys(FIT_OVERLAYS).map((k) => html`<option key=${k} value=${k}>${k}</option>`)}
          </select>
        </div>`}>
        <${ResponsiveContainer} width="100%" height=${300}>
          <${ComposedChart} data=${view} syncId="ff" margin=${{ top: 16, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="gFit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor=${C.cyan} stopOpacity=${0.32} />
                <stop offset="100%" stopColor=${C.cyan} stopOpacity=${0.02} />
              </linearGradient>
            </defs>
            <${CartesianGrid} stroke=${C.grid} vertical=${false} />
            <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${48} />
            <${YAxis} yAxisId=${FIT_OVERLAYS[fitOverlay] ? "left" : undefined} domain=${ffDomain} allowDataOverflow=${true} tick=${axis} tickLine=${false} axisLine=${false} width=${38} />
            ${FIT_OVERLAYS[fitOverlay] ? html`<${YAxis} yAxisId="right" orientation="right" tick=${{ ...axis, fill: FIT_OVERLAYS[fitOverlay].color }} tickLine=${false} axisLine=${false} width=${42} />` : null}
            <${Tooltip} content=${h(TT)} />
            ${yearLines(view, FIT_OVERLAYS[fitOverlay] ? "left" : undefined)}
            ${raceLines(view, races, FIT_OVERLAYS[fitOverlay] ? "left" : undefined)}
            <${Area} yAxisId=${FIT_OVERLAYS[fitOverlay] ? "left" : undefined} type="monotone" dataKey="fitness" name="Fitness" stroke=${C.cyan} strokeWidth=${2} fill="url(#gFit)" baseValue=${typeof ffDomain[0] === "number" ? ffDomain[0] : "dataMin"} dot=${false} />
            <${Line} yAxisId=${FIT_OVERLAYS[fitOverlay] ? "left" : undefined} type="monotone" dataKey="fatigue" name="Fatigue" stroke=${C.violet} strokeWidth=${1.6} dot=${false} />
            ${FIT_OVERLAYS[fitOverlay] ? html`<${Line} yAxisId="right" type="monotone" dataKey=${FIT_OVERLAYS[fitOverlay].key} name=${fitOverlay} stroke=${FIT_OVERLAYS[fitOverlay].color} strokeWidth=${1.6} strokeDasharray="4 3" dot=${false} connectNulls=${true} isAnimationActive=${false} />` : null}
          <//>
        <//>
        <${ResponsiveContainer} width="100%" height=${150}>
          <${ComposedChart} data=${view} syncId="ff" margin=${{ top: 4, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="gFormBand" x1="0" y1="0" x2="0" y2="1">
                ${formGradStops.map((s, i) => html`<stop key=${i} offset=${s.offset + "%"} stopColor=${s.color} />`)}
              </linearGradient>
            </defs>
            <${ReferenceArea} y1=${20} y2=${60} fill=${C.amber} fillOpacity=${0.22} />
            <${ReferenceArea} y1=${5} y2=${20} fill=${C.cyan} fillOpacity=${0.22} />
            <${ReferenceArea} y1=${-10} y2=${5} fill=${C.muted} fillOpacity=${0.08} />
            <${ReferenceArea} y1=${-30} y2=${-10} fill=${C.green} fillOpacity=${0.28} />
            <${ReferenceArea} y1=${-60} y2=${-30} fill=${C.red} fillOpacity=${0.12} />
            <${CartesianGrid} stroke=${C.grid} vertical=${false} />
            <${XAxis} dataKey="label" tick=${false} tickLine=${false} axisLine=${{ stroke: C.border }} height=${1} />
            <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${formDomain} allowDataOverflow=${true} />
            <${Tooltip} content=${h(TT)} />
            <${ReferenceLine} y=${0} stroke=${C.border} />
            ${raceLines(view, races)}
            <${Line} type="monotone" dataKey="form" name="Form"
              stroke=${formGradStops.length ? "url(#gFormBand)" : C.text}
              strokeWidth=${1.8} dot=${false} />
          <//>
        <//>
        <div className="text-[11px] mt-3" style=${{ color: C.muted, lineHeight: 1.5 }}>
          Keep purple above blue to drive fitness up. Form (blue − purple) optimal when slightly positive; very negative = high injury risk; very positive = ready to race. Schedule rest weeks to clear fatigue before key events.
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[11px]" style=${{ color: C.muted }}>
          <span style=${{ color: C.muted, marginRight: 4 }}>Form bands:</span>
          <span><span style=${{ color: C.amber }}>■</span> Transition</span>
          <span><span style=${{ color: C.cyan }}>■</span> Fresh</span>
          <span><span style=${{ color: C.muted }}>■</span> Grey zone</span>
          <span><span style=${{ color: C.green }}>■</span> Optimal</span>
          <span><span style=${{ color: C.red }}>■</span> High risk</span>
        </div>
      <//>

      <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-4">

        <${Card}
          title=${loadView === "Acute load" ? "Acute Load" : "Acute : Chronic Load Ratio"}
          sub=${loadView === "Acute load"
            ? "ATL (7-day EWMA) vs your current chronic load. Green band = 0.8–1.3 × CTL — the same sweet spot, expressed in absolute units."
            : "Acute load ÷ chronic load. Sweet spot 0.8–1.3."}
          source="Source: intervals.icu wellness (Garmin Connect partnership). Thresholds (0.8–1.3) from Gabbett / Banister ACWR research."
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

        <${Card} title="Aerobic Efficiency" sub="Run · pace-per-heartbeat (adjusted for temp/humidity/elevation) · higher = fitter aerobic engine"
          source="Source: your Google Sheet (aerobic_efficiency tab). Mirrored daily by GitHub Actions into the aerobic_efficiency table; trend is the 10-session rolling avg of the adjusted EF column.">
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
          source="Source: Strava activity summaries (duration, distance, sport). Load = Strava-reported training-load with a duration-based fallback for the few activities Strava doesn't carry."
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
          source="Source: Strava /activities/{id}/zones (per-activity HR-zone distribution). Backfilled into the workouts table; activities without an HR sensor are absent."
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
          <div className="flex flex-wrap gap-3 mt-3 text-[11px]" style=${{ color: C.text }}>
            ${zoneName.map((n, i) => {
              // Standard Garmin / % of Max-HR zone model. Edges:
              // Z1 <60% · Z2 60-70% · Z3 70-80% · Z4 80-90% · Z5 ≥90%.
              const pct = [[0, 60], [60, 70], [70, 80], [80, 90], [90, 100]][i];
              const range = RAW.maxHr
                ? (i === 0
                    ? `< ${Math.round(RAW.maxHr * pct[1] / 100)} bpm`
                    : i === 4
                      ? `≥ ${Math.round(RAW.maxHr * pct[0] / 100)} bpm`
                      : `${Math.round(RAW.maxHr * pct[0] / 100)}–${Math.round(RAW.maxHr * pct[1] / 100)} bpm`)
                : `${pct[0]}–${pct[1]}% max HR`;
              return html`<div key=${n} className="flex flex-col">
                <span><span style=${{ color: zoneColor[i] }}>■</span> ${n}</span>
                <span style=${{ color: C.muted, fontSize: 10 }} className="ml-3">${range}</span>
              </div>`;
            })}
          </div>
        <//>

        <${Card} title="Sleep Duration" sub=${sleepGran === "Daily" ? "Hours per night" : "Average hours per " + (sleepGran === "Weekly" ? "week" : "month")}
          source="Source: intervals.icu wellness (Garmin Connect partnership) — total sleep seconds. Stage breakdown (deep/REM/light) comes from Apple Health via the HAE Pro webhook, but isn't shown in this chart."
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

        <${Card} title=${"HRV Trend · " + range} sub="7-day rolling avg · shaded band = your trailing 60-day mean ± 0.7σ (personal baseline)"
          source="Source: intervals.icu wellness (Garmin Connect partnership). Garmin reports nightly RMSSD HRV; we deliberately don't mix Apple Health HRV (which is SDNN) to avoid corrupting the trend."
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

        <${Card} title=${"Resting Heart Rate · " + range} sub="7-day rolling avg · lower trend = more recovered / fitter"
          source="Source: intervals.icu wellness (Garmin Connect partnership) — Garmin's daily lowest 30-min HR.">
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

        <${Card} title=${"Weight · " + range} sub="7-day rolling avg smooths daily noise; weigh-ins fill from /weight Telegram command."
          source="Source: daily_metrics.weight_kg, manually logged via the Telegram /weight command (5-sec entry after weighing in)."
          right=${html`<button onClick=${() => setShowRawWeight((s) => !s)}
            style=${{ background: showRawWeight ? C.muted : "transparent", color: showRawWeight ? "#0a0d12" : C.muted, border: "1px solid " + (showRawWeight ? C.muted : C.border), borderRadius: 999 }}
            className="px-3 py-1 text-xs font-semibold">Daily values</button>`}>
          <${ResponsiveContainer} width="100%" height=${220}>
            <${LineChart} data=${weightSeries} margin=${topMargin}>
              <${CartesianGrid} stroke=${C.grid} vertical=${false} />
              <${XAxis} dataKey="label" tick=${axis} tickLine=${false} axisLine=${{ stroke: C.border }} minTickGap=${40} />
              <${YAxis} tick=${axis} tickLine=${false} axisLine=${false} width=${38} domain=${weightDomain} />
              <${Tooltip} content=${h(TT, { fmt: (v) => v.toFixed(1) + " kg" })} />
              ${yearLines(view)}
              ${raceLines(view, races)}
              ${showRawWeight ? html`<${Line} type="monotone" dataKey="raw" name="Daily" stroke="#9aa6b6" strokeWidth=${1} strokeDasharray="2 3" strokeOpacity=${0.7} dot=${{ r: 2.5, fill: "#9aa6b6" }} isAnimationActive=${false} connectNulls=${false} />` : null}
              <${Line} type="monotone" dataKey="weight" name="7-day avg" stroke=${C.amber} strokeWidth=${2} dot=${false} connectNulls=${true} />
            <//>
          <//>
        <//>

      </div>

      <${Card} title="Key Races" sub="Amber markers appear on every chart. Stored in this browser only."
        source="Source: local browser storage (localStorage key healthpulse_races_v1). Add/remove here; per-device only.">
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
    </div>`}
  </div>`;
}

createRoot(document.getElementById("root")).render(h(App));
