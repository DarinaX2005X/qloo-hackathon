import type { Neighborhood } from "@/shared/contracts";

// ---------------------------------------------------------------- Area metric (stage 09)
// The one number people see for an area is its place in the list of areas checked: "#1 of 16 areas checked".
// A percentile is added only when the backend allows it (enough support, at least 5 supported areas),
// and it is a percentile of the checked areas, never a "Match" or a probability. The internal taste score
// is never formatted for people. Every screen renders area numbers through these helpers and
// components/ui/Metric.tsx, so the wording and the rules live in one place.

export type Quality = "sufficient" | "limited" | "unavailable";

/** What the renderer needs from B's `AreaMetrics` (structural, so the v2 type and the legacy adapter both fit). */
export type MetricInput = {
  rank: number;
  candidateCount: number;
  /** 0..100 share of checked areas ranked below this one; null when hidden by the backend */
  percentile: number | null;
  /** true when this area is practically level with its neighbors in the ranking */
  tieBand: boolean;
  support?: { quality: Quality } | null;
};

const PERCENTILE_MIN_AREAS = 5;

/** "#1 of 16 areas checked"; "#1" alone when the count is unknown. */
export function rankText(m: Pick<MetricInput, "rank" | "candidateCount">, short = false): string {
  const rank = Math.max(1, Math.round(m.rank));
  if (!(m.candidateCount >= rank)) return `#${rank}`;
  return short ? `#${rank} of ${m.candidateCount}` : `#${rank} of ${m.candidateCount} areas checked`;
}

/** Whether the percentile may be shown at all. */
export function showsPercentile(m: MetricInput): boolean {
  if (m.percentile === null || !Number.isFinite(m.percentile)) return false;
  if (m.candidateCount < PERCENTILE_MIN_AREAS) return false;
  if (m.support && m.support.quality !== "sufficient") return false;
  return true;
}

/** "Top 15% of checked areas" (short) or "Ahead of about 85% of the areas checked for your taste" (long). Null when hidden. */
export function percentileText(m: MetricInput, long = false): string | null {
  if (!showsPercentile(m)) return null;
  const p = Math.max(0, Math.min(100, Math.round(m.percentile as number)));
  if (long) return `Ahead of about ${p}% of the areas checked for your taste`;
  const top = Math.max(1, 100 - p);
  if (top > 50) return null; // "Top 70%" says nothing useful; the rank already says it
  return `Top ${top}% of checked areas`;
}

export type MetricState = "ranked" | "close" | "limited";
/** One state per area: limited data wins over a close call, which wins over a plain rank. */
export function metricState(m: MetricInput): MetricState {
  if (m.support && m.support.quality !== "sufficient") return "limited";
  if (m.tieBand) return "close";
  return "ranked";
}

/** The second, quiet line under the rank. */
export function metricNote(m: MetricInput): string | null {
  const s = metricState(m);
  if (s === "limited") return m.support?.quality === "unavailable" ? "No data for this area yet" : "Limited data";
  if (s === "close") return m.rank === 1 ? "About level with the next area" : "About level with its neighbors in the list";
  return percentileText(m);
}

/** The heading over a shortlist. */
export function metricHeadline(list: MetricInput[]): string {
  if (!list.length) return "No areas checked yet";
  const top = [...list].sort((a, b) => a.rank - b.rank)[0];
  const supported = list.filter((m) => !m.support || m.support.quality === "sufficient").length;
  if (supported === 0) return "Limited data for this taste";
  if (top.tieBand) return "Several close options";
  return "Start with these areas";
}

/** The definition behind the number, for the expandable note. */
export function metricExplainer(opts: { city?: string; candidateCount?: number; searchArea?: string } = {}): string {
  const where = opts.city ? ` in ${opts.city}` : "";
  const n = opts.candidateCount ? `${opts.candidateCount} areas` : "the areas";
  const area = opts.searchArea ?? "the central search area";
  return `Homing compares ${n}${where}, each a walkable circle inside ${area}, by how strongly your loves show up in Qloo's cultural signal there. "#1 of ${opts.candidateCount ?? "N"}" is a place in that list. When a percentage is shown, it is the share of those same areas ranked below this one. It is not a probability that you will like living there.`;
}

/** Today's `Neighborhood` as a metric input: the neutral rank only, never its score. */
export function legacyMetrics(n: Pick<Neighborhood, "rank">, all?: readonly unknown[] | null): MetricInput {
  return { rank: n.rank, candidateCount: all?.length ?? 0, percentile: null, tieBand: false, support: null };
}

// ---------------------------------------------------------------- Home overlap (Feels like home)

export type SimilarityInput = { value: number | null; method?: string; support?: Quality };

/** "Cultural-profile overlap 42/100" or "Style overlap 42/100"; null when there is no number to show. */
export function overlapText(s: SimilarityInput | null | undefined): string | null {
  if (!s || s.value === null || !Number.isFinite(s.value)) return null;
  if (s.support && s.support !== "sufficient") return null;
  const v = Math.max(0, Math.min(100, Math.round(s.value)));
  return `${s.method?.startsWith("style_only") ? "Style overlap" : "Cultural-profile overlap"} ${v}/100`;
}

export const OVERLAP_EXPLAINER =
  "How much the two neighborhoods share the distinctive styles of their places and the music Qloo links to them, from 0 to 100. Common words every area has count for little. It is not the share of people who would feel at home, and the closest area can still be a weak match.";

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

/** @deprecated legacy Home label; v2 renders overlapText. */
export const SIMILARITY_LABEL = "taste-tag similarity";
/** Words almost every area carries; a counterpart is better described by a tag that says more. */
const BROAD_TAGS = new Set(["casual", "modern", "lively", "popular", "trendy", "friendly"]);

/** The tag a suggested counterpart shares with the place from home, the most telling one first. */
export function twinSharedTag(from: { tags: string[] }, to: { tags: string[] }): string | null {
  const there = new Set(to.tags.map((t) => t.toLowerCase()));
  const common = from.tags.filter((t) => there.has(t.toLowerCase()));
  return common.find((t) => !BROAD_TAGS.has(t.toLowerCase())) ?? common[0] ?? null;
}
