import { Domain, type EntityRef, type TagRef, apiError } from "@/shared/contracts";
import { qlooGet, record, resultRows, string, unit, type QlooRecord } from "./client";
import { qlooDomain } from "./domains";

const priority: Domain[] = ["artist", "movie", "tv_show", "book", "person", "brand", "place", "podcast", "video_game", "destination", "author"];

export function entityRef(row: QlooRecord, domain?: Domain): EntityRef | null {
  const id = string(row.entity_id) ?? string(row.id);
  const name = string(row.name);
  const rawTypes = Array.isArray(row.types) ? row.types : [row.subtype, row.type];
  const types = rawTypes.map((type) => type === "urn:entity:videogame" ? "urn:entity:video_game" : type);
  const selected = domain && domain !== "author" && types.includes(`urn:entity:${domain}`) ? domain : priority.find((d) => types.includes(`urn:entity:${d}`));
  if (!id || !name || !selected || (domain && !types.includes(`urn:entity:${domain}`))) return null;
  const properties = record(row.properties);
  return { id, name, domain: selected, image: string(record(properties.image).url),
    subtitle: (string(properties.short_description) ?? string(row.short_description))?.slice(0, 90),
    ...(typeof row.popularity === "number" ? { popularity: unit(row.popularity) } : {}) };
}

export function tagRef(row: QlooRecord): TagRef | null {
  const id = string(row.tag_id) ?? string(row.id);
  const name = string(row.name);
  return id?.startsWith("urn:tag:") && name ? { id, name, kind: id.split(":")[2] } : null;
}

export function searchQuery(q: string): string {
  if (!q.trim() || q.trim().length > 120) throw apiError("bad_input", "Search query must contain 1–120 characters.");
  return q.trim();
}

/** Search can return the same id once per type, rather than one row with all types. */
export function mergeEntityRows(rows: QlooRecord[]): QlooRecord[] {
  const merged = new Map<string, QlooRecord>();
  for (const row of rows) {
    const id = string(row.entity_id) ?? string(row.id);
    if (!id) continue;
    const previous = merged.get(id);
    const types = Array.isArray(row.types) ? row.types : [row.subtype, row.type];
    merged.set(id, { ...previous, ...row,
      properties: { ...record(previous?.properties), ...record(row.properties) },
      types: [...new Set([...(Array.isArray(previous?.types) ? previous.types : []), ...types])],
    });
  }
  return [...merged.values()];
}

export async function searchEntities(q: string, domain?: Domain): Promise<EntityRef[]> {
  if (domain !== undefined && !Domain.safeParse(domain).success) throw apiError("bad_input", "Unknown entity domain.");
  const response = await qlooGet("/search", { query: searchQuery(q), types: domain ? `urn:entity:${qlooDomain(domain)}` : undefined, take: 6 });
  const found = new Map<string, EntityRef>();
  for (const row of mergeEntityRows(resultRows(response, "entities"))) {
    const entity = entityRef(row, domain);
    if (entity && !found.has(entity.id)) found.set(entity.id, entity);
  }
  return [...found.values()].slice(0, 6);
}

const squash = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const WORK: Domain[] = ["artist", "movie", "tv_show", "book", "video_game", "podcast"];

/**
 * A music genre typed as a love ("jazz", "techno", "hip hop") has no entity of its own; the places it
 * finds are namesakes (a bar called Jazz, a streamer called Technoblade). Qloo knows which artists carry
 * the genre tag, so the genre's leading artists stand in for it and say so.
 */
export async function genreStandIns(q: string, results: EntityRef[]): Promise<EntityRef[]> {
  const word = squash(q);
  if (word.length < 3 || q.trim().split(/\s+/).length > 3) return [];
  // a well-known work with exactly this name is what the person meant ("Hip Hop" the album would not be)
  if (results.some((r) => squash(r.name) === word && WORK.includes(r.domain) && (r.popularity ?? 0) >= 0.9)) return [];
  const tags = resultRows(await qlooGet("/v2/tags", { "filter.query": q.trim(), "filter.tag.types": "urn:tag:genre:music", take: 10 }), "tags");
  const genre = tags.map(tagRef).find((tag): tag is TagRef => !!tag && squash(tag.name) === word);
  if (!genre) return [];
  const rows = resultRows(await qlooGet("/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.tags": genre.id, take: 5 }), "entities");
  return rows.flatMap((row) => {
    const entity = entityRef(row, "artist");
    return entity ? [{ ...entity, via: genre.name.replace(/\s*-\s*/g, "-") }] : [];
  }).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 3);
}

/** Search for something a person loves: entities by name, led by stand-ins when the text is a genre. */
export async function searchTaste(q: string): Promise<EntityRef[]> {
  const results = await searchEntities(q);
  // the lookup only reaches the network when nothing well known has exactly this name, so it may take
  // its time (Qloo's artist-by-genre answer can take several seconds cold); a hard cap still keeps search alive
  const late = new Promise<EntityRef[]>((resolve) => setTimeout(() => resolve([]), 14000));
  const standIns = await Promise.race([genreStandIns(q, results).catch(() => []), late]);
  return [...standIns, ...results.filter((r) => !standIns.some((s) => s.id === r.id))].slice(0, 8);
}

export async function searchPlaceTags(q: string): Promise<TagRef[]> {
  const response = await qlooGet("/v2/tags", { "filter.query": searchQuery(q), "filter.parents.types": "urn:entity:place", take: 50 });
  const found = new Map<string, TagRef>();
  for (const row of resultRows(response, "tags")) {
    if (Array.isArray(row.parents) && !row.parents.some((p) => record(p).type === "urn:entity:place")) continue;
    const tag = tagRef(row);
    if (tag) found.set(tag.id, tag);
  }
  return [...found.values()];
}
