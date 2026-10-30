import { describe, expect, it } from 'vitest';
import { Neighborhood, type FieldCell } from '@/shared/contracts';
import { areaMatchScore, orderNeighborhoods } from '@/server/engine/neighborhoods';
import { cardReply, finalFacts, finalReply, groundedReply } from '@/server/agent/final';
import { state } from './helpers';

const cell = (h: string, you: number, popularity = 0, them?: number): FieldCell => ({ h, you, popularity, them, lon: 0, lat: 0, drivers: {} });
const area = (name: string, score: number, extra: Partial<Neighborhood> = {}): Neighborhood => ({ name, id: name, score, you: score, center: [0, 0], rank: 1, drivers: [], matchedTags: [], vibe: 'mixed', samplePlaces: [], cellIds: [], ...extra });

describe('08 follow-up: one adjusted match metric', () => {
  it('shrinks weak coverage toward neutral, counts distinct cells and never invents missing-person support', () => {
    const sparse = [cell('a', .9)];
    expect(areaMatchScore(sparse, 0)).toBe(.6);
    expect(areaMatchScore([...sparse, ...sparse, ...sparse], 0)).toBe(.6);
    expect(areaMatchScore(Array.from({ length: 9 }, (_, i) => cell(String(i), .9)), 0)).toBeCloseTo(.8);
    expect(areaMatchScore([cell('b', .1)], 0)).toBe(.4);
    expect(areaMatchScore([cell('c', .5)], 0)).toBe(.5);
    expect(areaMatchScore([cell('d', 0)], 0)).toBe(0);
    expect(areaMatchScore(sparse, 0, 'them')).toBe(0);
    expect(areaMatchScore([], 0)).toBe(0);
  });
  it('does not award a tiny extreme area first over stronger, broader evidence', () => {
    const tiny = areaMatchScore([cell('one', 1)], 0);
    const broad = areaMatchScore(Array.from({ length: 9 }, (_, i) => cell(String(i), .75)), 0);
    expect(broad).toBeGreaterThan(tiny);
    const ordered = orderNeighborhoods([area('Tiny', tiny), area('Broad', broad)]);
    expect(ordered.map(a => a.name)).toEqual(['Broad', 'Tiny']);
    expect(ordered[0].lift).toBeGreaterThan(ordered[1].lift!);
  });
  it.each([0, .25, 1])('applies crowd preference to observations and neutral prior on the same scale (%s)', discovery => {
    const discount = 1 - .7 * discovery;
    const busy = areaMatchScore([cell('busy', .9 * discount, 1)], discovery);
    const quiet = areaMatchScore([cell('quiet', .7, 0)], discovery);
    expect(busy).toBeCloseTo(.6 * discount);
    expect(quiet).toBeCloseTo(.55);
    const ordered = orderNeighborhoods([area('Busy', busy), area('Quiet', quiet)]);
    expect(ordered[0].name).toBe(discovery === 0 ? 'Busy' : 'Quiet');
    expect(ordered[0].lift).toBeGreaterThanOrEqual(ordered[1].lift!);
  });
  it('takes the couple minimum after each area mean and displays exactly that fairness score', () => {
    const cells = [cell('a', .9, 0, .1), cell('b', .1, 0, .9)];
    const you = areaMatchScore(cells, 0), them = areaMatchScore(cells, 0, 'them');
    expect(you).toBeCloseTo(.5); expect(them).toBeCloseTo(.5);
    const [ranked] = orderNeighborhoods([area('Shared', Math.min(you, them), { you, them, lift: .99 })]);
    expect(ranked.lift).toBeCloseTo(0);
    expect(ranked.score).toBe(Math.min(ranked.you, ranked.them!));
  });
  it('replaces contradictory raw lifts and preserves monotonicity through rounding and ties', () => {
    const ordered = orderNeighborhoods([area('Second', .52, { lift: .139 }), area('First', .57, { lift: .03 }), area('Third', .51999, { lift: 2 }), area('Tie', .52, { lift: -.2 })]);
    expect(ordered[0].name).toBe('First');
    ordered.forEach((a, i) => {
      expect(a.lift).toBe(2 * a.score - 1);
      expect(a.liftKind).toBe('adjusted_match');
      expect(a.rank).toBe(i + 1);
      if (i) for (const digits of [0, 1, 2]) expect(Number((100 * ordered[i - 1].lift!).toFixed(digits))).toBeGreaterThanOrEqual(Number((100 * a.lift!).toFixed(digits)));
    });
    expect(ordered.filter(a => a.score === .52).map(a => a.lift)).toEqual([.04, .04].map(() => 2 * .52 - 1));
  });
  it('explains all-negative results and cannot rank a negative area above any nonnegative area', () => {
    const negatives = Array.from({ length: 12 }, (_, i) => area(`Negative ${i}`, .49 - .01 * i));
    const ordered = orderNeighborhoods(negatives);
    expect(ordered[0].rankingNote).toContain('All scored neighborhoods');
    expect(ordered.every(a => a.lift! < 0)).toBe(true);
    expect(ordered.slice(1).every(a => a.rankingNote === undefined)).toBe(true);
    for (const score of [.5, .6]) {
      const withPositive = orderNeighborhoods([...ordered, area('Positive', score)]);
      expect(withPositive[0].name).toBe('Positive');
      expect(withPositive.every(a => a.rankingNote === undefined)).toBe(true);
    }
  });
  it('keeps old contracts readable and preserves the all-negative note in both agent reply paths', async () => {
    expect(Neighborhood.parse(area('Old', .5)).liftKind).toBeUndefined();
    const ranked = orderNeighborhoods([area('Best available', .4), area('Lower', .3)]);
    expect(Neighborhood.parse(ranked[0]).rankingNote).toBe(ranked[0].rankingNote);
    expect(cardReply({ kind: 'ranking', neighborhoods: ranked })).toContain(ranked[0].rankingNote);
    const facts = finalFacts(state(), state(), ranked);
    expect(groundedReply(facts)).toContain(ranked[0].rankingNote);
    const emitted: string[] = [];
    await finalReply({ state: state(), message: 'Find my area', history: [] }, facts, new AbortController().signal, text => emitted.push(text));
    expect(emitted.join('')).toContain(ranked[0].rankingNote);
  });
});
