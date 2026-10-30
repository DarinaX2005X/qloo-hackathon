import type { PlaceV2 } from "@/shared/contracts-09";

// Hand-written regression records for F3's reported type conflicts. These are
// deliberately incomplete fixtures, not provider captures or runtime venue data.
const place = (key: string, name: string, primary: string, secondary: string[]): PlaceV2 => ({
  id: `fixture:role:${key}`, name, primaryGenre: primary,
  classifications: [primary, ...secondary],
  tags: secondary.map(tag => ({ id: `urn:tag:genre:place:${tag}`, name: tag.replaceAll("_", " "), kind: "genre" })),
  category: "drinks", lat: 0, lon: 0, affinity: .95, popularity: .5,
  why: [], mapsUrl: "https://example.invalid/fixture",
});

export const BAR_CULTURE_REGRESSIONS = [
  place("meisterschueler", "meisterschueler", "restaurant:bar", ["art_gallery", "cultural_center"]),
  place("base-ment", "Base Ment", "restaurant:cocktail_bar", ["art_gallery", "performing_arts_theater"]),
  place("studio8", "Studio8", "pub", ["art_gallery", "cultural_center"]),
];
export const RAUSCHGOLD_REGRESSION: PlaceV2 = {
  ...place("rauschgold", "Rauschgold", "restaurant:bar", ["night_club", "live_music_venue", "restaurant:karaoke_bar"]),
  tags: [
    { id: "urn:tag:genre:place:night_club", name: "Night club", kind: "genre" },
    { id: "urn:tag:amenity:qloo:dance_floor", name: "Dance floor", kind: "amenity" },
    { id: "urn:tag:interests:qloo:electronic_music", name: "Electronic music", kind: "interests" },
  ],
};
