import { Domain, ExploreState, ResolvedLove, TagRef } from "@/shared/contracts";

/** Compact love for the URL: query, entity id, name, domain, weight, image. */
type CompactLove = { q: string; id?: string; n?: string; d?: Domain; w?: number; i?: string };
type Compact = {
  c: string;
  l: CompactLove[];
  r?: [string, string, string][];
  x?: number;
  p?: CompactLove[];
  nb?: string;
  dy?: 1 | 2 | 3;
  b?: number;
  pc?: "relaxed" | "packed";
  sh?: number;
};

const toCompact = (l: ResolvedLove): CompactLove => ({
  q: l.query,
  ...(l.chosen ? { id: l.chosen.id, n: l.chosen.name, d: l.chosen.domain, i: l.chosen.image } : {}),
  ...(l.weight !== 1 ? { w: Math.round(l.weight * 100) / 100 } : {}),
});

const fromCompact = (c: CompactLove): ResolvedLove => ({
  query: c.q,
  chosen: c.id && c.n && c.d ? { id: c.id, name: c.n, domain: c.d, ...(c.i ? { image: c.i } : {}) } : null,
  candidates: [],
  weight: c.w ?? 1,
});

function b64urlEncode(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState(state: ExploreState): string {
  const c: Compact = {
    c: state.city,
    l: state.loves.map(toCompact),
    ...(state.refinements.length ? { r: state.refinements.map((t: TagRef) => [t.id, t.name, t.kind] as [string, string, string]) } : {}),
    ...(state.discovery !== 0.35 ? { x: Math.round(state.discovery * 100) / 100 } : {}),
    ...(state.companion?.loves.length ? { p: state.companion.loves.map(toCompact) } : {}),
    ...(state.neighborhood ? { nb: state.neighborhood } : {}),
    ...(state.days !== 2 ? { dy: state.days } : {}),
    ...(state.budget ? { b: state.budget } : {}),
    ...(state.pace && state.pace !== "balanced" ? { pc: state.pace } : {}),
    ...(state.startHour && state.startHour !== 9 ? { sh: state.startHour } : {}),
  };
  return b64urlEncode(JSON.stringify(c));
}

export function decodeState(s: string | null | undefined): ExploreState | null {
  if (!s) return null;
  try {
    const c = JSON.parse(b64urlDecode(s)) as Compact;
    const parsed = ExploreState.safeParse({
      city: c.c,
      loves: (c.l ?? []).map(fromCompact),
      refinements: (c.r ?? []).map(([id, name, kind]) => ({ id, name, kind })),
      discovery: c.x ?? 0.35,
      companion: c.p?.length ? { loves: c.p.map(fromCompact) } : null,
      neighborhood: c.nb ?? null,
      days: c.dy ?? 2,
      budget: c.b ?? null,
      pace: c.pc ?? "balanced",
      startHour: c.sh ?? 9,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const emptyState = (city = "Lisbon"): ExploreState => ({
  city,
  loves: [],
  refinements: [],
  discovery: 0.35,
  companion: null,
  neighborhood: null,
  days: 2,
  budget: null,
  pace: "balanced",
  startHour: 9,
});
