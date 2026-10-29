import type { Domain, EntityRef } from "@/shared/contracts";

// Places share names with films and songs ("Holiday"); a bare name almost always means the cultural thing.
const ORDER: Domain[] = ["artist", "tv_show", "movie", "book", "person", "author", "brand", "podcast", "video_game", "destination", "place"];

/** Picks the entity a person most likely meant by a bare name. */
export function pickEntity(query: string, results: EntityRef[]): EntityRef | null {
  if (!results.length) return null;
  const q = query.trim().toLowerCase();
  const exact = results.filter((r) => r.name.toLowerCase() === q);
  const pool = exact.length ? exact : results;
  return [...pool].sort((a, b) => {
    const d = ORDER.indexOf(a.domain) - ORDER.indexOf(b.domain);
    return d !== 0 ? d : (b.popularity ?? 0) - (a.popularity ?? 0);
  })[0];
}
