// Package Q (stage 09): live HTTP acceptance checks against §12 of the deep plan.
// Usage (from anywhere):  node tests/e2e/09/qa-http.mjs [matrix|home|venues|edge|all]
// Env: BASE_URL (default http://localhost:3001), QA_DIR (default tasks/09-qa).
// Every result is PASS/FAIL/PARTIAL/BLOCKED/INFO with the exact numbers; a missing field is never a PASS.
import { Recorder, stateFor, hybrid, call, areasOf, homeOf, distM, median, venueFlags, brandOf } from './lib.mjs';

const suite = process.argv[2] ?? 'all';
const rec = new Recorder(`http-${suite}`);
const LIVE = 'live provider';
const AUTO = 'automated';
const REF = ['techno', 'reader', 'night owl', 'pop', 'metal sport', 'indie outdoors'];
const CITIES = ['Berlin', 'Lisbon'];
const ALFAMA = [-9.1300, 38.7118];
const fmt = a => a.slice(0, 3).map(x => `${x.rank}.${x.name}${x.score != null ? ` H=${Number(x.score).toFixed(4)}` : ''}${x.percentile != null ? ` p=${x.percentile}` : ''}`).join(' | ');

async function ranked(state, label) {
  const r = await call('POST', '/api/neighborhoods', hybrid(state));
  rec.log(label, r);
  return { r, ...areasOf(r.json) };
}

// ---------------------------------------------------------------- matrix (§12.1, §12.2)
async function matrix() {
  const out = {};
  for (const city of CITIES) {
    for (const name of REF) {
      const res = await ranked(stateFor(name, city), `nbh ${city}/${name}`);
      out[`${city}/${name}`] = res;
      const ok = res.r.status === 200 && res.areas.length > 0;
      rec.check(`ref.${city}.${name}`, '12.1 reference case runs', LIVE, ok ? 'INFO' : 'FAIL',
        ok ? `v${res.version} ${res.r.ms}ms N=${res.areas[0]?.candidateCount ?? res.areas.length} top: ${fmt(res.areas)}` : `HTTP ${res.r.status} ${res.r.error ?? JSON.stringify(res.r.json)?.slice(0, 200)}`,
        { top: res.areas.slice(0, 3).map(a => ({ id: a.id, name: a.name, score: a.score, percentile: a.percentile, support: a.support?.quality })), meta: res.meta });
    }
  }
  const top3 = k => (out[k]?.areas ?? []).slice(0, 3).map(a => a.name);
  const lead = k => out[k]?.areas?.[0]?.name;
  // Reference expectations (§12.1 table)
  const bt = top3('Berlin/techno');
  rec.check('ref.berlin.techno.top3', 'Berlin techno: Friedrichshain or Kreuzberg in top-3', LIVE, bt.some(n => /Friedrichshain|Kreuzberg/.test(n)) ? 'PASS' : 'FAIL', bt.join(', '));
  const br = top3('Berlin/reader');
  rec.check('ref.berlin.reader.top3', 'Berlin reader: Kreuzberg or Prenzlauer Berg in top-3', LIVE, br.some(n => /Kreuzberg|Prenzlauer/.test(n)) ? 'PASS' : 'FAIL', br.join(', '));
  for (const city of CITIES) {
    const pop = top3(`${city}/pop`), tech = top3(`${city}/techno`);
    rec.check(`ref.${city}.pop-vs-techno`, 'pop differs from techno by >=1 top-3 area', LIVE, pop.join() !== tech.join() && pop.some(n => !tech.includes(n)) ? 'PASS' : 'FAIL', `pop ${pop.join(', ')} / techno ${tech.join(', ')}`);
    const leaders = REF.map(n => lead(`${city}/${n}`)).filter(Boolean);
    const counts = leaders.reduce((m, n) => (m[n] = (m[n] ?? 0) + 1, m), {});
    const distinct = Object.keys(counts).length, maxWins = Math.max(0, ...Object.values(counts));
    rec.check(`ref.${city}.leaders`, '12.2 taste influence: >=4 distinct leaders, max 2 wins per area', LIVE, distinct >= 4 && maxWins <= 2 ? 'PASS' : 'FAIL', JSON.stringify(counts));
    // Coverage + fixed geography
    const all = REF.map(n => out[`${city}/${n}`]).filter(Boolean);
    const Ns = all.map(x => x.areas[0]?.candidateCount ?? x.areas.length);
    const v2 = all.every(x => x.version === 2);
    rec.check(`ref.${city}.coverage`, '12.2 reference coverage: >=10 named candidates, >=5 supported', LIVE,
      v2 ? (Math.min(...Ns) >= 10 && all.every(x => x.areas.filter(a => a.support?.quality === 'sufficient').length >= 5 || (x.allCandidateIds?.length ?? 0) >= 10) ? 'PASS' : 'FAIL') : 'FAIL',
      `candidateCount per profile ${Ns.join(',')}; responseVersion ${[...new Set(all.map(x => x.version))].join('/')}; supported(top list) ${all.map(x => x.areas.filter(a => a.support?.quality === 'sufficient').length).join(',')}`);
    const centers = new Map(); let mismatch = [];
    for (const x of all) for (const a of x.areas) {
      const prev = centers.get(a.id);
      if (prev && distM(prev, a.center) > 1) mismatch.push(`${a.name} moved ${Math.round(distM(prev, a.center))}m`);
      if (!prev) centers.set(a.id, a.center);
    }
    const idSets = all.map(x => (x.allCandidateIds ?? []).slice().sort().join(','));
    const sameSets = v2 && idSets.every(s => s && s === idSets[0]);
    mismatch = [...new Set(mismatch)];
    rec.check(`ref.${city}.fixed-geography`, '12.2 fixed candidates: identical area IDs + centers across profiles', LIVE,
      mismatch.length === 0 && sameSets ? 'PASS' : 'FAIL',
      `${mismatch.length} center mismatches${mismatch.length ? `: ${mismatch.slice(0, 5).join('; ')}` : ''}; allCandidateIds identical across 6 profiles: ${v2 ? sameSets : 'n/a (legacy response, no allCandidateIds)'}`);
  }
  // indie vs metal Lisbon
  {
    const a = out['Lisbon/indie outdoors']?.areas ?? [], b = out['Lisbon/metal sport']?.areas ?? [];
    const diffLeader = a[0] && b[0] && a[0].id !== b[0].id;
    let bigMove = false;
    for (const x of a.slice(0, 3)) { const y = b.find(z => z.id === x.id); if (!y || Math.abs(y.rank - x.rank) >= 3) bigMove = true; }
    rec.check('ref.lisbon.indie-vs-metal', '12.2 Lisbon indie vs metal: different leaders or >=3 rank move', LIVE, diffLeader || bigMove ? 'PASS' : 'FAIL', `indie ${a[0]?.name} / metal ${b[0]?.name}; bigMove=${bigMove}`);
  }
  // Number semantics (v2 only): percentile recomputed from returned H when the full candidate set is returned
  for (const [k, x] of Object.entries(out)) {
    if (x.version !== 2) continue;
    const issues = [];
    x.areas.forEach((a, i) => {
      if (i && x.areas[i - 1].score < a.score - 1e-12) issues.push(`order: ${a.name} H above previous`);
      if (a.rank !== i + 1) issues.push(`rank ${a.rank} at position ${i + 1}`);
      if (a.percentile != null && (a.percentile < 0 || a.percentile > 100)) issues.push(`percentile ${a.percentile}`);
      if (a.percentile != null && a.support?.quality !== 'sufficient') issues.push(`${a.name} percentile shown with support ${a.support?.quality}`);
      if (a.percentile != null && (a.candidateCount ?? 0) < 5) issues.push(`${a.name} percentile with N=${a.candidateCount}`);
    });
    if (x.areas.length === x.areas[0]?.candidateCount) {
      const sup = x.areas.filter(a => a.support?.quality === 'sufficient');
      for (const a of sup) {
        if (a.percentile == null) continue;
        const N = sup.length; const H = a.score;
        const p = 100 * (sup.filter(b => b.score < H - 0.01).length + 0.5 * sup.filter(b => Math.abs(b.score - H) <= 0.01).length) / N;
        if (Math.abs(Math.round(p) - Math.round(a.percentile)) > 1) issues.push(`${a.name} percentile ${a.percentile} vs recomputed ${p.toFixed(1)}`);
      }
    }
    rec.check(`metric.${k}`, '5.4 number semantics: order by H, ranks, percentile gate and formula', AUTO, issues.length ? 'FAIL' : 'PASS', issues.slice(0, 6).join('; ') || 'consistent');
  }
  // §5.3 / §6.4: top-3 are distinct options — no near-total circle overlap, no venue reused as proof of two areas
  {
    const lens = (d, r) => (d >= 2 * r ? 0 : (2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d)) / (Math.PI * r * r));
    const issues = [];
    for (const [k, x] of Object.entries(out)) {
      if (x.version !== 2) continue;
      const t = x.areas.slice(0, 3);
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const r = t[i].geometry?.radiusM ?? 650; const f = lens(distM(t[i].center, t[j].center), r);
        if (f > 0.6) issues.push(`${k}: ${t[i].name}/${t[j].name} overlap ${(f * 100).toFixed(0)}%`);
      }
      const seen = new Map();
      for (const a of t) for (const p of a.anchors ?? []) { if (seen.has(p.id) && seen.get(p.id) !== a.name) issues.push(`${k}: "${p.name}" is proof for ${seen.get(p.id)} and ${a.name}`); else seen.set(p.id, a.name); }
      const thin = t.filter(a => (a.anchors ?? []).length < 2).map(a => a.name);
      if (thin.length) issues.push(`${k}: <2 anchors for ${thin.join(', ')}`);
    }
    rec.check('ref.distinct-top3', '5.3/6.4 top-3 distinct: overlap<=0.6, no anchor reused across areas, >=2 anchors each', LIVE, issues.length ? 'FAIL' : 'PASS', `${issues.length} issues: ${issues.slice(0, 8).join('; ')}`);
  }
  // Repeatability
  {
    const a = await ranked(stateFor('reader', 'Lisbon'), 'repeat reader Lisbon');
    const b = out['Lisbon/reader'];
    const diffs = a.areas.map((x, i) => [x.id === b.areas[i]?.id, Math.abs((x.score ?? 0) - (b.areas[i]?.score ?? 0))]);
    const ok = a.areas.length === b.areas.length && diffs.every(([same, d]) => same && d <= 1e-9);
    rec.check('ref.repeatability', '12.2 identical inputs -> identical order and scores (1e-9)', LIVE, ok ? 'PASS' : 'FAIL', `max |dH|=${Math.max(0, ...diffs.map(d => d[1])).toExponential(2)}; order same=${diffs.every(d => d[0])}`);
  }
  // Small weight change ±10%: top-3 keeps >=2 areas in >=10/12
  {
    let kept = 0; const notes = [];
    for (const city of CITIES) for (const name of REF) {
      const st = stateFor(name, city); st.loves[0].weight = 0.9;
      const res = await ranked(st, `w-10% ${city}/${name}`);
      const base = (out[`${city}/${name}`]?.areas ?? []).slice(0, 3).map(a => a.id);
      const n = res.areas.slice(0, 3).filter(a => base.includes(a.id)).length;
      if (n >= 2) kept++; else notes.push(`${city}/${name}: ${n}/3 kept`);
    }
    rec.check('ref.small-weight', '12.2 ±10% weight: top-3 keeps >=2 areas in >=10/12', LIVE, kept >= 10 ? 'PASS' : 'FAIL', `${kept}/12 stable${notes.length ? `; ${notes.join('; ')}` : ''}`);
  }
  // Neutral control: taste influence vs popularity-only order (needs product support)
  {
    const res = await ranked(stateFor(null, 'Lisbon'), 'neutral Lisbon (no loves)');
    rec.check('ref.neutral-control', '12.2 taste top-3 differs from neutral control in >=8/12', LIVE, res.r.status === 200 && res.areas.length ? 'INFO' : 'BLOCKED',
      res.r.status === 200 && res.areas.length ? `no-love order available: ${fmt(res.areas)} (comparison pending)` : `no neutral control via API (HTTP ${res.r.status} ${JSON.stringify(res.r.json)?.slice(0, 160)})`);
    if (res.r.status === 200 && res.areas.length) {
      let differ = 0;
      for (const city of CITIES) {
        const neutral = city === 'Lisbon' ? res : await ranked(stateFor(null, city), `neutral ${city}`);
        const nTop = neutral.areas.slice(0, 3).map(a => a.id).join();
        for (const name of REF) if ((out[`${city}/${name}`]?.areas ?? []).slice(0, 3).map(a => a.id).join() !== nTop) differ++;
      }
      rec.check('ref.taste-vs-neutral', '12.2 ordered top-3 differs from neutral control in >=8/12', LIVE, differ >= 8 ? 'PASS' : 'FAIL', `${differ}/12 differ`);
    }
  }
  // Held-out
  for (const [name, city] of [['heldout amsterdam', 'Amsterdam'], ['heldout montreal', 'Montreal']]) {
    const res = await ranked(stateFor(name, city), `heldout ${city}`);
    const ok = res.r.status === 200 && res.areas.length;
    rec.check(`heldout.${city}`, '12.1 held-out profile runs; support honest', LIVE, ok ? 'INFO' : 'FAIL', ok ? `${res.r.ms}ms N=${res.areas[0]?.candidateCount ?? res.areas.length} top: ${fmt(res.areas)} support=${res.areas.slice(0, 3).map(a => a.support?.quality ?? '-').join('/')}` : `HTTP ${res.r.status} ${JSON.stringify(res.r.json)?.slice(0, 200)}`);
  }
  // Same-domain weight -> field changes (Radiohead / Aphex Twin 1:1 -> 1:0.05)
  {
    const s1 = stateFor('weight pair', 'Berlin');
    const s2 = stateFor('weight pair', 'Berlin'); s2.loves[1].weight = 0.05;
    const f1 = await call('POST', '/api/field', hybrid(s1)); const f2 = await call('POST', '/api/field', hybrid(s2));
    rec.log('field 1:1', f1); rec.log('field 1:0.05', f2);
    const cells = j => j?.field?.cells ?? j?.cells ?? [];
    const val = c => c.fieldTaste ?? c.taste ?? c.you;
    const m2 = new Map(cells(f2.json).map(c => [c.h ?? c.id, c]));
    let max = 0; for (const c of cells(f1.json)) { const d = m2.get(c.h ?? c.id); if (d) max = Math.max(max, Math.abs(val(c) - val(d))); }
    rec.check('ref.domain-weight', '12.2 same-domain weight 1:1 -> 1:0.05 changes field, max cell delta >=0.10', LIVE, max >= 0.10 ? 'PASS' : 'FAIL', `max cell delta ${max.toFixed(4)} over ${cells(f1.json).length} cells (C4 reference 0.4466)`);
  }
  // Pair fairness
  {
    const st = stateFor('techno', 'Berlin', { companion: { loves: stateFor('pop', 'Berlin').loves } });
    const res = await ranked(st, 'couple Berlin');
    const bad = res.areas.filter(a => {
      const y = a.you?.score ?? a.you, t = a.partner?.score ?? a.them;
      return typeof y === 'number' && typeof t === 'number' && Math.abs(a.score - Math.min(y, t)) > 1e-9;
    });
    const has = res.areas.some(a => (a.partner ?? a.them) != null);
    rec.check('ref.pair-fairness', '12.2 couple score = min(personal scores)', LIVE, !has ? 'FAIL' : bad.length ? 'FAIL' : 'PASS', has ? `${bad.length} areas violate min(); top ${fmt(res.areas)}` : 'no per-person scores in response');
  }
  // Counterfactual: decides claims must equal a real re-rank without each love (same manifest)
  for (const [name, city] of [['reader', 'Berlin'], ['indie outdoors', 'Lisbon']]) {
    const st = stateFor(name, city);
    const d = await call('POST', '/api/decides', hybrid(st)); rec.log(`decides ${city}/${name}`, d);
    const base = out[`${city}/${name}`]?.areas ?? [];
    const claimed = [];
    if (d.json?.ablations) for (const ab of d.json.ablations) if (ab.areaId === base[0]?.id) claimed.push({ loveId: ab.loveId, rank: ab.withoutRank });
    if (d.json?.neighborhoods) { const top = d.json.neighborhoods.find(n => n.id === base[0]?.id) ?? d.json.neighborhoods[0]; for (const w of top?.without ?? []) claimed.push({ query: w.query, rank: w.rank }); }
    const issues = [];
    for (const c of claimed) {
      const s2 = stateFor(name, city); s2.loves = s2.loves.filter(l => !(l.chosen.id === c.loveId || l.query === c.query));
      const res = await ranked(s2, `ablate ${city}/${name} -${c.query ?? c.loveId}`);
      const actual = res.areas.find(a => a.id === base[0]?.id)?.rank ?? null;
      const legacyNull = c.rank === null && (actual === null || actual > 8);
      if (!(actual === c.rank || legacyNull)) issues.push(`without ${c.query ?? c.loveId}: claimed #${c.rank}, actual re-rank #${actual}`);
    }
    rec.check(`decides.${city}.${name}`, '5.9 ablation claims equal a real re-rank without that love', LIVE, d.status !== 200 ? 'FAIL' : !claimed.length ? 'FAIL' : issues.length ? 'FAIL' : 'PASS',
      d.status !== 200 ? `HTTP ${d.status}` : `${claimed.length} claims checked for ${base[0]?.name}; ${issues.join('; ') || 'all match'}; summary: ${(d.json?.summary ?? d.json?.claims?.map(c => c.text).join(' ') ?? '').slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- home (§5.7, §5.8, §12.2)
async function homeCall(sourceCity, hood, target, lambda = 0, prof = 'dialogue 1') {
  const st = stateFor(prof, target);
  const r = await call('POST', '/api/home', hybrid(st, { source: { city: sourceCity, neighborhood: hood }, blend: lambda, lambda }), { timeout: 120_000 });
  rec.log(`home ${hood}->${target} l=${lambda}`, r);
  return { r, ...homeOf(r.json) };
}
async function home() {
  const fmtH = m => m.slice(0, 3).map(x => `${x.order}.${x.name} S=${x.similarity ?? 'null'}`).join(' | ');
  // Alfama -> Lisbon (holdout semantics: independent source, no self branch)
  const al = await homeCall('Lisbon', 'Alfama', 'Lisbon');
  {
    const top3 = al.matches.slice(0, 3);
    const near = top3.filter(m => distM(m.center, ALFAMA) <= 800);
    const med = median(top3.map(m => m.similarity));
    const self = al.matches[0];
    rec.check('home.alfama.identity', '12.2 Alfama->Lisbon via HTTP: Alfama-area #1 (center<=800m) with S=100±0.1 (identity; the 20%-holdout runs only in B tests)', LIVE,
      al.r.status !== 200 ? 'FAIL' : self && distM(self.center, ALFAMA) <= 800 && Math.abs((self.similarity ?? 0) - 100) <= 0.1 ? 'PASS' : 'FAIL',
      al.r.status !== 200 ? `HTTP ${al.r.status} ${JSON.stringify(al.r.json)?.slice(0, 200)}` : `${al.r.ms}ms v${al.version} ${fmtH(al.matches)}; within 800m of Alfama: ${near.map(m => `${m.name} ${Math.round(distM(m.center, ALFAMA))}m`).join(', ') || 'none'}; median S top-3=${med}`);
  }
  // order matches the declared criterion at blend 0 (E4 defect)
  for (const [label, res] of [['alfama', al]]) {
    const sims = res.matches.map(m => m.similarity).filter(x => x != null);
    const sorted = sims.every((s, i) => !i || sims[i - 1] >= s);
    rec.check(`home.${label}.order`, '5.7 blend=0 order strictly by S (cards and labels agree)', LIVE, sims.length < 2 ? 'FAIL' : sorted ? 'PASS' : 'FAIL', `S in shown order: ${sims.join(', ')}; orderReason=${res.matches[0]?.orderReason ?? 'n/a'}`);
  }
  // Kreuzberg -> Lisbon vs Reykjavik discrimination
  const kl = await homeCall('Berlin', 'Kreuzberg', 'Lisbon');
  const kr = await homeCall('Berlin', 'Kreuzberg', 'Reykjavik');
  {
    const a = median(kl.matches.slice(0, 3).map(m => m.similarity)), b = median(kr.matches.slice(0, 3).map(m => m.similarity));
    const diff = a != null && b != null ? Math.abs(a - b) : null;
    rec.check('home.kreuzberg.discrimination', '12.2 Kreuzberg->Lisbon/Reykjavik: |median top-3 S| diff >=10 (else must be shown as a tie)', LIVE,
      diff == null ? 'FAIL' : diff >= 10 ? 'PASS' : 'PARTIAL',
      `Lisbon ${kl.r.ms}ms ${fmtH(kl.matches)} (median ${a}); Reykjavik ${kr.r.ms}ms ${fmtH(kr.matches)} (median ${b}); diff=${diff}${diff != null && diff < 10 ? ' -> product must say similar overlap; pitch must drop this contrast' : ''}`);
    for (const [label, res] of [['kreuzberg-lisbon', kl], ['kreuzberg-reykjavik', kr]]) {
      const sims = res.matches.map(m => m.similarity).filter(x => x != null);
      rec.check(`home.${label}.order`, '5.7 blend=0 order strictly by S', LIVE, sims.length < 2 ? 'FAIL' : sims.every((s, i) => !i || sims[i - 1] >= s) ? 'PASS' : 'FAIL', `S: ${sims.join(', ')}`);
      const generic = /^(casual|modern|charming|social|lively|unique)$/i;
      const shared = (res.matches[0]?.shared ?? []).map(s => (typeof s === 'string' ? s : s.label));
      rec.check(`home.${label}.features`, '5.7 shared features are not only generic tags', LIVE, !shared.length ? 'FAIL' : shared.every(s => generic.test(s)) ? 'FAIL' : 'PASS', `top shared: ${shared.join(', ') || 'none'}`);
    }
  }
  // Blend: S stays, header changes
  {
    const bl = await homeCall('Berlin', 'Kreuzberg', 'Lisbon', 0.35);
    const s0 = new Map(kl.matches.map(m => [m.id, m.similarity]));
    const changedS = bl.matches.filter(m => s0.has(m.id) && m.similarity != null && Math.abs(m.similarity - s0.get(m.id)) > 1e-9);
    rec.check('home.blend.keeps-S', '5.7 lambda>0 keeps each area\'s S; order labelled home_personal_blend', LIVE,
      bl.r.status !== 200 ? 'FAIL' : changedS.length ? 'FAIL' : bl.version === 2 && bl.matches[0]?.orderReason !== 'home_personal_blend' ? 'FAIL' : 'PASS',
      `${bl.r.ms}ms ${fmtH(bl.matches)}; S changed for ${changedS.map(m => m.name).join(', ') || 'none'}; orderReason=${bl.matches[0]?.orderReason ?? 'n/a (legacy)'}`);
  }
  // Cities: invalid city partial error + cross-city invariance + city unchanged
  {
    const st = stateFor('dialogue 1', 'Lisbon');
    const src = { city: 'Berlin', neighborhood: 'Kreuzberg' };
    const c3 = await call('POST', '/api/cities', hybrid(st, { cities: ['Lisbon', 'Berlin', 'Atlantiszzzz'], source: src, criteria: ['home_similarity', 'everyday_venues', 'support'] }), { timeout: 150_000 });
    rec.log('cities L/B/Atlantis', c3);
    const rows = c3.json?.results ?? c3.json?.cities ?? [];
    const ok = rows.filter(x => (x.status ? x.status === 'ok' || x.status === 'partial' : !x.error));
    const bad = rows.filter(x => x.status === 'error' || x.error);
    rec.check('cities.invalid-partial', '12.3 [Lisbon, Berlin, Atlantiszzzz]: two results + one separate error, HTTP 200', LIVE,
      c3.status === 200 && ok.length === 2 && bad.length === 1 ? 'PASS' : 'FAIL', `HTTP ${c3.status} ${c3.ms}ms ok=${ok.map(x => x.cityId ?? x.city).join(',')} error=${bad.map(x => `${x.cityId ?? x.city}: ${JSON.stringify(x.error).slice(0, 100)}`).join(',')}`);
    const val = x => (x?.homeMatches ? JSON.stringify([x.culturalOverlap, x.homeMatches.map(m => m.similarity?.value)]) : x?.culturalOverlap ?? x?.similarity ?? x?.score);
    const c2 = await call('POST', '/api/cities', hybrid(st, { cities: ['Lisbon', 'Reykjavik'], source: src, criteria: ['home_similarity', 'everyday_venues', 'support'] }), { timeout: 150_000 });
    const c3b = await call('POST', '/api/cities', hybrid(st, { cities: ['Lisbon', 'Reykjavik', 'Berlin'], source: src, criteria: ['home_similarity', 'everyday_venues', 'support'] }), { timeout: 150_000 });
    rec.log('cities L/R', c2); rec.log('cities L/R/B', c3b);
    const pick = (j, re) => (j?.results ?? j?.cities ?? []).find(x => re.test(x.cityName ?? x.cityId ?? x.city ?? ''));
    const pairs = [[/Lisbon/i, 'Lisbon'], [/Reykjav/i, 'Reykjavik']].map(([re, n]) => [n, val(pick(c2.json, re)), val(pick(c3b.json, re))]);
    const okInv = pairs.every(([, a, b]) => a != null && b != null && (typeof a === 'number' ? Math.abs(a - b) <= 1e-9 : a === b));
    rec.check('cities.third-city-invariance', '12.2 adding a third city does not change computed values (1e-9)', LIVE, okInv ? 'PASS' : 'FAIL', pairs.map(([n, a, b]) => `${n} ${a} vs ${b}`).join('; '));
    const rec2 = c2.json?.recommendation;
    rec.check('cities.recommendation', '5.8 recommendation only outside a tie, with claims', LIVE, 'INFO', `recommendation=${rec2 ? JSON.stringify(rec2).slice(0, 200) : 'none'}; values ${pairs.map(([n, a]) => `${n}=${a}`).join(', ')}`);
  }
}

// ---------------------------------------------------------------- venues (§6, §12.3)
function venuesOf(j) {
  if (Array.isArray(j?.venues)) return j.venues.map(v => ({ ...(v.place ?? v), role: v.role, eligibility: v.eligibility, priceStatus: v.priceStatus, brandKey: v.brandKey, insideArea: v.insideArea, connections: v.connections }));
  return j?.places ?? [];
}
async function venueSearch(prof, city, intent, categories, constraints = [], cityWide = false) {
  const st = stateFor(prof, city);
  const nb = await ranked(st, `nbh for venues ${city}/${prof}`);
  const r = await call('POST', '/api/places', hybrid(st, { intent, neighborhoodId: nb.areas[0]?.id, ...(cityWide ? {} : { areaId: nb.areas[0]?.id }), categories, constraints, excludeIds: [] }));
  rec.log(`places ${intent} ${city}`, r);
  return { r, venues: venuesOf(r.json), version: Array.isArray(r.json?.venues) ? 2 : 1, area: nb.areas[0]?.name };
}
const C = (id, kind, value, strength = 'hard') => ({ id, kind, value, strength, source: 'user' });
async function venues() {
  for (const city of CITIES) {
    const d = await venueSearch('techno', city, 'dance', ['drinks'], [C('no-hotel', 'exclude_type', 'hotel'), C('no-adult', 'exclude_type', 'adult')], true);
    const top = d.venues.slice(0, 5);
    const bad = top.filter(p => { const f = venueFlags(p); return f.adult || f.hotel; });
    const danceish = top.filter(p => { const f = venueFlags(p); return f.danceType || f.musicVenue; });
    rec.check(`venues.dance.${city}`, '12.3 top-5 dance: 0 adult / hotel venues; venues are dance/electronic', LIVE,
      d.r.status !== 200 || !top.length ? 'FAIL' : bad.length ? 'FAIL' : danceish.length >= Math.min(2, top.length) ? 'PASS' : 'FAIL',
      `v${d.version} ${d.r.ms}ms area=${d.area} (city-wide): ${top.map(p => `${p.name} [${venueFlags(p).types.split(' ').filter(t => /genre:place:/.test(t)).slice(0, 2).join(',').replace(/urn:tag:genre:place:/g, '')}]`).join('; ')}; adult/hotel: ${bad.map(p => p.name).join(', ') || 'none'}; dance/music-typed ${danceish.length}/${top.length}`);
    const c = await venueSearch('reader', city, 'coffee', ['coffee']);
    const ctop = c.venues.slice(0, 5);
    const cbad = ctop.filter(p => { const f = venueFlags(p); return f.grocery || (f.bar && !f.coffeeType); });
    rec.check(`venues.coffee.${city}`, '12.3 top-5 coffee: 0 supermarket/gas/bar-in-coffee-role', LIVE,
      c.r.status !== 200 || !ctop.length ? 'FAIL' : cbad.length ? 'FAIL' : 'PASS',
      `v${c.version} ${c.r.ms}ms area=${c.area}: ${ctop.map(p => p.name).join('; ')}; bad: ${cbad.map(p => `${p.name} (${venueFlags(p).types.slice(0, 80)})`).join(', ') || 'none'}`);
    const ids = [...d.venues, ...c.venues].map(p => p.id);
    rec.check(`venues.dupes.${city}`, '12.3 0 repeated venue IDs in a list', LIVE, new Set(d.venues.map(p => p.id)).size === d.venues.length && new Set(c.venues.map(p => p.id)).size === c.venues.length ? 'PASS' : 'FAIL', `${ids.length} ids`);
  }
  // Composite plan: no museums + no bars + vegetarian (§12.3), then swap
  const st = stateFor('reader', 'Lisbon', { days: 1, pace: 'relaxed' });
  const nb = await ranked(st, 'nbh for plan');
  const constraints = [C('no-museums', 'exclude_type', 'museum'), C('no-bars', 'exclude_type', 'bar'), C('veg', 'dietary', 'vegetarian')];
  const planBody = extra => hybrid(st, { neighborhoodIds: [nb.areas[0]?.id], areaIds: [nb.areas[0]?.id], excludeCategories: ['drinks'], excludeTags: ['urn:tag:genre:place:museum'], constraints, exclude: [], include: [], excludeIds: [], includeIds: [], ...extra });
  let lastItinerary = null;
  const p1 = await call('POST', '/api/plan', planBody({}), { timeout: 120_000 }); rec.log('plan composite', p1);
  const auditStops = (j, label) => {
    const days = j?.itinerary?.days ?? j?.days ?? [];
    const stops = days.flatMap(dd => dd.stops ?? []);
    const viol = [];
    for (const s of stops) {
      const f = venueFlags(s.place);
      if (f.museum) viol.push(`${s.place.name}: museum`);
      if (f.bar && !/coffee|cafe/.test(f.types)) viol.push(`${s.place.name}: bar types ${f.barTypes.join(',').replace(/urn:tag:(genre|category):place:/g, '') || s.place.category}`);
      else if (f.barName) viol.push(`${s.place.name}: bar by name (check)`);
    }
    const ids = stops.map(s => s.place.id);
    if (new Set(ids).size !== ids.length) viol.push('duplicate stop ids');
    const vegUnknown = stops.filter(s => ['food', 'coffee'].includes(s.place.category) && !/vegetarian|vegan/i.test([...(s.place.tags ?? []).map(t => t.id), ...(s.place.classifications ?? []), ...(s.place.keywords ?? []), s.place.description ?? ''].join(' '))).map(s => s.place.name);
    lastItinerary = j?.itinerary ?? null;
    const auditV2 = j?.audit;
    rec.check(`plan.${label}.hard`, '12.3 0 hard violations (museum, bar) and 0 duplicate stops', LIVE, !stops.length ? 'FAIL' : viol.length ? 'FAIL' : 'PASS',
      `${stops.length} stops: ${stops.map(s => `${s.time} ${s.place.name} [${s.place.category}]`).join('; ')}; violations: ${viol.join('; ') || 'none'}; audit.hardViolations=${auditV2 ? auditV2.hardViolations?.length : 'n/a'}`);
    rec.check(`plan.${label}.vegetarian`, '12.3 hard vegetarian: every food/coffee stop carries vegetarian/vegan evidence', LIVE, vegUnknown.length ? 'FAIL' : 'PASS',
      `food stops without a vegetarian tag: ${vegUnknown.join(', ') || 'none'}; audit unmet/warnings: ${JSON.stringify(auditV2?.unmet ?? auditV2?.warnings ?? null)?.slice(0, 200)}`);
    return stops;
  };
  const stops = auditStops(p1.json, 'composite');
  if (stops.length >= 3) {
    const victim = stops[1].place.id;
    const keep = stops.filter((_, i) => i !== 1).map(s => s.place.id);
    const p2 = await call('POST', '/api/plan', planBody({ exclude: [victim], excludeIds: [victim], include: keep, includeIds: keep, existingItinerary: lastItinerary ?? undefined, replacePlaceId: victim }), { timeout: 120_000 }); rec.log('plan swap', p2);
    const s2 = auditStops(p2.json, 'swap');
    const ids2 = s2.map(s => s.place.id);
    const lost = keep.filter(id => !ids2.includes(id));
    rec.check('plan.swap.keeps', '12.3 swap: remaining IDs kept 100%, removed ID absent, constraints kept', LIVE, !ids2.includes(victim) && !lost.length ? 'PASS' : 'FAIL',
      `removed ${stops[1].place.name}: ${ids2.includes(victim) ? 'STILL PRESENT' : 'absent'}; lost kept stops: ${lost.length}`);
  }
  // Budget $ with 3 days: no unknown price promised under budget
  {
    const sb = stateFor('reader', 'Lisbon', { days: 3, budget: 1, pace: 'balanced' });
    const pb = await call('POST', '/api/plan', hybrid(sb, { neighborhoodIds: [nb.areas[0]?.id], areaIds: [nb.areas[0]?.id], constraints: [C('budget', 'budget', 1)], exclude: [], include: [] }), { timeout: 120_000 });
    rec.log('plan $ 3 days', pb);
    const days = pb.json?.itinerary?.days ?? pb.json?.days ?? [];
    const all = days.flatMap(d => d.stops ?? []);
    const unknown = all.filter(s => s.place.priceLevel == null), over = all.filter(s => s.place.priceLevel > 1);
    const ids = all.map(s => s.place.id);
    const brandDays = days.map(d => { const b = (d.stops ?? []).map(s => brandOf(s.place)); return b.length - new Set(b).size; });
    const evid = pb.json?.venueEvidence;
    const unknownFlagged = evid ? unknown.every(s => evid[s.place.id]?.priceStatus === 'unknown') : false;
    rec.check('plan.budget', '6.3 hard $ budget: the main plan holds only confirmed-within-budget stops (unknown price goes to a separate list)', LIVE,
      !all.length ? 'FAIL' : over.length || unknown.length ? 'FAIL' : 'PASS',
      `${all.length} stops over ${days.length} days; over budget ${over.length}; unknown price ${unknown.length}${unknown.length ? ` (${unknown.slice(0, 4).map(s => s.place.name).join(', ')})` : ''}; unknown flagged as unknown in evidence: ${unknownFlagged}`);
    rec.check('plan.budget.dupes', '12.3 0 repeated venue IDs; <=1 brand per day', LIVE, new Set(ids).size === ids.length && brandDays.every(x => x === 0) ? 'PASS' : 'FAIL', `ids ${ids.length}/${new Set(ids).size} unique; brand repeats per day ${brandDays.join(',')}`);
  }
}

// ---------------------------------------------------------------- edge (§12.3)
async function edge() {
  const g = await call('GET', '/api/search?q=zxqv-no-such-band-92841'); rec.log('search gibberish', g);
  const res = g.json?.results ?? [];
  const resolution = g.json?.resolution;
  rec.check('edge.gibberish', '12.3 zxqv-no-such-band-92841 -> no_match, never No1 Lounge at Luton Airport', LIVE,
    res.some(r => /Luton/i.test(r.name)) ? 'FAIL' : res.length && resolution !== 'ambiguous' ? 'FAIL' : 'PASS',
    `HTTP ${g.status} resolution=${resolution ?? 'n/a'} results: ${res.map(r => `${r.name} (${r.domain})`).join(', ') || 'none'}`);
  const g2 = await call('GET', '/api/search?q=qwzxv'); rec.log('search qwzxv', g2);
  rec.check('edge.gibberish2', 'qwzxv -> no popular namesake', LIVE, (g2.json?.results ?? []).length && g2.json?.resolution !== 'ambiguous' ? 'FAIL' : 'PASS', `results: ${(g2.json?.results ?? []).map(r => r.name).join(', ') || 'none'} resolution=${g2.json?.resolution ?? 'n/a'}`);
  const u = await call('POST', '/api/neighborhoods', hybrid(stateFor('reader', 'Qwzxplorvillle'))); rec.log('unknown city', u);
  rec.check('edge.unknown-city', 'unknown city -> 4xx with readable message, not 500 or another city', LIVE, u.status >= 400 && u.status < 500 ? 'PASS' : 'FAIL', `HTTP ${u.status} ${JSON.stringify(u.json)?.slice(0, 200)}`);
  // localities: typed text vs confirmed city
  const l = await call('GET', '/api/localities?q=Reykjav'); rec.log('localities Reykjav', l);
  rec.check('edge.localities', 'localities returns candidates with country/coordinates', LIVE, l.status === 200 && JSON.stringify(l.json).includes('Reykjav') ? 'PASS' : 'FAIL', `HTTP ${l.status} ${JSON.stringify(l.json)?.slice(0, 200)}`);
}

const suites = { matrix, home, venues, edge };
const run = suite === 'all' ? Object.keys(suites) : suite.split(',');
console.log(`Q http ${run.join(',')} against ${rec.revision.rev} at ${new Date().toISOString()}`);
for (const s of run) {
  try { await suites[s](); } catch (e) { rec.check(`${s}.runner`, 'suite completed', 'automated', 'FAIL', `runner exception: ${e?.stack?.slice(0, 400) ?? e}`); }
}
rec.write();
