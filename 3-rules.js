// 3-rules.js — the building blocks the contact and deal checks share. No network in here,
// so each one is tested on invented records in selftest.js.
const { SETTINGS } = require("./config");
const { dayStart, DAY, HOUR, fmtShort, ms } = require("./1-clock");

// ---- lead stages ----
const QUALIFIED = new Set(SETTINGS.QUALIFIED_STAGES);
const NOT_REACHED = new Set(SETTINGS.NOT_REACHED_STAGES);
const CLOSED = new Set(SETTINGS.CLOSED_STAGES);
const NO_CONTACT_NEEDED = new Set(SETTINGS.NO_CONTACT_NEEDED_STAGES);
function stageGroup(stage) {
  if (!stage) return "blank";
  if (stage === SETTINGS.SALE_STAGE) return "sale";
  if (QUALIFIED.has(stage)) return "qualified";
  if (NOT_REACHED.has(stage)) return "notReached";
  if (stage === SETTINGS.CALL_BACK_STAGE) return "callBack";
  if (CLOSED.has(stage)) return "closed";
  return "other";
}

// ---- deals ----
// Stage names differ from pipeline to pipeline ("Postpone (No Specific Date)", "Deal
// Postpone", "Postponed"), so a deal's position is read from the stage name, not its id.
function dealCategory(pipelineId, stageLabel) {
  if (SETTINGS.SERVICE_PIPELINES[pipelineId]) return "SERVICE";            // won and handed over
  if (!SETTINGS.SALES_PIPELINES[pipelineId]) return "OTHER";               // not checked
  const s = String(stageLabel || "").toLowerCase();
  if (/payment made|deal won|sales? closed|sale\/closed|contract signed|college application|offer letter|admission letter|visa (submission|granted|refused)|resubm/.test(s)) return "WON";
  if (/\blost\b|rejected/.test(s)) return "LOST";
  if (/postpone/.test(s)) return "POSTPONED";
  if (/rollover/.test(s)) return "ROLLOVER";
  return "OPEN";
}
const CATEGORY_NAME = { OPEN: "Open", ROLLOVER: "Rollover", POSTPONED: "Postponed", LOST: "Lost", WON: "Won", SERVICE: "Won (with case manager)", OTHER: "Other pipeline" };
const isLiveDeal = (cat) => cat === "OPEN" || cat === "ROLLOVER" || cat === "POSTPONED";
const isWonCat = (cat) => cat === "WON" || cat === "SERVICE";

// ---- calls ----
// The dialler logs its own copy of a call a minute or so from the consultant's own log,
// so calls by the same person this close together are one attempt. The attempt reached the
// client if any copy says so, and it has a description if any copy has one.
function attempts(calls) {
  const gap = SETTINGS.SAME_ATTEMPT_MINUTES * 60e3;
  const out = [];
  for (const c of calls.slice().sort((a, b) => a.at - b.at)) {
    const last = out[out.length - 1];
    if (last && last.ownerId === c.ownerId && c.at - last.lastAt <= gap) {
      last.calls.push(c); last.lastAt = c.at;
      if (c.reached && !last.reached) { last.reached = true; last.outcome = c.outcome; }
      if (!last.outcome && c.outcome) last.outcome = c.outcome;
      if (!last.description && c.description) last.description = c.description;
    } else {
      out.push({ at: c.at, lastAt: c.at, ownerId: c.ownerId, calls: [c], reached: c.reached, outcome: c.outcome, description: c.description });
    }
  }
  return out;
}

// Days on which every attempt went unanswered. Each needs a follow-up message.
function unansweredDays(atts) {
  const byDay = new Map();
  for (const a of atts) {
    const d = dayStart(a.at);
    const x = byDay.get(d) || { day: d, first: a.at, reached: false, outcomes: [] };
    x.first = Math.min(x.first, a.at); x.reached = x.reached || a.reached;
    if (a.outcome) x.outcomes.push(a.outcome);
    byDay.set(d, x);
  }
  return [...byDay.values()].filter((x) => !x.reached && x.outcomes.length).sort((a, b) => a.day - b.day);
}

// A message counts for a day if it was sent that day (even minutes before the call was
// logged) and no later than 24 working hours after the first unanswered call.
function followUp(days, messages, clock, now) {
  const res = { applicable: 0, ok: 0, late: [], missing: [], pending: 0 };
  const sorted = messages.slice().sort((a, b) => a.at - b.at);
  for (const d of days) {
    const due = clock.deadline(d.first, SETTINGS.FOLLOW_UP_HOURS);
    const inTime = sorted.find((m) => m.at >= d.day && m.at <= due);
    if (inTime) { res.applicable++; res.ok++; continue; }
    // later than the limit is not a late follow-up for this day, it is a missing one
    const cap = clock.deadline(d.first, SETTINGS.LATE_LIMIT_HOURS);
    const later = sorted.find((m) => m.at > due && m.at <= cap);
    if (now < due && !later) { res.pending++; continue; }
    res.applicable++;
    if (later) res.late.push({ day: d.day, hrs: Math.round(clock.workingBetween(d.first, later.at) / HOUR) });
    else res.missing.push({ day: d.day });
  }
  return res;
}
function followUpText(r, what) {
  const parts = [];
  if (r.missing.length) parts.push(`no ${what} after unanswered calls on ${r.missing.length} of ${r.applicable} day${r.applicable > 1 ? "s" : ""} (${r.missing.slice(0, 4).map((m) => fmtShort(m.day)).join(", ")}${r.missing.length > 4 ? "…" : ""})`);
  if (r.late.length) parts.push(`${what} late on ${r.late.length} day${r.late.length > 1 ? "s" : ""} (${r.late.slice(0, 3).map((l) => `${fmtShort(l.day)}: ${l.hrs} working hrs`).join(", ")})`);
  return parts.join("; ").replace(/^./, (c) => c.toUpperCase());
}

// ---- tasks ----
// A completed task is not a scheduled follow-up. Our own "[Compliance]" tasks never count.
function followUpTask(tasks, now) {
  const theirs = tasks.filter((t) => !t.compliance);
  const open = theirs.filter((t) => !t.done);
  if (!open.length) {
    const lastDone = Math.max(0, ...theirs.map((t) => t.completedAt || t.dueAt || 0));
    return { ok: false, detail: theirs.length ? `No open follow-up task (the last one${lastDone ? ` was due or done ${fmtShort(lastDone)}` : " is completed"})` : "No follow-up task was ever set" };
  }
  const today = dayStart(now), grace = SETTINGS.TASK_OVERDUE_GRACE_DAYS * DAY;
  const due = open.map((t) => t.dueAt).filter(Boolean);
  if (due.length && due.every((d) => d < today - grace)) {
    const days = Math.round((today - Math.max(...due)) / DAY);
    return { ok: false, detail: `Follow-up task overdue by ${days} days` };
  }
  return { ok: true, detail: "" };
}

// ---- notes: client details and proof of payment (the deal compliance rules) ----
const DETAIL_SIGNALS = [
  /\b(bachelor|bachelors|master|masters|mba|bsc|msc|phd|diploma|graduate|b\.?\s?tech)\b/i,
  /\b\d+\s*\+?\s*(years?|yrs?)\b/i,
  /\bexp(erience)?\b/i,
  /\b(married|single|divorced|spouse|wife|husband)\b/i,
  /\b\d+\s*kids?\b/i,
  /\breason\b/i,
  /\b(ielts|pte|score)\b/i,
  /\b(uae|dubai|qatar|kuwait|oman|bahrain|saudi|ksa)\b/i,
  /\bage\s*:?\s*\d{2}\b/i,
];
const PAYMENT_SIGNALS = [/\bvat\b/i, /\bfee?s\b/i, /\bdeposit\b/i, /\bdue date\b/i, /\binstal?ment\b/i, /\bpayment\b/i, /\breceipt\b/i, /\bpaid\b/i, /\binvoice\b/i];
const hasFigures = (t) => /\d{3,}|\d+[,.]\d{3}/.test(t || "");
function looksLikeClientDetails(body) {
  const t = String(body || "");
  if (t.replace(/\s+/g, "").length < 25) return false;
  const hits = DETAIL_SIGNALS.filter((r) => r.test(t)).length;
  return hits >= 2 || (hits >= 1 && /\d/.test(t) && t.length > 60);
}
function looksLikePaymentProof(body) {
  const t = String(body || "");
  const hits = PAYMENT_SIGNALS.filter((r) => r.test(t)).length;
  return (hits >= 2 && hasFigures(t)) || (hits >= 1 && hasFigures(t) && /vat|deposit|instal/i.test(t));
}

// ---- emails ----
const PLACEHOLDER = /\{\{|\}\}|\[\s*(first ?name|client ?name|name|contact ?name)\s*\]|%[a-z_]+%/i;
const nameTokens = (name) => String(name || "").split(/\s+/).map((t) => t.toLowerCase().replace(/[^a-z]/g, "")).filter((t) => t.length >= 3);
// The greeting must name someone: "Hi," "Dear Sir" or "Dear Valued Applicants" do not.
// Another person's name is accepted (emails often go to the spouse who is the main
// applicant), so this catches unpersonalised emails, not every name mismatch.
const GENERIC = /^(sir|sirs|madam|maam|mam|ma|there|all|team|everyone|valued|applicant|applicants|client|clients|customer|customers|friend|friends|candidate|candidates|please|thanks|thank|hope|greetings|good|dear|hi|hello|concern|whom|you|your|i|we|this|my)$/i;
const TITLES = /^(mr|mrs|ms|miss|dr|engr|eng|sheikh|brother|sister)\.?$/i;
function emailProblems(email, clientName) {
  const out = [];
  if (PLACEHOLDER.test(email.subject || "")) out.push("placeholder left in the subject");
  if (PLACEHOLDER.test(String(email.text || "").slice(0, 800))) out.push("placeholder left in the email");
  const raw = String(email.text || "").slice(0, 90);
  const head = raw.toLowerCase();
  const g = /\b(hi|hello|dear|good\s+(?:morning|afternoon|evening))\b[\s,!.:;-]*([^\n]*)/i.exec(raw);
  const tokens = nameTokens(clientName);
  if (g && !(tokens.length && tokens.some((t) => head.includes(t)))) {
    const words = g[2].split(/[\s,!.:;]+/).filter(Boolean);
    while (words.length && TITLES.test(words[0])) words.shift();
    const w = words[0] || "";
    if (!w || GENERIC.test(w) || !/^[A-Z][a-zA-Z'-]+$/.test(w)) out.push("greeting without the client's name");
  }
  return out;
}

// ---- small helpers ----
const uniq = (a) => [...new Set(a)];
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const monthKey = (t) => { const d = new Date(t + SETTINGS.TZ_OFFSET_HOURS * HOUR); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const pass = (d = "") => ({ r: "pass", d });
const fail = (d) => ({ r: "fail", d });
const na = (d = "") => ({ r: "na", d });

// The facts about a deal both reviews need, worked out once.
function describeDeal(world, id) {
  const p = world.deals.get(String(id)) || {};
  const pipelineId = String(p.pipeline || "");
  const stageId = String(p.dealstage || "");
  const stageLabel = (world.pipes.stages[stageId] && world.pipes.stages[stageId].label) || stageId;
  const cat = dealCategory(pipelineId, stageLabel);
  const createdAt = ms(p.createdate);
  const creatorUserId = String(p.hs_created_by_user_id || "");
  const creatorOwnerId = world.userToOwner[creatorUserId] || (world.ownerName[creatorUserId] ? creatorUserId : "");
  const hist = world.dealHistory && world.dealHistory.get(String(id));
  const stageHist = hist ? hist.dealstage.map((h) => {
    const st = world.pipes.stages[h.value];
    return { ...h, label: (st && st.label) || h.value, cat: st ? dealCategory(st.pipelineId, st.label) : "OPEN" };
  }) : null;
  const pipeHist = hist ? hist.pipeline : null;
  const wasWon = isWonCat(cat) || !!(stageHist && stageHist.some((h) => isWonCat(h.cat))) || !!(pipeHist && pipeHist.some((h) => SETTINGS.SERVICE_PIPELINES[h.value]));
  const wonAt = (() => {
    const s = stageHist && stageHist.find((h) => isWonCat(h.cat));
    const q = pipeHist && pipeHist.find((h) => SETTINGS.SERVICE_PIPELINES[h.value]);
    return Math.min(s ? s.at : Infinity, q ? q.at : Infinity);
  })();
  return {
    id: String(id), name: String(p.dealname || `Deal ${id}`).trim(), pipelineId,
    pipelineName: world.pipes.names[pipelineId] || SETTINGS.SALES_PIPELINES[pipelineId] || SETTINGS.SERVICE_PIPELINES[pipelineId] || pipelineId,
    stageId, stageLabel, cat, createdAt, closedate: ms(p.closedate), ownerId: String(p.hubspot_owner_id || ""),
    creatorUserId, creatorOwnerId, reasons: String(p.outcome || "").split(";").map((s) => s.trim()).filter(Boolean),
    ageRange: p.age_range || "", amount: Number(p.amount || 0) || 0, wasWon, wonAt: Number.isFinite(wonAt) ? wonAt : null, stageHist, pipeHist,
  };
}

module.exports = {
  stageGroup, dealCategory, CATEGORY_NAME, isLiveDeal, isWonCat, attempts, unansweredDays, followUp, followUpText, followUpTask,
  looksLikeClientDetails, looksLikePaymentProof, emailProblems, nameTokens, uniq, median, monthKey, pass, fail, na, describeDeal,
  QUALIFIED, NOT_REACHED, CLOSED, NO_CONTACT_NEEDED,
};
