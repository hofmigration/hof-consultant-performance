// 2-collect.js — reads everything the checks need, once, and tidies it into one picture:
// the contacts assigned to the consultants in the period, the deals they created, every
// call, email, WhatsApp, task, note and meeting on those contacts and deals, and the
// history of each lead stage and deal stage. Nothing is written to HubSpot.
const { SETTINGS } = require("./config");
const H = require("./0-hubspot");
const { ms, HOUR, DAY } = require("./1-clock");

// HubSpot's standard call outcomes, used if the portal's own list cannot be read.
const STANDARD_DISPOSITIONS = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
  "2e7360c1-6b71-40e9-ab2b-30ae98a4678c": "Meeting booked",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
};

// Sales stage names, as seen in the portal, used if HubSpot's pipeline list cannot be read
// (otherwise every deal would look open). HubSpot's own list always wins.
const KNOWN_STAGES = {
  "26699617": { "75652492": "Qualified Client", "60994695": "CCL Sent", "181063346": "Last Month Rollover", "60994696": "Expected Sales", "60994706": "Payment Made/Deal Won", "76664875": "Postpone (No Specific Date)", "75652493": "Deal Lost" },
  "642383975": { "947690584": "Qualified Client", "947690585": "CCL Sent", "947690586": "Last Month Rollover", "947690587": "Expected Sale", "947690588": "Payment Made/Deal Won", "947690589": "Postponed", "947690590": "Deal Lost" },
  "97449039": { "178346503": "Qualified Email Sent", "178346504": "Will think about", "178346505": "Expected Sale", "178346506": "Sales Closed", "178346507": "Postponed", "178346508": "Lost" },
  "647754380": { "953906998": "Discussion", "953906999": "Shared Quotation", "953907002": "Sales Closed/Payment Made", "953907003": "Deal Lost", "953907004": "Deal Postpone" },
  "818310187": { "1209885796": "Discussion", "1209885797": "Shared Quotation", "1209885798": "Rollover Client", "1209885799": "Expected Sale", "1209885801": "Deal Lost", "1209885802": "Deal Postpone" },
  "818882472": { "1209280116": "Discussion", "1209280117": "Shared Quotation", "1209280118": "Rollover Client", "1209280122": "Deal Postpone" },
  "97796183": { "179262211": "Consultation", "179262212": "Details sent", "179262213": "Expected Sale", "179262215": "Postponed", "179262216": "Sale closed", "179262217": "Deal Lost" },
};

const CONTACT_PROPS = ["firstname", "lastname", "email", "phone", "jobtitle", "hubspot_owner_id", "hubspot_owner_assigneddate",
  "createdate", "lead_stage", "outcome", "reason_for_didnt_fill", "hof_ineligible_reason", "age_range", "nationality",
  "hs_lead_status", "lifecyclestage", "hs_analytics_source", "num_associated_deals", "notes_last_contacted", "hs_is_unworked"];
const DEAL_PROPS = ["dealname", "dealstage", "pipeline", "hubspot_owner_id", "hs_created_by_user_id", "createdate", "closedate",
  "outcome", "age_range", "amount", "notes_last_contacted", "hs_lastmodifieddate"];
const PROPS = {
  calls: ["hs_timestamp", "hs_createdate", "hs_call_disposition", "hs_call_duration", "hs_call_status", "hubspot_owner_id", "hs_call_title", "hs_call_body"],
  emails: ["hs_timestamp", "hs_createdate", "hs_email_direction", "hs_email_status", "hs_email_subject", "hs_email_text", "hubspot_owner_id"],
  communications: ["hs_timestamp", "hs_createdate", "hs_communication_channel_type", "hs_communication_logged_from", "hubspot_owner_id"],
  tasks: ["hs_timestamp", "hs_createdate", "hs_task_status", "hs_task_subject", "hs_task_completion_date", "hubspot_owner_id", "hs_task_type"],
  notes: ["hs_timestamp", "hs_createdate", "hs_note_body", "hs_attachment_ids", "hubspot_owner_id"],
  meetings: ["hs_timestamp", "hs_createdate", "hs_meeting_start_time", "hs_meeting_outcome", "hs_meeting_title", "hubspot_owner_id"],
};
const TYPES = ["calls", "emails", "communications", "tasks", "notes", "meetings"];

// ---------- tidying (no network; tested in selftest.js) ----------
const strip = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

const PLACEHOLDER = /^(na|n\/a|n\.a\.?|none|nil|no|ok|done|-+|\.+|x+|call|called)$/i;
// "Call id : 5c3bba9e-…" is the dialler's own log, not something the consultant wrote.
const DIALLER = /call\s*id\s*:?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function realDescription(text) {
  const t = String(text || "").replace(DIALLER, " ").replace(/\bziwo call\b/gi, " ").replace(/\s+/g, " ").trim();
  return t.length >= 3 && !PLACEHOLDER.test(t) ? t : "";
}

const isComplianceNote = (text) => (/^\s*hi\s*@/i.test(text) && /\bkindly\b/i.test(text)) || /\[compliance\]/i.test(text) || /^\s*compliance check/i.test(text);
const sentOk = (status) => !/bounce|fail|cancel|error|schedul/i.test(String(status || ""));
const at = (p, ...keys) => { for (const k of keys) { const v = ms(p[k]); if (v) return v; } return 0; };

function normCall(id, p, dispo) {
  const outcome = dispo[p.hs_call_disposition] || STANDARD_DISPOSITIONS[p.hs_call_disposition] || (p.hs_call_disposition ? "Other" : "");
  const text = strip(p.hs_call_body || "").slice(0, 1500);
  return {
    id: String(id), at: at(p, "hs_timestamp", "hs_createdate"), ownerId: String(p.hubspot_owner_id || ""),
    outcome, reached: SETTINGS.REACHED_OUTCOMES.map((x) => x.toLowerCase()).includes(outcome.toLowerCase()),
    durationMs: Number(p.hs_call_duration || 0) || 0, status: p.hs_call_status || "", title: p.hs_call_title || "",
    text, description: realDescription(text),
  };
}
function normEmail(id, p) {
  const dir = String(p.hs_email_direction || "");
  return {
    id: String(id), at: at(p, "hs_timestamp", "hs_createdate"), ownerId: String(p.hubspot_owner_id || ""),
    out: dir === "EMAIL" || dir === "FORWARDED_EMAIL", ok: sentOk(p.hs_email_status), status: p.hs_email_status || "",
    subject: String(p.hs_email_subject || "").trim(), text: strip(p.hs_email_text || "").slice(0, 1200),
  };
}
function normComm(id, p) {
  const ch = String(p.hs_communication_channel_type || "").trim().toUpperCase();
  // Tolerant on purpose: a blank channel still counts. Matching the channel strictly once
  // threw away every logged WhatsApp and blamed consultants for work they had done.
  const isWhatsApp = /WHATS/.test(ch) || !ch || !/SMS|LINKEDIN/.test(ch);
  return { id: String(id), at: at(p, "hs_timestamp", "hs_createdate"), ownerId: String(p.hubspot_owner_id || ""), channel: ch || "(blank)", isWhatsApp };
}
function normTask(id, p) {
  const subject = String(p.hs_task_subject || "").trim();
  return {
    id: String(id), dueAt: ms(p.hs_timestamp), createdAt: ms(p.hs_createdate), completedAt: ms(p.hs_task_completion_date),
    status: String(p.hs_task_status || ""), done: /^completed$/i.test(String(p.hs_task_status || "")),
    subject, ownerId: String(p.hubspot_owner_id || ""),
    compliance: subject.toLowerCase().startsWith(SETTINGS.TASK_PREFIX.toLowerCase()),
  };
}
function normNote(id, p) {
  const body = String(p.hs_note_body || "");
  const text = strip(body).slice(0, 4000);
  return {
    id: String(id), at: at(p, "hs_timestamp", "hs_createdate"), ownerId: String(p.hubspot_owner_id || ""), text,
    hasImage: /<img\b/i.test(body) || !!String(p.hs_attachment_ids || "").trim(), compliance: isComplianceNote(text),
  };
}
function normMeeting(id, p) {
  return { id: String(id), at: at(p, "hs_meeting_start_time", "hs_timestamp", "hs_createdate"), ownerId: String(p.hubspot_owner_id || ""),
    outcome: String(p.hs_meeting_outcome || ""), title: String(p.hs_meeting_title || "") };
}
const NORM = { calls: normCall, emails: normEmail, communications: normComm, tasks: normTask, notes: normNote, meetings: normMeeting };

// History entries, oldest first: { value, at, sourceType, userId }
function parseHistory(list) {
  return (Array.isArray(list) ? list : []).map((h) => {
    let userId = h.updatedByUserId != null ? String(h.updatedByUserId) : "";
    if (!userId) { const m = /userId:(\d+)/.exec(String(h.sourceId || "")); if (m) userId = m[1]; }
    return { value: h.value == null ? "" : String(h.value), at: ms(h.timestamp), sourceType: String(h.sourceType || ""), userId };
  }).filter((h) => h.at).sort((a, b) => a.at - b.at);
}

// "Muhammad Shahzad" -> Muhammad Shahzad Fiaz. Every word typed must be in the name.
function matchConsultants(input, owners) {
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const terms = String(input || "").split(/[,;|\n]+/).map((t) => t.trim()).filter(Boolean);
  const found = [], problems = [];
  for (const term of terms) {
    if (/^\d+$/.test(term)) {
      const o = owners.find((x) => x.ownerId === term);
      if (o) { if (!found.some((f) => f.ownerId === o.ownerId)) found.push(o); } else problems.push(`No HubSpot user has the id ${term}.`);
      continue;
    }
    const tw = words(term);
    let hits = owners.filter((o) => tw.every((w) => words(o.name).includes(w)));
    if (hits.length > 1) { const exact = hits.filter((o) => words(o.name).join(" ") === tw.join(" ")); if (exact.length === 1) hits = exact; }
    if (!hits.length) problems.push(`No HubSpot user matches "${term}".`);
    else if (hits.length > 1) problems.push(`"${term}" matches ${hits.length} people (${hits.map((h) => h.name).join(", ")}). Type the full name.`);
    else if (!found.some((f) => f.ownerId === hits[0].ownerId)) found.push(hits[0]);
  }
  return { found, problems };
}

// ---------- reading ----------
async function linksSafe(from, to, ids, log) {
  const names = to === "communications" ? ["communications", "0-18"] : [to];
  let last;
  for (const n of names) {
    try { return { map: await H.links(from, n, ids), ok: true }; } catch (e) { last = e; }
  }
  log(`  !! could not read ${from} -> ${to} links (${last && last.message}). Checks that need them are left out.`);
  return { map: new Map(), ok: false };
}

async function collect({ period, now, consultantsInput, log = console.log }) {
  const t0 = Date.now();
  // 1. people, pipelines and labels
  let owners = [];
  try { owners = await H.owners(); } catch (e) { log(`  !! could not read HubSpot users: ${e.message}`); }
  if (!owners.length) owners = Object.entries(SETTINGS.KNOWN_CONSULTANTS).map(([ownerId, name]) => ({ ownerId, userId: ownerId, name, email: "" }));
  const { found, problems } = matchConsultants(consultantsInput || SETTINGS.DEFAULT_CONSULTANTS, owners);
  if (problems.length) throw new Error(problems.join(" "));
  if (!found.length) throw new Error("No consultants were chosen.");
  const consultants = found.map((o) => ({ ownerId: o.ownerId, userId: o.userId || o.ownerId, name: o.name, email: o.email }));
  const ownerName = Object.fromEntries(owners.map((o) => [o.ownerId, o.name]));
  const userToOwner = {};
  for (const o of owners) if (o.userId) userToOwner[o.userId] = o.ownerId;
  log(`Consultants: ${consultants.map((c) => `${c.name} (${c.ownerId})`).join(", ")}`);

  let pipes = { stages: {}, names: {} };
  try { pipes = await H.pipelines(); } catch (e) { log(`  !! could not read deal pipelines (${e.message}); using the stage names built in`); }
  for (const [pid, st] of Object.entries(KNOWN_STAGES)) for (const [sid, label] of Object.entries(st)) if (!pipes.stages[sid]) pipes.stages[sid] = { label, pipelineId: pid };
  const [dispoLive, leadLabels] = await Promise.all([H.options("calls", "hs_call_disposition"), H.options("contacts", "lead_stage")]);
  const dispo = { ...STANDARD_DISPOSITIONS, ...dispoLive };

  // 2. the contacts assigned in the period, and the deals created in it
  const ownerIds = consultants.map((c) => c.ownerId);
  const contactsRaw = await H.searchByDate("contacts", [{ propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds }],
    "hubspot_owner_assigneddate", period.start, period.end, CONTACT_PROPS);
  const contacts = new Map(contactsRaw.map((c) => [String(c.id), c.properties || {}]));
  log(`Contacts assigned in ${period.label}: ${contacts.size}`);

  const creatorIds = [...new Set(consultants.flatMap((c) => [c.userId, c.ownerId]).filter(Boolean))];
  const [byOwner, byCreator] = await Promise.all([
    H.searchByDate("deals", [{ propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds }], "createdate", period.start, period.end, DEAL_PROPS),
    H.searchByDate("deals", [{ propertyName: "hs_created_by_user_id", operator: "IN", values: creatorIds }], "createdate", period.start, period.end, DEAL_PROPS),
  ]);
  const deals = new Map();
  for (const d of [...byOwner, ...byCreator]) deals.set(String(d.id), d.properties || {});
  const periodDealIds = new Set(deals.keys());
  log(`Deals created in ${period.label}: ${periodDealIds.size}`);

  // 3. links between them
  const contactIds = [...contacts.keys()];
  const cDeals = await linksSafe("contacts", "deals", contactIds, log);
  const allDealIds = [...new Set([...periodDealIds, ...[...cDeals.map.values()].flat()])];
  const missingDeals = allDealIds.filter((id) => !deals.has(id));
  if (missingDeals.length) for (const [id, p] of await H.batchRead("deals", missingDeals, DEAL_PROPS)) deals.set(id, p);

  const dContacts = await linksSafe("deals", "contacts", [...periodDealIds], log);
  const extraContactIds = [...new Set([...dContacts.map.values()].flat())].filter((id) => !contacts.has(id));
  const extraContacts = extraContactIds.length ? await H.batchRead("contacts", extraContactIds, CONTACT_PROPS) : new Map();

  const links = { contacts: { deals: cDeals.map }, deals: { contacts: dContacts.map } };
  const available = { dealLinks: cDeals.ok, dealContacts: dContacts.ok };
  for (const type of TYPES) {
    const ids = type === "notes" || type === "calls" ? [...contactIds, ...extraContactIds] : contactIds;
    const [c, d] = [await linksSafe("contacts", type, ids, log), await linksSafe("deals", type, allDealIds, log)];
    links.contacts[type] = c.map; links.deals[type] = d.map;
    available[type] = c.ok && d.ok;
  }
  log(`Links read (${Math.round((Date.now() - t0) / 1000)}s)`);

  // 4. the calls, emails, WhatsApps, tasks, notes and meetings themselves
  const eng = {};
  for (const type of TYPES) {
    const ids = [...new Set([...links.contacts[type].values(), ...links.deals[type].values()].flat())];
    const norm = NORM[type];
    eng[type] = await H.batchRead(type, ids, PROPS[type], (o) => norm(o.id, o.properties || {}, dispo));
    log(`  ${type}: ${eng[type].size}`);
  }
  // emails to these leads whose plain text came back empty: read the HTML instead (for the
  // greeting check). Stripped as it arrives, so long HTML bodies are never kept.
  const ownerSet = new Set(ownerIds);
  const onContacts = new Set([...links.contacts.emails.values()].flat());
  const blank = [...eng.emails.values()].filter((e) => e.out && !e.text && ownerSet.has(e.ownerId) && onContacts.has(e.id) && e.at >= period.start - 2 * DAY).map((e) => e.id).slice(0, 3000);
  if (blank.length) {
    const html = await H.batchRead("emails", blank, ["hs_email_html"], (o) => strip((o.properties || {}).hs_email_html || "").slice(0, 1200));
    for (const [id, text] of html) { const e = eng.emails.get(id); if (e) e.text = text; }
  }

  // 5. how each lead stage and deal stage moved
  const contactHistory = new Map(), dealHistory = new Map();
  let historyFailed = 0;
  await H.pool(contactIds, 8, async (id) => {
    try { const h = await H.history("contacts", id, ["lead_stage", "hubspot_owner_id"]); contactHistory.set(id, { lead_stage: parseHistory(h.lead_stage), owner: parseHistory(h.hubspot_owner_id) }); }
    catch (e) { historyFailed++; }
  });
  await H.pool([...periodDealIds], 8, async (id) => {
    try {
      const h = await H.history("deals", id, ["dealstage", "pipeline", "hubspot_owner_id"]);
      dealHistory.set(id, { dealstage: parseHistory(h.dealstage), pipeline: parseHistory(h.pipeline), hubspot_owner_id: parseHistory(h.hubspot_owner_id) });
    } catch (e) { historyFailed++; }
  });
  if (historyFailed) log(`  !! stage history could not be read for ${historyFailed} records`);
  log(`Read in ${Math.round((Date.now() - t0) / 1000)}s with ${H.stats.calls} HubSpot requests (${H.stats.retries} retried)`);

  return {
    period, now, consultants, ownerName, userToOwner, pipes, dispo, leadLabels,
    contacts, extraContacts, deals, periodDealIds, links, eng, contactHistory, dealHistory,
    available, historyFailed,
  };
}

module.exports = { collect, matchConsultants, parseHistory, strip, realDescription, isComplianceNote, normCall, normEmail, normComm, normTask, normNote, normMeeting, STANDARD_DISPOSITIONS, TYPES };
