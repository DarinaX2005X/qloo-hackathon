// Package Q (stage 09): shared helpers for live HTTP / SSE acceptance checks.
// Reads frozen inputs from tasks/09-qa, writes evidence only outside the repo.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const BASE = process.env.BASE_URL || 'http://localhost:3001';
export const QA_DIR = process.env.QA_DIR || 'C:/Users/user/Desktop/qloo/tasks/09-qa';
/** Q runs as its own client: localhost requests otherwise share one rate bucket ("unknown" IP) with every other agent.
 * Each process uses a distinct documentation-range address, like a separate person would. */
export const CLIENT_IP = process.env.QA_CLIENT_IP || `198.51.100.${1 + (process.pid % 250)}`;
export const PROJECT = process.env.PROJECT_DIR || 'C:/Users/user/Desktop/qloo/project';

/** Content hash of project/src: the "revision" every defect and result is tied to (no git in this project). */
export function srcRevision() {
  const root = join(PROJECT, 'src');
  const files = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else files.push(p); } };
  walk(root);
  files.sort();
  const h = createHash('sha1');
  let newest = 0;
  for (const f of files) { h.update(relative(root, f)); h.update(readFileSync(f)); newest = Math.max(newest, statSync(f).mtimeMs); }
  return { rev: h.digest('hex').slice(0, 10), files: files.length, newestSrcChange: new Date(newest).toISOString() };
}

export const frozen = JSON.parse(readFileSync(join(QA_DIR, 'frozen-inputs.json'), 'utf8'));
export function profile(name) {
  const p = frozen.profiles.find(x => x.name === name);
  if (!p) throw new Error(`No frozen profile ${name}`);
  return p;
}
export function love(l, weight = 1) {
  const chosen = { id: l.entity.id, name: l.entity.name, domain: l.entity.domain };
  return { query: l.query, chosen, candidates: [chosen], weight };
}
/** ExploreState with exact frozen entity IDs. */
export function stateFor(profileName, city, extra = {}) {
  const p = profileName ? profile(profileName) : { loves: [] };
  return { city, loves: p.loves.map(l => love(l)), refinements: [], discovery: 0.35, days: 1, pace: 'relaxed', startHour: 9, ...extra };
}

let revisionCounter = 1;
export const rateWaits = [];
/** Body that satisfies both the legacy shape (state at top level) and the v2 shape ({state, stateRevision}). */
export function hybrid(state, extra = {}) {
  return { ...state, responseVersion: 2, state, stateRevision: revisionCounter++, constraints: [], ...extra };
}

export async function call(method, path, body, { timeout = 90_000 } = {}) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await fetch(new URL(path, BASE), {
        method, signal: ctrl.signal,
        headers: { 'x-forwarded-for': CLIENT_IP, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status !== 429 || attempt) break;
      const wait = Math.min(60, Number(r.headers.get('retry-after')) || 20);
      console.log(`429 on ${path}; waiting ${wait}s once (recorded)`); rateWaits.push({ path, wait, at: new Date().toISOString() });
      await r.text(); await new Promise(res => setTimeout(res, wait * 1000));
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, ms: Math.round(performance.now() - started), json, text: json ? undefined : text.slice(0, 400) };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - started), json: null, error: String(e?.message ?? e) };
  } finally { clearTimeout(timer); }
}

/** Normalize a neighborhoods response (v2 AreaDecision[] or legacy Neighborhood[]). */
export function areasOf(json) {
  if (!json) return { version: null, areas: [] };
  if (Array.isArray(json.areas)) {
    return {
      version: 2, meta: json.meta, allCandidateIds: json.allCandidateIds,
      areas: json.areas.map((d, i) => ({
        id: d.area?.id, name: d.area?.name, center: d.area?.center, geometry: d.area?.geometry,
        rank: d.metrics?.rank ?? i + 1, score: d.metrics?.tasteScore, percentile: d.metrics?.percentile,
        candidateCount: d.metrics?.candidateCount, tieBand: d.metrics?.tieBand, support: d.metrics?.support,
        you: d.metrics?.you, partner: d.metrics?.partner,
        status: d.recommendationStatus, headline: d.headline, tradeoff: d.tradeoff,
        anchors: (d.anchors ?? []).map(a => ({ ...a.place, role: a.role, insideArea: a.insideArea, eligibility: a.eligibility, priceStatus: a.priceStatus, brandKey: a.brandKey, venueKey: a.venueKey })),
      })),
    };
  }
  if (Array.isArray(json.neighborhoods)) {
    return {
      version: 1,
      areas: json.neighborhoods.map(n => ({ id: n.id, name: n.name, center: n.center, rank: n.rank, score: n.score, you: n.you, them: n.them, percentile: null, candidateCount: json.neighborhoods.length, samplePlaces: n.samplePlaces, lift: n.lift, cellIds: n.cellIds })),
    };
  }
  return { version: null, areas: [] };
}

/** Normalize a home response. similarity is 0..100 or null. */
export function homeOf(json) {
  if (!json) return { version: null, matches: [] };
  if (json.meta && Array.isArray(json.matches) && json.matches[0]?.area) {
    return {
      version: 2, meta: json.meta, source: json.sourceSignatureSummary,
      matches: json.matches.map((m, i) => ({ id: m.area?.area?.id, name: m.area?.area?.name, center: m.area?.area?.center, order: i + 1, similarity: m.similarity?.value ?? null, method: m.similarity?.method, support: m.similarity?.support, orderReason: m.orderReason, blendedRank: m.blendedRank, shared: m.sharedFeatures, counterparts: m.counterparts })),
    };
  }
  if (Array.isArray(json.neighborhoods)) {
    const sim = new Map((json.matches ?? []).map(m => [m.neighborhoodId, m]));
    return {
      version: 1, source: json.source,
      matches: json.neighborhoods.map((n, i) => ({ id: n.id, name: n.name, center: n.center, order: i + 1, similarity: sim.get(n.id)?.similarity ?? null, shared: sim.get(n.id)?.sharedTags, counterparts: sim.get(n.id)?.twins })),
    };
  }
  return { version: null, matches: [] };
}

/** POST an SSE endpoint and collect every event with its arrival time (ms since send). */
export async function sse(path, body, { timeout = 150_000 } = {}) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const events = [];
  let status = 0; let contentType = ''; let error = null; let raw = '';
  try {
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await fetch(new URL(path, BASE), { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP }, body: JSON.stringify(body) });
      if (r.status !== 429 || attempt) break;
      const wait = Math.min(60, Number(r.headers.get('retry-after')) || 20);
      console.log(`429 on ${path}; waiting ${wait}s once (recorded)`); rateWaits.push({ path, wait, at: new Date().toISOString() });
      await r.text(); await new Promise(res => setTimeout(res, wait * 1000));
    }
    status = r.status; contentType = r.headers.get('content-type') ?? '';
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let evName = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      raw += chunk; buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) { evName = null; continue; }
        if (line.startsWith('event:')) { evName = line.slice(6).trim(); continue; }
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const t = Math.round(performance.now() - started);
        try { const j = JSON.parse(data); events.push({ t, ...j, type: j.type ?? evName ?? 'message' }); } catch { events.push({ t, type: 'unparsed', data }); }
      }
    }
  } catch (e) { error = String(e?.message ?? e); } finally { clearTimeout(timer); }
  if (!events.length && raw) { try { const j = JSON.parse(raw); events.push({ t: 0, type: 'json-body', ...j }); } catch { /* ignore */ } }
  return { status, contentType, ms: Math.round(performance.now() - started), events, error };
}

const toRad = d => d * Math.PI / 180;
/** metres between two [lon, lat] points */
export function distM(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000, dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- venue classification (Q's independent audit; not the product's eligibility code) ----------
/** primary type identifiers only: urn:tag:genre:place:* and urn:tag:category:place:* (amenities and audience tags are not types) */
export function typeIdsOf(p) {
  const ids = [...(p?.classifications ?? []), ...(p?.tags ?? []).map(t => t.id)].filter(x => typeof x === 'string');
  return [...new Set(ids.filter(x => /^urn:tag:(genre|category):place/.test(x)))];
}
const NOT_A_BAR = /snack_bar|juice_bar|coffee_bar|espresso_bar|sushi_bar|salad_bar|milk_bar|oyster_bar|breakfast/;
export function venueFlags(p) {
  const types = typeIdsOf(p).join(' ');
  const name = p?.name ?? '';
  const words = [name, p?.description ?? ''].join(' ');
  const barTypes = typeIdsOf(p).filter(t => /(bar|pub|nightclub|night_club|cocktail|wine_bar|beer|brewery|tavern|lounge|dance_club)$/.test(t) && !NOT_A_BAR.test(t));
  return {
    types,
    adult: /adult|strip|gentlem|erotic|sex_shop|brothel/.test(types) || /strip ?club|gentlem[ae]n'?s? ?club|adult entertainment|er[oó]tic|alterne|lap ?danc|peep ?show|brothel|bordel/i.test(words),
    hotel: /hotel|lodging|hostel|motel|resort/.test(types) || (/\bhotel\b|\bhostel\b/i.test(name) && !/night_club|nightclub|dance_club/.test(types)),
    grocery: /supermarket|grocery|convenience|gas_station|petrol|department_store|hypermarket/.test(types) || /\bcontinente\b|pingo doce|\blidl\b|\baldi\b|\brewe\b|\bedeka\b|\bspar\b|carrefour|minipre[cç]o|intermarch|\bnetto\b|kaufland|el corte ingl/i.test(name),
    bar: barTypes.length > 0 || p?.category === 'drinks', barTypes,
    barName: /\bbar\b|\bpub\b|\bkneipe\b|\bcervejaria\b|\btaberna\b/i.test(name),
    museum: /museum|gallery_museum/.test(types) || /museum|\bmuseu\b|\bmuseo\b/i.test(name),
    danceType: /nightclub|night_club|dance_club|dance_hall|disco|club/.test(types),
    musicVenue: /music_venue|live_music|concert|jazz_club/.test(types),
    coffeeType: /cafe|coffee|roaster|tea_house|bakery|pastry/.test(types),
  };
}
export const brandOf = p => (p?.brandKey ?? (p?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 2).join(' '));

// ---------- results recorder ----------
export class Recorder {
  constructor(suite) {
    this.suite = suite; this.started = new Date(); this.checks = []; this.calls = [];
    this.revision = srcRevision();
  }
  /** kind: automated | live provider | agent visual | human approved. status: PASS | FAIL | PARTIAL | BLOCKED | INFO */
  check(id, criterion, kind, status, detail, evidence) {
    const c = { id, criterion, kind, status, detail, evidence, at: new Date().toISOString() };
    this.checks.push(c);
    console.log(`${status.padEnd(7)} ${id} ${detail ?? ''}`.slice(0, 400));
    return c;
  }
  log(label, res, extra = {}) { this.calls.push({ label, status: res.status, ms: res.ms, error: res.error, ...extra }); }
  write() {
    const stamp = this.started.toISOString().replace(/[:.]/g, '-');
    const dir = join(QA_DIR, 'rounds', `${stamp}-${this.suite}`);
    mkdirSync(dir, { recursive: true });
    const summary = { suite: this.suite, base: BASE, clientIp: CLIENT_IP, rateWaits, startedAt: this.started.toISOString(), finishedAt: new Date().toISOString(), revision: this.revision, checks: this.checks, calls: this.calls };
    writeFileSync(join(dir, 'results.json'), JSON.stringify(summary, null, 2));
    const counts = this.checks.reduce((m, c) => (m[c.status] = (m[c.status] ?? 0) + 1, m), {});
    const md = [
      `# Q ${this.suite} round ${summary.startedAt}`, '',
      `Base: ${BASE}; src revision ${this.revision.rev} (${this.revision.files} files, newest change ${this.revision.newestSrcChange}). Finished ${summary.finishedAt}.`, '',
      `Totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`, '',
      '| Status | Check | Kind | Detail |', '| --- | --- | --- | --- |',
      ...this.checks.map(c => `| ${c.status} | ${c.id} | ${c.kind} | ${String(c.detail ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 600)} |`),
    ].join('\n');
    writeFileSync(join(dir, 'summary.md'), md + '\n');
    console.log('wrote', dir);
    return dir;
  }
}
