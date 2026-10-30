import type { CityScore, Domain, Neighborhood, ResolvedLove, TasteField } from "@/shared/contracts";

/** A name on the landing, with the kind of thing it means when the bare name is ambiguous
 *  ("Euphoria" alone finds the novel first; the night owl means the HBO show). */
export type LandingName = string | { name: string; domain: Domain };

export const nameOf = (n: LandingName) => (typeof n === "string" ? n : n.name);
export const domainOf = (n: LandingName): Domain | undefined => (typeof n === "string" ? undefined : n.domain);
/** Qloo spells some artists in capitals ("PEGGY GOU"); the landing keeps the spelling it shows above the map. */
export function landingName<T extends { name: string }>(query: string, chosen: T | null): T | null {
  const shouting = (s: string) => s === s.toUpperCase();
  if (!chosen || chosen.name.toLowerCase() !== query.toLowerCase() || !shouting(chosen.name) || shouting(query) || query === query.toLowerCase()) return chosen;
  return { ...chosen, name: query };
}
export const namesText = (list: readonly LandingName[]) => list.map(nameOf).join(", ");

/** The fixed tastes the landing shows. The data for them comes from /api/landing. */
export const LANDING: {
  hero: { city: string; loves: LandingName[] };
  reader: { city: string; loves: LandingName[] };
  owl: { city: string; loves: LandingName[] };
  pair: { city: string; you: LandingName[]; them: LandingName[] };
  compare: string[];
} = {
  hero: { city: "Lisbon", loves: ["Radiohead", { name: "Fleabag", domain: "tv_show" }, "Wes Anderson", { name: "Patagonia", domain: "brand" }] },
  reader: { city: "Berlin", loves: [{ name: "Haruki Murakami", domain: "author" }, "Radiohead", { name: "Fleabag", domain: "tv_show" }] },
  owl: { city: "Berlin", loves: [{ name: "Charli xcx", domain: "artist" }, { name: "Peggy Gou", domain: "artist" }, { name: "Euphoria", domain: "tv_show" }] },
  pair: {
    city: "Lisbon",
    you: [{ name: "Haruki Murakami", domain: "author" }, "Radiohead", "Wes Anderson"],
    them: [{ name: "Peggy Gou", domain: "artist" }, { name: "Succession", domain: "tv_show" }, { name: "Patagonia", domain: "brand" }],
  },
  compare: ["Lisbon", "Tokyo, Japan", "New York", "Mexico City", "Berlin"],
};

export type LandingScene = { city: string; loves: ResolvedLove[]; companion: ResolvedLove[] | null; field: TasteField; hoods: Neighborhood[] };
export type LandingData = { hero: LandingScene | null; reader: LandingScene | null; owl: LandingScene | null; pair: LandingScene | null; cities: CityScore[] | null };
