import { ExploreState, type Domain, type Place, type ResolvedLove } from "@/shared/contracts";

export function love(id: string, domain: Domain = "artist", weight = 1): ResolvedLove {
  return { query: id, chosen: { id, name: id, domain }, candidates: [], weight };
}

export function state(overrides: Partial<ExploreState> = {}): ExploreState {
  return ExploreState.parse({ city: "Test City", loves: [love("artist")], days: 2, ...overrides });
}

export function place(id: string, overrides: Partial<Place> = {}): Place {
  return { id, name: id, category: "coffee", lon: 0, lat: 0, affinity: 0.8, popularity: 0.5, why: [], mapsUrl: "https://example.test", ...overrides };
}

export function heat(h: string, artist: number, tv = 0, popularity = 0.5, lon = 0): object {
  return { location: { geohash: h, latitude: 0, longitude: lon }, query: {
    affinity: (artist + tv) / 2, popularity, entity_artist_affinity: artist, entity_tv_show_affinity: tv,
  } };
}

export function venue(id: string, neighborhood: string, lon = 0, affinity = 0.8): object {
  return { entity_id: id, name: id, location: { lat: 0, lon }, popularity: 0.4, query: { affinity },
    properties: { neighborhood, address: "1 Test St", keywords: [{ name: "quiet", count: 4 }] },
    tags: [{ id: "urn:tag:ambience:qloo:cozy", name: "Cozy" }, { id: "urn:tag:genre:place:restaurant:coffee_shop", name: "Coffee shop" }],
  };
}
