// 7-score.js — turns the checked records into each consultant's numbers.
//
// Compliance % = checks passed ÷ checks that applied. A check that did not apply to a
// record (a lead with no calls has no "call outcome" check) counts neither way.
const { CONTACT_CHECKS } = require("./4-contacts");
const { DEAL_CHECKS } = require("./5-deals");
const R = require("./3-rules");

const pct = (p, f) => (p + f ? Math.round((1000 * p) / (p + f)) / 10 : null);

function tally(records, checks) {
  const t = Object.fromEntries(checks.map((c) => [c.key, { pass: 0, fail: 0, na: 0 }]));
  for (const r of records) for (const c of checks) { const x = r.checks[c.key]; if (x) t[c.key][x.r]++; }
  return t;
}
const sumT = (t) => Object.values(t).reduce((a, x) => ({ pass: a.pass + x.pass, fail: a.fail + x.fail }), { pass: 0, fail: 0 });
const clean = (records) => {
  const judged = records.filter((r) => Object.values(r.checks).some((x) => x.r !== "na"));
  return { judged: judged.length, clean: judged.filter((r) => !Object.values(r.checks).some((x) => x.r === "fail")).length };
};

function scoreOne(name, ownerId, contacts, deals, ai) {
  const ct = tally(contacts, CONTACT_CHECKS), dt = tally(deals, DEAL_CHECKS);
  const cs = sumT(ct), ds = sumT(dt);
  const withCalls = contacts.filter((c) => c.attempts > 0);
  const stageMix = {};
  for (const c of contacts) stageMix[c.stageName || "(blank)"] = (stageMix[c.stageName || "(blank)"] || 0) + 1;
  const waA = contacts.reduce((a, c) => a + c.waDays.applicable, 0) + deals.reduce((a, d) => a + d.waDays.applicable, 0);
  const waO = contacts.reduce((a, c) => a + c.waDays.ok, 0) + deals.reduce((a, d) => a + d.waDays.ok, 0);
  const emA = deals.reduce((a, d) => a + d.emDays.applicable, 0), emO = deals.reduce((a, d) => a + d.emDays.ok, 0);
  const cc = clean(contacts), dc = clean(deals);
  const kp = {
    assigned: contacts.length,
    due: contacts.filter((c) => !c.justIn).length,
    worked: ct.worked.pass, notWorked: ct.worked.fail, workedPct: pct(ct.worked.pass, ct.worked.fail),
    first24: ct.first24.pass, first24Pct: pct(ct.first24.pass, ct.first24.fail),
    medianFirstHrs: R.median(contacts.filter((c) => c.hrsToFirst != null).map((c) => c.hrsToFirst)),
    attempts: contacts.reduce((a, c) => a + c.attempts, 0),
    attemptsPerLead: withCalls.length ? Math.round((10 * withCalls.reduce((a, c) => a + c.attempts, 0)) / withCalls.length) / 10 : null,
    reachedPct: pct(withCalls.filter((c) => c.reached > 0).length, withCalls.filter((c) => !c.reached).length),
    emails: contacts.reduce((a, c) => a + c.emails, 0), whatsapps: contacts.reduce((a, c) => a + c.whatsapps, 0),
    stageMix,
    blankStage: ct.stage.fail,
    qualified: contacts.filter((c) => c.group === "qualified" || c.group === "sale").length,
    closedNoContact: ct.closedContact.fail,
    leadsWithDeal: contacts.filter((c) => c.newDeals > 0).length,
    qualNotMarked: ct.qualifiedMarked.fail, qualNoDeal: ct.dealCreated.fail, saleNotMarked: ct.saleMarked.fail,
    aiFlagged: ai ? ai.flagged.filter((f) => f.contact.ownerId === ownerId || ownerId === "*").length : 0,
    waDayPct: pct(waO, waA - waO), waDays: waA, emDayPct: pct(emO, emA - emO),
    deals: deals.length,
    dealsOpen: deals.filter((d) => d.cat === "OPEN" || d.cat === "ROLLOVER").length,
    dealsPostponed: deals.filter((d) => d.cat === "POSTPONED").length,
    dealsLost: deals.filter((d) => d.cat === "LOST").length,
    dealsWon: deals.filter((d) => d.wasWon).length,
    dealsOther: deals.filter((d) => d.cat === "OTHER").length,
    cleanContactsPct: pct(cc.clean, cc.judged - cc.clean), cleanDealsPct: pct(dc.clean, dc.judged - dc.clean),
  };
  const issues = [
    ...CONTACT_CHECKS.map((c) => ({ ...c, kind: "contact", fail: ct[c.key].fail, applicable: ct[c.key].pass + ct[c.key].fail })),
    ...DEAL_CHECKS.map((c) => ({ ...c, kind: "deal", fail: dt[c.key].fail, applicable: dt[c.key].pass + dt[c.key].fail })),
  ].filter((x) => x.fail > 0).map((x) => ({ ...x, rate: pct(x.fail, x.applicable - x.fail) }))
    .sort((a, b) => b.fail - a.fail || b.rate - a.rate);
  return {
    ownerId, name, kp, ct, dt,
    contactPct: pct(cs.pass, cs.fail), dealPct: pct(ds.pass, ds.fail), overallPct: pct(cs.pass + ds.pass, cs.fail + ds.fail),
    checksRun: cs.pass + cs.fail + ds.pass + ds.fail, fails: cs.fail + ds.fail, issues,
  };
}

function score(contacts, deals, consultants, ai) {
  const people = consultants.map((c) => scoreOne(c.name, c.ownerId,
    contacts.filter((x) => x.ownerId === c.ownerId), deals.filter((x) => x.ownerId === c.ownerId), ai));
  const team = scoreOne("All consultants", "*", contacts, deals, ai);
  return { people, team };
}

module.exports = { score, tally, pct };
