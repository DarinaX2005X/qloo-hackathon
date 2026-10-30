"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { MapPin } from "lucide-react";

type Option = { query: string; name: string; label: string; kind: "popular" | "found" | "typed" };

export const CITY_SUGGESTIONS = ["Lisbon", "Berlin", "Mexico City", "Tokyo", "New York", "London", "Paris", "Barcelona", "Seoul", "Istanbul", "Copenhagen", "Buenos Aires"];
const POPULAR: Option[] = CITY_SUGGESTIONS.map((c) => ({ query: c, name: c, label: "", kind: "popular" }));

/** Short display name: "Portland, Oregon" reads as "Portland" in headings. */
export const cityName = (q: string) => q.split(",")[0].trim();

const sameName = (o: Option, q: string) => o.kind !== "typed" && o.name.toLowerCase() === q.toLowerCase();

/** The city a lookup for q points at: an exact name match first, then the top result, else the typed text. */
const bestMatch = (q: string, results: Option[]) => (results.find((o) => sameName(o, q)) ?? results[0])?.query ?? q;

/** City combobox for any city in the world: popular picks, live search, or exactly what was typed. */
export function CityPicker({
  value,
  onChange,
  variant = "bar",
  className,
}: {
  value: string;
  onChange: (city: string) => void;
  variant?: "bar" | "hero";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const [found, setFound] = useState<Option[]>([]);
  const [searching, setSearching] = useState(false);
  const [foundQ, setFoundQ] = useState("");
  useEffect(() => setText(value), [value]);

  const q = text.trim();
  const typing = open && q.length >= 2 && q.toLowerCase() !== value.toLowerCase();
  // Enter pressed while the lookup for the typed text is still running: resolve it when the results land
  const enterPendingRef = useRef(false);
  // the highlighted option was chosen with the arrow keys or the mouse, so Enter takes it as is
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (!typing) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/localities?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        const body = (await r.json()) as { results?: { query: string; name: string; label: string }[] };
        const results = (body.results ?? []).map((x) => ({ ...x, kind: "found" as const }));
        setFound(results);
        setFoundQ(q);
        if (enterPendingRef.current) {
          enterPendingRef.current = false;
          commitRef.current(bestMatch(q, results));
        }
      } catch {
        /* keep typed text as the option */
        if (enterPendingRef.current && !ac.signal.aborted) {
          enterPendingRef.current = false;
          commitRef.current(q);
        }
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q, typing]);

  const options: Option[] = !typing
    ? POPULAR
    : [...found, ...(found.some((f) => f.name.toLowerCase() === q.toLowerCase()) ? [] : [{ query: q, name: q, label: "Use exactly this", kind: "typed" as const }])];

  const commit = (c: string) => {
    const v = c.trim();
    enterPendingRef.current = false;
    setOpen(false);
    if (v && v.toLowerCase() !== value.toLowerCase()) onChange(v);
    setText(v || value);
  };

  // clicking away keeps what was typed (the best match if the lookup found one), so a city typed
  // right before pressing a button is never silently dropped
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = typing ? (foundQ === q && found[0] ? found[0].query : q) : null;
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Enter takes a highlighted option only when the person moved to it, or when the list was produced
  // for the typed text; otherwise it keeps the typed city (the popular list never overrides it)
  const onEnter = () => {
    const picked = navigatedRef.current ? options[hi] : undefined;
    if (picked) return commit(picked.query);
    if (!q || q.toLowerCase() === value.toLowerCase()) return commit(value);
    const exact = [...options, ...POPULAR].find((o) => sameName(o, q));
    if (exact) return commit(exact.query);
    if (!typing) return commit(q);
    if (foundQ === q) return commit(bestMatch(q, found));
    enterPendingRef.current = true;
  };
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !listRef.current?.contains(t)) {
        if (pendingRef.current) commitRef.current(pendingRef.current);
        else {
          setOpen(false);
          setText(value);
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [value]);

  // the list lives in a portal so a section with overflow hidden can't clip it; it opens upward when there's no room
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const place = () => {
      const r = box.current!.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      setPos({ left: r.left, width: r.width, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), maxH: Math.min(288, (up ? above : below) - 6) });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const hero = variant === "hero";
  return (
    <div ref={box} className={`relative ${className ?? ""}`}>
      <div
        className={`flex items-center gap-2 rounded-[12px] bg-paper-raised ring-1 ring-line transition-shadow focus-within:ring-2 focus-within:ring-you ${hero ? "h-[52px] px-4" : "h-10 px-3"}`}
      >
        <MapPin size={hero ? 18 : 16} strokeWidth={1.75} className="shrink-0 text-you" />
        <input
          data-testid="city-combobox"
          role="combobox"
          aria-expanded={open}
          aria-controls="city-list"
          aria-label="City"
          value={text}
          onFocus={(e) => {
            setOpen(true);
            navigatedRef.current = enterPendingRef.current = false;
            e.target.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHi(0);
            navigatedRef.current = enterPendingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              navigatedRef.current = true;
              setHi((h) => (e.key === "ArrowDown" ? Math.min(h + 1, options.length - 1) : Math.max(h - 1, 0)));
            } else if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              enterPendingRef.current = false;
              setOpen(false);
              setText(value);
            }
          }}
          className={`w-full min-w-0 bg-transparent font-[560] text-ink outline-none placeholder:text-ink-3 ${hero ? "text-[17px]" : "text-[15px]"}`}
          placeholder="Any city in the world"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {typeof document !== "undefined" &&
        createPortal(
      <AnimatePresence>
        {open && pos && options.length > 0 && (
          <motion.ul
            ref={listRef}
            id="city-list"
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            style={{ left: pos?.left ?? -9999, width: pos?.width, top: pos?.top, bottom: pos?.bottom, maxHeight: pos?.maxH }}
            className={`hm-scroll fixed z-[60] overflow-auto rounded-[14px] bg-paper-raised p-1.5 shadow-[var(--shadow-overlay)] ring-1 ring-line ${pos?.bottom !== undefined ? "origin-bottom" : "origin-top"}`}
          >
            {!typing && <li className="px-3 pb-1 pt-1.5 text-[12px] font-[560] text-ink-3">Popular, or type any city</li>}
            {options.map((c, i) => (
              <li
                key={c.query + i}
                role="option"
                aria-selected={i === hi}
                onMouseEnter={() => {
                  navigatedRef.current = true;
                  setHi(i);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c.query);
                }}
                className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-[10px] px-3 py-2 text-[15px] ${i === hi ? "bg-paper-sunk text-ink" : "text-ink-2"}`}
              >
                <span className="min-w-0 truncate">
                  <span className="font-[560] text-ink">{c.name}</span>
                  {c.label && <span className={`ml-2 text-[13px] ${c.kind === "typed" ? "text-ink-3" : "text-ink-3"}`}>{c.label}</span>}
                </span>
                {c.query.toLowerCase() === value.toLowerCase() && <span className="shrink-0 text-[12px] text-you">current</span>}
              </li>
            ))}
            {typing && searching && !found.length && <li className="px-3 py-2 text-[13px] text-ink-3">Looking up cities</li>}
          </motion.ul>
        )}
      </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
