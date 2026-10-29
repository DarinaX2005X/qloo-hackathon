import type { CityScore, Neighborhood, ResolvedLove, TasteField } from "@/shared/contracts";

/** The fixed tastes the landing shows. The data for them comes from /api/landing. */
export const LANDING = {
  hero: { city: "Lisbon", loves: ["Radiohead", "Fleabag", "Wes Anderson", "Patagonia"] },
  reader: { city: "Berlin", loves: ["Haruki Murakami", "Radiohead", "Fleabag"] },
  owl: { city: "Berlin", loves: ["Charli xcx", "Peggy Gou", "Euphoria"] },
  pair: { city: "Lisbon", you: ["Haruki Murakami", "Radiohead", "Wes Anderson"], them: ["Peggy Gou", "Succession", "Patagonia"] },
  compare: ["Lisbon", "Tokyo, Japan", "New York", "Mexico City", "Berlin"],
};

export type LandingScene = { city: string; loves: ResolvedLove[]; companion: ResolvedLove[] | null; field: TasteField; hoods: Neighborhood[] };
export type LandingData = { hero: LandingScene | null; reader: LandingScene | null; owl: LandingScene | null; pair: LandingScene | null; cities: CityScore[] | null };
