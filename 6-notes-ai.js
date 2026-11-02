// 6-notes-ai.js — reads the call notes of leads that were NOT marked qualified, for plain
// signs the client did qualify ("eligible for NIW", "sent the fee structure"). These are
// listed for a person to review; they are never counted in anyone's score. Needs the
// GEMINI_KEY secret; without it this step is skipped and the report says so.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prompt(stageName, texts) {
  return `You audit an immigration consultancy's CRM. A sales consultant spoke to a lead, wrote the notes below, and set the lead stage to "${stageName}".

Notes (oldest first):
${texts.map((t) => `- ${String(t).replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}

Question: do the notes CLEARLY show that the client qualified for, or was being offered, an immigration programme (for example Canada or Australia PR, USA EB-2 NIW, Germany Opportunity Card, Spain, a visit visa or a work permit), so the lead stage should have been a qualified stage instead?

Answer yes only when the notes say so plainly, for example "eligible", "qualified for", "profile is good for NIW", "pitched NIW, he is interested", "sent fee structure", "will proceed", "deal". Notes about no answer, call back requests, weak profiles, low education, age, no interest or wrong numbers are a no. Do not guess.

Reply ONLY with JSON: {"qualified": true or false, "programme": "<short, or empty>", "reason": "<at most 15 words>"}`;
}

async function ask(text, attempt = 0) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${SETTINGS.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_KEY}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0 } }) });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(15000 * (attempt + 1)); return ask(text, attempt + 1); }
  if (!res.ok) { const e = new Error(`Gemini ${res.status}`); e.status = res.status; throw e; }
  const j = await res.json();
  const t = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text || "";
  const m = String(t).match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// Fair order: one lead from each consultant in turn, so stopping early (time or quota)
// never leaves one consultant read and another not.
function roundRobin(contacts) {
  const by = new Map();
  for (const c of contacts) { if (!by.has(c.ownerId)) by.set(c.ownerId, []); by.get(c.ownerId).push(c); }
  const lists = [...by.values()]; const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

async function readNotes(contacts, log = console.log) {
  const candidates = roundRobin(contacts.filter((c) => c.aiCandidate));
  const summary = { ran: false, candidates: candidates.length, read: 0, flagged: [], stoppedEarly: "", byConsultant: {} };
  if (!SETTINGS.AI_NOTES_CHECK) { summary.stoppedEarly = "switched off in config.js"; return summary; }
  if (!process.env.GEMINI_KEY) { summary.stoppedEarly = "no GEMINI_KEY secret"; return summary; }
  if (!candidates.length) { summary.ran = true; return summary; }
  summary.ran = true;
  const t0 = Date.now(); let failures = 0;
  const list = candidates.slice(0, SETTINGS.AI_MAX_CALLS);
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      if (Date.now() - t0 > SETTINGS.AI_MAX_MINUTES * 60e3) { summary.stoppedEarly = summary.stoppedEarly || `time limit (${SETTINGS.AI_MAX_MINUTES} minutes)`; return; }
      if (failures >= 8) { summary.stoppedEarly = summary.stoppedEarly || "Gemini kept refusing"; return; }
      const c = list[i++];
      try {
        const j = await ask(prompt(c.stageName, c.aiText));
        summary.read++;
        const b = summary.byConsultant[c.consultant] || (summary.byConsultant[c.consultant] = { read: 0, flagged: 0 });
        b.read++;
        if (j && j.qualified === true) { b.flagged++; summary.flagged.push({ contact: c, programme: String(j.programme || ""), reason: String(j.reason || "") }); }
      } catch (e) { failures++; }
      await sleep(250);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (candidates.length > list.length && !summary.stoppedEarly) summary.stoppedEarly = `limit of ${SETTINGS.AI_MAX_CALLS} leads`;
  log(`Notes read for possible missed qualifications: ${summary.read} of ${summary.candidates}${summary.stoppedEarly ? ` (stopped: ${summary.stoppedEarly})` : ""}; ${summary.flagged.length} to review`);
  return summary;
}

module.exports = { readNotes, prompt, roundRobin };
