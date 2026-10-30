import { describe, expect, it } from 'vitest';
import { activeLoves, Neighborhood, SpotResult } from '@/shared/contracts';
import { baselineSeries, personField, type HeatCell, type PersonMaps } from '@/server/engine/field';
import { homeSimilarity, homeTags, homeTwins } from '@/server/engine/home';
import { meaningfulTag, matchedPlaceTags, tagName } from '@/server/engine/fingerprint';
import { matchesPlaceIntent } from '@/server/engine/places';
import { mean } from '@/server/engine/geo';
import { popularityNeighborhoods } from '@/server/engine/evidence';
import { love, state, venue } from './helpers';

const cell = (h: string, affinity: number, popularity = .5): HeatCell => ({ h, affinity, popularity, lat: 0, lon: 0, affinities: {} });
const tag = (name: string) => ({ id: `urn:tag:ambience:qloo:${name.toLowerCase().replaceAll(' ', '_')}`, name, kind: 'ambience' });

describe('08 population correction and individual weighting', () => {
  it('keeps the popularity-only evidence control independent of taste affinity and venue count', () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => ({ ...venue(`large${i}`, 'Large'), popularity: .6, query: { affinity: 1 } })),
      ...Array.from({ length: 3 }, (_, i) => ({ ...venue(`small${i}`, 'Small'), popularity: .8, query: { affinity: .01 } }))];
    expect(popularityNeighborhoods(rows, 'Test City').map(n => n.name)).toEqual(['Small', 'Large']);
    expect(popularityNeighborhoods([...rows, ...rows], 'Test City')).toEqual(popularityNeighborhoods(rows, 'Test City'));
  });
  it('removes a dense central popularity advantage while retaining actual relative lift', () => {
    const cells = [cell('central', .9, .9), cell('taste', .5, .2), cell('neutral', .2, .2)];
    const s = baselineSeries(cells, new Set(cells.map(c => c.h)));
    expect(s.ranks.get('taste')).toBeGreaterThan(s.ranks.get('central')!);
    expect(s.lifts.get('central')).toBe(0);
    expect(s.lifts.get('taste')).toBeCloseTo(.75);
    // Cell means confer no extra score for a larger area with the same distribution.
    const area = [.3, .6, .9];
    expect(mean(area)).toBeCloseTo(mean([...area, ...area, ...area]));
  });
  it('gives a population-only field zero lift and no arbitrary winner on ties', () => {
    const cells = [cell('a', .9, .9), cell('b', .2, .2), cell('c', .01, .01)];
    const s = baselineSeries(cells, new Set(['a', 'b', 'c']));
    expect([...s.lifts.values()]).toEqual([0, 0, 0]);
    expect([...s.ranks.values()]).toEqual([.5, .5, .5]);
  });
  it('two artists change the field when one weight changes, even with an identical joint domain affinity', () => {
    const cells = [cell('a', .8), cell('b', .2)];
    const make = (weight: number): PersonMaps => ({ combined: cells.map(c => ({ ...c, affinities: { artist: .5 } })), individual: [
      { love: activeLoves([love('Radiohead')])[0], cells },
      { love: activeLoves([love('Aphex Twin', 'artist', weight)])[0], cells: [cell('a', .2), cell('b', .8)] },
    ] });
    const even = personField(state({ discovery: 0 }), make(1), [], cells);
    const weighted = personField(state({ discovery: 0 }), make(.05), [], cells);
    expect(even.scores.get('a')).toBe(.5);
    expect(weighted.scores.get('a')).toBeCloseTo((.75 + .05 * .25) / 1.05);
    expect(weighted.scores.get('a')).toBeGreaterThan(even.scores.get('a')! + .2);
    expect(weighted.scores.get('b')).toBeLessThan(even.scores.get('b')! - .2);
  });
  it('keeps the crowd preference independent of display lift', () => {
    const cells = [cell('a', .9, 1), cell('b', .8, .1)];
    const maps = { combined: cells, individual: [{ love: activeLoves([love('one')])[0], cells }] };
    const busy = personField(state({ discovery: 0 }), maps, [], cells);
    const quiet = personField(state({ discovery: 1 }), maps, [], cells);
    expect(quiet.scores.get('a')).toBeCloseTo(busy.scores.get('a')! * .3);
    expect(quiet.scores.get('b')).toBeCloseTo(busy.scores.get('b')! * .93);
    expect(quiet.lifts).toEqual(busy.lifts);
  });
});

describe('08 honest tags, similarity and contracts', () => {
  it('filters category/service labels and collapses near duplicates across namespaces', () => {
    for (const name of ['Tourist attraction', 'Professional', 'Restaurant', 'Traditional']) expect(meaningfulTag(tag(name))).toBe(false);
    expect(tagName('Traditional Japanese')).toBe(tagName('Japanese'));
    const rows = [{ tags: [tag('Japanese'), tag('Traditional Japanese'), tag('Industrial'), tag('Tourist attraction')] }];
    expect(homeTags(rows).map(t => tagName(t.name))).toEqual(['industrial', 'japanese']);
    expect(matchedPlaceTags(rows, [tag('Japanese'), tag('Traditional Japanese')])).toHaveLength(1);
  });
  it('measures actual profile overlap including genuine low and zero similarity', () => {
    const source = [{ tags: [tag('Industrial'), tag('Alternative')] }, { tags: [tag('Industrial')] }];
    expect(homeSimilarity(source, source)).toBe(100);
    expect(homeSimilarity(source, [{ tags: [tag('Romantic')] }])).toBe(0);
    expect(homeSimilarity(source, [{ tags: [tag('Industrial'), tag('Romantic')] }])).toBe(40);
    expect(homeSimilarity(source, [])).toBe(0);
  });
  it('refuses twins sharing only a broad category or generic ambience', () => {
    const source = [{ id: 'source', name: 'Source', category: 'coffee' as const, tags: ['Casual', 'Industrial'] }];
    expect(homeTwins(source, [{ ...venue('ordinary', 'N'), tags: [{ id: 'urn:tag:genre:place:restaurant:coffee_shop', name: 'Coffee shop' }, tag('Casual')] }])).toEqual([]);
    const actual = { ...venue('warehouse', 'N'), tags: [{ id: 'urn:tag:genre:place:restaurant:coffee_shop', name: 'Coffee shop' }, tag('Industrial')] };
    expect(homeTwins(source, [actual])[0].target.id).toBe('warehouse');
  });
  it('accepts old payloads and explicit honest display metadata', () => {
    const base = { id: 'n', name: 'N', center: [0, 0], score: .2, you: .2, rank: 1, drivers: [], matchedTags: [], vibe: 'local', samplePlaces: [], cellIds: [] };
    expect(Neighborhood.parse(base).lift).toBeUndefined();
    expect(Neighborhood.parse({ ...base, lift: -.12, crowd: 'quiet' })).toMatchObject({ lift: -.12, crowd: 'quiet' });
    const spot = { label: 'Point', point: [0, 0], score: .2, percentile: 40, neighborhood: null, drivers: [], walk: [], counts: { coffee: 0, food: 0, drinks: 0, culture: 0, openLate: 0 }, verdict: 'Area estimate', resolutionM: 1200, walkIsApproximate: true, estimateScope: 'neighborhood' };
    expect(SpotResult.parse(spot)).toMatchObject({ resolutionM: 1200, walkIsApproximate: true });
  });
  it('dance requires dance-venue evidence and rejects a hotel bar even with matching tags', () => {
    const club = { tags: [{ id: 'urn:tag:genre:place:night_club', name: 'Night club' }] };
    expect(matchesPlaceIntent(club, 'dance')).toBe(true);
    expect(matchesPlaceIntent({ tags: [...club.tags, { id: 'urn:tag:genre:place:hotel', name: 'Hotel' }] }, 'dance')).toBe(false);
    expect(matchesPlaceIntent({ tags: [{ id: 'urn:tag:genre:place:restaurant:bar', name: 'Cocktail bar' }] }, 'dance')).toBe(false);
  });
});
