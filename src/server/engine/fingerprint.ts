import { activeLoves, type ExploreState, type Fingerprint, type ResolvedLove, type TagRef } from "@/shared/contracts";
import { qlooGet, record, resultRows, unit } from "@/server/qloo/client";
import { tagRef } from "@/server/qloo/search";
import { signals } from "./signals";

export function meaningfulTag(tag: TagRef): boolean {
  return !/(?:^|:)(?:payment\w*|parking\w*|accessibility\w*|wheelchair\w*|hotel_class|hotel_rating|star_rating|rating|business_rating)(?::|$)/i.test(tag.id);
}

export async function fingerprintTags(loves: ResolvedLove[], refinements: TagRef[] = []): Promise<TagRef[]> {
  if (!activeLoves(loves).length && !refinements.length) return [];
  const response = await qlooGet("/v2/insights", { "filter.type": "urn:tag", ...signals(loves, refinements), take: 50 });
  const found = new Map<string, TagRef>();
  const rows = resultRows(response, "tags").sort((a, b) => unit(record(b.query).affinity) - unit(record(a.query).affinity));
  for (const row of rows) {
    const tag = tagRef(row);
    if (tag && meaningfulTag(tag) && !found.has(tag.id)) found.set(tag.id, tag);
  }
  return [...found.values()].slice(0, 12);
}

export async function buildFingerprint(state: ExploreState): Promise<Fingerprint> {
  const [you, them] = await Promise.all([
    fingerprintTags(state.loves, state.refinements),
    state.companion ? fingerprintTags(state.companion.loves, state.refinements) : undefined,
  ]);
  if (!them) return { you };
  const yours = new Set(you.map((tag) => tag.id));
  const theirs = new Set(them.map((tag) => tag.id));
  return { you, them, shared: you.filter((tag) => theirs.has(tag.id)), onlyYou: you.filter((tag) => !theirs.has(tag.id)), onlyThem: them.filter((tag) => !yours.has(tag.id)) };
}
