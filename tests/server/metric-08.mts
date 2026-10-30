// Live diagnostic only: outputs stay outside the repository. No saved provider fixtures.
import { loadEnvFile } from 'node:process';
import { appendFileSync } from 'node:fs';
import { profile, profiles } from './profiles-08';
import { buildField } from '../../src/server/engine/field';
import { getCityEvidence } from '../../src/server/engine/evidence';
import { coordinates, focusRadius, haversine, mean, median } from '../../src/server/engine/geo';
import { neighborhoodName, normalizedAreaName } from '../../src/server/engine/neighborhoods';
import type { FieldCell } from '../../src/shared/contracts';
loadEnvFile('.env.local');
const log = (line: string) => { console.log(line); if (process.argv.includes('--report')) appendFileSync('C:/Users/user/Desktop/qloo/tasks/08-engine.out.md', line + '\n'); };
log('\n## Follow-up metric investigation\n');
log('Two fixed candidates: area-mean ratio lift, and centered per-love percentile mean. Both use three neutral pseudo-cells (n / (n + 3)), then the existing crowd discount. No city-specific parameters.');
for (const city of ['Berlin', 'Lisbon']) {
  const wins = new Map<string, Record<string, number>>();
  for (const p of profiles) {
    const state = await profile(city, p.tastes);
    const [field, evidence] = await Promise.all([buildField(state), getCityEvidence(state)]);
    const radius = focusRadius(field.center, field.cells);
    const grouped = new Map<string, { ids: Set<string>; points: [number, number][] }>();
    for (const row of evidence.yours) {
      const name = neighborhoodName(row), point = coordinates(row);
      if (!name || !point || !row.entity_id || normalizedAreaName(name) === normalizedAreaName(city) || haversine(field.center, point) > radius) continue;
      const group = grouped.get(name) ?? { ids: new Set<string>(), points: [] };
      if (!group.ids.has(String(row.entity_id))) { group.ids.add(String(row.entity_id)); group.points.push(point); }
      grouped.set(name, group);
    }
    const areas = [...grouped].filter(([, g]) => g.ids.size >= 3).map(([name, g]) => ({ name, center: [median(g.points.map(p => p[0])), median(g.points.map(p => p[1]))] as [number, number], cells: [] as FieldCell[] }));
    for (const cell of field.cells) {
      let nearest: typeof areas[number] | undefined; let distance = 1600;
      for (const area of areas) { const d = haversine([cell.lon, cell.lat], area.center); if (d <= distance) { nearest = area; distance = d; } }
      nearest?.cells.push(cell);
    }
    const candidates = areas.filter(a => a.cells.some(c => c.you > 0)).map(a => {
      const n = a.cells.length, reliability = n / (n + 3);
      const ratio = mean(a.cells.map(c => ((1 + reliability * (c.lift ?? 0)) * (1 - .7 * state.discovery * c.popularity)) - 1));
      const percentile = mean(a.cells.map(c => (1 + reliability * (2 * c.you / (1 - .7 * state.discovery * c.popularity) - 1)) * (1 - .7 * state.discovery * c.popularity) - 1));
      return { name: a.name, n, ratio, percentile, old: mean(a.cells.map(c => c.you)), oldLift: mean(a.cells.map(c => c.lift ?? 0)) };
    });
    for (const method of ['old', 'ratio', 'percentile'] as const) {
      const ranked = [...candidates].sort((a, b) => b[method] - a[method]);
      const counts = wins.get(method) ?? {}; counts[ranked[0].name] = (counts[ranked[0].name] ?? 0) + 1; wins.set(method, counts);
      log(`${city} / ${p.name} / ${method}: ${ranked.slice(0, 3).map(a => `${a.name} ${a[method].toFixed(4)} (n=${a.n}, raw lift=${(100*a.oldLift).toFixed(1)}%)`).join(' | ')}`);
    }
  }
  for (const [method, counts] of wins) log(`${city} / ${method} winners: ${JSON.stringify(counts)}`);
}
