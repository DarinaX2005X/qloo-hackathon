import type { Neighborhood } from "@/shared/contracts";

// ---------------------------------------------------------------- Match
// Neighborhoods are ordered by `score`, and the number people see is the same score on a 0-100 scale:
// "Match 54". 50 is neutral, so a whole ranking can sit below 50. One word everywhere: "Match".

export const MATCH_LABEL = "Match";

/** 0..100, rounded. Null when there is no score. */
export function matchIndex(score: number | null | undefined): number | null {
  if (score === undefined || score === null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

/** "Match 54". */
export function matchPhrase(score: number | null | undefined): string | null {
  const m = matchIndex(score);
  return m === null ? null : `${MATCH_LABEL} ${m}`;
}

/** The meaning of the number, on hover and behind "What Match means". */
export const MATCH_EXPLAINER =
  "Your taste's signal here on a 0–100 scale, where 50 is neutral; it accounts for how busy the area is and, for two people, the less happy of you. Neighborhoods are ordered by this number. It is not a probability.";

/** Under a ranked list where no area reaches neutral (the backend sends rankingNote). */
export const BELOW_NEUTRAL_NOTE =
  "None of the mapped areas stands out for this taste with these settings; try fewer loves or turn the crowd dial.";

// ---------------------------------------------------------------- Crowd
// Popularity only: never a claim about residents or visitors.

export type Crowd = "quiet" | "moderate" | "busy";
export const CROWD_LABEL: Record<Crowd, string> = { quiet: "Quieter", moderate: "Moderate", busy: "Busy" };
const FROM_VIBE: Record<Neighborhood["vibe"], Crowd> = { local: "quiet", mixed: "moderate", touristy: "busy" };

export function crowdOf(n: Pick<Neighborhood, "crowd" | "vibe">): Crowd {
  return n.crowd ?? FROM_VIBE[n.vibe] ?? "moderate";
}

/** Same thresholds as the backend's neighborhood crowd. */
export function crowdFromPopularity(popularity: number): Crowd {
  return popularity > 0.85 ? "busy" : popularity > 0.6 ? "moderate" : "quiet";
}

/** "Crowd: Quieter" with the plain meaning, for a line under a neighborhood. */
export function crowdLine(c: Crowd) {
  return `Crowd: ${CROWD_LABEL[c]}`;
}
export const CROWD_TOOLTIP = "How busy the area is overall in Qloo's popularity data. It says nothing about who lives there.";

// ---------------------------------------------------------------- Plan reason codes

/** Why a stop is in the plan when the planner had to adapt. Only codes that describe the stop itself;
 *  the reasons a slot stayed empty (none_nearby, over_budget, unsuitable_time) belong to the day. */
const STOP_REASON: Record<string, string> = {
  closed: "Replaced a pick that is closed at this time",
  relaxed_neighborhood: "From another ranked area nearby",
  relaxed_radius: "Found in a wider radius",
  relaxed_preferences: "A looser match to your place preferences",
  relaxed_category: "A different kind of stop than planned",
};
export function stopReasonLines(codes: string[] | undefined): string[] {
  return [...new Set((codes ?? []).map((c) => STOP_REASON[c]).filter((s): s is string => !!s))];
}

// ---------------------------------------------------------------- Plan rules

const CATEGORY_RULE: Record<string, string> = { coffee: "No cafés", food: "No restaurants", drinks: "No bars", culture: "No culture stops", stay: "No hotels" };
export const categoryRuleLabel = (c: string) => CATEGORY_RULE[c] ?? `No ${c}`;

/** "museum" -> "No museums", "urn:tag:category:qloo:art_gallery" -> "No art galleries". */
export function tagRuleLabel(tag: string) {
  const words = (tag.includes(":") ? tag.slice(tag.lastIndexOf(":") + 1) : tag).replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!words) return "No tag";
  const plural = /s$/.test(words) ? words : /[^aeiou]y$/.test(words) ? `${words.slice(0, -1)}ies` : /(x|ch|sh)$/.test(words) ? `${words}es` : `${words}s`;
  return `No ${plural}`;
}

// ---------------------------------------------------------------- Walking

/** "≈ 8 min walk": straight-line distance, so always approximate. */
export function walkText(minutes: number, approximate = true) {
  const m = Math.max(1, Math.round(minutes));
  return approximate ? `≈ ${m} min walk` : `${m} min walk`;
}

/** "Neighborhood estimate · roughly 1 km grid". */
export function gridText(resolutionM?: number) {
  const km = (resolutionM ?? 1000) / 1000;
  const shown = km < 0.95 ? `${Math.round(km * 10) / 10} km` : `${Math.round(km)} km`;
  return `Neighborhood estimate · roughly ${shown} grid`;
}

// ---------------------------------------------------------------- Errors

/** A short, friendly line for a rate-limited request, shown next to the action that hit it. */
export function quotaText(what = "this") {
  return `Homing is getting a lot of requests right now. Wait a few seconds, then try ${what} again.`;
}

// ---------------------------------------------------------------- Feels like home

export const SIMILARITY_LABEL = "taste-tag similarity";
/** Words almost every area carries; a counterpart is better described by a tag that says more. */
const BROAD_TAGS = new Set(["casual", "modern", "lively", "popular", "trendy", "friendly"]);

/** The tag a suggested counterpart shares with the place from home, the most telling one first. */
export function twinSharedTag(from: { tags: string[] }, to: { tags: string[] }): string | null {
  const there = new Set(to.tags.map((t) => t.toLowerCase()));
  const common = from.tags.filter((t) => there.has(t.toLowerCase()));
  return common.find((t) => !BROAD_TAGS.has(t.toLowerCase())) ?? common[0] ?? null;
}
