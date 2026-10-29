"use client";

import { useEffect, useRef, useState } from "react";
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
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setText(value);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [value]);

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
      <AnimatePresence>
        {open && options.length > 0 && (
          <motion.ul
            id="city-list"
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 origin-top overflow-auto rounded-[14px] bg-paper-raised p-1.5 shadow-[var(--shadow-overlay)] ring-1 ring-line"
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
      </AnimatePresence>
    </div>
  );
}
