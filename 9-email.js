// 9-email.js — the summary email, in the house compliance-report style: navy hero, soft
// rounded numbers, compliance against the 85% target, then one numbered section per area.
// Tables only and inline styles, so it survives Gmail. Every row is in the attached workbook.
const { SETTINGS } = require("./config");
const { fmtDay } = require("./1-clock");

const NUM = "'Century Gothic','Trebuchet MS','Gill Sans',sans-serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const C = { navy: "#0f2d8a", deep: "#0a1650", accent: "#1848C8", secNum: "#C7D2E8", track: "#EEF1F5", ink: "#111827", body: "#374151",
  soft: "#6B7280", line: "#E5E7EB", panel: "#F9FAFB", good: "#059669", warn: "#D97706", bad: "#DC2626" };
const MAX_BYTES = 95000;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (p) => (p == null ? C.soft : p >= 80 ? C.good : p >= 60 ? C.warn : C.bad);
const pctTxt = (p) => (p == null ? "–" : `${Math.round(p)}%`);
const n = (v) => (v == null ? "–" : Number(v).toLocaleString("en-US"));
const count = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many}`;
// "Muhammad Shahzad Fiaz" -> "Shahzad"; the full name when two people would share a short one
const shortOf = (name) => { const w = String(name || "").split(/\s+/).filter(Boolean); return /^(muhammad|mohammad|mohammed|muhammed|mohd|syed|m\.?)$/i.test(w[0] || "") && w[1] ? w[1] : (w[0] || ""); };
let first = shortOf;
function useShortNames(people) {
  const counts = {};
  for (const s of people) counts[shortOf(s.name)] = (counts[shortOf(s.name)] || 0) + 1;
  first = (name) => (counts[shortOf(name)] > 1 ? name : shortOf(name));
}
// house rule: no em dashes in what people read
const tidy = (s) => String(s).replace(/\s*—\s*/g, ", ").replace(/–(?=\s)/g, "-");

function hero(rep) {
  const t = rep.scores.team;
  const below = t.overallPct != null && t.overallPct < SETTINGS.TARGET_PCT;
  return `<tr><td style="background:${C.navy};background-image:linear-gradient(135deg,#1e40af 0%,#0f2d8a 52%,#0a1f6e 100%);padding:30px 32px 26px">
<div style="font:700 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.72)">HOF Migration · CRM Compliance</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
<td valign="bottom" style="font:800 40px/1.02 ${SANS};letter-spacing:-0.5px;text-transform:uppercase;color:#ffffff">Consultant<br><span style="color:rgba(160,200,255,0.9)">Performance</span></td>
<td valign="bottom" align="right" style="white-space:nowrap"><div style="font:400 50px/1 ${NUM};color:${below ? "#fca5a5" : "#86efac"}">${pctTxt(t.overallPct)}</div>
<div style="font:600 11px/1.6 ${SANS};color:rgba(255,255,255,0.78);margin-top:6px">${below ? "▼ below" : "▲ at or above"} ${SETTINGS.TARGET_PCT}% target</div></td></tr></table>
<div style="border-top:1px solid rgba(255,255,255,0.22);margin:20px 0 14px"></div>
<span style="display:inline-block;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,0.14);font:600 11.5px/1.5 ${SANS};color:#ffffff">${esc(rep.period.label)}</span>
<span style="font:500 12px/1.5 ${SANS};color:rgba(255,255,255,0.78);margin-left:8px">Performance Review · ${rep.consultants.length} consultant${rep.consultants.length > 1 ? "s" : ""}</span>
</td></tr>`;
}

function strip(rep) {
  const t = rep.scores.team.kp;
  const cell = (label, value, color, last) => `<td width="25%" align="center" style="padding:16px 6px;${last ? "" : `border-right:1px solid ${C.line};`}">
<div style="font:700 9.5px/1.3 ${SANS};letter-spacing:1px;text-transform:uppercase;color:${C.soft}">${label}</div>
<div style="font:400 28px/1.2 ${NUM};color:${color};margin-top:6px">${value}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:10px;margin:0 0 26px"><tr>
${cell("Leads assigned", n(t.assigned), C.navy)}${cell("Worked", pctTxt(t.workedPct), col(t.workedPct))}${cell("Deals created", n(t.deals), C.navy)}${cell("Team compliance", pctTxt(rep.scores.team.overallPct), col(rep.scores.team.overallPct), true)}
</tr></table>`;
}

function bars(rep) {
  const rows = rep.scores.people.slice().sort((a, b) => (b.overallPct ?? -1) - (a.overallPct ?? -1)).map((s) => `
<tr><td style="padding:9px 0 3px;font:600 13px/1.4 ${SANS};color:${C.ink}">${esc(s.name)}<span style="font:400 11.5px ${SANS};color:${C.soft}"> · contacts ${pctTxt(s.contactPct)}, deals ${pctTxt(s.dealPct)}</span></td>
<td align="right" style="padding:9px 0 3px;font:400 17px/1.4 ${NUM};color:${col(s.overallPct)}">${pctTxt(s.overallPct)}</td></tr>
<tr><td colspan="2" style="padding:0 0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.track};border-radius:4px"><tr>
<td width="${Math.max(1, Math.round(s.overallPct || 0))}%" style="background:${col(s.overallPct)};height:8px;border-radius:4px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`).join("");
  return `<div style="font:800 12px/1.4 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.ink};margin:0 0 4px">Compliance vs target</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:8px 0 30px"><span style="display:inline-block;width:18px;border-top:2px solid ${C.accent};vertical-align:middle;margin-right:6px"></span>${SETTINGS.TARGET_PCT}% target threshold. Checks passed ÷ checks that applied, contacts and deals together.</div>`;
}

function sectionHead(no, label, sub, score) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:34px 0 0"><tr>
<td width="58" valign="middle" style="font:400 40px/1 ${NUM};color:${C.secNum}">${no}</td>
<td valign="middle"><div style="font:800 13px/1.3 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.ink}">${esc(label)}</div>
<div style="font:400 12px/1.5 ${SANS};color:${C.soft};margin-top:2px">${esc(sub)}</div></td>
${score != null ? `<td align="right" valign="middle" style="font:400 30px/1 ${NUM};color:${col(score)}">${pctTxt(score)}</td>` : ""}</tr></table>
<div style="border-top:1px solid ${C.line};margin:12px 0 14px"></div>`;
}

// a small comparison table, one row per consultant plus the team
function table(rep, heads, cells) {
  const all = rep.scores.people.length > 1 ? [...rep.scores.people, rep.scores.team] : rep.scores.people;
  const th = heads.map((h, i) => `<td ${i ? 'align="right"' : ""} style="padding:7px 6px;font:700 9.5px/1.3 ${SANS};letter-spacing:.6px;text-transform:uppercase;color:${C.soft};border-bottom:1px solid ${C.line}">${h}</td>`).join("");
  const tr = all.map((s) => {
    const team = s === rep.scores.team;
    const words = ["", "", "both", "all three", "all four", "all five", "all six"];
    const who = team ? (words[rep.scores.people.length] || `all ${rep.scores.people.length}`).replace(/^./, (c) => c.toUpperCase()) : first(s.name);
    return `<tr${team ? ` style="background:${C.panel}"` : ""}><td style="padding:8px 6px;font:${team ? 700 : 600} 12.5px/1.35 ${SANS};color:${C.ink};border-bottom:1px solid ${C.line}">${esc(who)}</td>${cells(s).map(([v, color]) => `<td align="right" style="padding:8px 6px;font:400 14px/1.35 ${NUM};color:${color || C.ink};border-bottom:1px solid ${C.line}">${v}</td>`).join("")}</tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${`<tr>${th}</tr>`}${tr}</table>`;
}

function performers(list, getPct, what) {
  const ranked = list.filter((s) => getPct(s) != null).sort((a, b) => getPct(b) - getPct(a));
  if (ranked.length < 2) return "";
  const top = ranked[0], low = ranked[ranked.length - 1];
  const block = (s, role, accent, arrow) => `<td width="50%" valign="top" style="padding:0 ${role === "top" ? "6px 0 0" : "0 0 6px"}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${role === "top" ? "#F0FDF4" : accent === C.warn ? "#FFFBEB" : "#FEF2F2"}"><tr>
<td width="3" style="background:${accent};font-size:0">&nbsp;</td><td style="padding:11px 13px">
<div style="font:700 9.5px/1.3 ${SANS};letter-spacing:1px;text-transform:uppercase;color:${C.soft}">${arrow} ${role === "top" ? "Highest" : "Lowest"} ${what}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:5px"><tr><td style="font:700 14px/1.3 ${SANS};color:${C.ink}">${esc(s.name)}</td>
<td align="right" style="font:400 20px/1 ${NUM};color:${col(getPct(s))}">${pctTxt(getPct(s))}</td></tr></table></td></tr></table></td>`;
  const lowAccent = getPct(low) >= 60 && getPct(low) < 80 ? C.warn : C.bad;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>${block(top, "top", C.good, "▲")}${block(low, "low", lowAccent, "▼")}</tr></table>`;
}

function numbered(items) {
  return items.map((it, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr>
<td width="42" valign="top"><div style="width:28px;height:28px;border:2px solid ${C.accent};border-radius:50%;text-align:center;font:400 13px/28px ${NUM};color:${C.accent}">${i + 1}</div></td>
<td valign="top"><div style="font:700 13px/1.4 ${SANS};color:${C.ink}">${esc(it.title)}${it.pill ? ` <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#FEE2E2;color:#991B1B;font:600 10.5px/1.6 ${SANS}">${esc(it.pill)}</span>` : ""}</div>
<div style="font:400 12.5px/1.5 ${SANS};color:${C.soft};margin-top:1px">${esc(tidy(it.text))}</div></td></tr></table>`).join("");
}

function navyStrip(name, right) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.navy};border-radius:6px;margin:16px 0 12px"><tr>
<td style="padding:9px 14px;font:700 12.5px/1.4 ${SANS};color:#ffffff">${esc(name)}</td>
<td align="right" style="padding:9px 14px;font:500 12px/1.4 ${SANS};color:rgba(255,255,255,0.8)">${right}</td></tr></table>`;
}

// the worst few checks for a person, as numbered items
function topIssues(s, kind, max, recordsWord) {
  return s.issues.filter((x) => x.kind === kind).slice(0, max).map((x) => ({
    title: x.short, pill: count(x.fail, recordsWord.replace(/s$/, ""), recordsWord), text: `${x.label}. Failed on ${n(x.fail)} of ${n(x.applicable)} (${pctTxt(x.rate)}).`,
  }));
}

const HEADLINE = {
  worked: (f, a) => `${n(f)} assigned leads (${pctTxt((100 * f) / a)}) were never called, emailed or messaged.`,
  first24: (f, a) => `${n(f)} leads (${pctTxt((100 * f) / a)}) did not get a first contact within 24 working hours.`,
  whatsapp: (f) => `${n(f)} leads had days of unanswered calls with no WhatsApp follow-up within 24 working hours.`,
  noAnswerWhatsapp: (f) => `${n(f)} deals had days of unanswered calls with no WhatsApp follow-up within 24 working hours.`,
  noAnswerEmail: (f) => `${n(f)} deals had days of unanswered calls with no follow-up email within 24 working hours.`,
  task: (f) => `${n(f)} live leads or deals had no open follow-up task.`,
  closeDate: (f) => `${n(f)} open deals have a close date in the past.`,
  qualifiedMarked: (f) => `${n(f)} clients got a deal but their lead stage was never marked qualified.`,
};
function headline(rep) {
  const t = rep.scores.team;
  const top = t.issues[0];
  if (!top) return { text: "No issues were found in any record checked.", good: true };
  const f = HEADLINE[top.key];
  const text = f ? f(top.fail, top.applicable) : `${n(top.fail)} ${top.kind === "contact" ? "leads" : "deals"} failed "${top.short}" (${pctTxt(top.rate)} of those checked).`;
  return { text: `${text} This was the most frequent issue in the review.`, good: false };
}

function positives(rep) {
  const t = rep.scores.team;
  const out = [];
  const all = [...require("./4-contacts").CONTACT_CHECKS.map((c) => ({ ...c, t: t.ct[c.key], kind: "leads" })), ...require("./5-deals").DEAL_CHECKS.map((c) => ({ ...c, t: t.dt[c.key], kind: "deals" }))];
  for (const c of all) {
    const nApp = c.t.pass + c.t.fail;
    if (nApp >= 20 && c.t.pass / nApp >= 0.95) out.push({ c, p: (100 * c.t.pass) / nApp, nApp });
  }
  return out.sort((a, b) => b.nApp - a.nApp).slice(0, 4).map((x) => `${x.c.short}: ${pctTxt(x.p)} of ${n(x.nApp)} ${x.c.kind} passed.`);
}

function buildEmail(rep, opts = {}) {
  const { people, team } = rep.scores;
  useShortNames(people);
  const hl = headline(rep);
  const names = rep.consultants.map((c) => c.name);
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const intro = `This review covers every contact assigned to ${esc(nameList)} from ${esc(rep.period.long)} (${n(team.kp.assigned)} leads), and every deal they created in that time (${n(team.kp.deals)}). Each record was checked against the contact and deal compliance rules, together with how quickly leads were worked, whether lead stages were moved correctly, and whether qualified clients were marked qualified. Full coverage, not a sample: every record is in the attached workbook.`;
  const pos = positives(rep);
  const perPerson = (kind) => people.map((s) => {
    const pct = kind === "contact" ? s.contactPct : s.dealPct;
    const howMany = kind === "contact" ? count(s.kp.assigned, "lead", "leads") : count(s.kp.deals, "deal", "deals");
    const items = topIssues(s, kind, opts.issuesPer || 3, kind === "contact" ? "leads" : "deals");
    return navyStrip(s.name, `${howMany} · avg <span style="font:400 14px ${NUM};color:#fca5a5">${pctTxt(pct)}</span>`) + (items.length ? numbered(items) : `<div style="font:400 12.5px/1.5 ${SANS};color:${C.good};margin:0 0 8px">No issues.</div>`);
  }).join("");

  const s01 = sectionHead("01", "Lead handling", "Were assigned leads worked, and how fast", team.kp.workedPct) +
    table(rep, ["", "Assigned", "Worked", "1st in 24h", "Median hrs", "Attempts", "Reached"], (s) => [
      [n(s.kp.assigned)], [pctTxt(s.kp.workedPct), col(s.kp.workedPct)], [pctTxt(s.kp.first24Pct), col(s.kp.first24Pct)],
      [s.kp.medianFirstHrs == null ? "–" : Math.round(s.kp.medianFirstHrs)], [s.kp.attemptsPerLead ?? "–"], [pctTxt(s.kp.reachedPct)]]) +
    `<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:8px 0 0">Median hrs = working hours from assignment to first contact. Attempts = call attempts per lead called. Reached = leads spoken to on the phone, of those called.</div>`;

  const qualItems = [];
  const tq = team.kp;
  if (tq.qualNotMarked) qualItems.push({ title: "Client got a deal, lead not marked qualified", pill: count(tq.qualNotMarked, "lead", "leads"), text: `A deal was created after the lead was assigned (or the consultant owns an open deal) but the lead stage still says otherwise. ${people.map((s) => `${first(s.name)} ${s.kp.qualNotMarked}`).join(", ")}.` });
  if (tq.qualNoDeal) qualItems.push({ title: "Marked qualified, no deal created", pill: count(tq.qualNoDeal, "lead", "leads"), text: `Qualified for ${SETTINGS.DEAL_CREATED_GRACE_DAYS}+ working days with no deal. ${people.map((s) => `${first(s.name)} ${s.kp.qualNoDeal}`).join(", ")}.` });
  if (tq.closedNoContact) qualItems.push({ title: "Closed or qualified without any contact", pill: count(tq.closedNoContact, "lead", "leads"), text: `Lead stage set (Ineligible, They Didn't Fill, qualified…) with no call, email or WhatsApp logged. ${people.map((s) => `${first(s.name)} ${s.kp.closedNoContact}`).join(", ")}.` });
  if (tq.saleNotMarked) qualItems.push({ title: "Deal won, lead not marked Sale", pill: count(tq.saleNotMarked, "lead", "leads"), text: people.map((s) => `${first(s.name)} ${s.kp.saleNotMarked}`).join(", ") + "." });
  if (rep.ai.ran && rep.ai.flagged.length) qualItems.push({ title: "Call notes suggest qualified (for review)", pill: count(rep.ai.flagged.length, "lead", "leads"), text: `The consultant's own notes read as qualified, but the stage says otherwise. Listed in the Qualification tab; not counted in any score.` });
  const s02 = sectionHead("02", "Lead stages and qualification", "Were stages moved correctly, and were qualified clients marked qualified", null) +
    table(rep, ["", "Qualified", "Got a deal", "Not marked", "No deal", "No contact"], (s) => [
      [n(s.kp.qualified)], [n(s.kp.leadsWithDeal)], [n(s.kp.qualNotMarked), s.kp.qualNotMarked ? C.bad : C.ink], [n(s.kp.qualNoDeal), s.kp.qualNoDeal ? C.bad : C.ink], [n(s.kp.closedNoContact), s.kp.closedNoContact ? C.bad : C.ink]]) +
    `<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:8px 0 14px">Qualified = lead stage is a qualified stage or Sale now. Got a deal = a deal was created after assignment. Not marked = got a deal but the stage is not qualified. No deal = marked qualified with no deal. No contact = closed or qualified with nothing logged.</div>` +
    (qualItems.length ? numbered(qualItems) : "");

  const s03 = sectionHead("03", "Contact compliance", "The contact compliance rules, every lead", team.contactPct) + performers(people, (s) => s.contactPct, "contacts") + perPerson("contact");
  const s04 = sectionHead("04", "Deal compliance", `The deal compliance rules, every deal created. ${n(tq.dealsWon)} won, ${n(tq.dealsLost)} lost, ${n(tq.dealsPostponed)} postponed, ${n(tq.dealsOpen)} open`, team.dealPct) + performers(people, (s) => s.dealPct, "deals") + perPerson("deal");

  const warn = (rep.warnings || []).length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:#FFFBEB;border-left:4px solid ${C.warn};padding:11px 14px;font:400 12.5px/1.55 ${SANS};color:#92400E">${rep.warnings.map(esc).join("<br>")}</td></tr></table>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consultant performance review</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;"><tr><td align="center" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:28px 12px 48px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.line}">
${hero(rep)}
<tr><td style="padding:28px 32px 10px">
${warn}
<p style="margin:0 0 18px;font:400 14px/1.65 ${SANS};color:${C.body}">${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:${hl.good ? "#F0FDF4" : "#FEF2F2"};border:1px solid ${hl.good ? "#D1FAE5" : "#FECACA"};border-left:4px solid ${hl.good ? C.good : C.bad};border-radius:8px;padding:13px 16px">
<div style="font:700 10px/1.4 ${SANS};letter-spacing:1px;text-transform:uppercase;color:${hl.good ? "#065F46" : "#991B1B"}">Top finding</div>
<div style="font:600 14px/1.55 ${SANS};color:${C.ink};margin-top:3px">${esc(tidy(hl.text))}</div></td></tr></table>
${strip(rep)}
${bars(rep)}
${s01}${s02}${s03}${s04}
${pos.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 8px"><tr><td style="background:#F0FDF4;border:1px solid #D1FAE5;border-radius:10px;padding:15px 18px">
<div style="font:800 12px/1.4 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:#065F46;margin-bottom:6px">Done well</div>
${pos.map((p) => `<div style="font:400 13px/1.6 ${SANS};color:#065F46">✓ ${esc(p)}</div>`).join("")}</td></tr></table>` : ""}
<p style="margin:22px 0 26px;font:400 12.5px/1.6 ${SANS};color:${C.soft}">The attached workbook has the side-by-side summary, a scorecard of every check, every lead and deal with a pass or fail for each rule, every issue on its own row, the leads never worked, the qualification findings, and a tab for each consultant that can be shared with them.</p>
</td></tr>
<tr><td style="background:${C.deep};padding:20px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font:400 12px/1.6 ${SANS};color:rgba(255,255,255,0.85)"><b style="color:#ffffff">Ali Raza</b><br>Compliance Lead, HOF Migration</td>
<td align="right" style="font:400 12px/1.6 ${SANS};color:rgba(255,255,255,0.7)">HOF Migration<br>Consultant Performance Review<br><span style="font-family:${NUM};color:#ffffff">${esc(rep.period.label)}</span></td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
  return html;
}

function fitEmail(rep) {
  let html = buildEmail(rep);
  if (Buffer.byteLength(html, "utf8") > MAX_BYTES) html = buildEmail(rep, { issuesPer: 2 });
  if (Buffer.byteLength(html, "utf8") > MAX_BYTES) html = buildEmail(rep, { issuesPer: 1 });
  return html;
}

async function sendEmail(subject, html, attachments) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret, so the email was not sent."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html, attachments };
  if (SETTINGS.CC.length) body.cc = SETTINGS.CC;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`Email failed: ${res.status} ${(await res.text()).slice(0, 250)}`);
    if (res.status === 403) console.log("  The built-in sender (onboarding@resend.dev) only reaches the address the Resend account belongs to; CC needs a verified domain.");
    return false;
  }
  return true;
}

module.exports = { buildEmail, fitEmail, sendEmail, MAX_BYTES, tidy, shortOf };
