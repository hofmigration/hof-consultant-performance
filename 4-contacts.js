// 4-contacts.js — every contact assigned to the consultants in the period, checked against
// the contact compliance rules, plus how it was handled (worked at all, how fast), whether
// the lead stage moved correctly, and whether qualified clients were marked qualified.
//
// Every check answers pass, fail, or "does not apply" — a check that does not apply never
// counts for or against anyone.
const { SETTINGS } = require("./config");
const { HOUR, ms, fmtShort, fmtDay, hrs, hrs1 } = require("./1-clock");
const R = require("./3-rules");

const CONTACT_CHECKS = [
  { key: "worked", area: "Handling", short: "Worked", label: "Lead was worked: a call, email or WhatsApp logged after assignment" },
  { key: "first24", area: "Handling", short: "1st contact in 24h", label: "First contact within 24 working hours of assignment" },
  { key: "stage", area: "Lead stage", short: "Stage marked", label: "Lead stage marked" },
  { key: "outcome", area: "Lead stage", short: "Outcome marked", label: "Outcome marked once calls were made" },
  { key: "stageCalls", area: "Lead stage", short: "Stage fits calls", label: "No Answer, Switched off, Cannot Dial, Call Back and Wrong Number backed by logged calls, and not left on No Answer after a connected call" },
  { key: "closedContact", area: "Lead stage", short: "Closed after contact", label: "Lead closed or qualified only after speaking to the client" },
  { key: "reason", area: "Lead stage", short: "Reason recorded", label: "Reason recorded for Ineligible and They Didn't Fill (Reason For Lead Stage, Hof Ineligible Reason, or an Outcome such as No Education)" },
  { key: "name", area: "Lead stage", short: "Client name", label: "Client name present" },
  { key: "callLogged", area: "Calls", short: "Call logged", label: "A call was logged, not only an email, WhatsApp or note" },
  { key: "callOutcome", area: "Calls", short: "Call outcomes", label: "Every call has a call outcome" },
  { key: "callDesc", area: "Calls", short: "Call notes", label: "Connected calls have a description" },
  { key: "whatsapp", area: "Follow-up", short: "WhatsApp after no answer", label: "WhatsApp within 24 working hours of every day of unanswered calls" },
  { key: "email", area: "Follow-up", short: "Email sent", label: "An email was sent once calls were made" },
  { key: "emailQuality", area: "Follow-up", short: "Email quality", label: "Emails greet the client by name, with no placeholders left in" },
  { key: "task", area: "Follow-up", short: "Follow-up task", label: "Open follow-up task while the lead is still live (No Answer, Switched off, Call Back, or qualified with no deal yet)" },
  { key: "qualifiedMarked", area: "Qualification", short: "Qualified marked", label: "A client who got a deal is marked qualified" },
  { key: "dealCreated", area: "Qualification", short: "Deal created", label: "A client marked qualified has a deal" },
  { key: "saleMarked", area: "Qualification", short: "Sale marked", label: "A client whose deal was won is marked Sale" },
];

const label = (world, v) => (v ? String(world.leadLabels[v] || v).trim() : "");

function who(world, h, ownerId, userId) {
  if (!h) return "";
  const owner = world.userToOwner[h.userId] || (world.ownerName[h.userId] ? h.userId : "");
  if (owner && owner === ownerId) return "consultant";
  if (h.userId && h.userId === userId) return "consultant";
  if (owner) return world.ownerName[owner] || "another user";
  const t = String(h.sourceType || "").toUpperCase();
  if (/AUTOMATION|WORKFLOW/.test(t)) return "workflow";
  if (/IMPORT/.test(t)) return "import";
  if (/FORM/.test(t)) return "form";
  if (/INTEGRATION|API|APP|SALES/.test(t)) return "integration";
  if (/CRM_UI|BATCH/.test(t)) return "a HubSpot user";
  return t ? t.toLowerCase() : "";
}
const SYSTEM = new Set(["workflow", "import", "form", "integration"]);

// What the lead stage history says: when the current stage was set and by whom, the stage
// the lead had when it was assigned, and every change since.
function stageFacts(world, hist, stage, from, ownerId, userId) {
  if (!hist) return { known: false, path: [] };
  let i = hist.length - 1;
  while (i > 0 && hist[i - 1].value === stage) i--;
  const setEntry = hist.length && hist[hist.length - 1].value === stage ? hist[i] : null;
  const before = hist.filter((h) => h.at < from);
  const path = [];
  for (const h of hist.filter((x) => x.at >= from)) if (!path.length || path[path.length - 1].value !== h.value) path.push(h);
  return {
    known: true, setAt: setEntry ? setEntry.at : null, setBy: who(world, setEntry, ownerId, userId),
    atAssign: before.length ? before[before.length - 1].value : "",
    path: path.map((h) => ({ value: h.value, at: h.at, by: who(world, h, ownerId, userId) })),
  };
}
function pathText(world, f, current) {
  if (!f.known) return label(world, current) || "(blank)";
  const steps = [];
  if (f.atAssign) steps.push(`${label(world, f.atAssign)} (when assigned)`);
  for (const p of f.path) steps.push(`${label(world, p.value) || "(cleared)"} ${fmtShort(p.at)}${p.by && p.by !== "consultant" ? `, by ${p.by}` : ""}`);
  return steps.join(" → ") || "(never set)";
}

// When this consultant's current, unbroken ownership began. HubSpot's "owner assigned date"
// moves whenever the owner is set again, even to the same person, so a lead the consultant
// had been working since Monday can show as assigned on Wednesday.
function ownedSince(hist, ownerId) {
  if (!hist || !hist.length || hist[hist.length - 1].value !== ownerId) return null;
  let i = hist.length - 1;
  while (i > 0 && hist[i - 1].value === ownerId) i--;
  return hist[i].at;
}

function buildContact(world, id, ctx) {
  const { clock, now, consultants, period } = ctx;
  const p = world.contacts.get(id) || {};
  const ownerId = String(p.hubspot_owner_id || "");
  const cons = consultants.find((c) => c.ownerId === ownerId) || { ownerId, userId: ownerId, name: world.ownerName[ownerId] || ownerId };
  const hubspotAssigned = ms(p.hubspot_owner_assigneddate) || ms(p.createdate);
  const hist = world.contactHistory.get(id) || {};
  const since = ownedSince(hist.owner, ownerId);
  const assignedAt = since && since < hubspotAssigned ? since : hubspotAssigned;
  const beforePeriod = period && assignedAt < period.start - 24 * HOUR;
  const from = assignedAt - HOUR;
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const stage = String(p.lead_stage || "");
  const group = R.stageGroup(stage);
  const stageName = label(world, stage);

  // everything on the contact and on its deals (consultants often log calls on the deal)
  const dealIds = world.links.contacts.deals.get(id) || [];
  const gather = (type) => R.uniq([...(world.links.contacts[type].get(id) || []), ...dealIds.flatMap((d) => (world.links.deals[type] && world.links.deals[type].get(d)) || [])])
    .map((x) => world.eng[type].get(x)).filter(Boolean);
  const inTime = (e) => e.at >= from && e.at <= now;
  const calls = gather("calls").filter((c) => c.ownerId === ownerId && inTime(c));
  const emailsTried = gather("emails").filter((e) => e.out && e.ownerId === ownerId && inTime(e));   // a bounced email was still an attempt
  const emails = emailsTried.filter((e) => e.ok);
  const whatsapps = gather("communications").filter((w) => w.isWhatsApp && inTime(w));
  const meetings = gather("meetings").filter((m) => m.ownerId === ownerId && inTime(m));
  const notes = gather("notes").filter((n) => n.ownerId === ownerId && !n.compliance && inTime(n));
  const tasks = gather("tasks").filter((t) => !t.compliance);

  // the client's deals. "Evidence" deals say the client qualified while this consultant had
  // the lead: created after assignment, or the consultant's own and not lost.
  const deals = dealIds.map((d) => R.describeDeal(world, d));
  const evidence = deals.filter((d) => d.cat !== "OTHER" && (d.createdAt >= from || (d.ownerId === ownerId && d.cat !== "LOST")));
  const newDeals = deals.filter((d) => d.createdAt >= from);
  // Once a deal exists, follow-up is checked on the deal, so a call is never counted twice.
  const leadEnd = evidence.length ? Math.min(...evidence.map((d) => d.createdAt)) : Infinity;

  const atts = R.attempts(calls);
  const leadAtts = atts.filter((a) => a.at < leadEnd);
  const outreach = [...calls, ...emailsTried, ...whatsapps, ...meetings].map((e) => e.at).sort((a, b) => a - b);
  const firstAt = outreach[0] || null;
  const worked = outreach.length > 0;
  const due24 = clock.deadline(assignedAt, SETTINGS.FIRST_CONTACT_HOURS);
  const justIn = now < due24 && !worked;
  const facts = stageFacts(world, hist.lead_stage || null, stage, from, ownerId, cons.userId);
  const noContactNeeded = R.NO_CONTACT_NEEDED.has(stage);

  const c = {}; // check results
  // ---- handling ----
  if (noContactNeeded) c.worked = R.na(`${stageName}: no contact needed`);
  else if (justIn) c.worked = R.na("Assigned less than 24 working hours ago");
  else c.worked = worked ? R.pass(`${outreach.length} contact${outreach.length > 1 ? "s" : ""} logged`)
    : R.fail(`Not contacted since assignment on ${fmtDay(assignedAt)}${notes.length ? ". A note was written, but no call, email or WhatsApp was logged" : ""}`);

  if (noContactNeeded || justIn) c.first24 = R.na();
  else if (beforePeriod) c.first24 = R.na(`Owned since ${fmtDay(assignedAt)}, before the period`);
  else if (firstAt && firstAt <= due24) c.first24 = R.pass(`${hrs(clock.workingBetween(assignedAt, firstAt))} working hrs`);
  else c.first24 = R.fail(firstAt ? `First contact after ${hrs1(clock.workingBetween(assignedAt, firstAt))} working hours` : "Never contacted");

  // ---- lead stage ----
  c.stage = justIn ? R.na() : stage ? R.pass(stageName) : R.fail("No lead stage marked");
  c.outcome = !calls.length ? R.na() : p.outcome ? R.pass(String(p.outcome).replace(/;/g, ", ")) : R.fail("Calls logged but no Outcome marked");

  if (group === "notReached") {
    if (!atts.length) c.stageCalls = R.fail(`Marked ${stageName} but no call is logged`);
    else { const last = atts[atts.length - 1]; c.stageCalls = last.reached ? R.fail(`Marked ${stageName} but the last call (${fmtShort(last.at)}) was ${last.outcome}`) : R.pass(); }
  } else if (stage === SETTINGS.CALL_BACK_STAGE || stage === "Wrong Number") {
    c.stageCalls = atts.length ? R.pass() : R.fail(`Marked ${stageName} but no call is logged`);
  } else c.stageCalls = R.na();

  if (["closed", "qualified", "sale"].includes(group) && !noContactNeeded && stage !== "Wrong Number") {
    if (facts.known && facts.setAt && facts.setAt < from) c.closedContact = R.na("Stage was set before this consultant had the lead");
    else if (facts.known && SYSTEM.has(facts.setBy)) c.closedContact = R.na(`Stage set by ${facts.setBy}`);
    else c.closedContact = worked ? R.pass() : R.fail(`Marked ${stageName} without any call, email or WhatsApp logged`);
  } else c.closedContact = R.na();

  const fields = SETTINGS.REASON_FIELDS[stage];
  const outcomes = String(p.outcome || "").split(";").map((x) => x.trim());
  const reasonOutcome = stage === "Ineligible" ? outcomes.find((o) => SETTINGS.REASON_OUTCOMES.includes(o)) : null;
  const reasonText = fields ? [...fields.map((f) => String(p[f] || "").trim()), reasonOutcome].filter(Boolean) : [];
  c.reason = !fields ? R.na() : reasonText.length ? R.pass(reasonText.join(", ")) : R.fail(`Marked ${stageName} but no reason recorded`);
  c.name = justIn ? R.na() : name ? R.pass() : R.fail("No client name");

  // ---- calls (while it is a lead) ----
  c.callLogged = !worked || noContactNeeded ? R.na() : calls.length ? R.pass(`${atts.length} attempt${atts.length > 1 ? "s" : ""}`) : R.fail("Contacted by email or WhatsApp only; no call logged");
  const noOutcome = leadAtts.filter((a) => !a.outcome);
  c.callOutcome = !leadAtts.length ? R.na() : noOutcome.length ? R.fail(`${noOutcome.length} of ${leadAtts.length} calls have no call outcome`) : R.pass();
  const reached = atts.filter((a) => a.reached);
  const leadReached = leadAtts.filter((a) => a.reached), undescribed = leadReached.filter((a) => !a.description);
  c.callDesc = !leadReached.length ? R.na() : undescribed.length ? R.fail(`${undescribed.length} of ${leadReached.length} connected calls have no description (${undescribed.slice(0, 3).map((a) => fmtShort(a.at)).join(", ")})`) : R.pass();

  // ---- follow-up (while it is a lead) ----
  const messages = [...whatsapps, ...(SETTINGS.IMAGE_NOTE_IS_WHATSAPP ? notes.filter((n) => n.hasImage) : [])];
  const wa = R.followUp(R.unansweredDays(leadAtts), messages, clock, now);
  c.whatsapp = !world.available.communications || ctx.whatsappBlind ? R.na("WhatsApp could not be read") : !wa.applicable ? R.na()
    : wa.missing.length || wa.late.length ? R.fail(R.followUpText(wa, "WhatsApp")) : R.pass(`${wa.ok} of ${wa.applicable} days`);
  const firstLead = leadAtts[0];
  c.email = !firstLead || now < clock.deadline(firstLead.at, SETTINGS.FOLLOW_UP_HOURS) ? R.na() : emails.length ? R.pass(`${emails.length} sent`) : R.fail(emailsTried.length ? "Calls made, and the only email bounced" : "Calls made but no email sent");
  const withText = emails.filter((e) => e.text);
  const badMail = withText.map((e) => ({ e, probs: R.emailProblems(e, name) })).filter((x) => x.probs.length);
  c.emailQuality = !withText.length ? R.na() : badMail.length
    ? R.fail(`${badMail.length} of ${withText.length} emails: "${badMail[0].e.subject.slice(0, 60)}" (${fmtShort(badMail[0].e.at)}) ${badMail[0].probs.join(", ")}`) : R.pass();
  const live = (SETTINGS.TASK_STAGES.includes(stage) && !evidence.some((d) => R.isLiveDeal(d.cat) || R.isWonCat(d.cat)))
    || (group === "qualified" && !deals.some((d) => d.cat !== "OTHER"));
  if (!live || justIn) c.task = R.na();
  else { const t = R.followUpTask(tasks, now); c.task = t.ok ? R.pass() : R.fail(t.detail); }

  // ---- qualification ----
  const okStages = new Set([...SETTINGS.QUALIFIED_STAGES, SETTINGS.SALE_STAGE]);
  if (evidence.length && evidence.every((d) => d.cat === "LOST")) { okStages.add("Started With Competitor"); okStages.add("Already Migrated"); }
  const ev = evidence[0];
  c.qualifiedMarked = !evidence.length ? R.na() : okStages.has(stage) ? R.pass()
    : R.fail(`Deal "${ev.name}" (${ev.stageLabel}, created ${fmtShort(ev.createdAt)}) but the lead stage is ${stageName || "blank"}`);

  if (group === "qualified" || group === "sale") {
    const qualifiedAt = Math.max((facts.known && facts.setAt) || assignedAt, assignedAt);
    const hasDeal = deals.some((d) => d.cat !== "OTHER" && (d.cat !== "LOST" || d.createdAt >= from));
    if (hasDeal) c.dealCreated = R.pass();
    else if (clock.workingBetween(qualifiedAt, now) < SETTINGS.DEAL_CREATED_GRACE_DAYS * 24 * HOUR) c.dealCreated = R.na(`Marked qualified less than ${SETTINGS.DEAL_CREATED_GRACE_DAYS} working days ago`);
    else c.dealCreated = R.fail(`Marked ${stageName}${facts.known && facts.setAt ? ` on ${fmtShort(facts.setAt)}` : ""} but no deal was created`);
  } else c.dealCreated = R.na();

  const won = evidence.filter((d) => d.wasWon);
  c.saleMarked = !won.length ? R.na() : stage === SETTINGS.SALE_STAGE ? R.pass()
    : R.fail(`Deal "${won[0].name}" was won${won[0].wonAt ? ` (${fmtShort(won[0].wonAt)})` : ""} but the lead stage is ${stageName || "blank"}`);

  // what the consultant wrote, for reading by AI on leads not marked qualified (review only)
  const aiText = R.uniq([...atts.map((a) => a.description), ...notes.filter((n) => !n.hasImage || n.text.length > 20).map((n) => n.text)]
    .map((t) => String(t || "").trim()).filter((t) => t.length >= 15)).slice(-6);

  return {
    id, name: name || "(no name)", email: p.email || "", ownerId, consultant: cons.name, assignedAt, hubspotAssigned,
    reassigned: since && since < hubspotAssigned - HOUR ? `HubSpot shows the owner set again on ${fmtDay(hubspotAssigned)}` : "",
    createdAt: ms(p.createdate), stage, stageName, group, outcome: String(p.outcome || "").replace(/;/g, ", "),
    reason: [p.reason_for_didnt_fill, p.hof_ineligible_reason].filter(Boolean).join(", "),
    source: p.hs_analytics_source || "", path: pathText(world, facts, stage), stageSetBy: facts.setBy || "", stageChanges: facts.known ? facts.path.length : null,
    firstAt, hrsToFirst: firstAt ? hrs1(clock.workingBetween(assignedAt, firstAt)) : null, worked, justIn,
    attempts: atts.length, reached: reached.length, emails: emails.length, whatsapps: whatsapps.length, meetings: meetings.length,
    waDays: { applicable: wa.applicable, ok: wa.ok },
    deals: deals.map((d) => ({ id: d.id, name: d.name, cat: d.cat, stageLabel: d.stageLabel, createdAt: d.createdAt })),
    newDeals: newDeals.length, aiCandidate: SETTINGS.AI_STAGES.includes(stage) && !evidence.length && aiText.length > 0, aiText,
    checks: c,
  };
}

function buildContacts(world, ctx) {
  return [...world.contacts.keys()].map((id) => buildContact(world, id, ctx));
}

module.exports = { CONTACT_CHECKS, buildContacts, buildContact, stageFacts, ownedSince };
