"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type ExpressionSpecification } from "maplibre-gl";
import type { FieldCell, Neighborhood, Place, TasteField } from "@/shared/contracts";
import { buildHexes, focusCells, heightOf, type HexMode, type HexProps } from "./hexgrid";
import { firstLabelLayer, loadAtlasStyle } from "./style";
import { CellCard } from "./CellCard";

export type TerrainMapProps = {
  field: TasteField | null;
  mode?: HexMode;
  neighborhoods?: Neighborhood[];
  selectedId?: string | null;
  onSelectNeighborhood?: (id: string | null) => void;
  places?: Place[];
  activePlaceId?: string | null;
  onHoverPlace?: (id: string | null) => void;
  route?: [number, number][];
  /** "hero" slowly orbits and ignores input; "work" is the interactive workspace map */
  variant?: "hero" | "work";
  /** extra padding so the camera frames content next to floating panels */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** loves by domain, used in the hover card to name what drives a cell */
  loveNames?: Partial<Record<string, string>>;
  className?: string;
};

const SRC = "terrain";
const LAYER = "terrain-cols";
const RISE_MS = 1100;
const MORPH_MS = 420;

/** Height that animates from h0 to h1 with stagger by `d`, driven by a literal time T. */
function heightExpr(T: number, stagger: number): ExpressionSpecification {
  const S = stagger;
  const p: ExpressionSpecification = ["max", 0, ["min", 1, ["/", ["-", T, ["*", ["get", "d"], S]], 1 - S]]];
  return ["interpolate", ["cubic-bezier", 0.2, 0.8, 0.2, 1], p, 0, ["get", "h0"], 1, ["get", "h1"]];
}

export function TerrainMap({
  field,
  mode = "you",
  neighborhoods = [],
  selectedId = null,
  onSelectNeighborhood,
  places = [],
  activePlaceId = null,
  onHoverPlace,
  route,
  variant = "work",
  padding = { top: 40, bottom: 40, left: 40, right: 40 },
  loveNames,
  className,
}: TerrainMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const prevHeights = useRef(new Map<string, number>());
  const anim = useRef<number | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const fittedFor = useRef<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; cell: FieldCell; props: HexProps } | null>(null);
  

  // --- map lifecycle
  useEffect(() => {
    let disposed = false;
    loadAtlasStyle()
      .then((style) => {
        if (disposed || !el.current) return;
        const map = new maplibregl.Map({
          container: el.current,
          style,
          center: field?.center ?? [-9.14, 38.72],
          zoom: 11.6,
          pitch: variant === "hero" ? 54 : 48,
          bearing: -14,
          attributionControl: { compact: true },
          interactive: variant === "work",
          maxPitch: 70,
          fadeDuration: 0,
          // keeps the last frame readable for screenshots and screen recording
          canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
        });
        mapRef.current = map;
        if (process.env.NODE_ENV !== "production") (window as unknown as { __map: MLMap }).__map = map;
        map.on("load", () => {
          map.setLight({ anchor: "viewport", color: "#fffaf2", intensity: 0.32, position: [1.3, 215, 38] });
          const before = firstLabelLayer(style);
          map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer(
            {
              id: LAYER,
              type: "fill-extrusion",
              source: SRC,
              paint: {
                "fill-extrusion-color": ["get", "color"],
                "fill-extrusion-height": ["get", "h1"],
                "fill-extrusion-base": 0,
                "fill-extrusion-opacity": 0.94,
                "fill-extrusion-vertical-gradient": true,
              },
            },
            before,
          );
          map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2b211c", "line-width": 3, "line-dasharray": [0.1, 1.8] },
          });
          map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({
            id: "places-dot",
            type: "circle",
            source: "places",
            paint: {
              "circle-radius": ["case", ["boolean", ["feature-state", "active"], false], 9, 6],
              "circle-color": "#fffdf9",
              "circle-stroke-color": "#2b211c",
              "circle-stroke-width": ["case", ["boolean", ["feature-state", "active"], false], 3.5, 2.2],
              "circle-pitch-alignment": "map",
            },
          });
          setReady(true);
        });
        if (variant === "work") {
          map.on("mousemove", LAYER, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const props = f.properties as unknown as HexProps;
            const cell = cellsRef.current.get(props.cell);
            if (cell) setHover({ x: e.point.x, y: e.point.y, cell, props });
          });
          map.on("mouseleave", LAYER, () => setHover(null));
          map.on("mouseenter", "places-dot", (e) => {
            map.getCanvas().style.cursor = "pointer";
            const id = e.features?.[0]?.properties?.id as string | undefined;
            if (id) hoverPlaceRef.current?.(id);
          });
          map.on("mouseleave", "places-dot", () => {
            map.getCanvas().style.cursor = "";
            hoverPlaceRef.current?.(null);
          });
        }
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      if (anim.current) cancelAnimationFrame(anim.current);
      markers.current.forEach((m) => m.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- terrain data and animation
  const focused = useMemo(() => (field ? focusCells(field.cells, field.center) : []), [field]);
  const cellsByH = useMemo(() => new Map(focused.map((c) => [c.h, c])), [focused]);
  const cellsRef = useRef(cellsByH);
  cellsRef.current = cellsByH;
  const hoverPlaceRef = useRef(onHoverPlace);
  hoverPlaceRef.current = onHoverPlace;

  const hexes = useMemo(() => (field ? buildHexes(focused, { mode }) : null), [field, focused, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !hexes) return;
    const prev = prevHeights.current;
    const isRise = prev.size === 0;
    const next = new Map<string, number>();
    // inside a neighborhood the terrain lies down into a low carpet so places and streets stay readable
    const scale = (variant === "hero" ? 1.15 : 1) * (selectedId ? 0.1 : 1);
    for (const f of hexes.features) {
      const h1 = heightOf(f.properties.v, scale);
      next.set(f.properties.id, h1);
      Object.assign(f.properties, { h0: prev.get(f.properties.id) ?? 0, h1 });
    }
    prevHeights.current = next;
    (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(hexes);

    const dur = isRise ? RISE_MS : MORPH_MS;
    const stagger = isRise ? 0.5 : 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (anim.current) cancelAnimationFrame(anim.current);
    if (reduced) {
      map.setPaintProperty(LAYER, "fill-extrusion-height", ["get", "h1"]);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const T = Math.min(1, (now - t0) / dur);
      map.setPaintProperty(LAYER, "fill-extrusion-height", heightExpr(T, stagger));
      if (T < 1) anim.current = requestAnimationFrame(tick);
      else map.setPaintProperty(LAYER, "fill-extrusion-height", ["get", "h1"]);
    };
    anim.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexes, ready, variant, !!selectedId]);

  // --- camera: frame the strongest part of the field once per city
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !field) return;
    const key = field.city.toLowerCase();
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    const strong = [...focused].sort((a, b) => Math.max(b.you, b.them ?? 0) - Math.max(a.you, a.them ?? 0)).slice(0, Math.max(8, Math.round(focused.length * 0.09)));
    const lons = strong.map((c) => c.lon), lats = strong.map((c) => c.lat);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
    map.fitBounds(bounds, { padding, pitch: variant === "hero" ? 54 : 48, bearing: -14, duration: 1400, maxZoom: 13.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, ready]);

  // --- hero orbit
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || variant !== "hero") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const spin = (now: number) => {
      if (!map.isMoving()) map.setBearing(-14 + Math.sin((now - t0) / 9000) * 9);
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [ready, variant]);

  // --- neighborhood plates
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = neighborhoods.slice(0, 8).map((n) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = `hm-plate${n.id === selectedId ? " is-selected" : ""}${selectedId && n.id !== selectedId ? " is-dim" : ""}`;
      node.innerHTML = `<span class="hm-plate-rank">${n.rank}</span><span class="hm-plate-name"></span>`;
      (node.querySelector(".hm-plate-name") as HTMLElement).textContent = n.name;
      node.setAttribute("aria-label", `${n.rank}. ${n.name}`);
      node.style.zIndex = String(n.id === selectedId ? 100 : 50 - n.rank);
      if (variant === "work") node.addEventListener("click", () => onSelectNeighborhood?.(n.id === selectedId ? null : n.id));
      else node.tabIndex = -1;
      return new maplibregl.Marker({ element: node, anchor: "bottom", offset: [0, -6] }).setLngLat(n.center).addTo(map);
    });
    // Plates are placed in rank order; a plate that would overlap a better-ranked one collapses to its number.
    const declutter = () => {
      const kept: DOMRect[] = [];
      markers.current.forEach((m, i) => {
        const node = m.getElement();
        const n = neighborhoods[i];
        node.classList.remove("is-collapsed");
        const r = node.getBoundingClientRect();
        const hit = kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
        if (hit && n.id !== selectedId) node.classList.add("is-collapsed");
        kept.push(node.getBoundingClientRect());
      });
    };
    declutter();
    map.on("moveend", declutter);
    return () => {
      map.off("moveend", declutter);
    };
  }, [neighborhoods, selectedId, ready, variant, onSelectNeighborhood]);

  // --- fly to the selected neighborhood, dim the rest of the terrain
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const sel = neighborhoods.find((n) => n.id === selectedId);
    if (sel) {
      map.flyTo({ center: sel.center, zoom: 14.2, pitch: 56, duration: 1300, padding, essential: true });
      map.setPaintProperty(LAYER, "fill-extrusion-opacity", 0.42);
    } else {
      map.setPaintProperty(LAYER, "fill-extrusion-opacity", 0.94);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  // --- places and route
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("places") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: places.map((p, i) => ({
        type: "Feature",
        id: i,
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { id: p.id, name: p.name },
      })),
    });
  }, [places, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    places.forEach((p, i) => map.setFeatureState({ source: "places", id: i }, { active: p.id === activePlaceId }));
  }, [activePlaceId, places, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("route") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: route && route.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: route }, properties: {} }] : [],
    });
  }, [route, ready]);

  return (
    <div className={`relative isolate h-full w-full overflow-hidden ${className ?? ""}`}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-paper-sunk text-ink-2">
          <p className="max-w-xs text-center text-[15px]">The map tiles didn&apos;t load. Your results below still work.</p>
        </div>
      )}
      {hover && variant === "work" && <CellCard x={hover.x} y={hover.y} cell={hover.cell} loveNames={loveNames} pair={mode === "pair"} />}
    </div>
  );
}
