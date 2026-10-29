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
