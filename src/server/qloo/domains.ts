import type { Domain } from "@/shared/contracts";

/** The hackathon API spells this domain differently from the public Homing contract. */
export function qlooDomain(domain: Domain): string {
  return domain === "video_game" ? "videogame" : domain;
}
