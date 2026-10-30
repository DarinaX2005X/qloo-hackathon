import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planFromPlaces, solvePlan, minutes, excludedPlace, planDayNote, MAX_RECOVERY_ATTEMPTS, MAX_RECOVERY_QLOO_CALLS, PLAN_QLOO_CALL_LIMIT } from '@/server/engine/plan';
import { consumeQlooCall } from '@/server/qloo/budget';
import { rankNeighborhoods } from '@/server/engine/neighborhoods';
import { getCityEvidence } from '@/server/engine/evidence';
import { placesNear, placeFromRow } from '@/server/engine/places';
import { place, state, venue } from './helpers';
import { qlooGet } from '@/server/qloo/client';
import type { Neighborhood } from '@/shared/contracts';

vi.mock('@/server/engine/neighborhoods', async original => ({ ...await original<typeof import('@/server/engine/neighborhoods')>(), rankNeighborhoods: vi.fn() }));
vi.mock('@/server/engine/evidence', () => ({ getCityEvidence: vi.fn() }));
vi.mock('@/server/qloo/client', async original => ({ ...await original<typeof import('@/server/qloo/client')>(), qlooGet: vi.fn() }));
vi.mock('@/server/engine/places', async original => ({ ...await original<typeof import('@/server/engine/places')>(), placesNear: vi.fn() }));
const now = new Date('2026-11-01T00:00:00Z');
const area = (id: string): Neighborhood => ({ id, name: id, center: [0, 0], score: .5, you: .5, rank: 1, drivers: [], matchedTags: [], vibe: 'mixed', cellIds: [], samplePlaces: [] });
const pool = () => ['coffee', 'culture', 'food', 'coffee', 'food', 'drinks'].map((category, i) => place(`p${i}`, { category: category as 'coffee' | 'culture' | 'food' | 'drinks' }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(rankNeighborhoods).mockResolvedValue([area('Empty'), area('Next')]); vi.mocked(getCityEvidence).mockResolvedValue({ yours: [], fingerprint: { you: [] } }); });

describe('08 plan recovery and explicit reasons', () => {
  it('preserves completed relaxed stops when swapping the first stop across two packed days', () => {
    const places = [
      ...Array.from({ length: 16 }, (_, i) => place(`coffee-${String(i).padStart(2, '0')}`)),
      ...Array.from({ length: 6 }, (_, i) => place(`food-${i}`, { category: 'food' })),
      ...Array.from({ length: 3 }, (_, i) => place(`drinks-${i}`, { category: 'drinks' })),
    ];
    const areas = [{ id: 'a', name: 'A', places }];
    const options = { pace: 'packed' as const, relaxCategories: true };
    const before = planFromPlaces(2, areas, now, options);
    const removed = before.days[0].stops[0].place.id;
    const after = planFromPlaces(2, areas, now, { ...options, exclude: [removed], include: [removed] });
    expect(before.days.every(day => day.stops.length === 8)).toBe(true);
    expect(before.days[0].stops.some(s => s.reasonCodes?.includes('relaxed_category'))).toBe(true);
    expect(after.days.flatMap(day => day.stops).some(s => s.place.id === removed)).toBe(false);
    for (const [d, day] of before.days.entries()) for (const [i, stop] of day.stops.entries()) {
      if (stop.place.id !== removed) expect(after.days[d].stops[i].place.id).toBe(stop.place.id);
    }
    expect(after.days[1].missing.join(' ')).toContain('excluded from this plan');
  });
  it.each([false, true])('keeps ID exclusions absolute through includes, alternate areas, second-day and wide recovery (wide=%s)', async wide => {
    vi.mocked(rankNeighborhoods).mockResolvedValue(['A', 'B', 'C'].map(area));
    const forbidden = place('removed', { affinity: 1 });
    vi.mocked(placesNear).mockImplementation(async (_s, n, _c, _f, options) => {
      if (!options?.radius || (wide && options.radius !== 2200)) return [forbidden];
      const id = typeof n === 'object' && n && 'id' in n ? n.id : 'pool';
      return [forbidden, ...Array.from({ length: 3 }, (_, batch) => pool().map(p => ({ ...p, id: `${id}-${batch}-${p.id}` }))).flat()];
    });
    const result = await solvePlan(state({ days: 2, pace: 'packed' }), ['A', 'B'], { exclude: ['removed'], include: ['removed'] });
    expect(result.days.some(day => day.stops.length > 0)).toBe(true);
    expect(result.days.flatMap(day => day.stops).every(s => s.place.id !== 'removed')).toBe(true);
    expect(vi.mocked(placesNear).mock.calls.some(call => call[4]?.radius === (wide ? 2200 : 900))).toBe(true);
    const ids = result.days.flatMap(day => day.stops.map(s => s.place.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('does not fetch a conflicting include that the person explicitly excluded', async () => {
    vi.mocked(placesNear).mockResolvedValue(pool());
    const result = await solvePlan(state({ days: 1 }), ['Empty'], { include: ['removed'], exclude: ['removed'] });
    expect(qlooGet).not.toHaveBeenCalled();
    expect(result.days[0].missing.join(' ')).toContain('removed: excluded from this plan');
  });
  it('shares at most three alternate-area attempts and one wider attempt across all three days', async () => {
    const ranked = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(area);
    vi.mocked(rankNeighborhoods).mockResolvedValue(ranked);
    vi.mocked(placesNear).mockResolvedValue([]);
    const result = await solvePlan(state({ days: 3 }), ['A', 'B', 'C']);
    const recovery = vi.mocked(placesNear).mock.calls.filter(call => call[4]?.radius);
    expect(recovery).toHaveLength(MAX_RECOVERY_ATTEMPTS);
    expect(recovery.filter(call => call[4]?.radius === 900)).toHaveLength(3);
    expect(recovery.filter(call => call[4]?.radius === 2200)).toHaveLength(1);
    expect(placesNear).toHaveBeenCalledTimes(3 + MAX_RECOVERY_ATTEMPTS);
    expect(result.days.every(day => day.note?.includes('within this search'))).toBe(true);
  });
  it('skips both place fan-out and recovery when all planned categories are excluded', async () => {
    const result = await solvePlan(state({ days: 3 }), ['Empty'], { excludeCategories: ['coffee', 'culture', 'food', 'drinks'], include: ['also-excluded'] });
    expect(placesNear).not.toHaveBeenCalled(); expect(qlooGet).not.toHaveBeenCalled();
    expect(result.days.every(day => !day.stops.length && day.note?.includes('Your exclusions'))).toBe(true);
  });
  it('does not recover intentionally excluded slots when the other slots are filled', async () => {
    vi.mocked(placesNear).mockResolvedValue(pool().filter(p => p.category !== 'culture'));
    const result = await solvePlan(state({ days: 1 }), ['Empty'], { excludeCategories: ['culture'] });
    expect(result.days[0].missing).toEqual(['Morning culture']);
    expect(placesNear).toHaveBeenCalledTimes(1);
    expect(vi.mocked(placesNear).mock.calls[0][2]).not.toContain('culture');
  });
  it('caps recovery transport attempts even when an individual pool needs retries', async () => {
    vi.mocked(rankNeighborhoods).mockResolvedValue(['A', 'B', 'C', 'D', 'E'].map(area));
    let calls = 0;
    vi.mocked(placesNear).mockImplementation(async (_s, _n, _c, _f, options) => {
      if (options?.radius) for (let i = 0; i < 15; i++) { consumeQlooCall(); calls++; }
      return [];
    });
    const result = await solvePlan(state({ days: 3 }), ['A']);
    expect(calls).toBe(MAX_RECOVERY_QLOO_CALLS);
    expect(result.days.every(day => day.note?.includes('within this search'))).toBe(true);
    expect(vi.mocked(placesNear).mock.calls.filter(call => call[4]?.radius).length).toBeLessThanOrEqual(MAX_RECOVERY_ATTEMPTS);
  });
  it('caps the whole plan, including work done before recovery', async () => {
    let calls = 0;
    vi.mocked(rankNeighborhoods).mockImplementation(async () => {
      for (let i = 0; i < PLAN_QLOO_CALL_LIMIT - 5; i++) { consumeQlooCall(); calls++; }
      return [area('A')];
    });
    vi.mocked(placesNear).mockImplementation(async () => {
      for (let i = 0; i < 10; i++) { consumeQlooCall(); calls++; }
      return [];
    });
    await expect(solvePlan(state({ days: 1 }), ['A'])).rejects.toMatchObject({ error: { code: 'quota' } });
    expect(calls).toBe(PLAN_QLOO_CALL_LIMIT);
  });
  it('excludes museum/gallery tags, unnamed primary genres and place types while preserving other culture', () => {
    const forbidden = [
      place('typed', { category: 'culture', classifications: ['urn:entity:place:museum'] }),
      place('gallery', { category: 'culture', tags: [{ id: 'urn:tag:genre:place:art_gallery', name: 'Art gallery', kind: 'genre' }] }),
      ...['Museum of Things', 'Museu de Lisboa', 'Museo Nacional', 'Musée Moderne', 'Naturkundemuseum'].map(name => place(name, { category: 'culture' })),
    ];
    for (const raw of [
      { ...venue('unnamed tag', 'A'), tags: [{ id: 'urn:tag:genre:place:museum' }] },
      { ...venue('primary only', 'A'), tags: [], properties: { primary_genre: { id: 'urn:tag:genre:place:art_gallery' } } },
      { ...venue('type only', 'A'), tags: [], types: ['urn:entity:place:museum'] },
    ]) forbidden.push(placeFromRow(raw, 'culture', [])!);
    const allowed = ['book_store', 'cinema', 'live_music_venue'].map(type => place(type, { category: 'culture', tags: [{ id: `urn:tag:genre:place:${type}`, name: type, kind: 'genre' }] }));
    expect(forbidden.every(p => excludedPlace(p, { excludeTags: ['museum'] }))).toBe(true);
    expect(allowed.every(p => !excludedPlace(p, { excludeTags: ['museum'] }))).toBe(true);
    const day = planFromPlaces(1, [{ id: 'a', name: 'A', places: [...forbidden.map(p => ({ ...p, affinity: 1 })), ...allowed] }], now, { excludeTags: ['museum'], include: [forbidden[0].id], relaxCategories: true }).days[0];
    expect(day.stops.length).toBeGreaterThan(0);
    expect(day.stops.every(s => allowed.some(p => p.id === s.place.id))).toBe(true);
    expect(day.missing.join(' ')).toContain('excluded from this plan');
  });
  it('writes plain partial-day notes and mentions closure only for closed issues', () => {
    const day = { neighborhood: 'Pena', stops: [{ time: '09:00', slot: 'Morning coffee', place: place('coffee'), walkMin: 0 }], missing: ['Dinner', 'Evening drinks'], issues: [{ slot: 'Dinner', reason: 'none_nearby' }, { slot: 'Evening drinks', reason: 'over_budget' }] };
    const note = planDayNote(day, "Homing couldn't fill this day near Pena, so it used São Vicente instead.");
    expect(note).toContain('It left two evening slots open.');
    expect(note).toContain('above your budget');
    expect(note).not.toMatch(/closed|eligible|over_budget|none_nearby/);
    expect(planDayNote({ ...day, issues: [{ slot: 'Dinner', reason: 'closed' }] })).toContain('for dinner are closed at the planned times');
  });
  it('retrieves a required place outside the category sample and rejects unrelated returned IDs', async () => {
    vi.mocked(placesNear).mockResolvedValue(pool());
    vi.mocked(qlooGet).mockResolvedValue({ results: { entities: [venue('wanted', 'Empty', .01), venue('unrequested', 'Empty', .01)] } });
    const result = await solvePlan(state({ days: 1 }), ['Empty'], { include: ['wanted'] });
    expect(qlooGet).toHaveBeenCalledWith('/v2/insights', expect.objectContaining({ 'filter.entities': 'wanted' }));
    expect(result.days[0].stops.some(s => s.place.id === 'wanted')).toBe(true);
    expect(result.days[0].stops.some(s => s.place.id === 'unrequested')).toBe(false);
  });
  it('annotates every empty day and distinguishes unavailable, closed and unaffordable', () => {
    const closed = place('closed', { hours: { monday: [] } });
    const expensive = place('expensive', { category: 'food', priceLevel: 4 });
    const plan = planFromPlaces(1, [{ id: 'a', name: 'A', places: [closed, expensive] }], now, { budget: 1 });
    expect(plan.days[0].stops).toHaveLength(0);
    expect(plan.days[0].note).toBeTruthy();
    expect(plan.days[0].issues?.map(i => i.reason)).toEqual(expect.arrayContaining(['closed', 'over_budget', 'none_nearby']));
  });
  it('recovers an empty day in the next ranked neighborhood and discloses it on each stop', async () => {
    vi.mocked(placesNear).mockImplementation(async (_state, n) => n === undefined ? [] : 'name' in n && n.name === 'Empty' ? [] : pool());
    const result = await solvePlan(state({ days: 1 }), ['Empty']);
    expect(result.days[0].stops).toHaveLength(6);
    expect(result.days[0].neighborhood).toBe('Next');
    expect(result.days[0].note).toBe("Homing couldn't fill this day with places that fit you near Empty, so it used Next instead.");
    expect(result.days[0].stops.every(s => s.reasonCodes?.includes('relaxed_neighborhood'))).toBe(true);
    expect(placesNear).toHaveBeenCalledTimes(2); // Initial pool + first successful alternate; no wider search.
  });
  it('widens radius and then relaxes soft preferences while retaining museum exclusions', async () => {
    vi.mocked(rankNeighborhoods).mockResolvedValue([area('Only')]);
    vi.mocked(placesNear).mockImplementation(async (s, _n, _c, _f, options) => options?.radius === 2200 && !s.refinements.length
      ? [place('book', { category: 'culture', tags: [{ id: 'urn:tag:genre:place:book_store', name: 'Book store', kind: 'genre' }] }), place('museum', { category: 'culture', tags: [{ id: 'urn:tag:genre:place:art_museum', name: 'Art museum', kind: 'genre' }] })] : []);
    const result = await solvePlan(state({ days: 1, refinements: [{ id: 'wifi', name: 'Wifi', kind: 'amenity' }] }), ['Only'], { excludeTags: ['museum'] });
    expect(result.days[0].stops.map(s => s.place.id)).toEqual(['book']);
    expect(result.days[0].note).toContain('a looser match to your place preferences');
    expect(result.days[0].stops[0].reasonCodes).toContain('relaxed_preferences');
    expect(result.days[0].stops.every(s => s.place.id !== 'museum')).toBe(true);
  });
  it('reports exhausted recovery without inventing stops', async () => {
    vi.mocked(placesNear).mockResolvedValue([]);
    const result = await solvePlan(state({ days: 2 }), ['Empty']);
    expect(result.days.every(d => !d.stops.length && /Homing couldn't (?:find|finish)/.test(d.note ?? ''))).toBe(true);
    expect(result.days.every(d => !/closed|eligible open|none_nearby/.test(d.note ?? ''))).toBe(true);
  });
  it('walking pushes the next arrival and rechecks hours at that later time', () => {
    const stops = [place('coffee'), place('closes', { category: 'culture', affinity: 1, lon: .01, hours: { monday: [{ opens: '10:00', closes: '10:35' }] } }),
      place('open', { category: 'culture', affinity: .5, lon: .02, hours: { monday: [{ opens: '10:00', closes: '18:00' }] } })];
    const day = planFromPlaces(1, [{ id: 'a', name: 'A', places: stops }], now, { pace: 'relaxed' }).days[0];
    expect(day.stops[1].place.id).toBe('open');
    expect(minutes(day.stops[1].time)).toBe(10 * 60 + 30 + day.stops[1].walkMin);
    expect(day.stops[1].walkIsApproximate).toBe(true);
    expect(day.stops[1].reasonCodes).toContain('closed');
  });
  it('does not assume an unknown-hours concert venue is a morning attraction', () => {
    const concert = place('hall', { category: 'culture', tags: [{ id: 'urn:tag:genre:place:concert_hall', name: 'Concert hall', kind: 'genre' }] });
    const day = planFromPlaces(1, [{ id: 'a', name: 'A', places: [concert] }], now).days[0];
    expect(day.stops).toHaveLength(0); expect(day.note).toBeTruthy();
    expect(day.note).not.toContain('closed');
    const withInclude = planFromPlaces(1, [{ id: 'a', name: 'A', places: [concert] }], now, { include: ['hall'] }).days[0];
    expect(withInclude.note).not.toContain('closed');
  });
});
