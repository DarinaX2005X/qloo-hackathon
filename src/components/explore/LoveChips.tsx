"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, X } from "lucide-react";
import type { Domain, ResolvedLove } from "@/shared/contracts";
import { LIMITS } from "@/shared/contracts";
import { Spinner } from "@/components/ui/primitives";

export const DOMAIN_NAME: Record<Domain, string> = {
  artist: "Music",
  movie: "Film",
  tv_show: "TV",
  book: "Book",
  author: "Author",
  person: "Person",
  brand: "Brand",
  place: "Place",
  podcast: "Podcast",
  video_game: "Game",
  destination: "Destination",
};

type Ink = "you" | "them";
const squash = (t: string) => t.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function LoveChip({
  love,
  ink,
  onRemove,
  onChoose,
  onWeight,
  onOpen,
  noGeo,
}: {
  love: ResolvedLove;
  ink: Ink;
  onRemove: () => void;
  onChoose: (id: string) => void;
  onWeight: (w: number) => void;
  /** a shared link carries only the chosen match; the menu fetches the alternatives again */
  onOpen?: () => void;
  noGeo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  useEffect(() => {
    if (open && love.candidates.length <= 1) onOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // keyboard: opening the menu moves focus into it, closing returns it to the chip
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => pop.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const shut = () => setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      chip.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", shut);
    document.addEventListener("scroll", shut, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", shut);
      document.removeEventListener("scroll", shut, true);
    };
  }, [open]);
  // the menu lives in a portal so a scrolling panel can't clip it; keep it inside the viewport
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const W = 288, H = pop.current?.offsetHeight ?? 260, M = 12;
    const left = Math.min(Math.max(M, r.left), window.innerWidth - W - M);
    const up = r.bottom + 6 + H > window.innerHeight - M && r.top - 6 - H > M;
    setPos({ left, top: up ? r.top - 6 - H : r.bottom + 6, up });
  }, [open, love]);

  const c = love.chosen;
  // "jazz" becomes Miles Davis; the chip keeps saying what the person typed
  const standsFor = c && !squash(c.name).includes(squash(love.query)) && !squash(love.query).includes(squash(c.name)) ? love.query : null;
  const inkColor = ink === "you" ? "var(--you)" : "var(--them)";
  const dim = love.weight < 1;
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, rotateX: -70, y: 6 }}
      animate={{ opacity: 1, rotateX: 0, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="relative"
      style={{ transformPerspective: 600 }}
    >
      <button
        ref={chip}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`group flex h-11 max-w-[260px] items-center gap-2 rounded-[12px] bg-paper-raised py-1 pl-1 pr-2.5 text-left shadow-[var(--shadow-rest),var(--highlight)] ring-1 transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-raised)] active:scale-[0.98] ${c ? "ring-line" : "ring-[color-mix(in_oklch,var(--warn)_60%,transparent)]"}`}
      >
        {c?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.image} alt="" className="h-9 w-9 shrink-0 rounded-[9px] object-cover" style={{ opacity: dim ? 0.6 : 1 }} />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[15px] font-[650] text-white" style={{ background: c ? inkColor : "var(--ink-3)" }}>
            {(c?.name ?? love.query).slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-[580] leading-tight text-ink">{c?.name ?? love.query}</span>
          <span className="block truncate text-[12px] leading-tight text-ink-3">
            {c ? DOMAIN_NAME[c.domain] : "Not in the taste graph"}
            {standsFor ? `, for ${standsFor}` : ""}
            {c && noGeo ? ", not on the map" : ""}
            {dim ? `, ${Math.round(love.weight * 100)}%` : ""}
          </span>
        </span>
      </button>
      {typeof document !== "undefined" &&
        createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            ref={pop}
            role="dialog"
            aria-label={`Options for ${c?.name ?? love.query}`}
            initial={{ opacity: 0, y: pos?.up ? 4 : -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: pos?.up ? 4 : -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
            className={`fixed z-[60] w-[288px] rounded-[16px] bg-paper-raised p-3 shadow-[var(--shadow-overlay)] ring-1 ring-line ${pos?.up ? "origin-bottom-left" : "origin-top-left"}`}
          >
            {c && (
              <>
                {c.via ? (
                  <p className="mb-3 text-[13px] leading-snug text-ink-2">
                    Qloo has no single entity for {c.via.toLowerCase()}, so its best-known artist carries it on the map. Pick another below.
                  </p>
                ) : (
                  c.subtitle && <p className="mb-3 text-[13px] leading-snug text-ink-2">{c.subtitle}</p>
                )}
                <p className="mb-1.5 text-[12px] font-[560] text-ink-3">How much it counts</p>
                <div className="mb-3 flex gap-1">
                  {[0.35, 0.65, 1].map((w) => (
                    <button
                      key={w}
                      onClick={() => onWeight(w)}
                      className={`h-8 flex-1 rounded-[9px] text-[13px] font-[550] transition-colors ${Math.abs(love.weight - w) < 0.01 ? "text-white" : "bg-paper-sunk text-ink-2 hover:text-ink"}`}
                      style={Math.abs(love.weight - w) < 0.01 ? { background: inkColor } : undefined}
                    >
                      {w === 1 ? "A lot" : w > 0.5 ? "Some" : "A little"}
                    </button>
                  ))}
                </div>
              </>
            )}
            {love.candidates.length > 1 && (
              <>
                <p className="mb-1 text-[12px] font-[560] text-ink-3">{c ? "Did you mean" : "Closest matches"}</p>
                <ul className="mb-2 max-h-48 space-y-0.5 overflow-auto">
                  {love.candidates.map((x) => (
                    <li key={x.id + x.domain}>
                      <button
                        onClick={() => {
                          onChoose(x.id);
                          setOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13.5px] hover:bg-paper-sunk ${x.id === c?.id ? "bg-paper-sunk" : ""}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-ink">{x.name}</span>
                        <span className="shrink-0 text-[12px] text-ink-3">{x.via ? `${x.via}, ${DOMAIN_NAME[x.domain]}` : DOMAIN_NAME[x.domain]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!c && love.candidates.length <= 1 && (
              <p className="mb-2 text-[13px] text-ink-2">We couldn&apos;t match this to anything people rate. Try the full name of an artist, film, book or place.</p>
            )}
            <button onClick={onRemove} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-[550] text-ink-2 hover:bg-paper-sunk hover:text-err">
              <X size={14} strokeWidth={2} /> Remove
            </button>
          </motion.div>
        )}
      </AnimatePresence>,
          document.body,
        )}
    </motion.div>
  );
}

/** A love still being looked up. It can always be removed; after the search deadline it turns into
 *  "Couldn't check" with Retry, keeping the text the person typed. */
export function PendingChip({ query, failed, onRemove, onRetry }: { query: string; failed?: string | null; onRemove?: () => void; onRetry?: () => void }) {
  return (
    <motion.div
      layout
      data-testid="pending-love"
      data-state={failed ? "failed" : "searching"}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`flex min-h-11 max-w-full items-center gap-2 rounded-[12px] py-1 pl-3 pr-1 text-[14px] ${failed ? "bg-paper-raised text-ink ring-1 ring-[color-mix(in_oklch,var(--warn)_60%,transparent)]" : "bg-paper-sunk text-ink-2"}`}
    >
      {!failed && <Spinner size={14} className="shrink-0 text-ink-3" />}
      <span className="min-w-0">
        <span className="block truncate font-[560] leading-tight">{query}</span>
        <span className="block text-[12px] leading-tight text-ink-3">{failed ? "Couldn't check it" : "Looking it up"}</span>
      </span>
      {failed && onRetry && (
        <button onClick={onRetry} title={failed} className="h-8 shrink-0 rounded-[8px] px-2 text-[13px] font-[600] text-you-deep hover:bg-paper-sunk">
          Retry
        </button>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${query}`}
          title="Remove"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-raised hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </motion.div>
  );
}

/** Split what was typed or pasted into separate loves: one per line, comma or semicolon. */
export function splitLoves(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;\n]/)) {
    const s = part.trim().slice(0, 120);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

/** Text input that turns each entry into a chip. Paste or drop an image to read a screenshot. */
export function LoveInput({
  onAdd,
  onImage,
  count,
  ink = "you",
  placeholder,
  autoFocus,
  reading,
}: {
  onAdd: (q: string) => void;
  onImage: (dataUrl: string) => void;
  count: number;
  ink?: Ink;
  placeholder: string;
  autoFocus?: boolean;
  reading?: boolean;
}) {
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const full = count >= LIMITS.loves;

  const readFile = (f: File | undefined | null) => {
    if (!f || !/^image\/(png|jpe?g|webp)$/.test(f.type)) return;
    const r = new FileReader();
    r.onload = () => onImage(String(r.result));
    r.readAsDataURL(f);
  };
  const [split, setSplit] = useState<string[] | null>(null);
  const submit = () => {
    const parts = splitLoves(text).slice(0, LIMITS.loves - count);
    parts.forEach(onAdd);
    // several names in one line become separate loves; say so, in case it was one name with a comma
    setSplit(parts.length > 1 ? parts : null);
    setText("");
  };

  return (
    <div>
    <div
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        readFile(e.dataTransfer.files[0]);
      }}
      className={`flex h-12 items-center gap-1 rounded-[12px] bg-paper-sunk pl-3.5 pr-1.5 ring-1 transition-shadow focus-within:ring-2 ${drag ? "ring-2" : "ring-transparent"}`}
      style={{ ["--tw-ring-color" as string]: ink === "you" ? "var(--you)" : "var(--them)" }}
    >
      <input
        data-testid={ink === "you" ? "love-input" : "companion-input"}
        value={text}
        disabled={full}
        autoFocus={autoFocus}
        maxLength={600}
        onChange={(e) => {
          setText(e.target.value);
          if (split) setSplit(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), submit());
        }}
        onPaste={(e) => {
          const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
          if (img) (e.preventDefault(), readFile(img));
        }}
        placeholder={full ? "That's plenty to map your taste" : placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        aria-label={ink === "you" ? "Add something you love" : "Add something they love"}
      />
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={reading || full}
        title="Read a screenshot of your playlists, watchlist or bookshelf"
        className="grid h-9 w-9 place-items-center rounded-[9px] text-ink-2 transition-colors hover:bg-paper-raised hover:text-ink disabled:opacity-50"
        aria-label="Use a screenshot"
      >
        {reading ? <Spinner size={16} /> : <ImagePlus size={18} strokeWidth={1.75} />}
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (readFile(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
      {split ? (
        <p data-testid="love-split-note" className="mt-1.5 px-1 text-[12.5px] leading-snug text-ink-2">
          Added as {split.length} separate loves: {split.join(", ")}. If that was one name, remove them and type it without commas.
        </p>
      ) : (
        !full && <p className="mt-1.5 px-1 text-[12px] leading-snug text-ink-3">One at a time works best: type a name and press Enter, then the next.</p>
      )}
    </div>
  );
}
