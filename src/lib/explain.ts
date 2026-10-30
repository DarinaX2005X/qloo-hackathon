import type { DecidesResult, Itinerary } from "@/shared/contracts";
import type { Constraint, GoalKind, GoalStatus, RecoveryAction, VenueEvidence, VenueRole } from "@/components/agent09/types";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export function joinAnd(list: string[]) {
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// ---------------------------------------------------------------- What decides

/** The line under the summary. Each love is taken away on its own, so the text never reads as if
 *  several were removed together, and never names one love as deciding when several move the top. */
export function decidesStatement(r: DecidesResult) {
  const top = r.neighborhoods[0];
  if (!top || !top.without.length) return null;
  const losers = top.without.filter((w) => w.rank !== 1);
  if (r.robust || !losers.length) return { robust: true, text: `${top.name} stays first whichever single love you take away, so this pick does not rest on one taste.` };
  if (losers.length === 1) {
    const others = top.without.length - 1;
    return { robust: false, text: `Without ${losers[0].name}, ${top.name} is no longer first${others ? `; take away any other love on its own and it stays on top` : ""}.` };
  }
  return {
    robust: false,
    text: `${top.name} loses first place ${joinAnd(losers.map((w) => `without ${w.name}`)).replace(/ and without /, " and also without ")}, each taken away on its own. It rests on several of your loves, not on one.`,
  };
}

// ---------------------------------------------------------------- Trip: days the planner could not fill

type PlanDay = Itinerary["days"][number];
type Gap = { slot: string; reason?: string };

const REASON: Record<string, string> = {
  none_nearby: "no place that fits you nearby",
  closed: "the places that fit you are closed then",
  over_budget: "the places that fit you are over your budget",
  // unknown hours at an event venue, or the wrong time of day for it: not a confirmed closure
  unsuitable_time: "the places that fit you don't suit that time of day",
  relaxed_neighborhood: "filled from another ranked area",
  relaxed_radius: "filled from a wider radius",
  relaxed_preferences: "filled with a looser match to your preferences",
  relaxed_category: "filled with a different kind of stop",
};
/** A reason code in words; free text is shown as sent, unknown codes are dropped. */
export const reasonText = (code: string): string | null =>
  REASON[code] ?? (code.startsWith("relaxed_") ? `filled with a looser match (${code.slice(8).replace(/_/g, " ")})` : /\s/.test(code) ? code : null);

/** Slots the planner could not fill, with a reason when the backend sends one (day.issues, or objects in missing). */
function dayGaps(d: PlanDay): Gap[] {
  const issues = d.issues ?? [];
  const missing = (d.missing as unknown as (string | Gap)[]).map((m) => (typeof m === "string" ? { slot: m } : m));
  return [...issues, ...missing.filter((m) => !issues.some((i) => i.slot === m.slot))];
}

/** What to say under a planned day. The backend's own note wins; reasons are named only when sent;
 *  without them an empty day gets one line, never a "closed" claim per slot. */
export function dayNoteLines(d: PlanDay, city: string): string[] {
  const gaps = dayGaps(d);
  const sentences = gaps.filter((g) => /[.:]/.test(g.slot)).map((g) => g.slot);
  const slots = gaps.filter((g) => !/[.:]/.test(g.slot));
  const area = d.neighborhood || city;
  const lines: string[] = [];
  if (d.note) lines.push(d.note);
  if (slots.length && !d.stops.length && !d.note) {
    const why = [...new Set(slots.map((g) => (g.reason ? reasonText(g.reason) : null)).filter((w): w is string => !!w))];
    lines.push(`Homing couldn't fill this day in ${area} with places that fit you${why.length ? ` (${joinAnd(why)})` : ""}; try Plan again or a wider area.`);
  } else if (slots.length) {
    const byReason = new Map<string, string[]>();
    const plain: string[] = [];
    for (const g of slots) {
      const why = g.reason ? reasonText(g.reason) : null;
      if (why) byReason.set(why, [...(byReason.get(why) ?? []), g.slot.toLowerCase()]);
      else plain.push(g.slot.toLowerCase());
    }
    for (const [why, names] of byReason) lines.push(`${cap(joinAnd(names))}: ${why.replace(/[.\s]+$/, "")}.`);
    if (plain.length && !d.note) lines.push(`Homing couldn't find a place that fits you for ${joinAnd(plain)} in ${area}.`);
  }
  lines.push(...sentences);
  return lines;
}

// ---------------------------------------------------------------- Agent v2: goals, constraints, venues, visit


/** What each goal of a turn is, in the person's terms. */
export const GOAL_LABEL: Record<GoalKind, string> = {
  choose_area: "Choose where to start looking",
  compare_cities: "Compare the cities",
  evaluate_address: "Check the address",
  find_venues: "Find places that fit",
  build_visit: "Plan a walk to try the area",
};
export const GOAL_STATUS: Record<GoalStatus, string> = {
  pending: "Waiting",
  running: "Working on it",
  satisfied: "Done",
  partial: "Partly done",
  failed: "Not finished",
  needs_input: "Needs your answer",
};

/** Short reasons the backend sends as codes; free text is shown as sent. */
const UNMET: Record<string, string> = {
  not_reported: "the assistant did not report back on this",
  no_signal: "Qloo has no data for this here",
  unavailable: "Qloo did not answer in time",
  limited_support: "there is too little data to be sure",
  no_eligible_venues: "no place passed your rules",
  wifi_unverified: "wifi is not listed for these cafés",
  price_unknown: "prices are not listed",
  hours_unknown: "opening hours are not listed",
  geocode_street: "only the street was found, not the building",
  outside_area: "it is outside the area you picked",
  budget_exhausted: "the assistant ran out of lookups for this question",
  timeout: "it took too long",
  stopped: "you stopped the answer before this finished",
  interrupted: "the connection ended before this finished",
};
export function unmetText(code: string): string {
  if (UNMET[code]) return UNMET[code];
  if (/\s/.test(code)) return code.trim();
  return code.replace(/_/g, " ");
}

const INTENT: Record<string, string> = {
  dance: "dancing",
  concert: "live music",
  coffee: "coffee",
  food: "food",
  bar: "bars",
  daily_life: "everyday places",
  live_music: "live music",
  culture: "culture",
};
const PLURAL: Record<string, string> = {
  bar: "bars",
  museum: "museums",
  club: "clubs",
  nightclub: "clubs",
  hotel: "hotels",
  hotel_bar: "hotel bars",
  "hotel bar": "hotel bars",
  adult: "adult venues",
  adult_entertainment: "adult venues",
  chain: "chains",
  drinks: "bars",
  culture: "museums or galleries",
  coffee: "cafés",
  food: "restaurants",
};
const dollars = (n: number) => "$".repeat(Math.max(1, Math.min(4, Math.round(n))));
const words = (v: string) => v.replace(/[_-]+/g, " ").replace(/wi ?fi/gi, "Wi-Fi").trim();

/** A constraint as a chip label. `names` turns place IDs into names; without one, the ID is never shown. */
export function constraintLabel(c: Constraint, names: Record<string, string> = {}): string {
  const v = typeof c.value === "string" ? c.value.trim() : c.value;
  switch (c.kind) {
    case "exclude_type": {
      const key = String(v).toLowerCase();
      return `No ${PLURAL[key] ?? (key.endsWith("s") ? words(key) : `${words(key)}s`)}`;
    }
    case "exclude_place":
      return names[String(v)] ? `Not ${names[String(v)]}` : "A place you removed";
    case "budget": {
      const level = typeof v === "number" ? v : Number(String(v).replace(/[^0-9]/g, "")) || String(v).length;
      return c.strength === "hard" ? `${dollars(level)} or less, known prices only` : `Around ${dollars(level)}`;
    }
    case "dietary":
      return cap(words(String(v)));
    case "hours":
      return cap(words(String(v)));
    case "distance": {
      const m = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(m)) return cap(words(String(v)));
      return m >= 1000 ? `Within ${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `Within ${Math.round(m / 50) * 50} m`;
    }
    case "ambience":
      return cap(words(String(v)));
    case "intent":
      return cap(INTENT[String(v)] ?? words(String(v)));
  }
}
export const constraintStrengthText = (c: Constraint) =>
  c.strength === "hard" ? "Always kept, also when the assistant has to look further" : "A preference the assistant can bend if nothing fits";

export const ROLE_LABEL: Record<VenueRole, string> = {
  coffee: "Café",
  food: "Food",
  bar: "Bar",
  dance: "Dancing",
  live_music: "Live music",
  culture: "Culture",
};

/** The facts about a venue that are not known, said plainly; known-good facts stay quiet. */
export function venueStatusLines(v: Pick<VenueEvidence, "priceStatus" | "hoursStatus" | "insideArea" | "eligibility">): string[] {
  const out: string[] = [];
  if (!v.insideArea) out.push("Just outside the area");
  if (v.priceStatus === "known_over") out.push("Over your budget");
  if (v.priceStatus === "unknown") out.push("Price not listed");
  if (v.hoursStatus === "known_closed") out.push("Closed at that time");
  if (v.hoursStatus === "unknown") out.push("Hours not listed");
  if (v.hoursStatus === "event_required") out.push("Open for events; check the venue's own listings");
  if (v.eligibility === "conditional") out.push("Fits with a condition");
  return out;
}

/** One sentence with exactly one closing stop, whatever the backend text ended with. */
export function sentence(s: string): string {
  const x = s.trim().replace(/[.\s]+$/, "");
  if (!x) return "";
  const y = x[0].toUpperCase() + x.slice(1);
  return /[!?]$/.test(y) ? y : `${y}.`;
}

/** "urn:tag:genre:place:restaurant:bakery" or "restaurant:bakery" → "bakery". */
export function genreWord(g: string | undefined | null): string | null {
  if (!g) return null;
  const last = g.split(":").pop()?.replace(/_/g, " ").trim().toLowerCase();
  return last || null;
}

export const RECOVERY_TEXT: Record<RecoveryAction, string> = {
  alternate_venue: "Picked another place",
  wider_radius: "Looked a little further out",
  alternate_area: "Moved to another area on your shortlist",
  fewer_stops: "Planned fewer stops",
};
