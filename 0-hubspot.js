// 0-hubspot.js — reading HubSpot. Nothing is ever written.
//
// HubSpot allows five searches a second for the whole account (the other agents share
// that), so searches and reads are paced, and a busy moment is simply waited out.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throttle(rps) {
  let next = 0;
  return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / rps; if (at > now) await sleep(at - now); };
}
const gate = { search: throttle(SETTINGS.SEARCH_RPS), api: throttle(SETTINGS.API_RPS) };
const stats = { calls: 0, retries: 0 };

async function hs(method, path, body, kind = "api", attempt = 0) {
  await gate[kind]();
  stats.calls++;
  let res;
  try {
    res = await fetch(`https://api.hubapi.com${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (attempt < 6) { stats.retries++; await sleep(2000 * (attempt + 1)); return hs(method, path, body, kind, attempt + 1); }
    throw new Error(`Could not reach HubSpot: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 8) {
    stats.retries++;
    await sleep(Math.min(30000, 1500 * 2 ** attempt));
    return hs(method, path, body, kind, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 220)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : null;
}

// Run fn over items with at most n at a time (the pacing above still applies).
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// Every record matching `filters` with `dateProp` in [from, to). HubSpot will not page past
// 10,000 results in one search, so a window holding more is halved until each part fits —
// nothing is ever silently cut short.
async function searchByDate(obj, filters, dateProp, from, to, properties, depth = 0) {
  const group = (f, t) => [{ filters: [...filters,
    { propertyName: dateProp, operator: "GTE", value: String(f) },
    { propertyName: dateProp, operator: "LT", value: String(t) }] }];
  const probe = await hs("POST", `/crm/v3/objects/${obj}/search`, { filterGroups: group(from, to), properties: [dateProp], limit: 1 }, "search");
  const total = (probe && probe.total) || 0;
  if (!total) return [];
  if (total > 9800 && depth < 16 && to - from > 60e3) {
    const mid = Math.floor((from + to) / 2);
    return [...(await searchByDate(obj, filters, dateProp, from, mid, properties, depth + 1)),
      ...(await searchByDate(obj, filters, dateProp, mid, to, properties, depth + 1))];
  }
  const out = []; let after;
  for (let i = 0; i < 120; i++) {
    const r = await hs("POST", `/crm/v3/objects/${obj}/search`, {
      filterGroups: group(from, to), sorts: [{ propertyName: dateProp, direction: "ASCENDING" }],
      properties, limit: 100, after,
    }, "search");
    out.push(...((r && r.results) || []));
    after = r && r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  if (out.length < total) console.log(`  !! HubSpot said ${total} ${obj} in a window but ${out.length} were read`);
  return out;
}

// Associations, many records at once. HubSpot's batch size for this has changed over time,
// so it starts big and halves on refusal rather than assuming. A record with more links
// than one answer holds is paged to the end.
let assocBatch = 1000;
async function links(fromObj, toObj, ids) {
  const map = new Map();
  const list = [...new Set(ids.map(String))];
  for (let i = 0; i < list.length;) {
    const chunk = list.slice(i, i + assocBatch);
    let r;
    try {
      r = await hs("POST", `/crm/v4/associations/${fromObj}/${toObj}/batch/read`, { inputs: chunk.map((id) => ({ id })) });
    } catch (e) {
      if (e.status === 400 && assocBatch > 100) { assocBatch = Math.max(100, Math.floor(assocBatch / 2)); continue; }
      throw e;
    }
    for (const row of (r && r.results) || []) {
      const from = String(row.from && row.from.id);
      const to = new Set([...(map.get(from) || []), ...(row.to || []).map((t) => String(t.toObjectId))]);
      let after = row.paging && row.paging.next && row.paging.next.after;
      for (let p = 0; after && p < 50; p++) {
        const more = await hs("GET", `/crm/v4/objects/${fromObj}/${from}/associations/${toObj}?limit=500&after=${encodeURIComponent(after)}`);
        for (const t of (more && more.results) || []) to.add(String(t.toObjectId));
        after = more && more.paging && more.paging.next && more.paging.next.after;
      }
      map.set(from, [...to]);
    }
    i += chunk.length;
  }
  return map;
}

async function batchRead(obj, ids, properties, onPage) {
  const map = new Map();
  const list = [...new Set(ids.map(String))];
  for (let i = 0; i < list.length; i += 100) {
    const r = await hs("POST", `/crm/v3/objects/${obj}/batch/read`, { properties, inputs: list.slice(i, i + 100).map((id) => ({ id })) });
    for (const o of (r && r.results) || []) map.set(String(o.id), onPage ? onPage(o) : (o.properties || {}));
  }
  return map;
}

// One record with the full change history of some properties. (The batch version is known
// to cut history short, so these are read one at a time.)
async function history(obj, id, props) {
  try {
    const q = `properties=${props.join(",")}&propertiesWithHistory=${props.join(",")}`;
    const r = await hs("GET", `/crm/v3/objects/${obj}/${id}?${q}`);
    return (r && r.propertiesWithHistory) || {};
  } catch (e) {
    if (e.status === 404) return {};
    throw e;
  }
}

async function owners() {
  const list = []; let after;
  for (let i = 0; i < 20; i++) {
    const r = await hs("GET", `/crm/v3/owners?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    for (const o of (r && r.results) || []) list.push({
      ownerId: String(o.id), userId: o.userId != null ? String(o.userId) : "",
      name: `${o.firstName || ""} ${o.lastName || ""}`.replace(/\s+/g, " ").trim() || o.email || String(o.id),
      email: String(o.email || "").toLowerCase(),
    });
    after = r && r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return list;
}

// Deal stage and pipeline names. Stage names differ between pipelines, so they are read
// from HubSpot rather than assumed.
async function pipelines() {
  const r = await hs("GET", "/crm/v3/pipelines/deals");
  const stages = {}, names = {};
  for (const p of (r && r.results) || []) {
    names[String(p.id)] = p.label;
    for (const s of p.stages || []) stages[String(s.id)] = { label: s.label, pipelineId: String(p.id) };
  }
  return { stages, names };
}

async function options(obj, prop) {
  try {
    const p = await hs("GET", `/crm/v3/properties/${obj}/${prop}`);
    return Object.fromEntries((p.options || []).map((o) => [String(o.value), String(o.label || o.value).trim()]));
  } catch (e) { console.log(`  Could not read ${obj}.${prop}: ${e.message}`); return {}; }
}

const contactLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-1/${id}`;
const dealLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-3/${id}`;

module.exports = { hs, pool, searchByDate, links, batchRead, history, owners, pipelines, options, contactLink, dealLink, stats };
