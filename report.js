// report.js — runs the review: reads HubSpot, checks every contact and deal, scores each
// consultant, writes the workbook and the email, and sends it. Read-only: nothing in
// HubSpot is changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS } = require("./config");
const { makeClock, resolvePeriod, fmtDay, dateKey } = require("./1-clock");
const { collect } = require("./2-collect");
const { buildContacts } = require("./4-contacts");
const { buildDeals } = require("./5-deals");
const { readNotes } = require("./6-notes-ai");
const { score } = require("./7-score");
const { buildWorkbook } = require("./8-workbook");
const { fitEmail, sendEmail, shortOf } = require("./9-email");
const H = require("./0-hubspot");

async function main() {
  if (!process.env.HUBSPOT_TOKEN) throw new Error("The HUBSPOT_TOKEN secret is missing.");
  const now = process.env.REPORT_NOW ? Date.parse(process.env.REPORT_NOW) : Date.now();   // REPORT_NOW is for testing
  const period = resolvePeriod(process.env.PERIOD, process.env.FROM_DATE, process.env.TO_DATE, now);
  console.log(`Consultant performance review: ${period.long}\n`);
  const clock = makeClock();
  const warnings = [];
  const years = [...new Set([dateKey(period.start), dateKey(now)].map((d) => d.slice(0, 4)))];
  const missing = years.filter((y) => !SETTINGS.HOLIDAYS.some((h) => h.startsWith(y)));
  if (missing.length) warnings.push(`No UAE public holidays are listed for ${missing.join(", ")} in config.js, so any holiday that year was counted as a working day.`);

  const world = await collect({ period, now, consultantsInput: process.env.CONSULTANTS, log: console.log });
  if (!world.contacts.size && !world.periodDealIds.size) throw new Error(`No contacts were assigned to, and no deals created by, these consultants in ${period.long}.`);

  const ctx = { clock, now, period, consultants: world.consultants, whatsappBlind: false };
  let contacts = buildContacts(world, ctx);
  // Safety net: if not one WhatsApp could be read anywhere while many were needed, we
  // cannot see them, so nobody is marked down for them.
  const waRead = [...world.eng.communications.values()].filter((w) => w.isWhatsApp).length;
  const waNeeded = contacts.reduce((a, c) => a + c.waDays.applicable, 0);
  if (!world.available.communications || (waRead === 0 && waNeeded >= 20)) {
    ctx.whatsappBlind = true;
    warnings.push("No WhatsApp messages could be read from HubSpot, so WhatsApp follow-up was left out rather than counted as missed. Check the HubSpot token can read communications.");
    contacts = buildContacts(world, ctx);
  }
  const deals = buildDeals(world, ctx);
  console.log(`Checked ${contacts.length} contacts and ${deals.length} deals`);
  if (world.historyFailed) warnings.push(`The stage history of ${world.historyFailed} records could not be read; for those, stage moves are judged on the current stage only.`);
  for (const t of ["calls", "emails", "tasks", "notes"]) if (!world.available[t]) warnings.push(`HubSpot ${t} could not be read, so checks that need them are left out.`);

  const ai = await readNotes(contacts);
  const scores = score(contacts, deals, world.consultants, ai);
  const rep = { period, now, consultants: world.consultants, contacts, deals, scores, ai, warnings };

  fs.mkdirSync(SETTINGS.OUT_DIR, { recursive: true });
  const base = `consultant-performance_${period.fileLabel}`;
  const xlsxPath = path.join(SETTINGS.OUT_DIR, `${base}.xlsx`);
  const wb = await buildWorkbook(rep);
  await wb.xlsx.writeFile(xlsxPath);
  const html = fitEmail(rep);
  fs.writeFileSync(path.join(SETTINGS.OUT_DIR, "email.html"), html);

  // a short summary in the log, and on the Actions run page
  const lines = [`| Consultant | Leads | Worked | 1st in 24h | Deals | Contacts | Deals | Overall |`, `|---|---:|---:|---:|---:|---:|---:|---:|`];
  for (const s of [...scores.people, scores.team]) {
    const p = (v) => (v == null ? "–" : `${v}%`);
    lines.push(`| ${s.name} | ${s.kp.assigned} | ${p(s.kp.workedPct)} | ${p(s.kp.first24Pct)} | ${s.kp.deals} | ${p(s.contactPct)} | ${p(s.dealPct)} | **${p(s.overallPct)}** |`);
  }
  console.log("\n" + lines.join("\n"));
  for (const w of warnings) console.log(`!! ${w}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Consultant performance · ${period.label}\n\n${lines.join("\n")}\n\n${warnings.map((w) => `> ${w}`).join("\n")}\n`);

  const sizeMb = fs.statSync(xlsxPath).size / 1048576;
  console.log(`\nWorkbook ${xlsxPath} (${sizeMb.toFixed(1)} MB), email ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
  console.log(`HubSpot requests: ${H.stats.calls} (${H.stats.retries} retried)`);
  if (!SETTINGS.SEND_EMAIL) { console.log("Not emailed (SEND_EMAIL is off)."); return; }
  const first = world.consultants.map((c) => shortOf(c.name)).join(", ");
  const subject = `Consultant performance review · ${period.label} · ${first}`;
  const attachments = sizeMb < 25 ? [{ filename: `${base}.xlsx`, content: fs.readFileSync(xlsxPath).toString("base64") }] : [];
  if (!attachments.length) console.log("The workbook is too big to attach; it is in this run's artifacts.");
  const ok = await sendEmail(subject, html, attachments);
  console.log(ok ? `Emailed to ${SETTINGS.REPORT_TO}${SETTINGS.CC.length ? ` (cc ${SETTINGS.CC.join(", ")})` : ""}` : "The email was NOT sent.");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(`\nThe review could not run: ${e.message}`); if (process.env.DEBUG) console.error(e.stack); process.exit(1); });
