import { activeLoves, apiError } from "@/shared/contracts";
import type { AuditV2, Constraint, SpotRequestV2, SpotResponseV2, VenueEvidence } from "@/shared/contracts-09";
import { geocode, reverseGeocode } from "@/server/geo/geocode";
import { haversine, median, walkMinutes } from "../geo";
import { evidenceRef, hash, normalized, resultMeta, uniqueEvidence } from "./core";
import { dedupePlaces } from "./eligibility";
import { pointInArea } from "./geometry";
import { cityManifest, type CityManifest } from "./manifest";
import { analyzeAreas } from "./ranking";
import { areaSignature } from "./signatures";
import { homeAreaDecision } from "./home-api";
import { effectiveConstraints, loadVenuePool } from "./venues-api";

export function requiredVenueRoles(constraints: Constraint[]): string[] {
  return [...new Set(constraints.filter(c => c.strength === "hard" && c.kind === "intent").flatMap(c => {
    const value = normalized(String(c.value));
    return /coffee|cafe|wifi|wi fi/.test(value) ? ["coffee"] : /dance|dancing/.test(value) ? ["dance"] : /concert|live music/.test(value) ? ["live_music"] : /food|restaurant/.test(value) ? ["food"] : [];
  }))];
}
export function auditVenueRequirements(venues: VenueEvidence[], constraints: Constraint[], goalId: string): AuditV2 {
  const missing = requiredVenueRoles(constraints).filter(role => !venues.some(v => v.role === role));
  return { hardViolations: [], unmet: missing.map(role => ({ goalId, reason: `No ${role.replace(/_/g, " ")} venue satisfies all of the requested constraints.`, recoverable: true })),
    warnings: [...new Set(venues.flatMap(v => v.limitations))] };
}
/** A street estimate from matching verified venue addresses, never a house geocode. */
export function catalogStreetPoint(query: string, manifest: CityManifest): { point: [number, number]; label: string; entityIds: string[] } | null {
  const rawStreet = query.split(",")[0].replace(/\s+\d+[a-z]?\s*$/i, "").trim();
  const stem = (text: string) => normalized(text.replace(/\d.*$/, "")).replace(/^(?:r|rua|rue|street|st|road|rd|avenue|ave|av|avenida)\s+/, "");
  const wanted = stem(rawStreet);
  if (wanted.length < 5 || wanted.split(" ").length < 2) return null;
  const matches = manifest.catalog.filter(p => p.address && stem(p.address) === wanted);
  if (matches.length < 2) return null;
  const point: [number, number] = [median(matches.map(p => p.lon)), median(matches.map(p => p.lat))];
  if (matches.some(p => haversine(point, [p.lon, p.lat]) > 1500)) return null;
  return { point, label: `${rawStreet}, ${manifest.cityName} (street estimate)`, entityIds: matches.map(p => p.id) };
}
export async function spotV2(input: SpotRequestV2): Promise<SpotResponseV2> {
  const { value: manifest } = await cityManifest(input.state.city);
  if (input.manifestVersion && input.manifestVersion !== manifest.version) throw apiError("bad_input", "The city catalog changed. Refresh the area list before checking this address.", true);
  const found = input.point ? null : await geocode(`${input.query}, ${manifest.cityName}`, manifest.center, 25000);
  const streetEstimate = !input.point && !found && input.query ? catalogStreetPoint(input.query, manifest) : null;
  const point = input.point ?? found?.center ?? streetEstimate?.point;
  if (!point || haversine(point, manifest.center) > 25000) throw apiError("not_found", `We couldn't locate that address in ${manifest.cityName}. Try a street name or choose a point.`);
  const selected = input.areaId ? manifest.areas.find(a => a.identity.id === input.areaId) : undefined;
  if (input.areaId && !selected) throw apiError("not_found", "The selected area is no longer in the city catalog.");
  const containing = manifest.areas.filter(a => pointInArea(point, a.identity)).sort((a, b) => haversine(point, a.identity.center) - haversine(point, b.identity.center))[0];
  const constraints = effectiveConstraints(input.state, input.constraints);
  const [pool, analysis, pinLabel] = await Promise.all([
    loadVenuePool(manifest, input.state, { intent: "daily_life", constraints, center: point, radiusM: 800, area: containing?.identity }),
    activeLoves(input.state.loves).length ? analyzeAreas(input).catch(() => null) : null,
    input.point ? reverseGeocode(point) : null,
  ]);
  const nearest = pool.venues.map(venue => ({ venue, walkMinutes: walkMinutes(point, [venue.place.lon, venue.place.lat]), approximate: true as const }))
    .filter(v => v.walkMinutes <= 12).sort((a, b) => a.walkMinutes - b.walkMinutes || b.venue.place.affinity - a.venue.place.affinity);
  const keep = new Set(dedupePlaces(nearest.map(v => v.venue.place), true).map(p => p.id));
  const nearby = nearest.filter(v => keep.has(v.venue.place.id)).slice(0, 10).map(v => ({ ...v, walkMinutes: Math.round(v.walkMinutes * 10) / 10 }));
  const actual = containing && analysis?.value.areas.find(a => a.area.id === containing.identity.id);
  const area = actual ?? (containing ? homeAreaDecision(await areaSignature(manifest, containing), null, manifest.areas.indexOf(containing) + 1, manifest.areas.length, constraints) : null);
  const geo = evidenceRef(streetEstimate ? "derived" : "geocode", { fetchedAt: new Date().toISOString(), requestHash: hash([input.query, point, found?.houseNumber, found?.street, streetEstimate?.entityIds]) }, streetEstimate?.entityIds, streetEstimate ? "verified-catalog-street-estimate-v1" : undefined);
  const evidence = uniqueEvidence([geo, ...pool.evidence, ...(analysis?.value.evidence ?? []), ...manifest.evidence]);
  const constraintsAudit = auditVenueRequirements(nearby.map(p => p.venue), constraints, "evaluate_address");
  if (streetEstimate) constraintsAudit.warnings.push("The house number could not be located. This check estimates the street's surroundings from matching venue addresses.");
  constraintsAudit.unmet.push(...pool.unmet.map(reason => ({ goalId: "evaluate_address", reason, recoverable: true })));
  if (!nearby.length && !constraintsAudit.unmet.length) constraintsAudit.unmet.push({ goalId: "evaluate_address", reason: "No eligible everyday places were found within about 12 minutes on foot.", recoverable: true });
  if (analysis === null && activeLoves(input.state.loves).length) constraintsAudit.warnings.push("The cultural area ranking could not be loaded; the nearby venue check is still available.");
  if (!area) constraintsAudit.warnings.push("This address is outside the fixed areas in the central city comparison.");
  return { meta: resultMeta(input, manifest, { method: "address-actual-point-v1", partial: pool.partial || !area || constraintsAudit.unmet.length > 0, suffix: [point, input.areaId], dataAsOf: evidence.map(e => e.fetchedAt).sort()[0] }),
    label: found?.label ?? streetEstimate?.label ?? pinLabel ?? input.query ?? "Selected point", point,
    geocodeQuality: found?.houseNumber ? "building" : found?.street || found?.streetLevel || streetEstimate ? "street" : "area", area,
    outsideSelectedArea: !!selected && !pointInArea(point, selected.identity), nearby, constraintsAudit, evidenceIds: evidence.map(e => e.id), evidence };
}
