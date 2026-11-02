// 8-workbook.js — the attached Excel workbook: the summary side by side, a scorecard of every
// check, every contact and every deal with a column per check, every issue on its own row,
// and a tab per consultant they can be handed.
const ExcelJS = require("exceljs");
const { SETTINGS } = require("./config");
const { xlDate, fmtDay } = require("./1-clock");
const { contactLink, dealLink } = require("./0-hubspot");
const { CONTACT_CHECKS } = require("./4-contacts");
const { DEAL_CHECKS } = require("./5-deals");

const NAVY = "FF0F2D8A", INK = "FF1F2937", SOFT = "FF6B7280", LINE = "FFE5E7EB", PANEL = "FFF3F6FB", WHITE = "FFFFFFFF";
const GOOD = "FFE7F6EE", GOODTX = "FF05603A", WARN = "FFFFF4E5", WARNTX = "FF92400E", BAD = "FFFDECEC", BADTX = "FFB42318", BLUE = "FF1848C8";
const F = "Arial";
const thin = { style: "thin", color: { argb: LINE } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const tone = (p) => (p == null ? [PANEL, SOFT] : p >= 80 ? [GOOD, GOODTX] : p >= 60 ? [WARN, WARNTX] : [BAD, BADTX]);
const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function title(ws, text, sub, width) {
  ws.mergeCells(1, 1, 1, Math.max(2, width));
  const t = ws.getCell(1, 1);
  t.value = text; t.font = { name: F, bold: true, size: 15, color: { argb: WHITE } }; t.fill = fill(NAVY);
  t.alignment = { vertical: "middle", indent: 1 }; ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells(2, 1, 2, Math.max(2, width));
    const s = ws.getCell(2, 1);
    s.value = sub; s.font = { name: F, size: 10, color: { argb: SOFT } }; s.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(2).height = 34;
  }
}
function header(ws, rowNo, labels, heights = 32) {
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l; c.font = { name: F, bold: true, size: 9.5, color: { argb: WHITE } }; c.fill = fill(NAVY);
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = BOX;
  });
  r.height = heights;
}
const link = (url, text) => ({ text: String(text || "open"), hyperlink: url });
const resultCell = (cell, x) => {
  if (!x || x.r === "na") { cell.value = ""; return; }
  cell.value = x.r === "pass" ? "Pass" : "Fail";
  cell.fill = fill(x.r === "pass" ? GOOD : BAD);
  cell.font = { name: F, size: 9.5, bold: x.r === "fail", color: { argb: x.r === "pass" ? GOODTX : BADTX } };
  cell.alignment = { horizontal: "center", vertical: "top" };
};
const issuesText = (r, checks) => checks.filter((c) => r.checks[c.key] && r.checks[c.key].r === "fail").map((c) => `${c.short}: ${r.checks[c.key].d}`).join("\n");

// ---------- Summary ----------
function summarySheet(wb, rep) {
  const { people, team } = rep.scores;
  const cols = [...people, team];
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: 1 }] });
  ws.columns = [{ width: 46 }, ...cols.map(() => ({ width: 17 }))];
  title(ws, `Consultant performance review · ${rep.period.label}`,
    `Every contact assigned to these consultants from ${rep.period.long}, and every deal they created in that time. Checked ${fmtDay(rep.now)}. Target ${SETTINGS.TARGET_PCT}%.`, cols.length + 1);
  header(ws, 4, ["", ...cols.map((c) => c.name)]);
  let row = 5;
  const section = (text) => {
    ws.mergeCells(row, 1, row, cols.length + 1);
    const c = ws.getCell(row, 1);
    c.value = text.toUpperCase(); c.font = { name: F, bold: true, size: 9.5, color: { argb: BLUE } }; c.fill = fill(PANEL);
    c.alignment = { vertical: "middle", indent: 1 }; ws.getRow(row).height = 20; row++;
  };
  const line = (lab, get, kind = "n", hint) => {
    const r = ws.getRow(row);
    r.getCell(1).value = lab; r.getCell(1).font = { name: F, size: 10, color: { argb: INK } }; r.getCell(1).border = BOX;
    r.getCell(1).alignment = { vertical: "middle", indent: 1, wrapText: true };
    if (hint) r.getCell(1).note = hint;
    cols.forEach((s, i) => {
      const v = get(s); const cell = r.getCell(i + 2);
      cell.border = BOX; cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { name: F, size: 10, bold: s === team, color: { argb: INK } };
      if (v == null || v === "") { cell.value = "–"; cell.font = { name: F, size: 10, color: { argb: SOFT } }; return; }
      if (kind === "pct") {
        cell.value = v / 100; cell.numFmt = "0.0%";
        const [bg, tx] = tone(v); cell.fill = fill(bg); cell.font = { name: F, size: 10, bold: true, color: { argb: tx } };
      } else if (kind === "bad") {
        cell.value = v; if (v > 0) cell.font = { name: F, size: 10, bold: true, color: { argb: BADTX } };
      } else cell.value = v;
    });
    row++;
  };
  section("Compliance");
  line("Overall compliance", (s) => s.overallPct, "pct", "Checks passed ÷ checks that applied, contacts and deals together");
  line("Contacts compliance", (s) => s.contactPct, "pct");
  line("Deals compliance", (s) => s.dealPct, "pct");
  line("Contacts with no issue at all", (s) => s.kp.cleanContactsPct, "pct");
  line("Deals with no issue at all", (s) => s.kp.cleanDealsPct, "pct");
  line("Checks run", (s) => s.checksRun);
  line("Issues found", (s) => s.fails, "bad");
  section("Leads assigned and worked");
  line("Contacts assigned in the period", (s) => s.kp.assigned);
  line("Worked (a call, email or WhatsApp logged)", (s) => s.kp.worked);
  line("Never worked", (s) => s.kp.notWorked, "bad");
  line("Worked %", (s) => s.kp.workedPct, "pct");
  line("First contact within 24 working hours", (s) => s.kp.first24Pct, "pct");
  line("Median working hours to first contact", (s) => s.kp.medianFirstHrs);
  line("Call attempts", (s) => s.kp.attempts);
  line("Call attempts per lead called", (s) => s.kp.attemptsPerLead);
  line("Leads reached on the phone (of those called)", (s) => s.kp.reachedPct, "pct");
  line("Emails sent to these leads", (s) => s.kp.emails);
  line("WhatsApps logged on these leads", (s) => s.kp.whatsapps);
  line("Unanswered-call days followed by WhatsApp in 24 working hrs", (s) => s.kp.waDayPct, "pct", "Contacts and deals together");
  line("Unanswered-call days on deals followed by email in 24 working hrs", (s) => s.kp.emDayPct, "pct");
  section("Lead stages now");
  const stages = Object.entries(team.kp.stageMix).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  for (const st of stages) line(st, (s) => s.kp.stageMix[st] || 0);
  section("Stage moves and qualification");
  line("No lead stage marked", (s) => s.kp.blankStage, "bad");
  line("Closed or qualified without any call, email or WhatsApp", (s) => s.kp.closedNoContact, "bad");
  line("Leads marked qualified (or Sale) now", (s) => s.kp.qualified);
  line("Leads that got a deal after assignment", (s) => s.kp.leadsWithDeal);
  line("Client got a deal but is not marked qualified", (s) => s.kp.qualNotMarked, "bad");
  line("Marked qualified but no deal created", (s) => s.kp.qualNoDeal, "bad");
  line("Deal won but lead not marked Sale", (s) => s.kp.saleNotMarked, "bad");
  line("Call notes suggest qualified, not marked (to review, not scored)", (s) => (rep.ai.ran ? s.kp.aiFlagged : null), "bad");
  section("Deals created in the period");
  line("Deals created", (s) => s.kp.deals);
  line("Open (incl. rollover)", (s) => s.kp.dealsOpen);
  line("Postponed", (s) => s.kp.dealsPostponed);
  line("Lost", (s) => s.kp.dealsLost);
  line("Won", (s) => s.kp.dealsWon);
  if (team.kp.dealsOther) line("In another pipeline (not checked)", (s) => s.kp.dealsOther);
  ws.getCell(row + 1, 1).value = "Green 80% and over, amber 60 to 79%, red under 60%. Hover a label with a small red corner for how it is worked out.";
  ws.getCell(row + 1, 1).font = { name: F, size: 9, italic: true, color: { argb: SOFT } };
}

// ---------- Scorecard ----------
function scorecardSheet(wb, rep) {
  const { people, team } = rep.scores;
  const cols = [...people, team];
  const ws = wb.addWorksheet("Scorecard", { views: [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: 3 }] });
  ws.columns = [{ width: 10 }, { width: 20 }, { width: 58 }, ...cols.flatMap(() => [{ width: 9 }, { width: 13 }])];
  title(ws, "Scorecard: every check, every consultant", "Pass % = passed ÷ checked. \"Fails of checked\" shows how many records failed out of those the check applied to.", 3 + cols.length * 2);
  const h = ws.getRow(4);
  ["Record", "Area", "Check"].forEach((l, i) => { const c = h.getCell(i + 1); c.value = l; });
  cols.forEach((s, i) => { ws.mergeCells(3, 4 + i * 2, 3, 5 + i * 2); const c = ws.getCell(3, 4 + i * 2); c.value = s.name; c.font = { name: F, bold: true, size: 10, color: { argb: WHITE } }; c.fill = fill(NAVY); c.alignment = { horizontal: "center" }; h.getCell(4 + i * 2).value = "Pass %"; h.getCell(5 + i * 2).value = "Fails of checked"; });
  h.eachCell((c) => { c.font = { name: F, bold: true, size: 9.5, color: { argb: WHITE } }; c.fill = fill(NAVY); c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = BOX; });
  h.height = 30;
  let row = 5;
  const put = (kind, checks, key) => {
    for (const chk of checks) {
      const r = ws.getRow(row);
      r.getCell(1).value = kind; r.getCell(2).value = chk.area; r.getCell(3).value = chk.label;
      [1, 2, 3].forEach((i) => { r.getCell(i).font = { name: F, size: 9.5, color: { argb: INK } }; r.getCell(i).border = BOX; r.getCell(i).alignment = { vertical: "middle", wrapText: true }; });
      cols.forEach((s, i) => {
        const t = s[key][chk.key]; const n = t.pass + t.fail;
        const a = r.getCell(4 + i * 2), b = r.getCell(5 + i * 2);
        a.border = BOX; b.border = BOX; a.alignment = b.alignment = { horizontal: "center", vertical: "middle" };
        if (!n) { a.value = "–"; b.value = ""; a.font = { name: F, size: 9.5, color: { argb: SOFT } }; return; }
        const p = Math.round((1000 * t.pass) / n) / 10;
        a.value = p / 100; a.numFmt = "0%"; const [bg, tx] = tone(p); a.fill = fill(bg); a.font = { name: F, size: 9.5, bold: true, color: { argb: tx } };
        b.value = `${t.fail} of ${n}`; b.font = { name: F, size: 9.5, color: { argb: t.fail ? BADTX : SOFT } };
      });
      r.height = 28; row++;
    }
  };
  put("Contacts", CONTACT_CHECKS, "ct");
  put("Deals", DEAL_CHECKS, "dt");
}

// ---------- Contacts ----------
function contactsSheet(wb, rep, list, name = "Contacts", heading) {
  const base = [["Consultant", 18], ["Contact", 24], ["Assigned", 15], ["Note", 18], ["Lead stage", 16], ["Outcome", 18], ["Reason", 16],
    ["How the lead stage moved", 44], ["First contact", 15], ["Working hrs to 1st contact", 10], ["Call attempts", 8], ["Reached", 8],
    ["Emails", 7], ["WhatsApps", 9], ["Deals", 26]];
  const checks = CONTACT_CHECKS;
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false, state: "frozen", ySplit: 3, xSplit: 2 }] });
  ws.columns = [...base.map(([, w]) => ({ width: w })), ...checks.map(() => ({ width: 10 })), { width: 8 }, { width: 70 }];
  title(ws, heading || `Every contact assigned in ${rep.period.label}: ${list.length}`, "Pass / Fail per check (blank = the check did not apply). Filter any column; the Issues column says what is wrong.", base.length + checks.length + 2);
  header(ws, 3, [...base.map(([h]) => h), ...checks.map((c) => c.short), "Issues", "What is wrong"], 44);
  list.forEach((c, i) => {
    const r = ws.getRow(4 + i);
    const issues = checks.filter((k) => c.checks[k.key] && c.checks[k.key].r === "fail").length;
    r.values = [c.consultant, link(contactLink(c.id), c.name), xlDate(c.assignedAt), c.reassigned, c.stageName || "(blank)", c.outcome, c.reason, c.path,
      xlDate(c.firstAt), c.hrsToFirst, c.attempts, c.reached, c.emails, c.whatsapps, c.deals.map((d) => `${d.name} (${d.stageLabel})`).join("; "),
      ...checks.map(() => ""), issues, issuesText(c, checks)];
    r.eachCell({ includeEmpty: true }, (cell, col) => { cell.border = BOX; cell.alignment = { vertical: "top", wrapText: col === 4 || col === 8 || col === 15 || col >= base.length + checks.length + 2 }; cell.font = { name: F, size: 9.5, color: { argb: INK } }; });
    r.getCell(2).font = { name: F, size: 9.5, color: { argb: BLUE }, underline: true };
    r.getCell(3).numFmt = "dd mmm yyyy hh:mm"; r.getCell(9).numFmt = "dd mmm yyyy hh:mm";
    checks.forEach((k, j) => resultCell(r.getCell(base.length + 1 + j), c.checks[k.key]));
    const ic = r.getCell(base.length + checks.length + 1); ic.alignment = { horizontal: "center", vertical: "top" };
    if (issues) ic.font = { name: F, size: 9.5, bold: true, color: { argb: BADTX } };
  });
  if (list.length) ws.autoFilter = { from: "A3", to: `${colName(base.length + checks.length + 2)}${3 + list.length}` };
  else ws.getCell("A4").value = "None.";
  return ws;
}

// ---------- Deals ----------
function dealsSheet(wb, rep, list, name = "Deals", heading) {
  const base = [["Consultant", 18], ["Deal", 26], ["Created", 15], ["Created by", 16], ["Owner now", 16], ["Pipeline", 24], ["Stage now", 18],
    ["Position", 12], ["How the stage moved", 44], ["Close date", 12], ["Reason", 18], ["Contact", 20], ["Contact lead stage", 15], ["Days idle", 7]];
  const checks = DEAL_CHECKS;
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false, state: "frozen", ySplit: 3, xSplit: 2 }] });
  ws.columns = [...base.map(([, w]) => ({ width: w })), ...checks.map(() => ({ width: 10 })), { width: 8 }, { width: 70 }];
  title(ws, heading || `Every deal created in ${rep.period.label}: ${list.length}`, "Pass / Fail per check (blank = the check did not apply).", base.length + checks.length + 2);
  header(ws, 3, [...base.map(([h]) => h), ...checks.map((c) => c.short), "Issues", "What is wrong"], 44);
  list.forEach((d, i) => {
    const r = ws.getRow(4 + i);
    const issues = checks.filter((k) => d.checks[k.key] && d.checks[k.key].r === "fail").length;
    r.values = [d.consultant, link(dealLink(d.id), d.name), xlDate(d.createdAt), d.createdBy, d.currentOwner, d.pipelineName, d.stageLabel, d.catName, d.path,
      xlDate(d.closedate), d.reasons, d.contactId ? link(contactLink(d.contactId), d.contactName || "contact") : "", d.contactStage, d.idleDays,
      ...checks.map(() => ""), issues, issuesText(d, checks)];
    r.eachCell({ includeEmpty: true }, (cell, col) => { cell.border = BOX; cell.alignment = { vertical: "top", wrapText: col === 9 || col >= base.length + checks.length + 2 }; cell.font = { name: F, size: 9.5, color: { argb: INK } }; });
    r.getCell(2).font = { name: F, size: 9.5, color: { argb: BLUE }, underline: true };
    if (d.contactId) r.getCell(12).font = { name: F, size: 9.5, color: { argb: BLUE }, underline: true };
    r.getCell(3).numFmt = "dd mmm yyyy hh:mm"; r.getCell(10).numFmt = "dd mmm yyyy";
    checks.forEach((k, j) => resultCell(r.getCell(base.length + 1 + j), d.checks[k.key]));
    const ic = r.getCell(base.length + checks.length + 1); ic.alignment = { horizontal: "center", vertical: "top" };
    if (issues) ic.font = { name: F, size: 9.5, bold: true, color: { argb: BADTX } };
  });
  if (list.length) ws.autoFilter = { from: "A3", to: `${colName(base.length + checks.length + 2)}${3 + list.length}` };
  else ws.getCell("A4").value = "None.";
}

// ---------- Issues: one row per failed check ----------
function issueRows(rep, ownerId) {
  const rows = [];
  for (const c of rep.contacts) if (!ownerId || c.ownerId === ownerId)
    for (const k of CONTACT_CHECKS) { const x = c.checks[k.key]; if (x && x.r === "fail") rows.push({ who: c.consultant, kind: "Contact", name: c.name, url: contactLink(c.id), area: k.area, check: k.short, what: x.d, when: c.assignedAt, stage: c.stageName }); }
  for (const d of rep.deals) if (!ownerId || d.ownerId === ownerId)
    for (const k of DEAL_CHECKS) { const x = d.checks[k.key]; if (x && x.r === "fail") rows.push({ who: d.consultant, kind: "Deal", name: d.name, url: dealLink(d.id), area: k.area, check: k.short, what: x.d, when: d.createdAt, stage: d.stageLabel }); }
  return rows.sort((a, b) => a.who.localeCompare(b.who) || (a.kind === b.kind ? 0 : a.kind === "Contact" ? -1 : 1) || a.when - b.when);
}
function issuesSheet(wb, rows, name, heading, sub) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false, state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 18 }, { width: 9 }, { width: 28 }, { width: 15 }, { width: 18 }, { width: 22 }, { width: 18 }, { width: 80 }];
  title(ws, heading, sub, 8);
  header(ws, 3, ["Consultant", "Record", "Name", "Assigned / created", "Stage now", "Area", "Check", "What is wrong"]);
  rows.forEach((x, i) => {
    const r = ws.getRow(4 + i);
    r.values = [x.who, x.kind, link(x.url, x.name), xlDate(x.when), x.stage || "", x.area, x.check, x.what];
    r.eachCell({ includeEmpty: true }, (cell, col) => { cell.border = BOX; cell.alignment = { vertical: "top", wrapText: col === 8 }; cell.font = { name: F, size: 9.5, color: { argb: INK } }; });
    r.getCell(3).font = { name: F, size: 9.5, color: { argb: BLUE }, underline: true };
    r.getCell(4).numFmt = "dd mmm yyyy";
  });
  if (rows.length) ws.autoFilter = { from: "A3", to: `H${3 + rows.length}` };
  else ws.getCell("A4").value = "No issues.";
  return ws;
}

// ---------- Qualification ----------
function qualificationSheet(wb, rep) {
  const ws = wb.addWorksheet("Qualification", { views: [{ showGridLines: false, state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 18 }, { width: 26 }, { width: 15 }, { width: 18 }, { width: 34 }, { width: 70 }, { width: 44 }];
  title(ws, "Qualified clients not handled as qualified", "Deterministic findings first (they count in the scores). Then leads whose own call notes suggest they qualified: these are for review only and are not scored.", 7);
  header(ws, 3, ["Consultant", "Contact", "Assigned", "Lead stage now", "Finding", "Detail", "How the lead stage moved"]);
  let row = 4;
  const keys = [["qualifiedMarked", "Got a deal, not marked qualified"], ["dealCreated", "Marked qualified, no deal"], ["saleMarked", "Won, not marked Sale"]];
  const put = (c, finding, detail) => {
    const r = ws.getRow(row++);
    r.values = [c.consultant, link(contactLink(c.id), c.name), xlDate(c.assignedAt), c.stageName || "(blank)", finding, detail, c.path];
    r.eachCell({ includeEmpty: true }, (cell, col) => { cell.border = BOX; cell.alignment = { vertical: "top", wrapText: col >= 5 }; cell.font = { name: F, size: 9.5, color: { argb: INK } }; });
    r.getCell(2).font = { name: F, size: 9.5, color: { argb: BLUE }, underline: true }; r.getCell(3).numFmt = "dd mmm yyyy";
  };
  for (const [k, lab] of keys) for (const c of rep.contacts) if (c.checks[k] && c.checks[k].r === "fail") put(c, lab, c.checks[k].d);
  for (const f of rep.ai.flagged) put(f.contact, "Notes suggest qualified (review)", `${f.programme ? `${f.programme}: ` : ""}${f.reason}\nNotes: ${f.contact.aiText.join(" | ").slice(0, 600)}`);
  if (row === 4) ws.getCell("A4").value = "None found.";
  else ws.autoFilter = { from: "A3", to: `G${row - 1}` };
  if (!rep.ai.ran) { ws.getCell(row + 1, 1).value = `Call notes were not read this time (${rep.ai.stoppedEarly}).`; ws.getCell(row + 1, 1).font = { name: F, size: 9.5, italic: true, color: { argb: SOFT } }; }
}

// ---------- per consultant ----------
function personSheet(wb, rep, s) {
  const tab = s.name.replace(/[\\/?*[\]:]/g, "").slice(0, 28);
  const rows = issueRows(rep, s.ownerId);
  const ws = issuesSheet(wb, rows, tab, `${s.name} · ${rep.period.label}`,
    `Overall ${s.overallPct ?? "–"}% · contacts ${s.contactPct ?? "–"}% · deals ${s.dealPct ?? "–"}% (target ${SETTINGS.TARGET_PCT}%). ${s.kp.assigned} contacts assigned, ${s.kp.worked} worked, ${s.kp.notWorked} never worked; ${s.kp.deals} deals created. Every issue below, one row each.`);
  return ws;
}

// ---------- how it was checked ----------
function methodSheet(wb, rep) {
  const ws = wb.addWorksheet("How it was checked", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 130 }];
  title(ws, "How this was checked", null, 1);
  const L = [
    `Consultants: ${rep.consultants.map((c) => c.name).join(", ")}.`,
    `Period: ${rep.period.long}. Records were read from HubSpot on ${fmtDay(rep.now)}, and activity up to that moment counts.`,
    "",
    "WHAT WAS CHECKED",
    "Contacts: every contact whose current owner is one of these consultants and whose owner-assigned date falls in the period. Contacts since moved to someone else cannot be seen.",
    "Deals: every deal created in the period by one of these consultants, or owned by one of them. A deal counts for the consultant who created it; if someone else created it, for the owner.",
    "Every call, email, WhatsApp, meeting, task and note on the contact and on its deals is read. A consultant's own work counts from one hour before the lead was assigned.",
    "HubSpot moves the owner-assigned date whenever the owner is set again, even to the same person. The owner history is read, and the review counts from when the consultant's unbroken ownership began; those rows carry a note in the Contacts tab.",
    "",
    "THE RULES",
    ...CONTACT_CHECKS.map((c) => `Contact · ${c.area} · ${c.label}`),
    ...DEAL_CHECKS.map((c) => `Deal · ${c.area} · ${c.label}`),
    "",
    "HOW THE RULES ARE APPLIED",
    `"24 hours" means 24 working hours: Saturday, Sunday and UAE public holidays are not counted, so Friday 3pm is due Monday 3pm.`,
    `The dialler logs its own copy of each call a minute or so from the consultant's own log; calls by the same person within ${SETTINGS.SAME_ATTEMPT_MINUTES} minutes are one attempt. A "Call id" line from the dialler is not a description.`,
    `Reached means the call outcome was ${SETTINGS.REACHED_OUTCOMES.join(" or ")}. Every other outcome (No answer, Busy, Left voicemail, Wrong number) needs a WhatsApp, and on a deal an email as well, from that day and within 24 working hours. Each day of unanswered calls is checked, not just the last call.`,
    `While a contact is still a lead, follow-up is checked on the contact. Once a deal is created, follow-up is checked on the deal, so the same call is never counted twice.`,
    SETTINGS.IMAGE_NOTE_IS_WHATSAPP ? "A screenshot pasted into a note that day also counts as the WhatsApp follow-up." : "",
    `Qualification: a client is treated as qualified if a deal was created for them after the lead was assigned, or the consultant owns an open, postponed or won deal for them. Their lead stage must then be a qualified stage or Sale (or Started With Competitor / Already Migrated if every such deal was lost).`,
    `A lead marked qualified must have a deal within ${SETTINGS.DEAL_CREATED_GRACE_DAYS} working days. A won deal (paid, or moved to a service pipeline) means the lead stage should be Sale.`,
    `"Closed or qualified without contact" is not counted when the lead already had that stage before it was assigned, or when a workflow, form or import set it.`,
    `Deal stages are read by name, because each pipeline names them differently. Won deals that moved to a case manager's service pipeline are checked for client details, payment proof and the sales calls only.`,
    `Close dates up to ${SETTINGS.CLOSEDATE_GRACE_DAYS} days in the past and tasks up to ${SETTINGS.TASK_OVERDUE_GRACE_DAYS} days overdue are still accepted. "[Compliance]" tasks never count as follow-up.`,
    `Client details: a note or call description on the deal counts${SETTINGS.DETAILS_ON_CONTACT_COUNTS ? ", and so do details on the contact" : "; details only on the contact do not"}. Payment proof: a note with fee or payment figures${SETTINGS.IMAGE_NOTE_IS_PAYMENT_PROOF ? ", or a screenshot note" : ""}.`,
    "",
    "THE SCORES",
    "Compliance % = checks passed ÷ checks that applied. A check that did not apply to a record counts neither way. Green 80% and over, amber 60 to 79%, red under 60%.",
    "",
    "LIMITS WORTH KNOWING",
    "Only what is logged in HubSpot can be seen: a call, email or WhatsApp made outside HubSpot counts as not done.",
    rep.ai.ran ? `Call notes of ${rep.ai.read} leads not marked qualified were read for clear signs they qualified; ${rep.ai.flagged.length} are listed in the Qualification tab for review. These are never counted in the scores.${rep.ai.stoppedEarly ? ` Reading stopped early: ${rep.ai.stoppedEarly}.` : ""}` : `Call notes were not read for missed qualifications (${rep.ai.stoppedEarly}).`,
    "Spelling in emails and WhatsApps is not checked in this review.",
    ...(rep.warnings || []).map((w) => `WARNING: ${w}`),
  ].filter((x) => x !== null && x !== undefined);
  L.forEach((l, i) => {
    const c = ws.getCell(3 + i, 1); c.value = l;
    const head = /^[A-Z][A-Z ,]+$/.test(l);
    c.font = { name: F, size: head ? 10 : 10, bold: head || /^WARNING/.test(l), color: { argb: head ? NAVY : /^WARNING/.test(l) ? BADTX : INK } };
    c.alignment = { wrapText: true, vertical: "top" };
  });
}

async function buildWorkbook(rep) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HOF Compliance"; wb.created = new Date(rep.now);
  summarySheet(wb, rep);
  scorecardSheet(wb, rep);
  const byPerson = (a, b) => a.consultant.localeCompare(b.consultant);
  contactsSheet(wb, rep, rep.contacts.slice().sort((a, b) => byPerson(a, b) || a.assignedAt - b.assignedAt));
  dealsSheet(wb, rep, rep.deals.slice().sort((a, b) => byPerson(a, b) || a.createdAt - b.createdAt));
  const all = issueRows(rep);
  issuesSheet(wb, all, "Issues", `Every issue found: ${all.length}`, "One row per failed check. Filter by consultant, area or check.");
  const notWorked = rep.contacts.filter((c) => c.checks.worked.r === "fail").sort((a, b) => byPerson(a, b) || a.assignedAt - b.assignedAt);
  contactsSheet(wb, rep, notWorked, "Never worked", `Assigned but never contacted: ${notWorked.length}`);
  qualificationSheet(wb, rep);
  if (rep.scores.people.length <= SETTINGS.PER_CONSULTANT_TABS_MAX) for (const s of rep.scores.people) personSheet(wb, rep, s);
  methodSheet(wb, rep);
  return wb;
}

module.exports = { buildWorkbook, issueRows };
