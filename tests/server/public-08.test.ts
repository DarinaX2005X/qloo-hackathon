import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enforceRateLimit, clearRateLimits, QLOO_REQUEST_LIMITS, RATE_CAPACITY } from '@/server/engine/rate-limit';
import { errorResponse } from '@/server/engine/http';
import { clearGeocodeCache, validateCity } from '@/server/geo/geocode';
const fetcher = vi.fn();
beforeEach(() => { clearRateLimits(); clearGeocodeCache(); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('08 public demo limits and city validation', () => {
  const request = (path: string, ip = '192.0.2.1') => new Request(`http://localhost/api/${path}`, { headers: { 'x-forwarded-for': ip } });
  it('shares the expensive budget across endpoints, refills, separates IPs and excludes CDN landing', async () => {
    for (let i = 0; i < 3; i++) enforceRateLimit(request('agent'), 0);
    let error: unknown;
    try { enforceRateLimit(request('plan'), 0); } catch (e) { error = e; }
    const response = errorResponse(error);
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ error: { code: 'quota', retryable: true } });
    expect(response.headers.get('Retry-After')).toBe('80');
    expect(() => enforceRateLimit(request('home', '192.0.2.2'), 0)).not.toThrow();
    for (let i = 0; i < 100; i++) enforceRateLimit(request('landing'), 0);
    expect(() => enforceRateLimit(request('plan'), 80000)).not.toThrow();
  });
  it.each(['plan', 'places', 'spot', 'neighborhoods', 'field', 'fingerprint', 'intake', 'home', 'cities', 'decides', 'agent'])('bounds the shared worst-case reservation for /api/%s', path => {
    const cost = QLOO_REQUEST_LIMITS[`/api/${path}`];
    for (let i = 0; i < Math.floor(RATE_CAPACITY / cost); i++) expect(enforceRateLimit(request(path), 0)?.limit).toBe(cost);
    expect(() => enforceRateLimit(request(`${path}/`), 0)).toThrow();
  });
  it('refunds unused Qloo capacity once while retaining a proportional warm-request charge', () => {
    const lease = enforceRateLimit(request('plan'), 0)!;
    lease.finish(4); lease.finish(0);
    // Used 10 tokens (160/16), not 160; double finishing must not erase that charge.
    enforceRateLimit(request('agent'), 0); enforceRateLimit(request('agent'), 0);
    expect(() => enforceRateLimit(request('agent'), 0)).toThrow();
  });
  it('leaves headroom for a cached 21-scenario UI journey without elapsed-time refill or a test bypass', () => {
    let charged = 0;
    const visit = (path: string, calls = 0) => {
      const lease = enforceRateLimit(request(path), 0)!;
      charged += Math.max(calls, Math.ceil(lease.limit / 16)); lease.finish(calls);
    };
    // Map loads/refinements, places, repeat plans/swaps, city comparisons, home/address/why and agent.
    for (let i = 0; i < 21; i++) { visit('field', i === 0 ? 37 : 2); visit('neighborhoods'); visit('fingerprint'); }
    for (let i = 0; i < 10; i++) visit('places');
    for (let i = 0; i < 8; i++) visit('plan');
    for (let i = 0; i < 5; i++) { visit('agent'); visit('cities'); }
    for (let i = 0; i < 2; i++) visit('home');
    for (let i = 0; i < 4; i++) visit('spot');
    visit('decides');
    expect(charged).toBeLessThan(RATE_CAPACITY / 2);
    expect(() => enforceRateLimit(request('agent'), 0)).not.toThrow();
  });
  it.each(['x', 'ab', '12', '!!!'])('rejects %s before any geocoder request', async city => {
    await expect(validateCity(city)).rejects.toMatchObject({ error: { code: 'not_found' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a non-city Photon hit and a neighborhood Open-Meteo hit', async () => {
    fetcher.mockImplementation(async input => String(input).includes('photon')
      ? Response.json({ features: [{ geometry: { coordinates: [0, 0] }, properties: { name: 'Fake Place', country: 'France', osm_key: 'tourism', osm_value: 'attraction' } }] })
      : Response.json({ results: [{ name: 'Fake Place', country: 'France', latitude: 0, longitude: 0, feature_code: 'PPLX' }] }));
    await expect(validateCity('Fake Place')).rejects.toMatchObject({ error: { code: 'not_found' } });
  });
  it('prefers the city over a village namesake and respects an explicit region', async () => {
    fetcher.mockImplementation(async input => String(input).includes('photon')
      ? Response.json({ features: [{ geometry: { coordinates: [2.1, 43.2] }, properties: { name: 'Montréal', country: 'France', osm_key: 'place', osm_value: 'village' } }] })
      : Response.json({ results: [{ name: 'Montréal', country: 'Canada', admin1: 'Quebec', latitude: 45.5, longitude: -73.6, population: 1600000, feature_code: 'PPLA2' }] }));
    expect((await validateCity('Montréal')).center).toEqual([-73.6, 45.5]);
    expect((await validateCity('Montréal, France')).center).toEqual([2.1, 43.2]);
    await expect(validateCity('Montréal, Australia')).rejects.toMatchObject({ error: { code: 'not_found' } });
  });
  it.each(['city', 'town', 'village'])('accepts a real %s and caches validation per city', async type => {
    fetcher.mockImplementation(async input => String(input).includes('photon')
      ? Response.json({ features: [{ geometry: { coordinates: [0, 0] }, properties: { name: 'Valid Place', country: 'France', osm_key: 'place', osm_value: type } }] })
      : Response.json({ results: [] }));
    expect((await validateCity('Valid Place')).name).toBe('Valid Place');
    await validateCity('Valid Place'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
