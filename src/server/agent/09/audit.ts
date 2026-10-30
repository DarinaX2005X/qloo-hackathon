import type { AgentCardV2, Claim, Constraint, GoalState } from "@/shared/contracts-09";
import { auditVenueRequirements } from "@/server/engine/09/address-api";
import { venueEligibility } from "@/server/engine/09/eligibility";
import type { Execution } from "./tools";

export type GoalAudit = { status: GoalState["status"]; unmet: string[]; observation: string; evidenceIds: string[] };
export function auditExecution(result: Execution, constraints: Constraint[], goalId: string): GoalAudit {
  const evidenceIds = result.data.evidence.map(e => e.id), unmet: string[] = [];
  const venues = result.tool === "rank_areas" ? result.data.areas.slice(0, 3).flatMap(a => a.anchors)
    : result.tool === "translate_home" ? result.data.matches.slice(0, 3).flatMap(m => [...m.area.anchors, ...m.counterparts.map(p => p.target)])
    : result.tool === "find_venues" ? result.data.venues : result.tool === "evaluate_address" ? result.data.nearby.map(v => v.venue) : [];
  const invalid = venues.filter(v => !venueEligibility(v.place, v.role, constraints).allowed || !v.evidenceIds.length || v.evidenceIds.some(id => !evidenceIds.includes(id)));
  if (invalid.length) return { status: "failed", unmet: ["The returned places did not pass the final role, requirement and evidence check."], observation: "The places failed a final check, so they were not recommended.", evidenceIds };
  let observation = "The check returned a result.";
  switch (result.tool) {
    case "rank_areas": {
      const areas = result.data.areas.slice(0, 3);
      if (!areas.length) unmet.push("No area comparison could be made from the available cultural signals.");
      if (areas.some(a => a.recommendationStatus === "needs_checking")) unmet.push("The area ranking is exploratory; the places need checking before choosing a home.");
      unmet.push(...auditVenueRequirements(areas[0]?.anchors ?? [], constraints, goalId).unmet.map(u => `${u.reason} This requirement is unverified in the leading area.`));
      observation = areas.length ? `${areas[0].area.name} is first among ${areas[0].metrics.candidateCount} checked areas. ${areas[0].metrics.tieBand ? "Several options are close." : ""}`.trim() : unmet[0];
      break;
    }
    case "translate_home": {
      const top = result.data.matches[0];
      if (!top) unmet.push("No comparable target areas were found.");
      if (result.data.sourceSignatureSummary.support !== "sufficient") unmet.push("The former neighborhood has limited cultural evidence.");
      if (top && (top.similarity.value === null || top.similarity.support !== "sufficient")) unmet.push("The closest area's cultural overlap is not supported by enough data.");
      else if (top && top.similarity.value! < 35) unmet.push("The closest cultural profile is still a weak match to the former neighborhood.");
      unmet.push(...auditVenueRequirements(result.data.matches.slice(0, 3).flatMap(m => m.area.anchors), constraints, goalId).unmet.map(u => u.reason));
      observation = top?.similarity.value != null ? `${top.area.area.name} has cultural-profile overlap ${top.similarity.value.toFixed(1)}/100. ${top.orderReason === "home_personal_blend" ? "The order also considers your own tastes; the overlap itself is unchanged." : ""}`.trim() : "There is not enough cultural data for an overlap number.";
      break;
    }
    case "compare_cities": {
      unmet.push(...result.data.results.filter(c => c.status !== "ok").map(c => `${c.cityName}: ${c.error?.message ?? "The comparison has limited supporting data."}`));
      observation = result.data.results.map(c => `${c.cityName}: ${c.culturalOverlap === null ? "overlap unavailable" : `${c.culturalOverlap.toFixed(1)}/100 cultural overlap`}`).join("; ") + (result.data.recommendation ? "." : ". These results do not establish a clear city recommendation.");
      break;
    }
    case "evaluate_address": {
      unmet.push(...result.data.constraintsAudit.unmet.map(u => u.reason), ...result.data.constraintsAudit.hardViolations.map(v => v.reason));
      if (result.data.geocodeQuality !== "building") unmet.push(`This check locates the ${result.data.geocodeQuality === "street" ? "street" : "area"}; the individual building is unverified.`);
      observation = `${result.data.label}: ${result.data.nearby.length} eligible places within about 12 minutes on foot.${result.data.outsideSelectedArea ? " The address is outside the previously selected area." : ""}`;
      break;
    }
    case "find_venues": {
      unmet.push(...result.data.unmet, ...auditVenueRequirements(result.data.venues, constraints, goalId).unmet.map(u => u.reason));
      if (result.data.venues.length < 2) unmet.push("Fewer than two venues passed the requested checks.");
      if (result.data.venues.length && !result.data.venues.some(v => v.connections.length)) unmet.push("The returned venues have no verified connection to the supplied loves.");
      observation = `${result.data.venues.length} venues passed the role and constraint checks.${result.data.venues.some(v => v.hoursStatus === "event_required") ? " Event schedules and admission remain unverified." : ""}`;
      break;
    }
    case "build_visit": {
      unmet.push(...result.data.audit.unmet.map(u => u.reason), ...result.data.audit.hardViolations.map(v => v.reason));
      const stops = result.data.itinerary.days.flatMap(d => d.stops);
      if (!stops.length && !unmet.length) unmet.push("No eligible stops could be scheduled.");
      observation = `${stops.length} stops across ${result.data.itinerary.days.length} day${result.data.itinerary.days.length === 1 ? "" : "s"}; ${result.data.audit.hardViolations.length} hard constraint violations.${unmet.length ? " Some requested stops remain unfilled." : ""}`;
      if (result.data.audit.hardViolations.length) return { status: "failed", unmet, observation, evidenceIds };
      break;
    }
    case "explain_area": {
      if (!result.data.ablations.length) unmet.push("There are no active cultural signals to remove for this check.");
      observation = result.data.claims.map(c => c.text).join(" ");
      break;
    }
  }
  return { status: unmet.length ? "partial" : "satisfied", unmet: [...new Set(unmet)], observation, evidenceIds };
}

/** Every factual sentence is rendered from a verified field; model prose never supplies facts. */
export function claimsForCard(card: AgentCardV2, evidenceIds: string[]): Claim[] {
  const make = (text: string, ids = evidenceIds): Claim => ({ text, evidenceIds: ids });
  switch (card.kind) {
    case "areas": {
      const top = card.areas[0]; if (!top) return [];
      const venues = top.anchors.slice(0, 2).map(v => v.place.name).join(" and ");
      return [make(`Start by exploring ${top.area.name}, #${top.metrics.rank} of ${top.metrics.candidateCount} areas checked.${venues ? ` Places to check include ${venues}.` : ""} The cultural ranking is a starting point; check the streets and practical details in person.`)];
    }
    case "home": {
      const top = card.matches[0]; if (!top) return [];
      const shared = top.sharedFeatures.slice(0, 2).map(f => f.label).join(" and ");
      return [make(`${top.area.area.name} comes first${top.orderReason === "home_personal_blend" ? " when home and your tastes are combined" : " in this home comparison"}.${top.similarity.value === null ? " The evidence is too limited for an overlap number." : ` Its cultural-profile overlap is ${top.similarity.value.toFixed(1)}/100.`}${shared ? ` Shared characteristics include ${shared}.` : ""}`)];
    }
    case "address": return [make(`${card.result.label} was checked at ${card.result.geocodeQuality} precision.${card.result.area ? ` Its surrounding comparison area is ${card.result.area.area.name}.` : " It is outside the named areas in this comparison."}${card.result.outsideSelectedArea ? " It lies outside your selected area." : ""}`)];
    case "venues": return card.venues.length ? [make(`Places to consider: ${card.venues.slice(0, 3).map(v => v.place.name).join(", ")}.${card.venues.some(v => v.hoursStatus === "event_required") ? " Check each venue's event schedule and admission; no particular event is confirmed." : " Check current opening hours before visiting."}`)] : [];
    case "comparison": return [make(card.result.results.map(c => `${c.cityName}: ${c.culturalOverlap === null ? "cultural overlap unavailable" : `${c.culturalOverlap.toFixed(1)}/100 cultural-profile overlap`}`).join("; ") + (card.result.recommendation ? "." : ". This comparison does not identify a clear winner."))];
    case "explanation": return card.claims;
    case "visit": {
      const n = card.result.itinerary.days.reduce((s, d) => s + d.stops.length, 0);
      return [make(`${n} verified ${n === 1 ? "stop is" : "stops are"} in the visit${card.result.audit.unmet.length ? ", with some gaps still shown" : ""}. ${card.result.itinerary.days.flatMap(d => d.stops).slice(0, 3).map(s => `${s.time} ${s.place.name}`).join("; ")}.${Object.values(card.result.venueEvidence).some(v => v.hoursStatus !== "known_open") ? " Some hours or event schedules remain unverified." : ""}`)];
    }
  }
}
