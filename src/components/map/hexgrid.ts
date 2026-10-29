import type { FieldCell } from "@/shared/contracts";

export type HexMode = "you" | "pair";

/** Below this (city percentile) nothing is drawn: the terrain shows where taste concentrates, not the whole city. */
export const FLOOR = 0.42;
const lift = (v: number) => Math.max(0, (v - FLOOR) / (1 - FLOOR));

export type HexProps = {
  id: string;
  you: number;
  them: number;
  both: number;
  /** value used for height and ranking in the current mode, 0..1 */
  v: number;
  /** stagger delay 0..1 for the rise animation, by distance from the strongest hex */
  d: number;
  color: string;
  /** strongest source cell, for hover details */
  cell: string;
};

export type HexFeature = GeoJSON.Feature<GeoJSON.Polygon, HexProps>;

const M_PER_DEG_LAT = 110_540;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Local equirectangular projection around the field centre; accurate enough at city scale. */
function projector(lat0: number) {
  const kx = mPerDegLon(lat0);
  return {
    fwd: (lon: number, lat: number) => [lon * kx, lat * M_PER_DEG_LAT] as const,
    inv: (x: number, y: number) => [x / kx, y / M_PER_DEG_LAT] as const,
  };
}

// Ink ramps in sRGB, sampled from the OKLCH tokens in DESIGN (map layers need plain colours).
const YOU_RAMP: [number, [number, number, number]][] = [
  [0, [246, 226, 214]],
  [0.35, [244, 176, 150]],
  [0.65, [232, 110, 80]],
  [0.85, [214, 72, 48]],
  [1, [160, 40, 28]],
];
const THEM: [number, number, number] = [24, 146, 166];
const BOTH: [number, number, number] = [118, 30, 40];
const PAPER: [number, number, number] = [246, 241, 233];

function ramp(stops: typeof YOU_RAMP, t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (x <= p1) {
      const k = (x - p0) / (p1 - p0 || 1);
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
const hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** Colour of a hex: vermilion ramp for one person; for two, inks overprint where both are strong. */
export function hexColor(you: number, them: number, mode: HexMode) {
  if (mode === "you") return hex(ramp(YOU_RAMP, lift(you)));
  // Each ink keeps its own colour where it leads; where both are strong the inks overprint into oxblood.
  const yl = lift(you), tl = lift(them);
  const base = yl >= tl ? ramp(YOU_RAMP, yl) : mix(PAPER, THEM, 0.25 + tl * 0.75);
  const o = Math.min(yl, tl);
  const k = Math.min(1, Math.max(0, (o - 0.25) / 0.5));
  return hex(mix(base, BOTH, k * k * (3 - 2 * k)));
}

type BuildOpts = {
  /** hex radius in metres (centre to corner) */
  radius?: number;
  mode?: HexMode;
  /** hexes below this value are not drawn */
  floor?: number;
  /** limit to this bbox [w, s, e, n] */
  bbox?: [number, number, number, number];
};

/**
 * Interpolates Qloo geohash cells onto a fine hex grid. Cells are ~1.2 x 0.6 km, too coarse to read as a city
 * surface; inverse-distance weighting over the nearest cells gives a continuous terrain that keeps their values.
 */
export function buildHexes(cells: FieldCell[], opts: BuildOpts = {}): GeoJSON.FeatureCollection<GeoJSON.Polygon, HexProps> {
  const radius = opts.radius ?? 130;
  const mode = opts.mode ?? "you";
  const floor = opts.floor ?? FLOOR;
  if (!cells.length) return { type: "FeatureCollection", features: [] };

  const lat0 = cells.reduce((s, c) => s + c.lat, 0) / cells.length;
  const P = projector(lat0);
  const pts = cells.map((c) => {
    const [x, y] = P.fwd(c.lon, c.lat);
    const them = c.them ?? 0;
    return { x, y, you: c.you, them, h: c.h };
  });

  let [w, s, e, n] = opts.bbox ?? [
    Math.min(...cells.map((c) => c.lon)),
    Math.min(...cells.map((c) => c.lat)),
    Math.max(...cells.map((c) => c.lon)),
    Math.max(...cells.map((c) => c.lat)),
  ];
  const [x0, y0] = P.fwd(w, s);
  const [x1, y1] = P.fwd(e, n);

  // bucket points for fast neighbour search
  const B = 1500;
  const buckets = new Map<string, typeof pts>();
  for (const p of pts) {
    const k = `${Math.floor(p.x / B)}:${Math.floor(p.y / B)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p);
  }
  const near = (x: number, y: number) => {
    const bx = Math.floor(x / B), by = Math.floor(y / B);
    const out: typeof pts = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(buckets.get(`${bx + i}:${by + j}`) ?? []));
    return out;
  };

  const dx = Math.sqrt(3) * radius;
  const dy = 1.5 * radius;
  const inner = radius * 0.86; // small gap between columns so they read as a printed grid
  const raw: { cx: number; cy: number; you: number; them: number; cell: string }[] = [];
  let row = 0;
  for (let cy = y0 - dy; cy <= y1 + dy; cy += dy, row++) {
    for (let cx = x0 - dx + (row % 2 ? dx / 2 : 0); cx <= x1 + dx; cx += dx) {
      const cand = near(cx, cy);
      if (!cand.length) continue;
      const scored = cand.map((p) => ({ p, d2: (p.x - cx) ** 2 + (p.y - cy) ** 2 })).sort((a, b) => a.d2 - b.d2).slice(0, 4);
      if (scored[0].d2 > 900 ** 2) continue; // outside the data, no fake terrain
      let ws = 0, you = 0, them = 0;
      for (const { p, d2 } of scored) {
        const wgt = 1 / Math.max(d2, 400);
        ws += wgt;
        you += p.you * wgt;
        them += p.them * wgt;
      }
      raw.push({ cx, cy, you: you / ws, them: them / ws, cell: scored[0].p.h });
    }
  }

  const val = (r: (typeof raw)[number]) => (mode === "pair" ? Math.max(r.you, r.them) : r.you);
  const kept = raw.filter((r) => val(r) >= (mode === "pair" ? floor + 0.1 : floor));
  if (!kept.length) return { type: "FeatureCollection", features: [] };
  const top = kept.reduce((a, b) => (val(b) > val(a) ? b : a), kept[0]);
  const maxDist = Math.max(1, ...kept.map((r) => Math.hypot(r.cx - top.cx, r.cy - top.cy)));

  const features: HexFeature[] = kept.map((r, i) => {
    const ring: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30);
      const [lon, lat] = P.inv(r.cx + inner * Math.cos(a), r.cy + inner * Math.sin(a));
      ring.push([lon, lat]);
    }
    ring.push(ring[0]);
    const both = Math.min(r.you, r.them);
    return {
      type: "Feature",
      id: i,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: `${Math.round(r.cx)}:${Math.round(r.cy)}`,
        you: r.you,
        them: r.them,
        both,
        v: val(r),
        d: Math.hypot(r.cx - top.cx, r.cy - top.cy) / maxDist,
        color: hexColor(r.you, r.them, mode),
        cell: r.cell,
      },
    };
  });
  return { type: "FeatureCollection", features };
}

/** Height curve: Qloo affinity is rank-like (uniform 0..1), so lift the top and flatten the rest. */
export const heightOf = (v: number, scale = 1) => 20 + Math.pow(lift(v), 2.1) * 950 * scale;

const distKm = (a: [number, number], lon: number, lat: number) =>
  Math.hypot((lon - a[0]) * mPerDegLon(a[1]), (lat - a[1]) * M_PER_DEG_LAT) / 1000;

/**
 * Qloo returns a metro-wide field whose affinity is rank-like, so the whole urban core reads as one plateau.
 * Keep the city around `center` and re-rank inside it, so peaks show where the taste concentrates within the city.
 */
export function focusCells(cells: FieldCell[], center: [number, number], km = 7.5): FieldCell[] {
  const kept = cells.filter((c) => distKm(center, c.lon, c.lat) <= km);
  if (kept.length < 12) return cells;
  const rerank = (key: "you" | "them") => {
    const vals = kept.map((c) => c[key] ?? 0);
    const sorted = [...vals].sort((a, b) => a - b);
    return vals.map((v) => {
      // percentile with ties resolved to the middle of their run
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
      let up = lo;
      while (up < sorted.length && sorted[up] === v) up++;
      return (lo + up) / 2 / sorted.length;
    });
  };
  const you = rerank("you");
  const them = kept.some((c) => c.them !== undefined) ? rerank("them") : null;
  return kept.map((c, i) => ({
    ...c,
    you: you[i],
    ...(them ? { them: them[i], both: Math.min(you[i], them[i]) } : {}),
  }));
}
