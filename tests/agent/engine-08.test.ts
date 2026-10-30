import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '@/server/agent/runner';
import { chat, type ChatChunk } from '@/server/agent/llm';
import { findHome } from '@/server/engine/home';
import { checkSpot } from '@/server/engine/spot';
import { solvePlan } from '@/server/engine/plan';
import { rankNeighborhoods } from '@/server/engine';
import { searchTastePlaces } from '@/server/engine/places';
import { createToolContext, executeTool, explicitlyAvoidsMuseums } from '@/server/agent/tools';
import { state, place } from '../server/helpers';
import type { AgentEvent, HomeResult, Neighborhood } from '@/shared/contracts';

vi.mock('@/server/agent/llm', () => ({ chat: vi.fn() }));
vi.mock('@/server/engine/home', () => ({ findHome: vi.fn() }));
vi.mock('@/server/engine/spot', () => ({ checkSpot: vi.fn() }));
vi.mock('@/server/engine/plan', () => ({ solvePlan: vi.fn() }));
vi.mock('@/server/engine', () => ({ rankNeighborhoods: vi.fn() }));
vi.mock('@/server/engine/places', () => ({ searchTastePlaces: vi.fn(), placesNear: vi.fn() }));
const area: Neighborhood = { id: 'home', name: 'Home match', center: [0, 0], rank: 1, score: .6, you: .6, drivers: [], matchedTags: [], vibe: 'mixed', samplePlaces: [], cellIds: [] };
const home: HomeResult = { source: { city: 'Berlin', neighborhood: 'Kreuzberg', center: [0, 0], tags: [], places: [] }, field: { city: 'Lisbon', center: [0, 0], bbox: [0, 0, 0, 0], cells: [], sparse: true, signalsWithoutGeo: [] }, neighborhoods: [area], matches: [{ neighborhoodId: area.id, similarity: 22, sharedTags: [], twins: [] }] };
const text = (events: AgentEvent[]) => events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('');
async function* chunks(value: ChatChunk[]): AsyncGenerator<ChatChunk> { yield* value; }
const call = (name: string, args: unknown): ChatChunk => ({ type: 'tool_call', call: { id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } } });
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(findHome).mockResolvedValue(home);
  vi.mocked(rankNeighborhoods).mockResolvedValue([{ ...area, id: 'personal', name: 'Personal winner' }]);
  vi.mocked(checkSpot).mockResolvedValue({ label: 'Verified address', point: [0, 0], score: .5, percentile: 63, neighborhood: null, drivers: [], walk: [], counts: { coffee: 0, food: 0, drinks: 0, culture: 0, openLate: 0 }, verdict: 'Verified address: neighborhood estimate at 63rd percentile.' });
  vi.mocked(solvePlan).mockResolvedValue({ days: [
    { neighborhood: 'Home match', stops: [{ time: '11:00', slot: 'Coffee', place: place('Verified cafe'), walkMin: 0, walkIsApproximate: true, reasonCodes: ['relaxed_radius'] }], missing: [], note: 'Widened the search to 2.2 km.' },
    { neighborhood: 'Next', stops: [], missing: ['Lunch'], note: "Homing couldn't find places that fit you near Next for this day." },
  ] });
});

describe('08 agent plans, chains and grounding', () => {
  it.each([
    { overrides: {}, expected: { days: 3, pace: 'packed', startHour: 7 } },
    { overrides: { days: 1, pace: 'relaxed', startHour: 11 }, expected: { days: 1, pace: 'relaxed', startHour: 11 } },
  ])('returns the exact effective plan rules and settings on the card: $expected', async ({ overrides, expected }) => {
    const context = createToolContext(state({ days: 3, pace: 'packed', startHour: 7 }), new AbortController().signal, 'Plan my trip, no museums');
    context.entities.set('known-bookshop', { id: 'resolved-place-id', name: 'Known bookshop', domain: 'place' });
    const result = await executeTool('plan_trip', { ...overrides, excludeCategories: ['drinks', 'culture'], excludeTags: ['smoking'], mustInclude: ['Known bookshop'] }, context);
    expect(result.card?.kind).toBe('plan');
    if (result.card?.kind !== 'plan') throw new Error('Expected a plan card');
    const [usedState, , usedOptions] = vi.mocked(solvePlan).mock.calls[0];
    expect(result.card.options).toEqual({ ...usedOptions, days: usedState.days, pace: usedState.pace, startHour: usedState.startHour });
    expect(JSON.parse(JSON.stringify(result.card)).options).toEqual({
      ...expected, excludeCategories: ['drinks'], excludeTags: ['smoking', 'museum'], include: ['resolved-place-id'],
    });
  });
  it('keeps an explicit museum exclusion when the model omits it or mistakenly bans all culture', async () => {
    vi.mocked(chat).mockResolvedValueOnce({ content: JSON.stringify({ plan_trip: { days: 2, excludeCategories: ['culture'] } }), tool_calls: [] });
    await runAgent({ state: state(), message: 'plan my first two days, I hate museums', history: [] }, () => {});
    expect(solvePlan).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ excludeTags: ['museum'], excludeCategories: [] }), undefined);
    for (const message of ['No museums', 'without museums', 'I hate museums', "I don't want museums"]) expect(explicitlyAvoidsMuseums(message)).toBe(true);
    for (const message of ['I love museums', "I don't hate museums", 'I want museums']) expect(explicitlyAvoidsMuseums(message)).toBe(false);
  });
  it('executes the dependent fast chain in order and returns a plan card with its actual recovery', async () => {
    vi.mocked(chat).mockResolvedValueOnce({ content: JSON.stringify({ find_home: { city: 'Berlin', neighborhood: 'Kreuzberg' }, check_address: { query: 'Rua da Rosa 120' }, plan_trip: { days: 2, startHour: 11, excludeTags: ['museum'] } }), tool_calls: [] });
    const events: AgentEvent[] = [];
    await runAgent({ state: state(), message: 'I used to live in Kreuzberg; check Rua da Rosa 120 there and plan two days without museums', history: [] }, e => events.push(e));
    const steps = events.flatMap(e => e.type === 'trace' ? [e.tool] : []);
    expect(steps.indexOf('find_home')).toBeLessThan(steps.indexOf('select_home_match'));
    expect(steps.indexOf('select_home_match')).toBeLessThan(steps.indexOf('check_address'));
    expect(steps.indexOf('check_address')).toBeLessThan(steps.indexOf('plan_trip'));
    expect(solvePlan).toHaveBeenCalledWith(expect.objectContaining({ neighborhood: 'home', days: 2, startHour: 11 }), ['home', 'personal'], expect.objectContaining({ excludeTags: ['museum'] }), home.neighborhoods);
    expect(events.some(e => e.type === 'card' && e.card.kind === 'plan')).toBe(true);
    expect(events.find(e => e.type === 'card' && e.card.kind === 'plan')).toMatchObject({
      card: { options: { days: 2, pace: 'balanced', startHour: 11, excludeTags: ['museum'], include: [] } },
    });
    expect(text(events)).toContain('Widened the search'); expect(text(events)).toContain('no places could be scheduled');
    expect(text(events)).not.toContain('best start is now Personal winner');
    expect(events.at(-1)?.type).toBe('done');
  });
  it('continues a fallback chain after reads and ignores invented pre-tool prose', async () => {
    vi.mocked(chat).mockResolvedValueOnce({ content: '{"use_tools":true}', tool_calls: [] });
    vi.mocked(chat).mockReturnValueOnce(chunks([{ type: 'content', text: 'Invented Palace is perfect.' }, call('find_home', { city: 'Berlin', neighborhood: 'Kreuzberg' })]));
    vi.mocked(chat).mockReturnValueOnce(chunks([call('select_home_match', {}), call('check_address', { query: 'Rua da Rosa 120' })]));
    vi.mocked(chat).mockReturnValueOnce(chunks([call('plan_trip', { days: 2, excludeTags: ['museum'] })]));
    const events: AgentEvent[] = [];
    await runAgent({ state: state(), message: 'I used to live in Kreuzberg; check Rua da Rosa 120 and plan two days', history: [] }, e => events.push(e));
    expect(solvePlan).toHaveBeenCalledOnce(); expect(text(events)).not.toContain('Invented Palace'); expect(text(events)).toContain('22/100');
    expect(chat).toHaveBeenCalledTimes(4);
  });
  it('does not emit unsupported place names when the fallback returns only free text', async () => {
    vi.mocked(chat).mockResolvedValueOnce({ content: '{"use_tools":true}', tool_calls: [] });
    vi.mocked(chat).mockReturnValueOnce(chunks([{ type: 'content', text: 'Try Imaginary Hotel and Unicorn Bar.' }]));
    const events: AgentEvent[] = [];
    await runAgent({ state: state(), message: 'Where should I go?', history: [] }, e => events.push(e));
    expect(text(events)).not.toMatch(/Imaginary|Unicorn/);
  });
  it('uses the persons own loves in city-wide intent search and grounds the reply', async () => {
    vi.mocked(searchTastePlaces).mockResolvedValue([place('Verified Club', { category: 'drinks' })]);
    const s = state(); const context = createToolContext(s, new AbortController().signal);
    const result = await executeTool('get_places', { intent: 'dance' }, context);
    expect(searchTastePlaces).toHaveBeenCalledWith(s, 'dance', undefined);
    expect(context.answers[0]).toContain('Verified Club'); expect(result.summary).toContain('1 places');
  });
});
