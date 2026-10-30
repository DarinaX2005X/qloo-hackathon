import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enforceRateLimit, clearRateLimits } from '@/server/engine/rate-limit';
import { errorResponse } from '@/server/engine/http';
import { clearGeocodeCache, validateCity } from '@/server/geo/geocode';
const fetcher = vi.fn();
beforeEach(() => { clearRateLimits(); clearGeocodeCache(); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('08 public demo limits and city validation', () => {
  const request = (path: string, ip = '192.0.2.1') => new Request(`http://localhost/api/${path}`, { headers: { 'x-forwarded-for': ip } });
  it('shares the expensive budget across endpoints, refills, separates IPs and excludes CDN landing', async () => {
    for (let i = 0; i < 12; i++) enforceRateLimit(request(['agent', 'cities', 'home', 'decides'][i % 4]), 0);
    let error: unknown;
    try { enforceRateLimit(request('agent'), 0); } catch (e) { error = e; }
    const response = errorResponse(error);
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ error: { code: 'quota', retryable: true } });
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(() => enforceRateLimit(request('home', '192.0.2.2'), 0)).not.toThrow();
    for (let i = 0; i < 100; i++) enforceRateLimit(request('landing'), 0);
    expect(() => enforceRateLimit(request('agent'), 10000)).not.toThrow();
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
  it.each(['city', 'town', 'village'])('accepts a real %s and caches validation per city', async type => {
    fetcher.mockImplementation(async input => String(input).includes('photon')
      ? Response.json({ features: [{ geometry: { coordinates: [0, 0] }, properties: { name: 'Valid Place', country: 'France', osm_key: 'place', osm_value: type } }] })
      : Response.json({ results: [] }));
    expect((await validateCity('Valid Place')).name).toBe('Valid Place');
    await validateCity('Valid Place'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
