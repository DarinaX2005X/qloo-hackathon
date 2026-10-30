// Package Q (stage 09, §16.1): record one live run of the core journey as the evidence manifest for media.
// Usage: node tests/e2e/09/release-manifest.mjs [label]
// Writes tasks/09-evidence/release-manifest[-label].json and .md. Stores result fields, IDs and versions only
// (no raw provider responses, no keys). Every public number must come from here.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, srcRevision, stateFor, hybrid, call, areasOf, homeOf, frozen } from './lib.mjs';

const label = process.argv[2] ?? '';
const dir = process.env.EVIDENCE_DIR || 'C:/Users/user/Desktop/qloo/tasks/09-evidence';
mkdirSync(dir, { recursive: true });
const C = (id, kind, value) => ({ id, kind, value, strength: 'hard', source: 'user' });
const capturedAt = new Date().toISOString();
const rev = srcRevision();
const profileName = 'dialogue 1';
const city = 'Lisbon';
const state = stateFor(profileName, city);
const steps = [];
const step = (name, res, fields) => { steps.push({ name, http: res.status, ms: res.ms, meta: res.json?.meta ?? null, ...fields }); };

const nb = await call('POST', '/api/neighborhoods', hybrid(state));
const a = areasOf(nb.json);
step('shortlist', nb, {
  candidateCount: a.areas[0]?.candidateCount, allCandidateIds: a.allCandidateIds?.length,
  top3: a.areas.slice(0, 3).map(x => ({ id: x.id, name: x.name, rank: x.rank, tasteScore: x.score, percentile: x.percentile, tieBand: x.tieBand, support: x.support?.quality, status: x.status, headline: x.headline, tradeoff: x.tradeoff, anchors: (x.anchors ?? []).map(p => ({ id: p.id, name: p.name, role: p.role, priceStatus: p.priceStatus })) })),
});
const dec = await call('POST', '/api/decides', hybrid(state, { analysisId: nb.json?.meta?.analysisId, areaId: a.areas[0]?.id }));
step('why', dec, { claims: dec.json?.claims ?? [], ablationsForTop: (dec.json?.ablations ?? []).filter(x => x.areaId === a.areas[0]?.id) });
const home = await call('POST', '/api/home', hybrid(state, { source: { city: 'Berlin', neighborhood: 'Kreuzberg' }, lambda: 0 }), { timeout: 120_000 });
const h = homeOf(home.json);
step('home Kreuzberg -> Lisbon', home, {
  referenceVersion: home.json?.meta?.referenceVersion ?? h.source?.referenceVersion, method: h.matches[0]?.method,
  source: { name: h.source?.area?.name, venueCount: h.source?.venueCount, features: (h.source?.features ?? []).slice(0, 6).map(f => f.label), representatives: (h.source?.representatives ?? []).slice(0, 8).map(r => r.place?.name) },
  top3: h.matches.slice(0, 3).map(m => ({ id: m.id, name: m.name, similarity: m.similarity, support: m.support, orderReason: m.orderReason, shared: (m.shared ?? []).map(s => s.label ?? s), counterparts: (m.counterparts ?? []).map(c => ({ sourcePlaceId: c.sourcePlaceId, target: c.target?.place?.name })) })),
});
const alf = await call('POST', '/api/home', hybrid(state, { source: { city: 'Lisbon', neighborhood: 'Alfama' }, lambda: 0 }), { timeout: 120_000 });
step('home Alfama -> Lisbon (identity)', alf, { top3: homeOf(alf.json).matches.slice(0, 3).map(m => ({ name: m.name, similarity: m.similarity })) });
const cons = [C('no-museums', 'exclude_type', 'museums'), C('no-bars', 'exclude_type', 'bars'), C('budget', 'budget', 2)];
const spot = await call('POST', '/api/spot', hybrid(state, { query: 'Rua da Rosa 120', constraints: cons }));
step('address Rua da Rosa 120', spot, { label: spot.json?.label, geocodeQuality: spot.json?.geocodeQuality, area: spot.json?.area?.area?.name, outsideSelectedArea: spot.json?.outsideSelectedArea, nearby: (spot.json?.nearby ?? []).map(n => ({ name: n.venue?.place?.name, walkMinutes: n.walkMinutes, priceStatus: n.venue?.priceStatus })), audit: spot.json?.constraintsAudit });
const areaForVisit = spot.json?.area?.area?.id ?? a.areas[0]?.id;
const visit = await call('POST', '/api/plan', hybrid({ ...state, days: 1, pace: 'relaxed' }, { areaIds: [areaForVisit], startHour: 14, constraints: cons, includeIds: [], excludeIds: [] }), { timeout: 120_000 });
step('visit', visit, { areaId: areaForVisit, stops: (visit.json?.itinerary?.days ?? []).flatMap(d => d.stops.map(s => ({ time: s.time, name: s.place.name, id: s.place.id, priceLevel: s.place.priceLevel ?? null }))), audit: visit.json?.audit, recoveryLog: visit.json?.recoveryLog });
const cities = await call('POST', '/api/cities', hybrid(state, { cities: ['Lisbon', 'Reykjavik'], source: { city: 'Berlin', neighborhood: 'Kreuzberg' }, criteria: ['home_similarity', 'everyday_venues', 'support'] }), { timeout: 150_000 });
step('compare Lisbon / Reykjavik from Kreuzberg', cities, { results: (cities.json?.results ?? []).map(r => ({ city: r.cityName, status: r.status, culturalOverlap: r.culturalOverlap })), recommendation: cities.json?.recommendation ?? null });

const manifest = {
  runId: `q-release-${capturedAt}`, capturedAt, url: BASE, appRevision: rev,
  profile: { name: profileName, city, loves: frozen.profiles.find(p => p.name === profileName).loves.map(l => ({ query: l.query, id: l.entity.id, domain: l.entity.domain, weight: 1 })), constraintsForAddressAndVisit: cons },
  versions: { manifestVersion: nb.json?.meta?.manifestVersion, methodVersion: nb.json?.meta?.methodVersion, homeReferenceVersion: home.json?.meta?.referenceVersion ?? null, homeMethod: h.matches[0]?.method ?? null },
  steps,
  knownLimitations: [
    'Percentiles are null (native-rank method failed its gate); areas are exploratory starting points with real venue evidence.',
    'Areas are 650 m circles around approximate centres, not official boundaries; ranking context uses fixed cells within 1.6 km.',
    'Home similarity is style_only_v1, an index out of 100, not a probability; Kreuzberg Lisbon/Reykjavik gap is below the 10-point gate, so no city winner is claimed.',
    'Address precision is street level; the house number is not verified.',
    'Single live run on the dev server; timings are single measurements, not p95.',
  ],
};
const base = join(dir, `release-manifest${label ? `-${label}` : ''}`);
writeFileSync(`${base}.json`, JSON.stringify(manifest, null, 2));
const md = [
  `# Release evidence manifest ${label}`.trim(), '',
  `Captured ${capturedAt} from ${BASE}; src revision ${rev.rev} (newest change ${rev.newestSrcChange}).`,
  `Manifest ${manifest.versions.manifestVersion}; method ${manifest.versions.methodVersion}; Home ${manifest.versions.homeMethod} / ${manifest.versions.homeReferenceVersion}.`, '',
  `Profile: ${manifest.profile.loves.map(l => `${l.query} (${l.id})`).join(', ')}; city ${city}.`, '',
  '| Step | HTTP | ms | Result fields |', '| --- | --- | --- | --- |',
  ...steps.map(s => `| ${s.name} | ${s.http} | ${s.ms} | ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => !['name', 'http', 'ms', 'meta'].includes(k)))).replace(/\|/g, '/').slice(0, 900)} |`),
  '', '## Known limitations', '', ...manifest.knownLimitations.map(x => `- ${x}`),
].join('\n');
writeFileSync(`${base}.md`, md + '\n');
console.log('wrote', `${base}.json`, `${base}.md`);
