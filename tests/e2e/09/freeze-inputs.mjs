// Package Q: resolve the reference profiles ONCE and freeze exact entity IDs + domains (§12.1).
// Usage: node freeze-inputs.mjs [baseUrl]   -> writes frozen-inputs.json next to this file.
// Never re-run after the matrix is in use unless an ID is proven wrong; record why in 09-qa.out.md.
import { writeFileSync, existsSync } from 'node:fs';

import { join } from 'node:path';


const BASE = process.argv[2] ?? 'http://localhost:3001';
const out = process.env.QA_DIR ? join(process.env.QA_DIR, 'frozen-inputs.json') : 'C:/Users/user/Desktop/qloo/tasks/09-qa/frozen-inputs.json';
if (existsSync(out) && !process.argv.includes('--force')) { console.error('frozen-inputs.json exists; pass --force to overwrite'); process.exit(1); }

const P = (name, tastes) => ({ name, tastes: tastes.map(([query, domain]) => ({ query, domain })) });
const profiles = [
  P('techno', [['Ben Klock', 'artist'], ['Kantine am Berghain', 'place'], ['Rick Owens', 'brand']]),
  P('reader', [['Haruki Murakami', 'author'], ['Radiohead', 'artist'], ['Fleabag', 'tv_show']]),
  P('night owl', [['Charli XCX', 'artist'], ['PEGGY GOU', 'artist'], ['Euphoria', 'tv_show']]),
  P('pop', [['Taylor Swift', 'artist'], ['Bridgerton', 'tv_show'], ['Starbucks', 'brand']]),
  P('metal sport', [['Metallica', 'artist'], ['Real Madrid CF', 'brand']]),
  P('indie outdoors', [['Radiohead', 'artist'], ['Fleabag', 'tv_show'], ['Wes Anderson', 'person'], ['Patagonia', 'brand']]),
  // held-out (§12.1): parameters must not be tuned after these
  P('heldout amsterdam', [['Björk', 'artist'], ['Spirited Away', 'movie'], ['The Left Hand of Darkness', 'book']]),
  P('heldout montreal', [['Aphex Twin', 'artist'], ['Arrival', 'movie']]),
  // dialogue profiles (§9)
  P('dialogue 1', [['Radiohead', 'artist'], ['Fleabag', 'tv_show'], ['Patagonia', 'brand']]),
  P('weight pair', [['Radiohead', 'artist'], ['Aphex Twin', 'artist']]),
];

const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const resolved = {};
for (const p of profiles) for (const t of p.tastes) {
  const key = `${t.query}|${t.domain}`;
  if (resolved[key]) continue;
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(t.query)}&domain=${t.domain}`);
  const body = await r.json();
  const results = body.results ?? [];
  const exact = results.find(e => norm(e.name) === norm(t.query));
  const chosen = exact ?? results[0] ?? null;
  resolved[key] = {
    status: r.status, exact: !!exact,
    chosen: chosen && { id: chosen.id, name: chosen.name, domain: chosen.domain },
    alternatives: results.slice(0, 4).map(e => ({ id: e.id, name: e.name, domain: e.domain })),
  };
  console.log(`${key} -> ${chosen ? `${chosen.name} ${chosen.id} (${chosen.domain})${exact ? '' : ' NOT EXACT'}` : 'NO RESULT'}`);
}

const frozen = {
  frozenAt: new Date().toISOString(),
  resolvedVia: `${BASE}/api/search (domain-restricted)`,
  note: 'Exact entity IDs used by every Q check. Berghain and Kantine am Berghain are different inputs (§12.1).',
  cities: { berlin: 'Berlin', lisbon: 'Lisbon', amsterdam: 'Amsterdam', montreal: 'Montreal', reykjavik: 'Reykjavik' },
  profiles: profiles.map(p => ({
    name: p.name,
    loves: p.tastes.map(t => ({ query: t.query, domain: t.domain, entity: resolved[`${t.query}|${t.domain}`].chosen, exact: resolved[`${t.query}|${t.domain}`].exact })),
  })),
  resolution: resolved,
};
writeFileSync(out, JSON.stringify(frozen, null, 2));
console.log('wrote', out);
