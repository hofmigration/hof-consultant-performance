// 1-clock.js — time. The 24-working-hour clock (weekends and UAE holidays paused), the
// review period, and how dates are written. No network in here, so every rule is tested
// on invented dates.
const { SETTINGS } = require("./config");

const HOUR = 3600e3, DAY = 24 * HOUR;
const OFF = SETTINGS.TZ_OFFSET_HOURS * HOUR;
const dayStart = (t) => Math.floor((t + OFF) / DAY) * DAY - OFF;   // midnight, Pakistan time
const dateKey = (t) => new Date(t + OFF).toISOString().slice(0, 10);
const weekday = (t) => new Date(t + OFF).getUTCDay();
const pad = (n) => String(n).padStart(2, "0");

function makeClock({ holidays = SETTINGS.HOLIDAYS, flat = SETTINGS.FLAT_24_HOURS } = {}) {
  const off = new Set(holidays || []);
  const isWorkingDay = (t) => flat || (!SETTINGS.WEEKEND_DAYS.includes(weekday(t)) && !off.has(dateKey(t)));
  const nextWorkingDayFrom = (d) => { let x = d; for (let i = 0; i < 60 && !isWorkingDay(x); i++) x += DAY; return x; };

  // `hours` of working time after t. Friday 3pm + 24 -> Monday 3pm.
  function deadline(t, hours = 24) {
    if (flat) return t + hours * HOUR;
    let cursor = isWorkingDay(t) ? t : nextWorkingDayFrom(dayStart(t) + DAY);
    let remaining = hours * HOUR;
    for (let i = 0; i < 400; i++) {
      const end = dayStart(cursor) + DAY;
      if (end - cursor >= remaining) return cursor + remaining;
      remaining -= end - cursor;
      cursor = nextWorkingDayFrom(end);
    }
    return cursor;
  }

  // working time between two moments, in ms
  function workingBetween(a, b) {
    if (!(b > a)) return 0;
    if (flat) return b - a;
    let total = 0;
    for (let d = dayStart(a), i = 0; d < b && i < 2000; d += DAY, i++) {
      if (!isWorkingDay(d)) continue;
      const s = Math.max(a, d), e = Math.min(b, d + DAY);
      if (e > s) total += e - s;
    }
    return total;
  }

  // the start of the working day `n` working days before t's day
  function workingDaysBack(t, n) {
    let d = dayStart(t);
    for (let i = 0; i < n; i++) { d -= DAY; while (!isWorkingDay(d)) d -= DAY; }
    return d;
  }

  return { deadline, workingBetween, isWorkingDay, workingDaysBack };
}

// ---- the review period ----
// "Previous 3 months" run on 2 November = 1 August 00:00 to 1 November 00:00, Pakistan time.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).getUTCDate() !== +m[3]) return null;
  return t - OFF;
}

function resolvePeriod(input, fromDate, toDate, now = Date.now()) {
  const raw = String(input || SETTINGS.DEFAULT_PERIOD).trim().toLowerCase();
  const local = new Date(now + OFF);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  const monthStart = (yy, mm) => Date.UTC(yy, mm, 1) - OFF;

  let start, end, whole = false;
  if (/custom/.test(raw) || (fromDate && toDate && !/previous|last/.test(raw))) {
    start = parseDay(fromDate); const last = parseDay(toDate);
    if (start == null || last == null) throw new Error(`For custom dates, type both dates as YYYY-MM-DD (got "${fromDate || ""}" and "${toDate || ""}").`);
    if (last < start) throw new Error(`The "to" date (${toDate}) is before the "from" date (${fromDate}).`);
    end = last + DAY;
  } else {
    const n = /(\d+)/.test(raw) ? Math.max(1, Math.min(12, +raw.match(/(\d+)/)[1])) : /two/.test(raw) ? 2 : /three/.test(raw) ? 3 : 1;
    start = monthStart(y, m - n); end = monthStart(y, m); whole = true;
  }
  if (end > now) end = Math.max(start + HOUR, now);

  const a = new Date(start + OFF), b = new Date(end - 1 + OFF);
  let label;
  if (whole) {
    label = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
      ? `${MONTHS_LONG[a.getUTCMonth()]} ${a.getUTCFullYear()}`
      : `${MONTHS[a.getUTCMonth()]}${a.getUTCFullYear() !== b.getUTCFullYear() ? ` ${a.getUTCFullYear()}` : ""} to ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  } else {
    label = `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${a.getUTCFullYear() !== b.getUTCFullYear() ? ` ${a.getUTCFullYear()}` : ""} to ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  const long = `${a.getUTCDate()} ${MONTHS_LONG[a.getUTCMonth()]} ${a.getUTCFullYear()} to ${b.getUTCDate()} ${MONTHS_LONG[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  const fileLabel = `${dateKey(start)}_to_${dateKey(end - 1)}`;
  return { start, end, label, long, fileLabel, months: whole ? Math.round((end - start) / (30.4 * DAY)) : null };
}

// ---- wording ----
const fmtWhen = (t) => {
  if (!t) return "";
  const d = new Date(t + OFF);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const fmtDay = (t) => { if (!t) return ""; const d = new Date(t + OFF); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// "12 Oct", or "12 Oct 2025" when the year is not the current one
const fmtShort = (t) => { if (!t) return ""; const d = new Date(t + OFF); const y = new Date(Date.now() + OFF).getUTCFullYear(); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${d.getUTCFullYear() !== y ? ` ${d.getUTCFullYear()}` : ""}`; };
const hrs = (ms) => Math.max(0, Math.round(ms / HOUR));
const hrs1 = (ms) => Math.max(0, Math.round((10 * ms) / HOUR) / 10);   // 24.3
const span = (ms) => {
  const h = hrs(ms);
  if (h < 48) return `${h} hr${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} day${d === 1 ? "" : "s"}${r ? ` ${r} hr${r === 1 ? "" : "s"}` : ""}`;
};
// a JS date whose UTC reading is Pakistan wall time, for Excel cells
const xlDate = (t) => (t ? new Date(t + OFF) : null);
const ms = (v) => { if (v == null || v === "") return 0; if (typeof v === "number") return v; const n = Number(v); return Number.isFinite(n) && /^\d{10,}$/.test(String(v)) ? n : (Date.parse(v) || 0); };

module.exports = { makeClock, resolvePeriod, parseDay, fmtWhen, fmtDay, fmtShort, hrs, hrs1, span, xlDate, ms, dayStart, dateKey, HOUR, DAY, MONTHS };
