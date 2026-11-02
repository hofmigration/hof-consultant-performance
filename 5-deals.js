// 5-deals.js — every deal the consultants created in the period (or own, if someone else
// created it for them), checked against the deal compliance rules, plus whether its stage
// was moved correctly. A deal is credited to the consultant who created it; if that was
// someone else, to the consultant who owns it.
const { SETTINGS } = require("./config");
const { HOUR, DAY, dayStart, fmtShort, fmtDay } = require("./1-clock");
const R = require("./3-rules");

const DEAL_CHECKS = [
  { key: "closeDate", area: "Deal stage", short: "Close date", label: "Close date not in the past (open and postponed deals)" },
  { key: "reason", area: "Deal stage", short: "Reason", label: "Postponed and lost deals carry a real reason (not \"Opportunity\")" },
  { key: "rollover", area: "Deal stage", short: "Rollover", label: "Last Month Rollover used only after the month the deal was created" },
  { key: "stuck", area: "Deal stage", short: "Not left idle", label: "Open deal worked or moved at least every 30 days" },
  { key: "pipeline", area: "Deal stage", short: "Right pipeline", label: "Deal is in the pipeline that matches the client's lead stage" },
  { key: "task", area: "Follow-up", short: "Follow-up task", label: "Open follow-up task on the deal, not overdue (every stage except Lost and Won)" },
  { key: "callOnDeal", area: "Calls and messages", short: "Call on deal", label: "Calls logged on the deal" },
  { key: "callDesc", area: "Calls and messages", short: "Call notes", label: "Connected calls have a description" },
  { key: "processEmail", area: "Calls and messages", short: "Process email", label: "Process details emailed after the first connected call" },
  { key: "noAnswerEmail", area: "Calls and messages", short: "Email after no answer", label: "Email within 24 working hours of every day of unanswered calls" },
  { key: "noAnswerWhatsapp", area: "Calls and messages", short: "WhatsApp after no answer", label: "WhatsApp within 24 working hours of every day of unanswered calls" },
  { key: "details", area: "Records", short: "Client details", label: "Client details note on the deal" },
  { key: "payment", area: "Records", short: "Payment proof", label: "Proof of payment logged on won deals" },
  { key: "outcome", area: "Records", short: "Outcome Deal Created", label: `Contact Outcome keeps "${SETTINGS.OUTCOME_MUST_INCLUDE}" ticked` },
  { key: "ageRange", area: "Records", short: "Age range", label: "Age range marked (contact or deal)" },
  { key: "nationality", area: "Records", short: "Nationality", label: "Nationality marked on the contact" },
];

// Where the client details are: a note on the deal, the deal's call description, or (not
// accepted unless DETAILS_ON_CONTACT_COUNTS) the contact's notes or calls.
function findClientDetails({ dealNotes, dealCalls, contactNotes, contactCalls }) {
  if (dealNotes.some((n) => R.looksLikeClientDetails(n.text))) return "deal-note";
  if (dealCalls.some((c) => R.looksLikeClientDetails(c.text))) return "deal-call";
  if (contactNotes.some((n) => R.looksLikeClientDetails(n.text))) return "contact-note";
  if (contactCalls.some((c) => R.looksLikeClientDetails(c.text))) return "contact-call";
  return null;
}

function stagePathText(d) {
  if (!d.stageHist || !d.stageHist.length) return d.stageLabel;
  const steps = [];
  for (const h of d.stageHist) if (!steps.length || steps[steps.length - 1].label !== h.label) steps.push(h);
  let txt = steps.map((h) => `${h.label} ${fmtShort(h.at)}`).join(" → ");
  if (d.cat === "SERVICE") txt += ` → ${d.pipelineName}`;
  return txt;
}

function buildDeal(world, id, ctx) {
  const { clock, now, consultants } = ctx;
  const d = R.describeDeal(world, id);
  const sel = new Set(consultants.map((c) => c.ownerId));
  const ownerId = sel.has(d.creatorOwnerId) ? d.creatorOwnerId : sel.has(d.ownerId) ? d.ownerId : null;
  if (!ownerId) return null;
  const cons = consultants.find((c) => c.ownerId === ownerId);

  const gather = (type) => ((world.links.deals[type] && world.links.deals[type].get(d.id)) || []).map((x) => world.eng[type].get(x)).filter(Boolean);
  const allCalls = gather("calls").filter((c) => c.at <= now);
  const calls = allCalls.filter((c) => c.ownerId === ownerId);
  const emails = gather("emails").filter((e) => e.out && e.ok && e.ownerId === ownerId && e.at <= now);
  const whatsapps = gather("communications").filter((w) => w.isWhatsApp && w.at <= now);
  const notes = gather("notes").filter((n) => !n.compliance);
  const myNotes = notes.filter((n) => n.ownerId === ownerId && n.at <= now);
  const tasks = gather("tasks").filter((t) => !t.compliance);
  const meetings = gather("meetings").filter((m) => m.ownerId === ownerId && m.at <= now);

  // the client
  const cIds = (world.links.deals.contacts && world.links.deals.contacts.get(d.id)) || [];
  const cId = cIds.find((x) => world.contacts.has(x)) || cIds[0] || null;
  const cp = cId ? (world.contacts.get(cId) || world.extraContacts.get(cId) || null) : null;
  const cName = cp ? [cp.firstname, cp.lastname].filter(Boolean).join(" ").trim() : "";
  const cStage = cp ? String(cp.lead_stage || "") : "";
  const cNotes = cId ? ((world.links.contacts.notes.get(cId) || []).map((x) => world.eng.notes.get(x)).filter((n) => n && !n.compliance)) : [];
  const cCalls = cId ? ((world.links.contacts.calls.get(cId) || []).map((x) => world.eng.calls.get(x)).filter(Boolean)) : [];
  const otherDeals = cId && world.links.contacts.deals.get(cId) ? world.links.contacts.deals.get(cId).filter((x) => x !== d.id).map((x) => R.describeDeal(world, x)) : [];

  const atts = R.attempts(calls);
  const dealAtts = atts.filter((a) => a.at >= d.createdAt - HOUR);
  const reached = atts.filter((a) => a.reached);
  const checked = d.cat !== "OTHER";
  const c = {};

  // ---- stage ----
  const graceStart = dayStart(now) - SETTINGS.CLOSEDATE_GRACE_DAYS * DAY;
  c.closeDate = !R.isLiveDeal(d.cat) ? R.na() : !d.closedate ? R.fail("No close date set")
    : d.closedate < graceStart ? R.fail(`Close date ${fmtDay(d.closedate)} is in the past`) : R.pass(fmtDay(d.closedate));

  const valid = d.reasons.filter((r) => !SETTINGS.REASON_FORBIDDEN.map((x) => x.toLowerCase()).includes(r.toLowerCase()));
  c.reason = !(d.cat === "POSTPONED" || d.cat === "LOST") ? R.na() : valid.length ? R.pass(valid.join(", "))
    : R.fail(d.reasons.length ? `${R.CATEGORY_NAME[d.cat]} with "${d.reasons.join(", ")}" as the reason` : `${R.CATEGORY_NAME[d.cat]} with no reason selected`);

  if (!d.stageHist) c.rollover = d.cat === "ROLLOVER" ? R.na("No stage history to check") : R.na();
  else {
    const rolls = d.stageHist.filter((h) => h.cat === "ROLLOVER");
    const bad = rolls.find((h) => R.monthKey(h.at) === R.monthKey(d.createdAt));
    c.rollover = !rolls.length ? R.na() : bad ? R.fail(`Moved to ${bad.label} on ${fmtShort(bad.at)}, the same month it was created (${fmtShort(d.createdAt)})`) : R.pass();
  }

  const activity = [...calls, ...emails, ...whatsapps, ...myNotes, ...meetings].map((e) => e.at);
  const lastMove = d.stageHist && d.stageHist.length ? d.stageHist[d.stageHist.length - 1].at : d.createdAt;
  const lastTouch = Math.max(d.createdAt, lastMove, ...activity);
  const idleDays = Math.floor((now - lastTouch) / DAY);
  c.stuck = !(d.cat === "OPEN" || d.cat === "ROLLOVER") || now - d.createdAt <= SETTINGS.STUCK_DAYS * DAY ? R.na()
    : idleDays > SETTINGS.STUCK_DAYS ? R.fail(`${d.stageLabel} with nothing logged and no stage move for ${idleDays} days`) : R.pass();

  const expected = SETTINGS.STAGE_PIPELINES[cStage];
  if (!expected || !checked) c.pipeline = R.na();
  else if (expected.includes(d.pipelineId) || otherDeals.some((o) => expected.includes(o.pipelineId))) c.pipeline = R.pass();
  else c.pipeline = R.fail(`Lead stage is ${world.leadLabels[cStage] || cStage} but the deal is in ${d.pipelineName}`);

  // ---- follow-up ----
  if (!R.isLiveDeal(d.cat)) c.task = R.na();
  else { const t = R.followUpTask(tasks, now); c.task = t.ok ? R.pass() : R.fail(t.detail); }

  // ---- calls and messages ----
  c.callOnDeal = !checked ? R.na() : calls.length ? R.pass(`${atts.length} attempt${atts.length > 1 ? "s" : ""}`) : R.fail("No call logged on the deal");
  // calls made once the deal existed (earlier calls were checked on the contact)
  const dealReached = dealAtts.filter((a) => a.reached), undescribed = dealReached.filter((a) => !a.description);
  c.callDesc = !dealReached.length ? R.na() : undescribed.length ? R.fail(`${undescribed.length} of ${dealReached.length} connected calls have no description (${undescribed.slice(0, 3).map((a) => fmtShort(a.at)).join(", ")})`) : R.pass();
  const firstReached = reached[0];
  c.processEmail = !firstReached || now < clock.deadline(firstReached.at, SETTINGS.FOLLOW_UP_HOURS) ? R.na()
    : emails.some((e) => e.at >= dayStart(firstReached.at)) ? R.pass() : R.fail(`Connected call on ${fmtShort(firstReached.at)} but no email with the process details`);
  const days = R.unansweredDays(dealAtts);
  const em = R.followUp(days, emails, clock, now);
  c.noAnswerEmail = !em.applicable ? R.na() : em.missing.length || em.late.length ? R.fail(R.followUpText(em, "email")) : R.pass(`${em.ok} of ${em.applicable} days`);
  const wa = R.followUp(days, [...whatsapps, ...(SETTINGS.IMAGE_NOTE_IS_WHATSAPP ? myNotes.filter((n) => n.hasImage) : [])], clock, now);
  c.noAnswerWhatsapp = !world.available.communications || ctx.whatsappBlind ? R.na("WhatsApp could not be read") : !wa.applicable ? R.na()
    : wa.missing.length || wa.late.length ? R.fail(R.followUpText(wa, "WhatsApp")) : R.pass(`${wa.ok} of ${wa.applicable} days`);

  // ---- records ----
  if (!checked || d.cat === "LOST") c.details = R.na();
  else {
    const where = findClientDetails({ dealNotes: notes, dealCalls: allCalls, contactNotes: cNotes, contactCalls: cCalls });
    if (where === "deal-note") c.details = R.pass();
    else if (where === "deal-call") c.details = R.pass("In the call description on the deal");
    else if (where) c.details = SETTINGS.DETAILS_ON_CONTACT_COUNTS ? R.pass("On the contact") : R.fail("Client details are on the contact, not in a note on the deal");
    else c.details = R.fail("No client details recorded on the deal or the contact");
  }
  if (!d.wasWon) c.payment = R.na();
  else {
    const proof = notes.find((n) => R.looksLikePaymentProof(n.text)) || (SETTINGS.IMAGE_NOTE_IS_PAYMENT_PROOF ? notes.find((n) => n.hasImage) : null);
    c.payment = proof ? R.pass(R.looksLikePaymentProof(proof.text) ? "" : `Screenshot note ${fmtShort(proof.at)}`) : R.fail("Won, but no proof of payment logged on the deal");
  }
  const outcome = cp ? String(cp.outcome || "") : "";
  c.outcome = !cp || !checked ? R.na() : outcome.split(";").map((s) => s.trim().toLowerCase()).includes(SETTINGS.OUTCOME_MUST_INCLUDE.toLowerCase()) ? R.pass()
    : R.fail(outcome ? `Contact Outcome is "${outcome.replace(/;/g, ", ")}", without ${SETTINGS.OUTCOME_MUST_INCLUDE}` : `Contact Outcome not marked ${SETTINGS.OUTCOME_MUST_INCLUDE}`);
  c.ageRange = !cp || !checked ? R.na() : (cp.age_range || d.ageRange) ? R.pass() : R.fail("Age range not marked");
  c.nationality = !cp || !checked ? R.na() : cp.nationality ? R.pass() : R.fail("Nationality not marked");

  return {
    id: d.id, name: d.name, ownerId, consultant: cons.name, createdAt: d.createdAt,
    createdBy: d.creatorOwnerId ? (world.ownerName[d.creatorOwnerId] || d.creatorOwnerId) : "", currentOwner: world.ownerName[d.ownerId] || d.ownerId,
    pipelineName: d.pipelineName, stageLabel: d.stageLabel, cat: d.cat, catName: R.CATEGORY_NAME[d.cat], wasWon: d.wasWon, wonAt: d.wonAt,
    closedate: d.closedate, reasons: d.reasons.join(", "), amount: d.amount, path: stagePathText(d),
    contactId: cId, contactName: cName, contactStage: world.leadLabels[cStage] || cStage,
    attempts: atts.length, reached: reached.length, emails: emails.length, whatsapps: whatsapps.length, idleDays: R.isLiveDeal(d.cat) ? idleDays : null,
    waDays: { applicable: wa.applicable, ok: wa.ok }, emDays: { applicable: em.applicable, ok: em.ok },
    checks: c,
  };
}

function buildDeals(world, ctx) {
  return [...world.periodDealIds].map((id) => buildDeal(world, id, ctx)).filter(Boolean);
}

module.exports = { DEAL_CHECKS, buildDeals, buildDeal, findClientDetails };
