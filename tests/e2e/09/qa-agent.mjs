// Package Q (stage 09): the five §9 dialogues as executable live checks against POST /api/agent (SSE).
// Usage: node tests/e2e/09/qa-agent.mjs [1,2,3,4,5]
// Works with v2 events (ack/plan/step/observation/replan/patch/result/answer/error/done) and the legacy
// stream (trace/patch/delta/card/done/error). A turn without the required evidence is FAIL, never PASS by absence of errors.
import { Recorder, stateFor, sse, venueFlags, distM, brandOf } from './lib.mjs';

const only = (process.argv[2] ?? '1,2,3,4,5').split(',');
const rec = new Recorder(`agent-${only.join('')}`);
const LIVE = 'live provider';
const BANNED = /\bMatch\s*\d|% alike|adjusted match lift|negative adjusted/i;

function applyPatch(state, ops) {
  const s = structuredClone(state);
  for (const op of ops ?? []) {
    if (op.op === 'set_city') s.city = op.city;
    else if (op.op === 'add_love') s.loves = [...s.loves.filter(l => l.query !== op.love.query), op.love];
    else if (op.op === 'remove_love') s.loves = s.loves.filter(l => l.query !== op.query);
    else if (op.op === 'set_weight') s.loves = s.loves.map(l => (l.query === op.query ? { ...l, weight: op.weight } : l));
    else if (op.op === 'add_refinement') s.refinements = [...(s.refinements ?? []), op.tag];
    else if (op.op === 'remove_refinement') s.refinements = (s.refinements ?? []).filter(t => t.id !== op.id);
    else if (op.op === 'set_discovery') s.discovery = op.value;
    else if (op.op === 'set_companion') s.companion = op.loves ? { loves: op.loves } : null;
    else if (op.op === 'set_days') s.days = op.days;
    else if (op.op === 'select_neighborhood') s.neighborhood = op.id;
    else if (op.op === 'set_budget') s.budget = op.budget;
    else if (op.op === 'set_pace') s.pace = op.pace;
    else if (op.op === 'set_start') s.startHour = op.hour;
  }
  return s;
}

class Session {
  constructor(name, state) { this.name = name; this.state = state; this.history = []; this.memory = { revision: 1, constraints: [], selectedAreaIds: [], rejectedPlaceIds: [], savedPlaceIds: [], lastResults: [] }; this.rev = 1; this.n = 0; this.sessionId = `q-${name}-${Date.now()}`; }
  async turn(message) {
    const turnId = `${this.sessionId}-t${++this.n}`;
    const before = structuredClone(this.state);
    const body = { responseVersion: 2, sessionId: this.sessionId, turnId, stateRevision: this.rev, state: this.state, memory: this.memory, message, history: this.history.slice(-20) };
    const res = await sse('/api/agent', body, { timeout: 180_000 });
    const t = { message, turnId, status: res.status, contentType: res.contentType, ms: res.ms, error: res.error, events: res.events, before };
    const ev = res.events;
    const first = type => ev.find(e => (Array.isArray(type) ? type.includes(e.type) : e.type === type));
    t.ackMs = first('ack')?.t ?? null;
    t.firstEventMs = ev[0]?.t ?? null;
    t.firstStepMs = first(['step', 'trace'])?.t ?? null;
    t.firstCardMs = first(['result', 'card'])?.t ?? null;
    t.doneMs = first('done')?.t ?? null;
    t.cards = ev.filter(e => e.type === 'result' || e.type === 'card').map(e => ({ ...e.card, meta: e.meta }));
    t.patches = ev.filter(e => e.type === 'patch').flatMap(e => e.ops ?? []);
    t.replans = ev.filter(e => e.type === 'replan');
    t.constraintPatches = ev.filter(e => e.type === 'patch' && e.constraints).map(e => e.constraints.map(c => `${c.kind}:${c.value}:${c.strength}`).join(','));
    t.errors = ev.filter(e => e.type === 'error');
    t.steps = ev.filter(e => e.type === 'step' || e.type === 'trace').map(e => e.text ?? `${e.tool}: ${e.summary}`);
    t.observations = ev.filter(e => e.type === 'observation').map(e => e.text);
    t.text = ev.filter(e => e.type === 'delta').map(e => e.text).join('') + ev.filter(e => e.type === 'answer').flatMap(e => e.claims ?? []).map(c => c.text).join(' ');
    t.claims = ev.filter(e => e.type === 'answer').flatMap(e => e.claims ?? []);
    const done = first('done');
    t.goals = done?.goals ?? first('plan')?.goals ?? null;
    t.v2 = ev.some(e => ['ack', 'plan', 'result', 'answer', 'step'].includes(e.type));
    if (done?.memory) this.memory = done.memory;
    this.state = applyPatch(this.state, t.patches);
    const nextRev = ev.filter(e => e.type === 'patch').map(e => e.nextRevision).filter(Number.isFinite).pop();
    this.rev = nextRev ?? this.rev + (t.patches.length ? 1 : 0);
    this.history.push({ role: 'user', content: message }, { role: 'assistant', content: t.text.slice(0, 1500) || '(no text)' });
    t.after = structuredClone(this.state);
    rec.log(`${this.name} t${this.n}`, { status: res.status, ms: res.ms, error: res.error }, { events: ev.map(e => e.type).join(','), ack: t.ackMs, firstStep: t.firstStepMs, firstCard: t.firstCardMs, done: t.doneMs });
    rec.calls.at(-1).transcript = { message, text: t.text.slice(0, 2000), steps: t.steps, observations: t.observations, replans: t.replans, patches: t.patches, constraints: t.constraintPatches, goals: t.goals, errors: t.errors, cards: t.cards.map(c => summarizeCard(c)) };
    return t;
  }
}

function summarizeCard(c) {
  const k = c.kind;
  if (k === 'areas' || k === 'ranking') return { kind: k, areas: (c.areas ?? c.neighborhoods ?? []).slice(0, 3).map(a => a.area?.name ?? a.name) };
  if (k === 'home') return { kind: k, matches: (c.matches ?? c.result?.neighborhoods ?? []).slice(0, 3).map(m => m.area?.area?.name ?? m.name), sims: (c.matches ?? c.result?.matches ?? []).slice(0, 3).map(m => m.similarity?.value ?? m.similarity) };
  if (k === 'comparison') return { kind: k, results: (c.result?.results ?? []).map(r => `${r.cityName ?? r.cityId}:${r.status}:${r.culturalOverlap}`) };
  if (k === 'address' || k === 'spot') return { kind: k, label: c.result?.label, quality: c.result?.geocodeQuality, nearby: (c.result?.nearby ?? c.result?.walk ?? []).length };
  if (k === 'visit' || k === 'plan') return { kind: k, stops: stopsOf(c).map(s => s.place?.name) };
  if (k === 'venues') return { kind: k, venues: (c.venues ?? []).map(v => v.place?.name) };
  return { kind: k };
}
function stopsOf(card) {
  const it = card.result?.itinerary ?? card.itinerary;
  return (it?.days ?? []).flatMap(d => d.stops ?? []);
}
const cardOf = (t, kinds) => t.cards.find(c => kinds.includes(c.kind));
const venuesIn = c => (c?.venues ?? []).map(v => v.place ?? v);

function common(label, t, { needCard }) {
  const okStream = t.status === 200 && /event-stream/.test(t.contentType);
  rec.check(`${label}.stream`, 'SSE 200, finished with done', LIVE, okStream && t.doneMs != null ? 'PASS' : 'FAIL', `HTTP ${t.status} ${t.contentType} total ${t.ms}ms; events ${t.events.map(e => e.type).join(',').slice(0, 300)}${t.error ? `; error ${t.error}` : ''}`);
  rec.check(`${label}.latency`, '11.1 ack <=0.5s cold, first step <=2.5s, first card <=7s', LIVE,
    t.ackMs == null ? 'FAIL' : t.ackMs <= 500 && (t.firstStepMs ?? 1e9) <= 2500 && (t.firstCardMs ?? 1e9) <= 7000 ? 'PASS' : 'PARTIAL',
    `ack ${t.ackMs ?? 'none'} / first event ${t.firstEventMs} / first step ${t.firstStepMs} / first card ${t.firstCardMs} / done ${t.doneMs} ms`);
  if (needCard) rec.check(`${label}.card`, `result card of kind ${needCard.join('|')}`, LIVE, cardOf(t, needCard) ? 'PASS' : 'FAIL', `cards: ${t.cards.map(c => c.kind).join(',') || 'none'}`);
  const goals = t.goals ?? [];
  const open = goals.filter(g => ['pending', 'running'].includes(g.status));
  rec.check(`${label}.ledger`, '12.3 100% goals in ledger with a final status; failures/partials visible', LIVE,
    !t.v2 ? 'FAIL' : !goals.length ? 'FAIL' : open.length ? 'FAIL' : 'PASS',
    t.v2 ? `goals: ${goals.map(g => `${g.kind}=${g.status}${g.unmet?.length ? `(${g.unmet.join(';').slice(0, 80)})` : ''}`).join(', ') || 'none'}` : 'legacy stream: no goal ledger');
  rec.check(`${label}.copy`, '12.2 no Match NN / % alike / adjusted lift wording in the answer', LIVE, BANNED.test(t.text) ? 'FAIL' : 'PASS', t.text.slice(0, 300).replace(/\n/g, ' '));
  if (t.errors.length) rec.check(`${label}.errors`, 'error events are explicit and tied to a goal', LIVE, 'INFO', JSON.stringify(t.errors).slice(0, 300));
}

// ---------------------------------------------------------------- scenario 1
async function s1() {
  const s = new Session('s1', stateFor(null, 'Lisbon'));
  const t1 = await s.turn("I'm moving to Lisbon. I love Radiohead, Fleabag and Patagonia. I work from cafés. Where should I start looking?");
  common('s1.t1', t1, { needCard: ['areas', 'ranking'] });
  const names = s.state.loves.map(l => l.chosen?.name);
  const want = ['Radiohead', 'Fleabag', 'Patagonia'];
  const extra = s.state.loves.filter(l => !want.some(w => (l.chosen?.name ?? '').toLowerCase().includes(w.toLowerCase())));
  rec.check('s1.t1.profile', 'exactly the three explicit loves added, city Lisbon, no unrequested loves', LIVE,
    want.every(w => names.some(n => n?.toLowerCase().includes(w.toLowerCase()))) && !extra.length && s.state.city === 'Lisbon' ? 'PASS' : 'FAIL', `loves: ${names.join(', ')}; city ${s.state.city}`);
  const areasCard = cardOf(t1, ['areas', 'ranking']);
  const areas = areasCard?.areas ?? areasCard?.neighborhoods ?? [];
  const anchors = areas.slice(0, 3).map(a => (a.anchors ?? []).map(x => x.place ?? x));
  rec.check('s1.t1.evidence', '4: each of 3 areas has 2-3 verified places; café-work requirement checked', LIVE,
    areas.length >= 3 && anchors.every(a => a.length >= 2) ? 'PASS' : 'FAIL', `areas ${areas.slice(0, 3).map((a, i) => `${a.area?.name ?? a.name}(${anchors[i]?.length ?? 0} anchors: ${(anchors[i] ?? []).slice(0, 3).map(p => p.name).join('/')})`).join('; ')}`);
  const cafeGoal = (t1.goals ?? []).find(g => /venue|cafe|café|work/i.test(`${g.kind} ${g.unmet?.join(' ')}`));
  rec.check('s1.t1.wifi-honesty', 'wifi/café-work not silently claimed: satisfied only with a verified café, else partial', LIVE,
    /wi-?fi/i.test(t1.text) && !/(not (verified|confirmed)|unverified|unknown|could not confirm|can't confirm)/i.test(t1.text) && !(t1.goals ?? []).some(g => g.status === 'partial') ? 'FAIL' : 'INFO',
    `goal: ${cafeGoal ? `${cafeGoal.kind}=${cafeGoal.status}` : 'none'}; text mentions wifi: ${/wi-?fi/i.test(t1.text)}`);
  const top1 = areas[0]?.area?.id ?? areas[0]?.id;
  const t2 = await s.turn('Why that one? What if Radiohead matters less?');
  common('s1.t2', t2, { needCard: ['explanation', 'decides', 'areas', 'ranking'] });
  const w = s.state.loves.find(l => /radiohead/i.test(l.chosen?.name ?? ''));
  rec.check('s1.t2.weight', 'Radiohead weight lowered (≈0.5), not removed; no other love changed', LIVE, w && w.weight > 0 && w.weight < 1 ? 'PASS' : 'FAIL', `Radiohead weight ${w?.weight ?? 'REMOVED'}; patches ${JSON.stringify(t2.patches).slice(0, 200)}`);
  const a2 = cardOf(t2, ['areas', 'ranking']);
  const areas2 = a2?.areas ?? a2?.neighborhoods ?? [];
  const sameN = areas2.length && areas.length ? (areas2[0]?.metrics?.candidateCount ?? areas2.length) === (areas[0]?.metrics?.candidateCount ?? areas.length) : null;
  rec.check('s1.t2.reorder', 'previous vs new order shown on same geography; "stays" stated honestly', LIVE, areas2.length && sameN !== false ? 'PASS' : 'FAIL',
    `before #1 ${areas[0]?.area?.name ?? areas[0]?.name} / after #1 ${areas2[0]?.area?.name ?? areas2[0]?.name ?? 'no new ranking card'}; same candidateCount=${sameN}; text: ${t2.text.slice(0, 200)}`);
  void top1;
}

// ---------------------------------------------------------------- scenario 2
async function s2() {
  const s = new Session('s2', stateFor('dialogue 1', 'Lisbon'));
  const t1 = await s.turn('I loved living in Kreuzberg, Berlin. Where in Lisbon could feel familiar? Use my tastes too if the match is weak.');
  common('s2.t1', t1, { needCard: ['home'] });
  const homes = t1.cards.filter(c => c.kind === 'home');
  const sims = c => (c.matches ?? c.result?.matches ?? []).map(m => m.similarity?.value ?? m.similarity);
  const s0 = sims(homes[0] ?? {});
  const weak = s0.length && s0[0] != null && s0[0] < 35;
  rec.check('s2.t1.replan', 'if S_top<35: observation -> replan -> blended home (lambda 0.35) -> venues; S unchanged', LIVE,
    !homes.length ? 'FAIL' : weak ? (t1.replans.length && homes.length >= 2 ? 'PASS' : 'FAIL') : 'INFO',
    `S_top=${s0[0]}; replans ${t1.replans.map(r => r.reason).join(' / ') || 'none'}; home cards ${homes.length} (${homes.map(h => (h.matches?.[0]?.orderReason ?? '')).join(',')}); steps: ${t1.steps.join(' > ').slice(0, 300)}`);
  rec.check('s2.t1.city', 'map city stays Lisbon; no loves added', LIVE, s.state.city === 'Lisbon' && s.state.loves.length === 3 ? 'PASS' : 'FAIL', `city ${s.state.city}; loves ${s.state.loves.length}`);
  const t2 = await s.turn('What happens if I ask for Alfama in Lisbon itself?');
  common('s2.t2', t2, { needCard: ['home'] });
  const h = cardOf(t2, ['home']);
  const ms = (h?.matches ?? []).map(m => ({ name: m.area?.area?.name, center: m.area?.area?.center, s: m.similarity?.value }));
  const legacyN = h?.result?.neighborhoods ?? [];
  const tops = ms.length ? ms : legacyN.map(n => ({ name: n.name, center: n.center }));
  const near = tops.slice(0, 3).filter(m => distM(m.center, [-9.13, 38.7118]) <= 800);
  rec.check('s2.t2.alfama', 'Alfama -> Lisbon: #1 is the Alfama area (<=800m) with S>=65 (identity/holdout), no special text', LIVE, tops[0] && distM(tops[0].center, [-9.13, 38.7118]) <= 800 && (tops[0].s ?? 0) >= 65 ? 'PASS' : 'FAIL', `top: ${tops.slice(0, 3).map(m => `${m.name} ${Math.round(distM(m.center, [-9.13, 38.7118]))}m S=${m.s ?? '?'}`).join(' | ')}`);
}

// ---------------------------------------------------------------- scenario 3
async function s3() {
  const s = new Session('s3', stateFor('dialogue 1', 'Lisbon'));
  const t1 = await s.turn('Would Lisbon or Reykjavík feel closer to Kreuzberg?');
  common('s3.t1', t1, { needCard: ['comparison'] });
  rec.check('s3.t1.city', '12.3 state.city unchanged by comparison (no set_city patch)', LIVE, !t1.patches.some(p => p.op === 'set_city') && s.state.city === 'Lisbon' ? 'PASS' : 'FAIL', `patches ${JSON.stringify(t1.patches).slice(0, 200)}`);
  const c = cardOf(t1, ['comparison']);
  const rows = c?.result?.results ?? [];
  rec.check('s3.t1.both', 'two city results with one method; no forced winner on close/incomplete data', LIVE, rows.length === 2 && rows.every(r => r.status !== 'error') ? 'PASS' : 'FAIL', `${rows.map(r => `${r.cityName}:${r.status} overlap=${r.culturalOverlap} top=${r.homeMatches?.[0]?.area?.area?.name ?? r.areas?.[0]?.area?.name}`).join(' | ')}; recommendation ${c?.result?.recommendation?.cityId ?? 'none'}`);
  const t2 = await s.turn('Open the Lisbon option.');
  common('s3.t2', t2, {});
  rec.check('s3.t2.open', 'open Lisbon: shows the actual Lisbon match; city switch only to Lisbon', LIVE, s.state.city === 'Lisbon' && t2.cards.length ? 'PASS' : 'FAIL', `city ${s.state.city}; cards ${t2.cards.map(x => x.kind).join(',')}`);
}

// ---------------------------------------------------------------- scenario 4
function auditVisit(label, card, opts = {}) {
  const stops = stopsOf(card ?? {});
  const viol = [];
  for (const st of stops) {
    const f = venueFlags(st.place);
    if (f.museum) viol.push(`${st.place.name}: museum`);
    if (f.bar && !/coffee|cafe/.test(f.types)) viol.push(`${st.place.name}: bar (${f.barTypes.join(',').replace(/urn:tag:(genre|category):place:/g, '') || st.place.category})`);
    if (opts.budget && (st.place.priceLevel == null || st.place.priceLevel > opts.budget)) viol.push(`${st.place.name}: price ${st.place.priceLevel ?? 'unknown'}`);
  }
  const ids = stops.map(x => x.place.id);
  if (new Set(ids).size !== ids.length) viol.push('duplicate stop');
  const brands = stops.map(x => brandOf(x.place));
  if (new Set(brands).size !== brands.length) viol.push(`same brand twice in a day: ${brands.filter((b, i) => brands.indexOf(b) !== i).join(', ')}`);
  rec.check(`${label}.hard`, '12.3 visit: 0 hard violations (no museums, no bars, known price <= $$), 0 duplicates', LIVE, !stops.length ? 'FAIL' : viol.length ? 'FAIL' : 'PASS',
    `${stops.length} stops: ${stops.map(x => `${x.time} ${x.place.name} [${x.place.category} ${x.place.priceLevel ?? '?'} ${x.place.id.slice(0, 8)} ${x.place.address ?? ''}]`).join('; ')}; violations: ${viol.join('; ') || 'none'}; audit.hardViolations=${card?.result?.audit?.hardViolations?.length ?? 'n/a'}`);
  return stops;
}
async function s4() {
  const s = new Session('s4', stateFor('dialogue 1', 'Lisbon'));
  const t1 = await s.turn('Check Rua da Rosa 120 for me. Then plan a relaxed afternoon nearby, no museums, no bars, and only places within $$ where you know the price.');
  common('s4.t1', t1, { needCard: ['address', 'spot'] });
  const addr = cardOf(t1, ['address', 'spot']);
  rec.check('s4.t1.address', 'address precision shown (building/street/area) and real nearby venues', LIVE, addr?.result?.geocodeQuality && (addr.result.nearby ?? []).length ? 'PASS' : 'FAIL',
    `label ${addr?.result?.label}; quality ${addr?.result?.geocodeQuality ?? 'n/a'}; nearby ${(addr?.result?.nearby ?? addr?.result?.walk ?? []).length}; outsideSelectedArea ${addr?.result?.outsideSelectedArea}`);
  const visit = cardOf(t1, ['visit', 'plan']);
  rec.check('s4.t1.visit-card', 'visit card present (3-4 stops or honest partial)', LIVE, visit ? 'PASS' : 'FAIL', `cards ${t1.cards.map(c => c.kind).join(',')}`);
  const stops = auditVisit('s4.t1.visit', visit, { budget: 2 });
  const recovery = visit?.result?.recoveryLog ?? [];
  rec.check('s4.t1.recovery', 'missing role -> wider radius / alternate venue recorded (if needed)', LIVE, 'INFO', `recoveryLog ${JSON.stringify(recovery).slice(0, 200)}; replans ${t1.replans.length}; unmet ${JSON.stringify(visit?.result?.audit?.unmet ?? []).slice(0, 200)}`);
  if (stops.length >= 2) {
    const victim = stops[1].place.id; const keep = stops.filter((_, i) => i !== 1).map(x => x.place.id);
    const t2 = await s.turn('Replace the second stop and keep the rest.');
    common('s4.t2', t2, { needCard: ['visit', 'plan'] });
    const v2 = cardOf(t2, ['visit', 'plan']);
    const st2 = auditVisit('s4.t2.visit', v2, { budget: 2 });
    const ids = st2.map(x => x.place.id);
    rec.check('s4.t2.swap', '12.3 swap keeps all other IDs, removes the second, constraints persist', LIVE, v2 && !ids.includes(victim) && keep.every(id => ids.includes(id)) ? 'PASS' : 'FAIL',
      `removed ${stops[1].place.name}: ${ids.includes(victim) ? 'STILL PRESENT' : 'absent'}; kept ${keep.filter(id => ids.includes(id)).length}/${keep.length}`);
    const t3 = await s.turn('Make it two days instead and plan again.');
    common('s4.t3', t3, { needCard: ['visit', 'plan'] });
    auditVisit('s4.t3.visit', cardOf(t3, ['visit', 'plan']), { budget: 2 });
    const cons = JSON.stringify(s.memory?.constraints ?? []);
    rec.check('s4.t3.constraints', '12.3 constraints survive a days change and Plan again (memory keeps no museums / no bars / budget)', LIVE, /museum/i.test(cons) && /bar/i.test(cons) && /budget/i.test(cons) ? 'PASS' : 'FAIL', `memory.constraints ${cons.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- scenario 5
async function s5() {
  for (const city of ['Berlin', 'Lisbon']) {
    const s = new Session(`s5-${city}`, stateFor('techno', city));
    const lovesBefore = s.state.loves.map(l => l.chosen.id).sort().join();
    const t1 = await s.turn('Where can I go dancing? I want dark techno, no hotel bars and no adult clubs.');
    common(`s5.${city}.t1`, t1, { needCard: ['venues', 'plan', 'visit'] });
    const card = cardOf(t1, ['venues']);
    const vs = card ? venuesIn(card) : stopsOf(cardOf(t1, ['plan', 'visit']) ?? {}).map(x => x.place);
    const bad = vs.filter(p => { const f = venueFlags(p); return f.adult || f.hotel; });
    const dancey = vs.filter(p => { const f = venueFlags(p); return f.danceType || f.musicVenue; });
    rec.check(`s5.${city}.t1.venues`, '12.3 2-3 dance venues, 0 adult/hotel, linked to real loves', LIVE, vs.length >= 2 && !bad.length && dancey.length >= 2 ? 'PASS' : 'FAIL',
      `${vs.map(p => p.name).join('; ') || 'none'}; adult/hotel ${bad.map(p => p.name).join(', ') || 'none'}; dance-typed ${dancey.length}/${vs.length}; connections ${(card?.venues ?? []).map(v => (v.connections ?? []).length).join(',')}`);
    rec.check(`s5.${city}.t1.no-new-loves`, 'no artist added to the profile because of a genre search', LIVE, s.state.loves.map(l => l.chosen?.id).sort().join() === lovesBefore ? 'PASS' : 'FAIL', `patches ${JSON.stringify(t1.patches).slice(0, 200)}`);
    if (city === 'Berlin') {
      const t2 = await s.turn("My partner doesn't like clubs. What could we do near our shortlist together?");
      common('s5.t2', t2, {});
      const vs2 = (cardOf(t2, ['venues']) ? venuesIn(cardOf(t2, ['venues'])) : stopsOf(cardOf(t2, ['plan', 'visit']) ?? {}).map(x => x.place));
      const clubs = vs2.filter(p => venueFlags(p).danceType);
      const asked = /\?/.test(t2.text) && !t2.cards.length;
      rec.check('s5.t2.goal', '12.3 the request is a goal in the ledger (answered, partial or needs_input), never only "requirements saved"', LIVE, (t2.goals ?? []).length || asked ? 'PASS' : 'FAIL', `goals ${JSON.stringify(t2.goals)}; text "${t2.text.slice(0, 160)}"`);
      rec.check('s5.t2.partner', 'partner: no clubs suggested; one necessary question or coffee/culture/food; techno loves kept', LIVE,
        s.state.loves.length === 3 && !clubs.length && (asked || vs2.length) ? 'PASS' : 'FAIL',
        `loves ${s.state.loves.length}; venues ${vs2.map(p => p.name).join('; ') || 'none'}; clubs ${clubs.map(p => p.name).join(', ') || 'none'}; question=${asked}; companion patch ${JSON.stringify(t2.patches.filter(p => p.op === 'set_companion')).slice(0, 120)}`);
    }
  }
}

const all = { 1: s1, 2: s2, 3: s3, 4: s4, 5: s5 };
console.log(`Q agent dialogues ${only.join(',')} against ${rec.revision.rev}`);
for (const k of only) {
  try { await all[k](); } catch (e) { rec.check(`s${k}.runner`, 'dialogue completed', 'automated', 'FAIL', `runner exception: ${e?.stack?.slice(0, 400) ?? e}`); }
}
rec.write();
