"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type ExpressionSpecification } from "maplibre-gl";
import type { FieldCell, Place, TasteField } from "@/shared/contracts";
import { buildHexes, focusCells, heightOf, SUPPORT_FLOOR, type HexMode, type HexProps } from "./hexgrid";
import { areaLabel, DEFAULT_RADIUS_M, type MapArea } from "./areas";
import { firstLabelLayer, loadAtlasStyle } from "./style";
import { CellCard } from "./CellCard";

export type TerrainMapProps = {
  field: TasteField | null;
  mode?: HexMode;
  /** candidate areas in rank order; only the first `plates` (and the selected one) get a plate */
  neighborhoods?: MapArea[];
  /** how many numbered plates to draw; the rest stay in the list */
  plates?: number;
  selectedId?: string | null;
  onSelectNeighborhood?: (id: string | null) => void;
  places?: Place[];
  activePlaceId?: string | null;
  onHoverPlace?: (id: string | null) => void;
  /** a click on the terrain, with the map coordinate */
  onClickTerrain?: (lngLat: [number, number]) => void;
  /** a click anywhere on the map (streets, water, terrain), with the map coordinate */
  onClickMap?: (lngLat: [number, number]) => void;
  route?: [number, number][];
  /** "hero" slowly orbits and ignores input; "work" is the interactive workspace map */
  variant?: "hero" | "work";
  /** extra padding so the camera frames content next to floating panels */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** loves by domain, used in the hover card to name what drives a cell */
  loveNames?: Partial<Record<string, string>>;
  /** a pin with a label, e.g. a checked address */
  pin?: { lon: number; lat: number; label: string } | null;
  /** a soft walking-radius circle, metres */
  ring?: { lon: number; lat: number; meters: number } | null;
  /** lay the terrain down into a faint carpet (as inside a neighborhood) so routes and streets read, e.g. on the Trip screen */
  flat?: boolean;
  /** bump to fly back to the whole field */
  reframe?: number;
  /** fly the camera here whenever it changes */
  focus?: [number, number] | null;
  /** called once, when the field is on the map, the camera has settled and the tiles are in */
  onReady?: () => void;
  /** start in full relief instead of the calm, low terrain (the work map has a toggle for it) */
  relief?: boolean;
  className?: string;
};

const SRC = "terrain";
/** calm by default: low columns and a gentle tilt keep labels and markers readable; relief is a toggle */
const CALM = { scale: 0.32, pitch: 36 };
const RELIEF = { scale: 1, pitch: 52 };
const HERO = { scale: 0.42, pitch: 44 };
const LAYER = "terrain-cols";
const RISE_MS = 1100;
const MORPH_MS = 420;

/** A circle of `meters` around a point, as a closed ring of lon/lat pairs. */
function circle(lon: number, lat: number, meters: number, steps = 72): [number, number][] {
  const kLat = meters / 110_540;
  const kLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lon + Math.cos(a) * kLon, lat + Math.sin(a) * kLat]);
  }
  return ring;
}

/**
 * fitBounds adds its padding to the padding the map already keeps (a fly or a panel shift leaves it set),
 * so pass only what is missing; otherwise the panels count twice and a city no longer fits.
 */
function extraPadding(map: MLMap, want: { top: number; bottom: number; left: number; right: number }) {
  const has = map.getPadding();
  return {
    top: Math.max(0, want.top - (has.top ?? 0)),
    bottom: Math.max(0, want.bottom - (has.bottom ?? 0)),
    left: Math.max(0, want.left - (has.left ?? 0)),
    right: Math.max(0, want.right - (has.right ?? 0)),
  };
}

/** The strongest part of a field, which is what the camera frames for a city. */
function fieldBounds(cells: FieldCell[]): [[number, number], [number, number]] {
  const strong = [...cells].sort((a, b) => Math.max(b.you, b.them ?? 0) - Math.max(a.you, a.them ?? 0)).slice(0, Math.max(8, Math.round(cells.length * 0.09)));
  const lons = strong.map((c) => c.lon), lats = strong.map((c) => c.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

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
  plates = 3,
  selectedId = null,
  onSelectNeighborhood,
  places = [],
  activePlaceId = null,
  onHoverPlace,
  onClickTerrain,
  onClickMap,
  route,
  variant = "work",
  padding = { top: 40, bottom: 40, left: 40, right: 40 },
  loveNames,
  pin = null,
  ring = null,
  focus = null,
  flat = false,
  reframe = 0,
  onReady,
  relief: reliefStart = false,
  className,
}: TerrainMapProps) {
  const [relief, setRelief] = useState(reliefStart);
  const look = variant === "hero" ? HERO : relief ? RELIEF : CALM;
  const lookRef = useRef(look);
  lookRef.current = look;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const prevHeights = useRef(new Map<string, number>());
  const anim = useRef<number | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pinMarker = useRef<maplibregl.Marker | null>(null);
  const fittedFor = useRef<string | null>(null);
  const everFitted = useRef(false);
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
          pitch: lookRef.current.pitch,
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
          map.addSource("ring", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": "#d6482f", "fill-opacity": 0.07 } }, before);
          map.addLayer({
            id: "ring-line",
            type: "line",
            source: "ring",
            layout: { "line-cap": "round" },
            paint: { "line-color": "#c2412b", "line-width": 1.6, "line-opacity": 0.75, "line-dasharray": [2, 2] },
          });
          map.addSource("area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#d6482f", "fill-opacity": 0.08 } }, before);
          map.addLayer({
            id: "area-line",
            type: "line",
            source: "area",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#b8392a", "line-width": 2, "line-opacity": 0.85, "line-dasharray": [1.5, 1.6] },
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
          map.on("click", LAYER, (e) => clickRef.current?.([e.lngLat.lng, e.lngLat.lat]));
          map.on("click", (e) => anyClickRef.current?.([e.lngLat.lng, e.lngLat.lat]));
          map.on("mouseenter", LAYER, () => (map.getCanvas().style.cursor = "pointer"));
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
      pinMarker.current?.remove();
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
  const clickRef = useRef(onClickTerrain);
  clickRef.current = onClickTerrain;
  const anyClickRef = useRef(onClickMap);
  anyClickRef.current = onClickMap;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getCanvas().classList.toggle("hm-map-pick", !!onClickMap);
  }, [onClickMap, ready]);

  const hexes = useMemo(() => (field ? buildHexes(focused, { mode }) : null), [field, focused, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!hexes) {
      // no field (another city is loading or failed): never leave the last city's terrain standing
      (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      prevHeights.current = new Map();
      fittedFor.current = null;
      return;
    }
    const prev = prevHeights.current;
    const isRise = prev.size === 0;
    const next = new Map<string, number>();
    // inside a neighborhood the terrain lies down into a low carpet so places and streets stay readable
    const scale = look.scale * (selectedId || flat ? 0.04 : 1);
    for (const f of hexes.features) {
      const h1 = heightOf(f.properties.v, scale) * (f.properties.s < SUPPORT_FLOOR ? 0.3 : 1);
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
  }, [hexes, ready, variant, !!selectedId || flat, look.scale]);

  // --- relief toggle: tilt with the terrain so tall columns never hide the streets head-on
  const firstLook = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (firstLook.current) {
      firstLook.current = false;
      return;
    }
    map.easeTo({ pitch: look.pitch, duration: 600 });
  }, [look.pitch, ready]);

  // --- camera: frame the strongest part of the field once per city
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !field) return;
    const key = field.city.toLowerCase();
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    userMoved.current = false;
    // the areas are already known (a prepared scene): frame them straight away
    if (!selectedId && !flat && neighborhoods.some((n) => n.rank <= plates) && fitTop(everFitted.current ? 1400 : 0)) {
      framedTop.current = key;
      everFitted.current = true;
      return;
    }
    // the first frame jumps straight to the field so its tiles load at once; later cities fly
    map.fitBounds(fieldBounds(focused), { padding: extraPadding(map, padding), pitch: look.pitch, bearing: -14, duration: everFitted.current ? 1400 : 0, maxZoom: 13.6 });
    everFitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, ready]);

  // the day route, when the terrain is laid down for a plan
  const routeKey = flat && route && route.length > 1 ? JSON.stringify(route) : null;
  // --- back to the whole field on request (a screen that zoomed in to a spot or a route has closed)
  useEffect(() => {
    const map = mapRef.current;
    // a route on screen keeps its own framing
    if (!ready || !map || !field || !reframe || routeKey) return;
    map.fitBounds(fieldBounds(focused), { padding: extraPadding(map, padding), pitch: look.pitch, bearing: -14, duration: 1300, maxZoom: 13.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reframe]);

  // --- readiness for a loading screen: the orbit never lets the map go idle, so check directly
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  const told = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !hexes || told.current || !onReadyRef.current) return;
    const since = performance.now();
    const iv = window.setInterval(() => {
      // the terrain is drawn and framed; basemap tiles get a short grace period, then they finish in place
      const tiles = map.areTilesLoaded() || performance.now() - since > 900;
      if (fittedFor.current && !map.isMoving() && tiles) {
        told.current = true;
        window.clearInterval(iv);
        onReadyRef.current?.();
      }
    }, 120);
    return () => window.clearInterval(iv);
  }, [ready, hexes]);
  useEffect(() => {
    if (failed && !told.current) {
      told.current = true;
      onReadyRef.current?.();
    }
  }, [failed]);

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

  // --- area plates: the first three by rank and the selected one; the full list lives in the panel
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markers.current.forEach((m) => m.remove());
    const shown = neighborhoods.filter((n) => n.rank <= plates || n.id === selectedId);
    markers.current = shown.map((n) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = `hm-plate${n.id === selectedId ? " is-selected" : ""}${selectedId && n.id !== selectedId ? " is-dim" : ""}`;
      node.innerHTML = `<span class="hm-plate-rank">${n.rank}</span><span class="hm-plate-name"></span>`;
      const label = areaLabel(n.name, n.approximate);
      (node.querySelector(".hm-plate-name") as HTMLElement).textContent = label;
      node.setAttribute("aria-label", `${n.rank}. ${label}`);
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
        const n = shown[i];
        node.classList.remove("is-collapsed", "is-hidden");
        const overlaps = (r: DOMRect) => kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
        if (n.id === selectedId || !overlaps(node.getBoundingClientRect())) return void kept.push(node.getBoundingClientRect());
        node.classList.add("is-collapsed");
        kept.push(node.getBoundingClientRect());
      });
    };
    // markers get their screen position on the next frame; measure then, and again whenever the camera rests
    let raf = requestAnimationFrame(declutter);
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(declutter);
    };
    map.on("moveend", later);
    map.once("idle", later);
    return () => {
      cancelAnimationFrame(raf);
      map.off("moveend", later);
      map.off("idle", later);
    };
  }, [neighborhoods, selectedId, ready, variant, onSelectNeighborhood, plates]);

  // --- the selected area's walkable circle
  const sel = neighborhoods.find((n) => n.id === selectedId) ?? null;
  const selKey = sel ? `${sel.center[0]},${sel.center[1]},${sel.radiusM ?? DEFAULT_RADIUS_M}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("area") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: sel
        ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [circle(sel.center[0], sel.center[1], sel.radiusM ?? DEFAULT_RADIUS_M)] }, properties: {} }]
        : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, ready]);

  // --- frame the first areas once per city, so the answer (not the whole metro field) fills the view.
  // Later reorders (a weight change) leave the camera where the person put it.
  const framedTop = useRef<string | null>(null);
  /** the person dragged, zoomed or rotated the map themselves; after that Homing does not reframe it on its own */
  const userMoved = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const mark = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved.current = true;
    };
    map.on("dragstart", mark);
    map.on("zoomstart", mark);
    map.on("rotatestart", mark);
    return () => {
      map.off("dragstart", mark);
      map.off("zoomstart", mark);
      map.off("rotatestart", mark);
    };
  }, [ready]);
  const fitTop = (duration: number) => {
    const map = mapRef.current;
    const top = neighborhoods.filter((n) => n.rank <= plates);
    if (!map || !top.length) return false;
    // a margin of streets around the circles keeps the areas in their city, not floating in a close-up
    const pts = top.flatMap((n) => circle(n.center[0], n.center[1], (n.radiusM ?? DEFAULT_RADIUS_M) * 3.2, 16));
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: extraPadding(map, padding), pitch: look.pitch, bearing: -14, duration, maxZoom: 13.4 },
    );
    return true;
  };
  const cityKey = field?.city.toLowerCase() ?? null;
  const hasTop = neighborhoods.some((n) => n.rank <= plates);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !cityKey || !hasTop || selectedId || flat || framedTop.current === cityKey) return;
    // wait for the field's own fit (it sets fittedFor) so the two moves do not fight
    if (fittedFor.current !== cityKey) return;
    if (fitTop(everFitted.current ? 1200 : 0)) framedTop.current = cityKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityKey, hasTop, ready, selectedId, flat, field]);

  // --- fly to the selected area, dim the rest of the terrain; closing it returns to the first areas
  const hadSel = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (sel) {
      map.flyTo({ center: sel.center, zoom: 14.2, pitch: Math.max(look.pitch, 44), duration: 1300, padding, essential: true });
      map.setPaintProperty(LAYER, "fill-extrusion-opacity", 0.12);
    } else {
      map.setPaintProperty(LAYER, "fill-extrusion-opacity", flat ? 0.22 : 0.94);
      if (hadSel.current && !flat) fitTop(1100);
    }
    hadSel.current = !!sel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready, flat]);

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

  // --- panels move between screens: slide the visible centre with them instead of jumping
  const padKey = JSON.stringify(padding);
  const firstPad = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (firstPad.current) {
      firstPad.current = false;
      return;
    }
    // never cut a flight short (a new city or a neighborhood being framed): shift once it lands.
    // While the camera still shows the first three areas as Homing framed them (a phone sheet went from peek to
    // results, a panel opened), frame them again for the new space; a camera the person moved only slides.
    const shift = () => {
      if (!userMoved.current && framedTop.current && !sel && !routeKey && fitTop(650)) return;
      map.easeTo({ padding, duration: 650, easing: (t) => 1 - Math.pow(1 - t, 3) });
    };
    if (!map.isMoving()) {
      shift();
      return;
    }
    map.once("moveend", shift);
    return () => {
      map.off("moveend", shift);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padKey, ready]);

  // --- a walking radius
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("ring") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: ring ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [circle(ring.lon, ring.lat, ring.meters)] }, properties: {} }] : [],
    });
  }, [ring?.lon, ring?.lat, ring?.meters, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- a pin with its label
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    pinMarker.current?.remove();
    pinMarker.current = null;
    if (!pin) return;
    const node = document.createElement("div");
    node.className = "hm-pin";
    node.innerHTML = `<span class="hm-pin-label"></span><span class="hm-pin-stem"></span><span class="hm-pin-dot"></span>`;
    (node.querySelector(".hm-pin-label") as HTMLElement).textContent = pin.label;
    node.setAttribute("aria-label", pin.label);
    node.style.zIndex = "200"; // above the neighborhood plates
    pinMarker.current = new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([pin.lon, pin.lat]).addTo(map);
  }, [pin?.lon, pin?.lat, pin?.label, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- with the terrain laid down for a plan, frame the route of the day
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !routeKey || !route) return;
    const lons = route.map((p) => p[0]), lats = route.map((p) => p[1]);
    // a margin past the panels, so a stop never lands on the very edge of the visible map
    const M = 44;
    const fit = () =>
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: extraPadding(map, { top: padding.top + M, bottom: padding.bottom + M, left: padding.left + M, right: padding.right + M }), pitch: 52, maxZoom: 15.6, duration: 1100 },
      );
    // a new route (a swapped or removed stop) always gets the last word over a camera move still running
    if (!map.isMoving()) {
      fit();
      return;
    }
    map.once("moveend", fit);
    return () => {
      map.off("moveend", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, ready]);

  // --- fly to a focus point
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    // a walking radius reads best close in; anything else keeps at least a district in view
    map.flyTo({ center: focus, zoom: ring ? 14.3 : Math.max(map.getZoom(), 13.4), pitch: 50, duration: 1300, padding, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.[0], focus?.[1], ready]);

  return (
    <div className={`relative isolate h-full w-full overflow-hidden ${className ?? ""}`}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-paper-sunk text-ink-2">
          <p className="max-w-xs text-center text-[15px]">The map tiles didn&apos;t load. Your results below still work.</p>
        </div>
      )}
      {variant === "work" && !failed && !!field && (
        <button
          type="button"
          onClick={() => setRelief((r) => !r)}
          aria-pressed={relief}
          title={relief ? "Lay the columns down so streets and markers read" : "Raise the columns to see where the signal peaks"}
          style={{ bottom: Math.max(12, padding.bottom - 28), right: Math.max(12, padding.right - 28) }}
          className="absolute z-10 flex h-9 items-center gap-2 rounded-[11px] bg-paper-raised/95 px-3 text-[13px] font-[560] text-ink-2 shadow-[var(--shadow-rest)] ring-1 ring-line backdrop-blur transition-colors hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
            <rect x="1.5" y={relief ? 8 : 10.5} width="3" height={relief ? 6.5 : 4} rx="1" />
            <rect x="6.5" y={relief ? 2 : 8.5} width="3" height={relief ? 12.5 : 6} rx="1" />
            <rect x="11.5" y={relief ? 5 : 9.5} width="3" height={relief ? 9.5 : 5} rx="1" />
          </svg>
          {relief ? "Flatten" : "Relief"}
        </button>
      )}
      {hover && variant === "work" && <CellCard x={hover.x} y={hover.y} cell={hover.cell} loveNames={loveNames} pair={mode === "pair"} />}
    </div>
  );
}
