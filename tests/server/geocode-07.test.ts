import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGeocodeCache, geocode, photon, relevantGeocode, reverseGeocode } from "@/server/geo/geocode";

const fetcher = vi.fn();
beforeEach(() => { clearGeocodeCache(); vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

describe("07 shared geocoding", () => {
  it.each(["Test Street 12, City", "12 Test Street, City"])("biases Photon and prefers the requested house number for %s, then caches it", async (query) => {
    fetcher.mockResolvedValue(Response.json({ features: [
      { geometry: { coordinates: [0, 0] }, properties: { name: "Test Street", city: "City" } },
      { geometry: { coordinates: [0.001, 0] }, properties: { street: "Test Street", housenumber: "12", city: "City" } },
    ] }));
    const found = await geocode(query, [0, 0], 25000);
    expect(found?.label).toBe("Test Street 12, City");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("lat")).toBe("0"); expect(url.searchParams.get("lon")).toBe("0");
    expect(url.searchParams.has("osm_tag")).toBe(false);
    expect(await geocode(query, [0, 0], 25000)).toEqual(found); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps street-only labels clean and records missing house numbers separately", async () => {
    fetcher.mockResolvedValue(Response.json({ features: [
      { geometry: { coordinates: [0, 0] }, properties: { street: "Test Street", housenumber: "99", city: "City" } },
      { geometry: { coordinates: [0.001, 0] }, properties: { name: "Test Street", city: "City" } },
    ] }));
    expect(await geocode("Test Street 12, City", [0, 0], 25000)).toMatchObject({ label: "Test Street, City", street: "Test Street", streetLevel: true });
  });
  it("falls back to Open-Meteo when Photon fails or only has distant namesakes", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ features: [{ geometry: { coordinates: [10, 10] }, properties: { name: "Old Area" } }] }))
      .mockResolvedValueOnce(Response.json({ results: [{ name: "Old Area", country: "Country", latitude: 0, longitude: 0, feature_code: "PPLX" }] }));
    expect((await geocode("Old Area, City", [0, 0], 30000))?.center).toEqual([0, 0]);
    expect(String(fetcher.mock.calls[1][0])).toContain("geocoding-api.open-meteo.com");
  });
  it("returns null for malformed responses, and never substitutes the city for a missing address", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ features: [{ geometry: { coordinates: [0, 0] }, properties: { name: "City" } }] }))
      .mockResolvedValueOnce(Response.json({ results: [{ name: "City", country: "Country", latitude: 0, longitude: 0 }] }));
    expect(await geocode("Missing Street 12, City", [0, 0], 25000)).toBeNull();
    expect(relevantGeocode({ name: "City", label: "City", query: "City", center: [0, 0] }, "Missing, City")).toBe(false);
  });
  it("preserves city autocomplete filters and labels", async () => {
    fetcher.mockResolvedValue(Response.json({ features: [{ geometry: { coordinates: [-122, 45] }, properties: { name: "Portland", state: "Oregon", country: "United States", osm_key: "place", osm_value: "city" } }] }));
    expect((await photon("Portland"))[0].query).toBe("Portland, Oregon");
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.getAll("osm_tag")).toEqual(["place:city", "place:town", "place:village"]);
  });
});

describe("07 pinned-spot reverse geocoding", () => {
  it.each([
    [{ street: "Test Street", housenumber: "12", name: "Nearby Cafe" }, "Test Street 12"],
    [{ street: "Test Street", name: "Nearby Cafe" }, "Test Street"],
    [{ name: "Nearby Cafe" }, "Nearby Cafe"],
  ])("uses the most specific available reverse label: %j", async (properties, expected) => {
    fetcher.mockResolvedValue(Response.json({ features: [{ geometry: { coordinates: [0, 0] }, properties }] }));
    expect(await reverseGeocode([0, 0])).toBe(expected);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/reverse");
    expect(url.searchParams.get("lat")).toBe("0"); expect(url.searchParams.get("lon")).toBe("0");
    expect(await reverseGeocode([0, 0])).toBe(expected); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the nearest available named place and ignores distant or malformed features", async () => {
    fetcher.mockResolvedValue(Response.json({ features: [
      { geometry: { coordinates: [0.002, 0] }, properties: { name: "Farther" } },
      { geometry: { coordinates: [1, 1] }, properties: { street: "Wrong City Street" } },
      { geometry: { coordinates: [0.001, 0] }, properties: { name: "Nearest" } },
      { geometry: { coordinates: [999, 999] }, properties: { name: "Invalid" } },
    ] }));
    expect(await reverseGeocode([0, 0])).toBe("Nearest");
  });
  it("returns null for empty or failed responses so the caller can use a neighborhood", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ features: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(Response.json({ features: "invalid" }));
    for (let i = 0; i < 4; i++) expect(await reverseGeocode([0, 0])).toBeNull();
  });
  it("bounds a stalled reverse lookup to 1.5 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetcher.mockImplementation(async (_url, options: RequestInit) => new Promise((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    }));
    try {
      expect(await reverseGeocode([0, 0])).toBeNull();
      expect(timeout).toHaveBeenCalledWith(1500);
    } finally { timeout.mockRestore(); }
  });
});
