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
