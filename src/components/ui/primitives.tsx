"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "ink";
  size?: "sm" | "md" | "lg";
};

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-[560] tracking-[-0.01em] transition-[transform,box-shadow,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45";
const variants = {
  primary: "bg-you text-white shadow-[var(--shadow-rest),inset_0_1px_0_oklch(100%_0_0/.25)] hover:-translate-y-px hover:bg-you-deep hover:shadow-[var(--shadow-raised)]",
  ink: "bg-ink text-paper shadow-[var(--shadow-rest)] hover:-translate-y-px hover:shadow-[var(--shadow-raised)]",
  secondary: "bg-paper-raised text-ink shadow-[var(--shadow-rest),var(--highlight)] ring-1 ring-line hover:-translate-y-px hover:shadow-[var(--shadow-raised)]",
  quiet: "text-ink-2 hover:bg-paper-sunk hover:text-ink",
};
const sizes = { sm: "h-8 rounded-[10px] px-3 text-[13px]", md: "h-10 rounded-[12px] px-4 text-[15px]", lg: "h-[52px] rounded-[14px] px-6 text-[17px]" };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", className, ...rest },
  ref,
) {
  return <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`} {...rest} />;
});

/** Segmented control with a sliding selection plate. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="relative flex rounded-[12px] bg-paper-sunk p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative z-0 flex-1 rounded-[9px] px-2.5 font-[550] transition-colors ${size === "sm" ? "min-h-7 py-0.5 text-[12.5px]" : "min-h-8 py-1 text-[13.5px]"} leading-tight ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[9px] bg-paper-raised shadow-[var(--shadow-rest)]"
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
              />
            )}
            {o.label}
            {o.count !== undefined && <span className="tnum ml-1 text-ink-3">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal slider with labelled ends; keyboard accessible via native range under a custom skin. */
export function Dial({
  value,
  onChange,
  left,
  right,
  label,
  ink = "you",
}: {
  value: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
  label: string;
  ink?: "you" | "them";
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const color = ink === "you" ? "var(--you)" : "var(--them)";
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-paper-sunk shadow-[inset_0_1px_1px_oklch(30%_0.02_50/.12)]" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ width: `${local * 100}%`, background: color }} />
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-paper-raised shadow-[var(--shadow-raised)]"
          style={{ left: `${local * 100}%`, borderColor: color }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={local}
          aria-label={label}
          onPointerDown={() => (dragging.current = true)}
          onChange={(e) => setLocal(Number(e.target.value))}
          onPointerUp={(e) => {
            dragging.current = false;
            onChange(Number((e.target as HTMLInputElement).value));
          }}
          onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-ink-3">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-[10px] bg-paper-sunk ${className ?? ""}`} />;
}

/** Small spinning contour used for in-place waiting. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`animate-spin ${className ?? ""}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
