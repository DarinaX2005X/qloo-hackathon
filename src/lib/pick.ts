import type { Domain, EntityRef } from "@/shared/contracts";

// Places share names with films and songs ("Holiday"), so a bare name rarely means a place.
// A brand often shares its name with the thing people actually love (Minecraft the game, not the store).
const PENALTY: Partial<Record<Domain, number>> = { place: 0.35, destination: 0.2, author: 0.05, brand: 0.05 };
const WEAK: Domain[] = ["place", "destination", "author"];

/** Picks the entity a person most likely meant by a bare name: exact names first, then the best known. */
export function pickEntity(query: string, results: EntityRef[]): EntityRef | null {
  if (!results.length) return null;
  // a genre the person typed ("jazz") is carried by its leading artist; search puts those first
  const standIn = results.find((r) => r.via);
  if (standIn) return standIn;
  const q = query.trim().toLowerCase();
  // an entity without popularity or picture is usually an obscure namesake (a researcher called Wes Anderson)
  const score = (r: EntityRef) => (r.popularity ?? 0) + (r.image ? 0.05 : 0) - (PENALTY[r.domain] ?? 0);
  const best = (list: EntityRef[]) => [...list].sort((a, b) => score(b) - score(a))[0];
  const exact = results.filter((r) => r.name.toLowerCase() === q);
  if (!exact.length) return best(results);
  const top = best(exact);
  // "Marvel" exactly names an author and a shop; "Marvel Entertainment" is what people mean
  const fuller = best(results.filter((r) => r.name.toLowerCase().startsWith(`${q} `)));
  if (WEAK.includes(top.domain) && fuller && (fuller.popularity ?? 0) >= (top.popularity ?? 0) + 0.2) return fuller;
  return top;
}
