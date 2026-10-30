import type { Constraint } from "@/shared/contracts-09";
import { hash, normalized } from "@/server/engine/09/core";
import type { DecisionPlan } from "./planning";
import { quoteInRequest } from "./planning";

export function userConstraint(kind: Constraint["kind"], value: string | number, strength: Constraint["strength"] = "hard"): Constraint {
  return { id: `user:${kind}:${hash([normalized(String(value))])}`, kind, value, strength, source: "user" };
}
/** These guardrails backstop extraction; they do not generate venues or strategy. */
export function explicitConstraints(message: string): Constraint[] {
  const result: Constraint[] = [];
  const ban = (words: string, value: string) => {
    if (new RegExp(`\\b(?:no|without|avoid|skip|exclude|hate|dislike)\\s+(?:(?:any|all|the)\\s+)*(?:${words})\\b|(?:don['’]t|doesn['’]t|do not|does not)\\s+(?:want|like)\\s+(?:(?:any|the)\\s+)*(?:${words})\\b`, "i").test(message)) result.push(userConstraint("exclude_type", value));
  };
  ban("bars?|pubs?", "bars"); ban("museums?", "museums"); ban("clubs?|nightclubs?", "clubs");
  ban("hotel bars?|hotels?", "hotel"); ban("adult clubs?|adult entertainment|strip clubs?", "adult");
  if (/\b(?:i(?:'m| am)|we(?:'re| are)|only|must be|need)\s+(?:strictly\s+)?vegan\b/i.test(message)) result.push(userConstraint("dietary", "vegan"));
  else if (/\b(?:vegetarian|veggie)\b/i.test(message) && !/\b(?:not|no longer)\s+(?:a\s+)?vegetarian\b/i.test(message)) result.push(userConstraint("dietary", "vegetarian"));
  if (/\bwork(?:ing)?\s+from\s+caf[eé]s?\b|\b(?:need|require|must have)\s+(?:free\s+)?wi[ -]?fi\b/i.test(message)) result.push(userConstraint("intent", "wifi"));
  const dollars = message.match(/(?:within|under|at most|budget(?: of)?|maximum|max)\s*(\${1,4})(?!\$)/i)?.[1];
  if (dollars) result.push(userConstraint("budget", dollars.length));
  return result;
}
export function mergeConstraints(current: Constraint[], plan: DecisionPlan, message: string): Constraint[] {
  const removals = new Set(plan.removeConstraints.filter(c => {
    const existing = current.find(item => item.id === c.id), quote = normalized(c.sourceText);
    if (!existing || !quoteInRequest(c.sourceText, message)) return false;
    const topic = existing.kind === "budget" ? /budget|price|spend|cost/.test(quote) : quote.includes(normalized(String(existing.value)).replace(/s$/, ""));
    return topic && /\b(?:allow|fine|okay|ok|include|drop|remove|forget|lift|no longer|do not need|don t need)\b/.test(quote);
  }).map(c => c.id));
  let next = current.filter(c => !removals.has(c.id));
  const added = [...plan.constraints.filter(c => {
    if (!quoteInRequest(c.sourceText, message) || (c.kind === "budget" && !/\$|budget|price|spend|cost|cheap|affordable/i.test(c.sourceText))) return false;
    if (c.kind === "exclude_type") {
      const value = normalized(String(c.value)), quote = normalized(c.sourceText);
      const explicit = explicitConstraints(c.sourceText).filter(item => item.kind === "exclude_type").map(item => item.value);
      // Qualified exclusions cannot silently grow into a ban on the whole role.
      if (/^(?:clubs?|nightclubs?)$/.test(value) && /adult|strip/.test(quote) && !explicit.includes("clubs")) return false;
      if (/^(?:bars?|pubs?)$/.test(value) && /hotel/.test(quote) && !explicit.includes("bars")) return false;
      if (value === "culture" && /museum/.test(quote) && !/\bculture\b/.test(quote)) return false;
    }
    return true;
  }).map(c => userConstraint(c.kind, c.value, c.strength)), ...explicitConstraints(message)];
  for (const item of added) {
    if (item.kind === "budget") next = next.filter(c => c.kind !== "budget");
    const index = next.findIndex(c => c.kind === item.kind && normalized(String(c.value)) === normalized(String(item.value)));
    if (index < 0) next.push(item);
    else if (item.strength === "hard") next[index] = { ...next[index], strength: "hard" };
  }
  // Refuse growth at the contract boundary, rather than truncating hard prohibitions.
  if (next.length > 40) throw new Error("Too many active constraints");
  return next;
}
