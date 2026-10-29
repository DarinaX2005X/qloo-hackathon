import type { Domain, EntityRef } from "@/shared/contracts";

// Places share names with films and songs ("Holiday"), so a bare name rarely means a place.
const PENALTY: Partial<Record<Domain, number>> = { place: 0.35, destination: 0.2, author: 0.05 };

/** Picks the entity a person most likely meant by a bare name: exact names first, then the best known. */
export function pickEntity(query: string, results: EntityRef[]): EntityRef | null {
  if (!results.length) return null;
  const q = query.trim().toLowerCase();
  const exact = results.filter((r) => r.name.toLowerCase() === q);
  const pool = exact.length ? exact : results;
  // an entity without popularity or picture is usually an obscure namesake (a researcher called Wes Anderson)
  const score = (r: EntityRef) => (r.popularity ?? 0) + (r.image ? 0.05 : 0) - (PENALTY[r.domain] ?? 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}
