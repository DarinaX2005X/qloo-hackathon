"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TasteField } from "@/shared/contracts";
import { FLOOR, focusCells, hexColor } from "@/components/map/hexgrid";
import { DEFAULT_RADIUS_M, type MapArea } from "@/components/map/areas";

type Pad = { top: number; bottom: number; left: number; right: number };

const M_LAT = 110_540;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * A light, flat drawing of the same example the hero map shows: the example's own cells and its three areas,
 * framed like the map frames them. It stands in while WebGL and the basemap load, then fades out under the live
 * map, so the first screen never shows an empty map. Nothing here is computed for the visitor.
 */
export function MapPreview({ field, areas, padding, hidden }: { field: TasteField | null; areas: MapArea[]; padding: Pad; hidden: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drawn = useMemo(() => {
    if (!field || !size) return null;
    const top = areas.filter((a) => a.rank <= 3);
    const lat0 = top[0]?.center[1] ?? field.center[1];
    const kLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    // the same frame the map uses for its first three areas: their circles with a margin of streets
    const pts = top.length
      ? top.flatMap((a) => {
          const r = (a.radiusM ?? DEFAULT_RADIUS_M) * 3.2;
          return [
            [a.center[0] - r / kLon, a.center[1] - r / M_LAT],
            [a.center[0] + r / kLon, a.center[1] + r / M_LAT],
          ];
        })
      : [
          [field.bbox[0], field.bbox[1]],
          [field.bbox[2], field.bbox[3]],
        ];
    const w0 = Math.min(...pts.map((p) => p[0])), e0 = Math.max(...pts.map((p) => p[0]));
    const s0 = Math.min(...pts.map((p) => p[1])), n0 = Math.max(...pts.map((p) => p[1]));
    const bw = Math.max(40, size.w - padding.left - padding.right), bh = Math.max(40, size.h - padding.top - padding.bottom);
    const dx = (e0 - w0) * (Math.PI / 180), dy = merc(n0) - merc(s0);
    const k = Math.min(bw / dx, bh / dy);
    const cx = padding.left + bw / 2, cy = padding.top + bh / 2;
    const mx = ((w0 + e0) / 2) * (Math.PI / 180), my = (merc(n0) + merc(s0)) / 2;
    const proj = (lon: number, lat: number) => [cx + ((lon * Math.PI) / 180 - mx) * k, cy - (merc(lat) - my) * k] as const;
    const pxPerM = k / (6_378_137 * Math.cos((lat0 * Math.PI) / 180));
    // one square per Qloo cell (about 150 m), drawn a little smaller so the grid reads like the printed terrain
    const r = Math.max(3, 128 * pxPerM);
    const cells = focusCells(field.cells, field.center)
      .filter((c) => c.you >= FLOOR)
      .map((c) => {
        const [x, y] = proj(c.lon, c.lat);
        return { x, y, c: hexColor(c.you, 0, "you"), key: c.h };
      })
      .filter((c) => c.x > -20 && c.y > -20 && c.x < size.w + 20 && c.y < size.h + 20);
    const plates = top.map((a) => {
      const [x, y] = proj(a.center[0], a.center[1]);
      return { x, y, a };
    });
    return { cells, plates, r };
  }, [field, areas, size, padding]);

  return (
    <div
      ref={box}
      aria-hidden
      data-testid="hero-preview"
      className="pointer-events-none absolute inset-0 bg-[#f3ede3] transition-opacity duration-500 ease-out"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      {drawn && size && (
        <svg width={size.w} height={size.h} className="absolute inset-0">
          {drawn.cells.map((c) => (
            <rect key={c.key} x={c.x - drawn.r / 2} y={c.y - drawn.r / 2} width={drawn.r} height={drawn.r} rx={Math.min(3, drawn.r / 4)} fill={c.c} opacity={0.92} />
          ))}
        </svg>
      )}
      {drawn?.plates.map(({ x, y, a }) => (
        <span key={a.id} className="hm-plate absolute -translate-x-1/2 -translate-y-full" style={{ left: x, top: y - 6, zIndex: 10 - a.rank }}>
          <span className="hm-plate-rank">{a.rank}</span>
          <span className="hm-plate-name">{a.approximate ? `Around ${a.name}` : a.name}</span>
        </span>
      ))}
    </div>
  );
}
