"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { MapPin } from "lucide-react";

export const CITY_SUGGESTIONS = [
  "Lisbon",
  "Berlin",
  "Mexico City",
  "Tokyo",
  "New York",
  "London",
  "Paris",
  "Barcelona",
  "Seoul",
  "Istanbul",
  "Copenhagen",
  "Buenos Aires",
];

/** City combobox: suggestions plus free input. Commits on Enter, click, or blur. */
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
  useEffect(() => setText(value), [value]);

  const q = text.trim().toLowerCase();
  const list = CITY_SUGGESTIONS.filter((c) => !q || c.toLowerCase().includes(q) || q === value.toLowerCase());
  const options = q && !CITY_SUGGESTIONS.some((c) => c.toLowerCase() === q) ? [text.trim(), ...list] : list;

  const commit = (c: string) => {
    const v = c.trim();
    setOpen(false);
    if (v && v.toLowerCase() !== value.toLowerCase()) onChange(v);
    else setText(value);
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
        setText(value);
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
            e.target.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, options.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
            else if (e.key === "Enter") (e.preventDefault(), commit(options[hi] ?? text), (e.target as HTMLInputElement).blur());
            else if (e.key === "Escape") (setOpen(false), setText(value));
          }}
          className={`w-full min-w-0 bg-transparent font-[560] text-ink outline-none placeholder:text-ink-3 ${hero ? "text-[17px]" : "text-[15px]"}`}
          placeholder="Any city"
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
            {options.map((c, i) => (
              <li
                key={c + i}
                role="option"
                aria-selected={i === hi}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c);
                }}
                className={`flex cursor-pointer items-center justify-between rounded-[10px] px-3 py-2 text-[15px] ${i === hi ? "bg-paper-sunk text-ink" : "text-ink-2"}`}
              >
                <span>{c}</span>
                {c.toLowerCase() === value.toLowerCase() && <span className="text-[12px] text-you">current</span>}
                {i === 0 && c === text.trim() && !CITY_SUGGESTIONS.includes(c) && <span className="text-[12px] text-ink-3">use this city</span>}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
