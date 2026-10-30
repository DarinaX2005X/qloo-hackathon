import type { DecidesResult, Itinerary } from "@/shared/contracts";

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
    for (const [why, names] of byReason) lines.push(`${cap(joinAnd(names))}: ${why}.`);
    if (plain.length && !d.note) lines.push(`Homing couldn't find a place that fits you for ${joinAnd(plain)} in ${area}.`);
  }
  lines.push(...sentences);
  return lines;
}
