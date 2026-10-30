import { AgentEventV2 } from "@/shared/contracts-09";

export const AGENT09_TIMEOUT_MS = 40_000;
export function acknowledgement(message: string): string {
  return /\b(?:compare|closer|versus)\b/i.test(message)
    ? "I’ll compare the cities and keep your current map open."
    : "I’ll check each part of your request and keep your requirements in place.";
}
export function serializeEventV2(event: AgentEventV2): string {
  const { type, ...data } = AgentEventV2.parse(event);
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
