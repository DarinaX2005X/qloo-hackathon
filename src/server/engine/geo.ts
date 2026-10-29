import { record, number, type QlooRecord } from "@/server/qloo/client";

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 : 0;
}

/** Coordinates are [longitude, latitude]; result is metres. */
export function haversine(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function walkMinutes(a: readonly [number, number], b: readonly [number, number]): number {
  return haversine(a, b) * 1.3 / 80;
}
export function coordinates(row: QlooRecord): [number, number] | null {
  const location = record(row.location);
  const lon = number(location.lon, NaN);
  const lat = number(location.lat, NaN);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}
/** Midrank plotting positions: ties share a percentile, a constant series is 0.5. */
export function percentileRanks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++;
    const percentile = (start + end) / (2 * sorted.length);
    for (let i = start; i < end; i++) result[sorted[i].index] = percentile;
    start = end;
  }
  return result;
}

export function focusRadius(center: [number, number], cells: { lon: number; lat: number }[]): number {
  return cells.filter((cell) => haversine(center, [cell.lon, cell.lat]) <= 7500).length < 40 ? 15000 : 7500;
}
