import { activeLoves, type ExploreState, type Fingerprint, type ResolvedLove, type TagRef } from "@/shared/contracts";
import { qlooGet, record, records, resultRows, unit, type QlooRecord } from "@/server/qloo/client";
import { tagRef } from "@/server/qloo/search";
import { signals } from "./signals";

export const PLACE_TAG_TYPES = "urn:tag:ambience:qloo,urn:tag:decor:qloo,urn:tag:genre:place";

export function tagName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function usefulExplanation(text: string): boolean {
  return !/\b(?:payments?|parking|credit cards?|debit cards?|wheelchair|accessib\w*|inclusiv\w*|ratings?|stars?|women.owned|identifies as)\b/i.test(text.replace(/[_:-]/g, " "));
}

export function meaningfulTag(tag: TagRef): boolean {
  return usefulExplanation(tag.id) && usefulExplanation(tag.name) &&
    !/(?:^|:)(?:hotel_class|hotel_rating|star_rating|business_rating)(?::|$)/i.test(tag.id);
}

export function placeTasteTag(tag: TagRef): boolean {
  return /^urn:tag:(?:(?:ambience|decor):(?:qloo|place):|genre:place:)/.test(tag.id) && meaningfulTag(tag);
}

/** Count a matching name at most once per venue, even across ambience/decor namespaces. */
export function matchedPlaceTags(places: QlooRecord[], desired: TagRef[], tasteOnly = true): string[] {
  const wanted = new Map<string, { name: string; order: number }>();
  desired.filter(meaningfulTag).forEach((tag, order) => {
    const key = tagName(tag.name);
    if (!wanted.has(key)) wanted.set(key, { name: tag.name, order });
  });
  const counts = new Map<string, number>();
  for (const place of places) {
    const names = new Set(records(place.tags).map(tagRef).filter((tag): tag is TagRef => !!tag &&
      meaningfulTag(tag) && (!tasteOnly || placeTasteTag(tag))).map((tag) => tagName(tag.name)));
    for (const name of names) if (wanted.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort(([a, ca], [b, cb]) => cb - ca || wanted.get(a)!.order - wanted.get(b)!.order)
    .slice(0, 4).map(([name]) => wanted.get(name)!.name);
}

export async function fingerprintTags(loves: ResolvedLove[], refinements: TagRef[] = []): Promise<TagRef[]> {
  if (!activeLoves(loves).length && !refinements.length) return [];
  const response = await qlooGet("/v2/insights", {
    "filter.type": "urn:tag", "filter.tag.types": PLACE_TAG_TYPES, ...signals(loves, refinements), take: 50,
  });
  const found = new Map<string, TagRef>();
  const rows = resultRows(response, "tags").sort((a, b) => unit(record(b.query).affinity) - unit(record(a.query).affinity));
  for (const row of rows) {
    const tag = tagRef(row);
    if (tag && /^urn:tag:(?:(?:ambience|decor):qloo:|genre:place:)/.test(tag.id) && meaningfulTag(tag) && !found.has(tagName(tag.name)))
      found.set(tagName(tag.name), tag);
  }
  return [...found.values()].slice(0, 10);
}

export async function buildFingerprint(state: ExploreState): Promise<Fingerprint> {
  const [you, them] = await Promise.all([
    fingerprintTags(state.loves, state.refinements),
    state.companion ? fingerprintTags(state.companion.loves, state.refinements) : undefined,
  ]);
  if (!them) return { you };
  const yours = new Set(you.map((tag) => tagName(tag.name)));
  const theirs = new Set(them.map((tag) => tagName(tag.name)));
  return { you, them, shared: you.filter((tag) => theirs.has(tagName(tag.name))).slice(0, 6),
    onlyYou: you.filter((tag) => !theirs.has(tagName(tag.name))).slice(0, 6),
    onlyThem: them.filter((tag) => !yours.has(tagName(tag.name))).slice(0, 6) };
}
