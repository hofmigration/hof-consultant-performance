// selftest.js — every rule, tried on invented records before the real review runs. If a
// rule breaks, this fails and the review does not go out. No network: nothing here talks
// to HubSpot, Gemini or Resend.
const { SETTINGS } = require("./config");
const { makeClock, resolvePeriod, fmtShort, HOUR, DAY } = require("./1-clock");
const C2 = require("./2-collect");
const R = require("./3-rules");
const { buildContact, ownedSince, CONTACT_CHECKS } = require("./4-contacts");
const { buildDeal, DEAL_CHECKS } = require("./5-deals");
const { roundRobin, readNotes } = require("./6-notes-ai");
const { score } = require("./7-score");
const { buildEmail, fitEmail, MAX_BYTES, shortOf } = require("./9-email");

let passed = 0, failed = 0;
const t = (name, cond, extra = "") => { if (cond) passed++; else { failed++; console.log(`FAIL  ${name}${extra ? `  (${extra})` : ""}`); } };
const at = (s) => Date.parse(s.length <= 16 ? `${s}:00+05:00` : s);   // "2026-10-12T10:00" is Pakistan time
const clock = makeClock();

// ---------- the clock and the period ----------
t("Friday 3pm + 24 working hours = Monday 3pm", clock.deadline(at("2026-10-16T15:00")) === at("2026-10-19T15:00"));
t("Monday 3pm + 24 = Tuesday 3pm", clock.deadline(at("2026-10-19T15:00")) === at("2026-10-20T15:00"));
t("Saturday counts from Monday morning", clock.deadline(at("2026-10-17T11:00")) === at("2026-10-20T00:00"));
t("Holiday 2 Dec is skipped", clock.deadline(at("2026-12-01T10:00")) === at("2026-12-04T10:00"));
t("working hours Friday 3pm to Monday 3pm = 24", clock.workingBetween(at("2026-10-16T15:00"), at("2026-10-19T15:00")) === 24 * HOUR);
const p3 = resolvePeriod("Previous 3 months", "", "", at("2026-11-02T15:00"));
t("previous 3 months from 2 Nov = 1 Aug to 1 Nov", p3.start === at("2026-08-01T00:00") && p3.end === at("2026-11-01T00:00"), `${new Date(p3.start).toISOString()} ${new Date(p3.end).toISOString()}`);
t("period label", p3.label === "Aug to Oct 2026", p3.label);
const p1 = resolvePeriod("Previous month", "", "", at("2026-11-02T15:00"));
t("previous month = October", p1.start === at("2026-10-01T00:00") && p1.end === at("2026-11-01T00:00") && p1.label === "October 2026", p1.label);
const p2 = resolvePeriod("Previous 2 months", "", "", at("2026-01-10T09:00"));
t("previous 2 months across a new year", p2.start === at("2025-11-01T00:00") && p2.end === at("2026-01-01T00:00") && p2.label === "Nov to Dec 2025", p2.label);
const pc = resolvePeriod("Custom dates", "2026-09-01", "2026-09-15", at("2026-11-02T15:00"));
t("custom dates include the last day", pc.start === at("2026-09-01T00:00") && pc.end === at("2026-09-16T00:00") && pc.label === "1 Sep to 15 Sep 2026", pc.label);
let threw = false; try { resolvePeriod("Custom dates", "2026-09-15", "", at("2026-11-02T15:00")); } catch { threw = true; }
t("custom dates without an end are refused", threw);
threw = false; try { resolvePeriod("Custom dates", "2026-09-15", "2026-09-01", at("2026-11-02T15:00")); } catch { threw = true; }
t("custom dates the wrong way round are refused", threw);

// ---------- names ----------
const owners = [
  { ownerId: "84648486", userId: "84648486", name: "Muhammad Shahzad Fiaz" }, { ownerId: "83210660", userId: "83210660", name: "Muhammad Diean" },
  { ownerId: "84172062", userId: "84172062", name: "Fatima Zahid" }, { ownerId: "84172061", userId: "84172061", name: "Ayesha Zahid" },
  { ownerId: "331190099", userId: "49743897", name: "Ayesha Anum" }, { ownerId: "90507249", userId: "90507249", name: "Muhammad Hanzla" },
];
let m = C2.matchConsultants(SETTINGS.DEFAULT_CONSULTANTS, owners);
t("the four default names resolve", m.found.map((o) => o.ownerId).join() === "84648486,83210660,84172062,84172061" && !m.problems.length, JSON.stringify(m.problems));
m = C2.matchConsultants("Ayesha", owners);
t("an ambiguous name is refused", m.problems.length === 1 && /2 people/.test(m.problems[0]));
m = C2.matchConsultants("84172061, nobody here", owners);
t("ids work and unknown names are reported", m.found.length === 1 && m.problems.length === 1);
t("short names", shortOf("Muhammad Shahzad Fiaz") === "Shahzad" && shortOf("Fatima Zahid") === "Fatima");

// ---------- tidying ----------
t("dialler call id is not a description", C2.realDescription("Call id : 5c3bba9e-5506-4235-aa64-b2d0723e58b4") === "");
t("'na' is not a description", C2.realDescription("na") === "");
t("a real note is a description", C2.realDescription("call back after 5 pm KSA time") !== "");
t("html note is read", C2.strip('<p>Age 26 &amp; married</p>') === "Age 26 & married");
const note = C2.normNote("1", { hs_note_body: '<div><img src="https://api.hubspot.com/filemanager/x"></div>', hs_timestamp: "2026-10-01T10:00:00Z" });
t("screenshot note is seen", note.hasImage && note.text === "");
t("compliance note recognised", C2.isComplianceNote("Hi @Fatima Zahid, kindly log the call on the deal"));
const comm = C2.normComm("1", { hs_communication_channel_type: "", hs_timestamp: "2026-10-01T10:00:00Z" });
t("WhatsApp with a blank channel still counts", comm.isWhatsApp);
t("SMS is not WhatsApp", !C2.normComm("2", { hs_communication_channel_type: "SMS" }).isWhatsApp);
const hist = C2.parseHistory([{ value: "Ineligible", timestamp: "2026-10-12T09:00:00Z", sourceType: "CRM_UI", sourceId: "userId:83210660" }, { value: "No Answer", timestamp: "2026-10-11T09:00:00Z", updatedByUserId: 99 }]);
t("history is read oldest first with the user", hist[0].value === "No Answer" && hist[0].userId === "99" && hist[1].userId === "83210660");
t("owner set again: ownership started earlier", ownedSince([{ value: "1", at: 10 }, { value: "5", at: 20 }, { value: "5", at: 30 }], "5") === 20);
t("owner changed away: no ownership", ownedSince([{ value: "5", at: 20 }, { value: "6", at: 30 }], "5") === null);

// ---------- calls and follow-up ----------
const call = (iso, outcome, extra = {}) => ({ id: iso + outcome, at: at(iso), ownerId: "1", outcome, reached: SETTINGS.REACHED_OUTCOMES.includes(outcome), description: "", text: "", ...extra });
let atts = R.attempts([call("2026-10-12T10:00", "Busy"), call("2026-10-12T10:01", "No answer"), call("2026-10-12T15:00", "No answer")]);
t("dialler copy + manual log one minute apart = one attempt", atts.length === 2);
atts = R.attempts([call("2026-10-12T10:00", "Connected", { description: "" }), call("2026-10-12T10:02", "Connected", { description: "call back at 3pm" })]);
t("the attempt has the description from either copy", atts.length === 1 && atts[0].reached && atts[0].description === "call back at 3pm");
const days = R.unansweredDays(R.attempts([call("2026-10-12T10:00", "No answer"), call("2026-10-13T11:00", "No answer"), call("2026-10-13T16:00", "Connected"), call("2026-10-14T09:00", "Busy")]));
t("a day with a connected call needs no follow-up", days.length === 2 && fmtShort(days[1].day) === "14 Oct");
const now = at("2026-11-02T15:00");
let f = R.followUp(days, [{ at: at("2026-10-12T09:55") }, { at: at("2026-10-16T12:00") }], clock, now);
t("a message minutes before the call that day counts; one 2 days later is late", f.ok === 1 && f.late.length === 1, JSON.stringify(f));
f = R.followUp(days, [{ at: at("2026-10-30T12:00") }], clock, now);
t("a message weeks later is missing, not late", f.missing.length === 2 && !f.late.length);
f = R.followUp(R.unansweredDays(R.attempts([call("2026-11-02T10:00", "No answer")])), [], clock, now);
t("not due yet is not counted", f.applicable === 0 && f.pending === 1);

// ---------- tasks ----------
const task = (over) => ({ id: "x", dueAt: at("2026-11-05T10:00"), done: false, compliance: false, subject: "call", completedAt: 0, ...over });
t("an open task in the future passes", R.followUpTask([task()], now).ok);
t("[Compliance] tasks never count", !R.followUpTask([task({ compliance: true })], now).ok);
t("only completed tasks fail", !R.followUpTask([task({ done: true, completedAt: at("2026-10-01T10:00") })], now).ok);
t("an open task 1 day overdue is still fine", R.followUpTask([task({ dueAt: at("2026-11-01T10:00") })], now).ok);
t("an open task 10 days overdue fails", /overdue by/.test(R.followUpTask([task({ dueAt: at("2026-10-23T10:00") })], now).detail));

// ---------- emails ----------
const mail = (text, subject = "Your inquiry") => ({ text, subject });
t("greeting with the client's name passes", !R.emailProblems(mail("Hi Kashif Javaid, I hope you're doing well"), "Kashif Javaid").length);
t("greeting a spouse by name passes", !R.emailProblems(mail("Hi Kiran, I hope you are doing well."), "Saad Malik").length);
t("'Dear Valued Applicants' fails", R.emailProblems(mail("Dear Valued Applicants, Every once in a while"), "Hem shrestha").length === 1);
t("bare 'Hi,' fails", R.emailProblems(mail("Hi, please find the details below"), "Ali Khan").length === 1);
t("'Dear Sir' fails", R.emailProblems(mail("Dear Sir, thank you for your inquiry"), "Ali Khan").length === 1);
t("'Dear Mr. Kamran' passes", !R.emailProblems(mail("Dear Mr. Kamran, welcome"), "Muhammad Kamran").length);
t("a placeholder fails", R.emailProblems(mail("Hi {{contact.firstname}}, welcome"), "Ali Khan").length >= 1);
t("no greeting at all is not flagged", !R.emailProblems(mail("Are you considering new horizons for your career?"), "Ali Khan").length);

// ---------- deal stages ----------
t("Qualified Client is open", R.dealCategory("26699617", "Qualified Client") === "OPEN");
t("Qualified Email Sent (Visit) is open", R.dealCategory("97449039", "Qualified Email Sent") === "OPEN");
t("Deal Postpone (Germany) is postponed", R.dealCategory("818310187", "Deal Postpone") === "POSTPONED");
t("Postpone (No Specific Date) is postponed", R.dealCategory("26699617", "Postpone (No Specific Date)") === "POSTPONED");
t("Lost (Visit) is lost", R.dealCategory("97449039", "Lost") === "LOST");
t("Rollover Client is rollover", R.dealCategory("818882472", "Rollover Client") === "ROLLOVER");
t("Sales Closed/Payment Made is won", R.dealCategory("647754380", "Sales Closed/Payment Made") === "WON");
t("any service pipeline means won and handed over", R.dealCategory("149481597", "Petition Preparation ") === "SERVICE");
t("Referral pipeline is not checked", R.dealCategory("63111503", "Contract Signed/Enrolled") === "OTHER");

// ---------- notes ----------
t("real client details note is recognised", R.looksLikeClientDetails("Age 40 Edu B tech 4 years electrical 2011 Exp 16 years Position: shift Eng KSA 3 years"));
t("real client details note 2", R.looksLikeClientDetails("37 Pakistan (Lahore) Pharmacist Bachelors (2012) 7 years as medical auditor in Kuwait 2 years in Pak"));
t("a short note is not client details", !R.looksLikeClientDetails("call back tomorrow"));
t("a fee note is payment proof", R.looksLikePaymentProof("VAT INCLUSIVE | Fees | Deposit | Due Date | 11,000 11,000 UP"));
t("a chat note is not payment proof", !R.looksLikePaymentProof("Client will pay next week"));

// ---------- a small invented HubSpot, for the contact and deal checks ----------
function makeWorld() {
  const w = {
    ownerName: { "1": "Consultant One", "2": "Consultant Two", "9": "Case Manager" }, userToOwner: { "1": "1", "2": "2", "9": "9" },
    pipes: { names: {}, stages: {
      "75652492": { label: "Qualified Client", pipelineId: "26699617" }, "76664875": { label: "Postpone (No Specific Date)", pipelineId: "26699617" },
      "75652493": { label: "Deal Lost", pipelineId: "26699617" }, "181063346": { label: "Last Month Rollover", pipelineId: "26699617" },
      "947690584": { label: "Qualified Client", pipelineId: "642383975" }, "947690588": { label: "Payment Made/Deal Won", pipelineId: "642383975" },
      "253513090": { label: "Welcome Call", pipelineId: "149481597" } } },
    leadLabels: { "Qualified": "Qualified CAN", "Call Back": "Schedule Call Back" },
    contacts: new Map(), extraContacts: new Map(), deals: new Map(), periodDealIds: new Set(),
    links: { contacts: { deals: new Map() }, deals: { contacts: new Map() } },
    eng: {}, contactHistory: new Map(), dealHistory: new Map(), available: { communications: true },
  };
  for (const ty of C2.TYPES) { w.eng[ty] = new Map(); w.links.contacts[ty] = new Map(); w.links.deals[ty] = new Map(); }
  return w;
}
const link = (w, from, id, type, eid) => { const mm = w.links[from][type]; mm.set(id, [...(mm.get(id) || []), eid]); };
let seq = 0;
function addEng(w, type, obj, contactId, dealId) {
  const id = `e${++seq}`; w.eng[type].set(id, { id, ...obj });
  if (contactId) link(w, "contacts", contactId, type, id);
  if (dealId) link(w, "deals", dealId, type, id);
  return id;
}
const consultants = [{ ownerId: "1", userId: "1", name: "Consultant One" }, { ownerId: "2", userId: "2", name: "Consultant Two" }];
const ctx = { clock, now, period: p3, consultants };
const contact = (w, id, props) => w.contacts.set(id, { firstname: "Ali", lastname: "Khan", hubspot_owner_id: "1", hubspot_owner_assigneddate: "2026-10-12T05:00:00Z", createdate: "2026-10-12T04:00:00Z", ...props });
const callE = (iso, outcome, desc = "") => ({ at: at(iso), ownerId: "1", outcome, reached: SETTINGS.REACHED_OUTCOMES.includes(outcome), text: desc, description: desc });
const deal = (w, id, props, contactId) => { w.deals.set(id, { dealname: `Deal ${id}`, hubspot_owner_id: "1", hs_created_by_user_id: "1", age_range: "18-32", ...props }); if (contactId) { link(w, "contacts", contactId, "deals", id); link(w, "deals", id, "contacts", contactId); } };

let w = makeWorld();
contact(w, "c1", { lead_stage: "Ineligible" });
w.contactHistory.set("c1", { lead_stage: [{ value: "Ineligible", at: at("2026-10-12T11:00"), sourceType: "CRM_UI", userId: "1" }], owner: [] });
let c = buildContact(w, "c1", ctx);
t("never contacted: worked fails", c.checks.worked.r === "fail" && c.checks.first24.r === "fail");
t("marked Ineligible with no contact fails", c.checks.closedContact.r === "fail");
t("Ineligible with no reason fails", c.checks.reason.r === "fail");
w.contacts.get("c1").outcome = "No Education";
t("Ineligible with 'No Education' as the Outcome has a reason", buildContact(w, "c1", ctx).checks.reason.r === "pass");
w.contactHistory.set("c1", { lead_stage: [{ value: "Ineligible", at: at("2026-10-12T10:05"), sourceType: "AUTOMATION_PLATFORM", userId: "" }], owner: [] });
t("a stage set by a workflow is not the consultant's", buildContact(w, "c1", ctx).checks.closedContact.r === "na");

w = makeWorld();
contact(w, "c2", { lead_stage: "No Answer", outcome: "No Answer (WBZ)" });
addEng(w, "calls", callE("2026-10-12T11:00", "No answer"), "c2");
addEng(w, "calls", callE("2026-10-14T11:00", "Connected", "he is interested in NIW"), "c2");
c = buildContact(w, "c2", ctx);
t("No Answer after a connected call fails", c.checks.stageCalls.r === "fail" && /Connected/.test(c.checks.stageCalls.d));
t("first contact within 24 working hours passes", c.checks.first24.r === "pass");
t("calls but no email fails", c.checks.email.r === "fail");
t("unanswered day with no WhatsApp fails", c.checks.whatsapp.r === "fail");
t("live No Answer lead with no task fails", c.checks.task.r === "fail");
addEng(w, "communications", { at: at("2026-10-12T11:30"), ownerId: "1", isWhatsApp: true, channel: "WHATS_APP" }, "c2");
addEng(w, "emails", { at: at("2026-10-12T11:40"), ownerId: "1", out: true, ok: false, subject: "Missed call", text: "Hi Ali, I tried calling" }, "c2");
c = buildContact(w, "c2", ctx);
t("WhatsApp 30 minutes after the call passes", c.checks.whatsapp.r === "pass");
t("a bounced email is still not 'email sent'", c.checks.email.r === "fail" && /bounced/.test(c.checks.email.d));

w = makeWorld();
contact(w, "c3", { lead_stage: "They Didn't Fill", reason_for_didnt_fill: "Didn't fill the form", outcome: "Opportunity" });
addEng(w, "calls", callE("2026-10-12T11:00", "Connected", "interested, sent fee structure"), "c3");
deal(w, "d3", { pipeline: "26699617", dealstage: "75652492", createdate: "2026-10-13T08:00:00Z", closedate: "2026-11-30T00:00:00Z" }, "c3");
addEng(w, "calls", callE("2026-10-15T11:00", "No answer"), "c3", "d3");
c = buildContact(w, "c3", ctx);
t("got a deal but marked They Didn't Fill fails", c.checks.qualifiedMarked.r === "fail");
t("follow-up after the deal is not checked on the contact", c.checks.whatsapp.r === "na");
let d = buildDeal(w, "d3", ctx);
t("…it is checked on the deal instead", d.checks.noAnswerWhatsapp.r === "fail" && d.checks.noAnswerEmail.r === "fail");
t("Outcome without Deal Created fails", d.checks.outcome.r === "fail");
t("no task on an open deal fails", d.checks.task.r === "fail");
t("no client details anywhere fails", d.checks.details.r === "fail");
addEng(w, "notes", { at: at("2026-10-13T09:00"), ownerId: "1", text: "Age 31 Bachelors in electrical engineering 9 years of experience married", hasImage: false, compliance: false }, "c3");
t("client details only on the contact fail", buildDeal(w, "d3", ctx).checks.details.r === "fail" && /on the contact/.test(buildDeal(w, "d3", ctx).checks.details.d));
addEng(w, "notes", { at: at("2026-10-13T09:00"), ownerId: "1", text: "Age 31 Bachelors in electrical engineering 9 years of experience married", hasImage: false, compliance: false }, null, "d3");
t("client details on the deal pass", buildDeal(w, "d3", ctx).checks.details.r === "pass");

w = makeWorld();
contact(w, "c4", { lead_stage: "Qualified" });
w.contactHistory.set("c4", { lead_stage: [{ value: "Qualified", at: at("2026-10-14T10:00"), sourceType: "CRM_UI", userId: "1" }], owner: [] });
addEng(w, "calls", callE("2026-10-12T11:00", "Connected", "eligible for Canada"), "c4");
c = buildContact(w, "c4", ctx);
t("qualified for weeks with no deal fails", c.checks.dealCreated.r === "fail");
t("qualified with no deal is a live lead needing a task", c.checks.task.r === "fail");
c = buildContact(w, "c4", { ...ctx, now: at("2026-10-15T10:00") });
t("qualified yesterday: no deal yet is fine", c.checks.dealCreated.r === "na");

w = makeWorld();
contact(w, "c5", { lead_stage: "USA NIW", outcome: "Deal Created;Deal Won", nationality: "Pakistani" });
deal(w, "d5", { pipeline: "149481597", dealstage: "253513090", createdate: "2026-10-13T08:00:00Z", hubspot_owner_id: "9", hs_created_by_user_id: "1" }, "c5");
addEng(w, "calls", callE("2026-10-12T11:00", "Connected", "pitched NIW"), "c5", "d5");
c = buildContact(w, "c5", ctx);
t("won but lead stage not Sale fails", c.checks.saleMarked.r === "fail");
d = buildDeal(w, "d5", ctx);
t("a deal handed to a case manager stays with the consultant who created it", d && d.consultant === "Consultant One");
t("won with no proof of payment fails", d.checks.payment.r === "fail");
addEng(w, "notes", { at: at("2026-10-13T09:00"), ownerId: "1", text: "", hasImage: true, compliance: false }, null, "d5");
t("a screenshot note on a won deal counts as proof", buildDeal(w, "d5", ctx).checks.payment.r === "pass");
t("Outcome keeping Deal Created passes", d.checks.outcome.r === "pass");
t("a won deal has no close-date or task check", d.checks.closeDate.r === "na" && d.checks.task.r === "na");

w = makeWorld();
contact(w, "c6", { lead_stage: "USA NIW", outcome: "Deal Created;Deal Postponed", nationality: "Indian", owner: "1" });
deal(w, "d6", { pipeline: "26699617", dealstage: "76664875", createdate: "2026-09-01T08:00:00Z", closedate: "2026-10-20T00:00:00Z", outcome: "Opportunity" }, "c6");
w.periodDealIds.add("d6");
d = buildDeal(w, "d6", ctx);
t("postponed with 'Opportunity' as the reason fails", d.checks.reason.r === "fail");
t("close date 13 days ago fails", d.checks.closeDate.r === "fail");
t("USA NIW lead with a deal in the Canada pipeline fails", d.checks.pipeline.r === "fail");
w.deals.get("d6").outcome = "Opportunity;Cannot Afford At This Time";
w.deals.get("d6").closedate = "2026-10-31T09:00:00Z";
d = buildDeal(w, "d6", ctx);
t("a real reason next to Opportunity passes", d.checks.reason.r === "pass");
t("a close date 2 days ago is within the grace", d.checks.closeDate.r === "pass");

w = makeWorld();
contact(w, "c7", { lead_stage: "Qualified" });
deal(w, "d7", { pipeline: "26699617", dealstage: "75652492", createdate: "2026-09-03T08:00:00Z", closedate: "2026-11-30T00:00:00Z" }, "c7");
w.dealHistory.set("d7", { dealstage: [{ value: "75652492", at: at("2026-09-03T13:00") }, { value: "181063346", at: at("2026-09-20T10:00") }, { value: "75652492", at: at("2026-09-22T10:00") }], pipeline: [], hubspot_owner_id: [] });
d = buildDeal(w, "d7", ctx);
t("Last Month Rollover in the month the deal was created fails", d.checks.rollover.r === "fail");
t("an open deal untouched for 40 days fails", d.checks.stuck.r === "fail");
w.dealHistory.set("d7", { dealstage: [{ value: "75652492", at: at("2026-09-03T13:00") }, { value: "181063346", at: at("2026-10-01T10:00") }], pipeline: [], hubspot_owner_id: [] });
t("rollover the next month passes", buildDeal(w, "d7", ctx).checks.rollover.r === "pass");
deal(w, "d8", { pipeline: "26699617", dealstage: "75652492", createdate: "2026-10-01T08:00:00Z", hubspot_owner_id: "1", hs_created_by_user_id: "77" });
t("a deal someone else created for the consultant counts for the owner", buildDeal(w, "d8", ctx).consultant === "Consultant One");
deal(w, "d9", { pipeline: "26699617", dealstage: "75652492", createdate: "2026-10-01T08:00:00Z", hubspot_owner_id: "77", hs_created_by_user_id: "77" });
t("a deal by someone else for someone else is left out", buildDeal(w, "d9", ctx) === null);

// owner set again after the consultant had started
w = makeWorld();
contact(w, "c10", { lead_stage: "Wrong Number", outcome: "Opportunity", hubspot_owner_assigneddate: "2026-10-13T13:30:00Z" });
w.contactHistory.set("c10", { lead_stage: [], owner: [{ value: "1", at: at("2026-10-12T10:00"), sourceType: "", userId: "" }, { value: "1", at: at("2026-10-13T18:30"), sourceType: "", userId: "" }] });
addEng(w, "calls", callE("2026-10-12T11:00", "Wrong number"), "c10");
c = buildContact(w, "c10", ctx);
t("work done before HubSpot's latest assigned date counts", c.checks.first24.r === "pass" && c.attempts === 1 && /set again/.test(c.reassigned));

// ---------- scores ----------
const recs = [{ ownerId: "1", checks: { worked: { r: "pass" }, first24: { r: "fail" }, stage: { r: "na" } }, waDays: { applicable: 0, ok: 0 }, attempts: 0, reached: 0, emails: 0, whatsapps: 0, group: "blank", newDeals: 0, justIn: false }];
const sc = score(recs, [], [consultants[0]], null);
t("checks that did not apply count neither way", sc.people[0].contactPct === 50, String(sc.people[0].contactPct));

// ---------- reading notes (no network: a pretend Gemini) ----------
const rr = roundRobin([{ ownerId: "a", n: 1 }, { ownerId: "a", n: 2 }, { ownerId: "b", n: 3 }]);
t("notes are read one consultant at a time, in turn", rr.map((x) => x.n).join() === "1,3,2");

// ---------- the email ----------
w = makeWorld();
contact(w, "c11", { lead_stage: "No Answer" });
addEng(w, "calls", callE("2026-10-12T11:00", "No answer"), "c11");
const cs = [buildContact(w, "c11", ctx), buildContact(w, "c11", { ...ctx })];
cs[1].ownerId = "2"; cs[1].consultant = "Consultant Two";
const rep = { period: p3, now, consultants, contacts: cs, deals: [], ai: { ran: false, flagged: [], stoppedEarly: "no GEMINI_KEY secret" }, warnings: [] };
rep.scores = score(rep.contacts, rep.deals, consultants, rep.ai);
const html = fitEmail(rep);
t("email fits under Gmail's clipping limit", Buffer.byteLength(html) <= MAX_BYTES);
t("no em dashes in the email", !/—/.test(html.replace(/<[^>]+>/g, "")));
t("email never says the checks are automated", !/automat/i.test(html));
t("numbers use the soft Century Gothic font", /Century Gothic/.test(html));
t("the grey background is on a wrapper table", /bgcolor="#f3f4f6"/.test(html));
t("the period is in the email", html.includes("Aug to Oct 2026"));
t("the 85% target is shown", html.includes(`${SETTINGS.TARGET_PCT}% target`));

(async () => {
  // the AI step with a pretend Gemini: one lead whose notes plainly say qualified
  const real = global.fetch;
  process.env.GEMINI_KEY = "test";
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"qualified": true, "programme": "USA NIW", "reason": "pitched NIW, client interested"}' }] } }] }) });
  const sum = await readNotes([{ ownerId: "1", consultant: "Consultant One", stageName: "No Answer", aiCandidate: true, aiText: ["pitched NIW, he is interested, sent fee"] }], () => {});
  global.fetch = real; delete process.env.GEMINI_KEY;
  t("notes that read as qualified are listed for review", sum.ran && sum.flagged.length === 1);
  const off = await readNotes([{ ownerId: "1", aiCandidate: true, aiText: ["x"] }], () => {});
  t("without a GEMINI_KEY the notes are not read", !off.ran && /GEMINI_KEY/.test(off.stoppedEarly));

  // the workbook builds with every tab
  try {
    const { buildWorkbook } = require("./8-workbook");
    const wb = await buildWorkbook(rep);
    const names = wb.worksheets.map((s) => s.name);
    t("workbook has every tab", ["Summary", "Scorecard", "Contacts", "Deals", "Issues", "Never worked", "Qualification", "How it was checked"].every((x) => names.includes(x)), names.join(", "));
    t("a tab for each consultant", names.includes("Consultant One") && names.includes("Consultant Two"));
    let dash = false;
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string" && cell.value.includes("—")) dash = true; })));
    t("no em dashes in the workbook", !dash);
  } catch (e) { t("workbook builds", false, e.message); }

  t("every check has a label", [...CONTACT_CHECKS, ...DEAL_CHECKS].every((x) => x.key && x.short && x.label && x.area));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
