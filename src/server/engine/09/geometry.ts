import type { AreaIdentity, LonLat } from "@/shared/contracts-09";
import { haversine } from "../geo";

const ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";
const LAT_STEP = 180 / 2 ** 17;
const LON_STEP = 360 / 2 ** 18;
export type CellGeometry = { h: string; center: LonLat; bounds: [number, number, number, number]; areaM2: number; block: string };
export type AreaCell = { h: string; areaM2: number; block: string };
export function encodeGeohash(point: LonLat, precision = 7): string {
  const ranges = [[-180, 180], [-90, 90]];
  let hash = "", value = 0;
  for (let bit = 0; bit < precision * 5; bit++) {
    const axis = bit % 2, interval = ranges[axis], mid = (interval[0] + interval[1]) / 2;
    const high = point[axis] >= mid;
    value = value * 2 + Number(high); interval[high ? 0 : 1] = mid;
    if (bit % 5 === 4) { hash += ALPHABET[value]; value = 0; }
  }
  return hash;
}
export function geohashBounds(h: string): [number, number, number, number] | null {
  const ranges = [[-180, 180], [-90, 90]];
  let bit = 0;
  for (const character of h) {
    const n = ALPHABET.indexOf(character);
    if (n < 0) return null;
    for (let shift = 4; shift >= 0; shift--) {
      const interval = ranges[bit++ % 2], mid = (interval[0] + interval[1]) / 2;
      interval[(n & (1 << shift)) !== 0 ? 0 : 1] = mid;
    }
  }
  return [ranges[0][0], ranges[1][0], ranges[0][1], ranges[1][1]];
}
export function projected(point: LonLat, origin: LonLat): LonLat {
  return [(point[0] - origin[0]) * 111_195 * Math.cos(origin[1] * Math.PI / 180), (point[1] - origin[1]) * 111_195];
}
export function pointInArea(point: LonLat, area: AreaIdentity): boolean {
  if (area.geometry.kind === "circle") return haversine(point, area.center) <= area.geometry.radiusM;
  // Ray casting with interior rings excluded.
  const inRing = (ring: LonLat[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  return inRing(area.geometry.coordinates[0]) && !area.geometry.coordinates.slice(1).some(inRing);
}
/** Fixed native grid independent of observed entities. Fractional intersections use 8x8 quadrature. */
export function areaMembership(area: AreaIdentity, cityCenter: LonLat, cityRadius: number): AreaCell[] {
  const radius = area.geometry.kind === "circle" ? area.geometry.radiusM : 2000;
  const latRadius = radius / 111_195;
  const lonRadius = latRadius / Math.cos(area.center[1] * Math.PI / 180);
  const result: AreaCell[] = [];
  const startLat = Math.floor((area.center[1] - latRadius + 90) / LAT_STEP);
  const endLat = Math.floor((area.center[1] + latRadius + 90) / LAT_STEP);
  const startLon = Math.floor((area.center[0] - lonRadius + 180) / LON_STEP);
  const endLon = Math.floor((area.center[0] + lonRadius + 180) / LON_STEP);
  for (let y = startLat; y <= endLat; y++) for (let x = startLon; x <= endLon; x++) {
    const west = x * LON_STEP - 180, south = y * LAT_STEP - 90;
    const center: LonLat = [west + LON_STEP / 2, south + LAT_STEP / 2];
    let included = 0;
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const point: LonLat = [west + (sx + 0.5) / 8 * LON_STEP, south + (sy + 0.5) / 8 * LAT_STEP];
      if (pointInArea(point, area) && haversine(point, cityCenter) <= cityRadius) included++;
    }
    if (!included) continue;
    const wholeArea = 6371000 ** 2 * (LON_STEP * Math.PI / 180) * (Math.sin((south + LAT_STEP) * Math.PI / 180) - Math.sin(south * Math.PI / 180));
    const xy = projected(center, cityCenter);
    result.push({ h: encodeGeohash(center), areaM2: wholeArea * included / 64, block: `${Math.floor(xy[0] / 300)}:${Math.floor(xy[1] / 300)}` });
  }
  return result.sort((a, b) => a.h.localeCompare(b.h));
}
export function overlapShare(a: AreaIdentity, b: AreaIdentity): number {
  if (a.geometry.kind !== "circle" || b.geometry.kind !== "circle") return 0;
  const r = a.geometry.radiusM, s = b.geometry.radiusM, d = haversine(a.center, b.center);
  if (d >= r + s) return 0;
  if (d <= Math.abs(r - s)) return 1;
  const intersection = r * r * Math.acos((d * d + r * r - s * s) / (2 * d * r)) + s * s * Math.acos((d * d + s * s - r * r) / (2 * d * s)) - .5 * Math.sqrt((-d + r + s) * (d + r - s) * (d - r + s) * (d + r + s));
  return intersection / (Math.PI * Math.min(r, s) ** 2);
}
