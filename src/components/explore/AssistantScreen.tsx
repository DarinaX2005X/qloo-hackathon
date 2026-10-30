"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUp, Check, ChevronDown, ImagePlus, Map as MapIcon, MessagesSquare, RotateCcw, Square } from "lucide-react";
import type { AgentCard, Neighborhood } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { useExplore, type ChatTurn } from "./store";
import { api } from "./api";
import { useGoTo, useIsMobile } from "./nav";
import { Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { useFeatures } from "@/components/screens/features";
import { DecidesCard, HomeCard, SpotCard } from "@/components/screens/cards";

const MAX = 1000;
const spring = { type: "spring", stiffness: 420, damping: 36 } as const;

/** Starter questions that use the real names on the map right now. */
function useSuggestions(): string[] {
  const ex = useExplore();
  const top = ex.hoods.data?.[0];
  const city = cityName(ex.state.city);
  const asked = new Set(ex.chat.filter((t) => t.role === "user").map((t) => t.text.toLowerCase()));
  const last = [...ex.chat].reverse().find((t) => t.role === "assistant" && !t.pending);
  const lastKinds = new Set(last?.cards.map((c) => c.kind) ?? []);
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const address =
    city === "Lisbon" ? "How is Rua da Rosa 120 for me?" : top ? `How would a flat in the middle of ${top.name} suit me?` : null;
  let list: (string | null)[];
  if (!hasLoves)
    list = [`I love Radiohead, Fleabag and natural wine. Map ${city} for me`, "I'm moving here with my partner, who loves techno and Succession", "I used to live in Kreuzberg, Berlin"];
  else if (lastKinds.has("home"))
    list = ["Mix in what I love as well", top ? `Why is ${top.name} first for me?` : null, address, "Plan three days"];
  else if (lastKinds.has("spot"))
    list = ["Which neighborhood fits me better than this?", "What's open late within a short walk?", "Plan three days"];
  else if (lastKinds.has("decides"))
    list = ["Less touristy, I work from cafés", "I used to live in Kreuzberg, Berlin", "Plan three days"];
  else
    list = [
      "I used to live in Kreuzberg, Berlin",
      address,
      top ? `Why is ${top.name} first?` : null,
      "Less touristy, I work from cafés",
      "Plan three days",
    ];
  return list.filter((s): s is string => !!s && !asked.has(s.toLowerCase())).slice(0, 5);
}

function Steps({ turn }: { turn: ChatTurn }) {
  const [open, setOpen] = useState(false);
  const live = !!turn.pending;
  if (!turn.trace.length) return null;
  if (live)
    return (
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {turn.trace.map((s, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
              <Check size={13} strokeWidth={2.4} className="mt-[3px] shrink-0 text-ok" />
              <span>{s.summary}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    );
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 rounded-[8px] py-0.5 text-[12.5px] font-[580] text-ink-3 hover:text-ink">
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        What I did, {turn.trace.length} {turn.trace.length === 1 ? "step" : "steps"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="space-y-1.5 overflow-hidden pl-5 pt-1.5"
          >
            {turn.trace.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
                <Check size={13} strokeWidth={2.4} className="mt-[3px] shrink-0 text-ok" />
                <span>{s.summary}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function RankingCard({ hoods }: { hoods: Neighborhood[] }) {
  const ex = useExplore();
  const goTo = useGoTo();
  const known = new Set(ex.hoods.data?.map((n) => n.id) ?? []);
  return (
    <div className="rounded-[18px] bg-paper-raised p-1.5 ring-1 ring-line">
      <p className="px-2 pb-1 pt-1.5 text-[12.5px] font-[560] text-ink-3">The ranking for your taste in {cityName(ex.state.city)}</p>
      <ol>
        {hoods.slice(0, 3).map((n, i) => (
          <li key={n.id}>
            <button
              onClick={() => {
                if (known.has(n.id)) ex.patch([{ op: "select_neighborhood", id: n.id }]);
                goTo("/explore");
              }}
              className="group flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors hover:bg-paper-sunk"
            >
              <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[650] ${i === 0 ? "bg-you text-white" : "bg-paper-sunk text-ink-2"}`}>{n.rank}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-[600] tracking-[-0.01em] text-ink">{n.name}</span>
                {n.matchedTags.length > 0 && <span className="block truncate text-[12px] text-ink-3">{n.matchedTags.slice(0, 3).join(", ")}</span>}
              </span>
              <span className="tnum shrink-0 text-[15px] font-[640] text-ink">{Math.round(n.score * 100)}</span>
              <ArrowRight size={14} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function OpenOnMap({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-1.5 flex items-center gap-1.5 rounded-[9px] px-2 py-1 text-[13px] font-[600] text-you-deep transition-colors hover:bg-you-soft/60">
      <MapIcon size={14} /> Open on the map <ArrowRight size={13} />
    </button>
  );
}

function Card({ card }: { card: AgentCard }) {
  const features = useFeatures();
  const goTo = useGoTo();
  if (card.kind === "ranking") return <RankingCard hoods={card.neighborhoods} />;
  if (card.kind === "home")
    return (
      <div>
        <HomeCard result={card.result} compact />
        <OpenOnMap
          onClick={() => {
            features.showHome(card.result);
            goTo("/explore/home");
          }}
        />
      </div>
    );
  if (card.kind === "spot")
    return (
      <div>
        <SpotCard result={card.result} compact />
        <OpenOnMap
          onClick={() => {
            features.showSpot(card.result);
            goTo("/explore/address");
          }}
        />
      </div>
    );
  return (
    <div>
      <DecidesCard result={card.result} compact />
      <OpenOnMap
        onClick={() => {
          features.showDecides(card.result);
          goTo("/explore/why");
        }}
      />
    </div>
  );
}

function Turn({ turn, retry }: { turn: ChatTurn; retry?: () => void }) {
  if (turn.role === "user")
    return (
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-[16px] rounded-br-[6px] bg-ink px-3.5 py-2.5 text-[14.5px] leading-snug text-paper [overflow-wrap:anywhere]"
      >
        {turn.text}
      </motion.p>
    );
  // cards come in before the words; show the words first so the card reads as the evidence
  const order: AgentCard["kind"][] = ["ranking", "home", "spot", "decides"];
  const cards = [...turn.cards].sort((a, b) => order.indexOf(b.kind) - order.indexOf(a.kind));
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5" data-testid="assistant-turn">
      <Steps turn={turn} />
      {turn.pending && !turn.text && (
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Spinner size={13} /> {turn.trace.length ? "Still working" : "Reading your question"}
        </div>
      )}
      {turn.text && (
        <p data-testid="assistant-reply" className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">
          {turn.text}
          {turn.pending && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] animate-pulse bg-ink-3" aria-hidden />}
        </p>
      )}
      {cards.map((c, i) => (
        <motion.div key={`${c.kind}-${i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <Card card={c} />
        </motion.div>
      ))}
      {turn.stopped && <p className="text-[12.5px] text-ink-3">You stopped this answer. Anything Homing had already changed on the map stays.</p>}
      {turn.error && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13.5px] text-err">{turn.error}</p>
          {retry && (
            <button onClick={retry} className="flex items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] font-[580] text-ink-2 hover:bg-paper-sunk hover:text-ink">
              <RotateCcw size={13} /> Try again
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function Composer({ autoFocus }: { autoFocus: boolean }) {
  const ex = useExplore();
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  // grow with the text up to six lines
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  }, [text]);
  useEffect(() => {
    if (autoFocus) area.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const send = () => {
    const t = text.trim();
    if (!t || ex.agentBusy) return;
    void ex.askAgent(t);
    setText("");
  };

  const readImage = (f?: File | null) => {
    if (!f || !/^image\/(png|jpe?g|webp)$/.test(f.type)) return;
    const r = new FileReader();
    r.onload = async () => {
      setReading(true);
      try {
        const res = await api.intake({ image: String(r.result) });
        const found = res.loves.filter((l) => l.chosen || l.candidates.length);
        if (!found.length) {
          ex.addNote("I couldn't read any titles or names in that screenshot. A clearer crop of the list usually works.");
          return;
        }
        ex.addResolved(found, "you");
        if (res.city && !ex.state.loves.length) ex.patch([{ op: "set_city", city: res.city }]);
        const names = found.map((l) => l.chosen?.name ?? l.query);
        ex.addNote(`From your screenshot I added ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names[names.length - 1]} to what you love. The map is updating.`);
      } catch (e) {
        ex.addNote((e as Error).message);
      } finally {
        setReading(false);
      }
    };
    r.readAsDataURL(f);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        readImage(e.dataTransfer.files[0]);
      }}
      className="flex items-end gap-1.5 rounded-[18px] bg-paper-raised p-1.5 shadow-[var(--shadow-raised)] ring-1 ring-line focus-within:ring-2 focus-within:ring-you"
    >
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={reading}
        aria-label="Add a screenshot of a playlist, watchlist or bookshelf"
        title="Add a screenshot of a playlist, watchlist or bookshelf"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-ink-2 transition-colors hover:bg-paper-sunk hover:text-ink disabled:opacity-60"
      >
        {reading ? <Spinner size={16} /> : <ImagePlus size={19} strokeWidth={1.75} />}
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (readImage(e.target.files?.[0]), (e.target.value = ""))} />
      <textarea
        ref={area}
        data-testid="agent-input"
        rows={1}
        value={text}
        maxLength={MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), send());
        }}
        onPaste={(e) => {
          const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
          if (img) (e.preventDefault(), readImage(img));
        }}
        placeholder={reading ? "Reading your screenshot" : "Ask about neighborhoods, an address, or your plan"}
        aria-label="Message Homing"
        className="hm-scroll max-h-[156px] min-h-[40px] flex-1 resize-none bg-transparent px-1 py-[9px] text-[15px] leading-snug text-ink outline-none placeholder:text-ink-3"
      />
      {text.length > 800 && <span className={`tnum self-center text-[12px] ${text.length >= MAX ? "text-err" : "text-ink-3"}`}>{MAX - text.length}</span>}
      {ex.agentBusy ? (
        <button
          type="button"
          onClick={ex.stopAgent}
          aria-label="Stop the answer"
          title="Stop"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-ink text-paper transition-transform active:scale-95"
        >
          <Square size={13} fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-you text-white transition-[transform,opacity] active:scale-95 disabled:opacity-35"
        >
          <ArrowUp size={18} strokeWidth={2.2} />
        </button>
      )}
    </form>
  );
}

function Suggestions({ big }: { big?: boolean }) {
  const ex = useExplore();
  const list = useSuggestions();
  if (!list.length || ex.agentBusy) return null;
  return (
    <div className={big ? "flex flex-col items-start gap-1.5" : "flex flex-wrap gap-1.5"}>
      {list.map((s, i) => (
        <motion.button
          key={s}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: i * 0.04 }}
          onClick={() => void ex.askAgent(s)}
          className={`rounded-[11px] text-left font-[530] text-ink-2 ring-1 ring-line transition-[background-color,color,transform] hover:-translate-y-px hover:bg-[color-mix(in_oklch,var(--you)_10%,var(--paper-raised))] hover:text-ink active:scale-[0.98] ${big ? "bg-paper-raised px-3.5 py-2.5 text-[14.5px]" : "bg-paper-raised/80 px-3 py-1.5 text-[13px]"}`}
        >
          {s}
        </motion.button>
      ))}
    </div>
  );
}

function Conversation({ onShowMap }: { onShowMap?: () => void }) {
  const ex = useExplore();
  const list = useRef<HTMLDivElement>(null);
  const city = cityName(ex.state.city);
  const empty = ex.chat.length === 0;
  const lastUser = useMemo(() => {
    const m = new Map<number, string>();
    let q = "";
    for (const t of ex.chat) {
      if (t.role === "user") q = t.text;
      else m.set(t.id, q);
    }
    return m;
  }, [ex.chat]);

  // follow the answer while it streams, unless the person scrolled up to read
  const pinned = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [ex.chat]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-you-soft text-you-deep">
            <MessagesSquare size={18} strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-[650] leading-tight tracking-[-0.02em]">Assistant</h2>
            <p className="truncate text-[12.5px] text-ink-3">Changes show on the map as it works</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onShowMap && (
            <button onClick={onShowMap} className="flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-[580] text-ink-2 hover:bg-paper-sunk hover:text-ink">
              <MapIcon size={15} /> Map
            </button>
          )}
          {!empty && (
            <button
              onClick={ex.clearChat}
              aria-label="New conversation"
              title="New conversation"
              className="flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-[580] text-ink-2 hover:bg-paper-sunk hover:text-ink"
            >
              <RotateCcw size={14} /> {onShowMap ? "New" : "New conversation"}
            </button>
          )}
        </div>
      </div>

      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="hm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2"
      >
        {empty ? (
          <div className="pt-6">
            <h3 className="text-[26px] font-[680] leading-[1.15] tracking-[-0.03em]">Ask Homing about {city}</h3>
            <p className="mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-ink-2">
              Say what you want in your own words. Homing can change your map, explain why a neighborhood ranks where it does, check a flat&apos;s address, find the part of {city} that feels like a place you used to live, and plan your first days.
            </p>
            <div className="mt-5">
              <Suggestions big />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {ex.chat.map((t) => (
              <Turn key={t.id} turn={t} retry={t.role === "assistant" && t.error && lastUser.get(t.id) && !ex.agentBusy ? () => void ex.askAgent(lastUser.get(t.id)!) : undefined} />
            ))}
            <Suggestions />
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-1">
        <Composer autoFocus={empty} />
        <p className="mt-1.5 px-1 text-[11.5px] text-ink-3">Enter sends, Shift and Enter starts a new line. You can drop a screenshot of a playlist or watchlist here.</p>
      </div>
    </div>
  );
}

/** The Assistant screen: a conversation next to the live map. On a phone the map waits behind a toggle. */
export function AssistantScreen() {
  const mobile = useIsMobile();
  const [showMap, setShowMap] = useState(false);
  const ex = useExplore();
  if (mobile)
    return (
      <AnimatePresence initial={false} mode="popLayout">
        {showMap ? (
          <motion.div key="pill" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={spring} className="absolute inset-x-4 bottom-4">
            <button
              onClick={() => setShowMap(false)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-ink text-[15px] font-[580] text-paper shadow-[var(--shadow-overlay)]"
            >
              {ex.agentBusy ? <Spinner size={15} /> : <MessagesSquare size={17} />}
              {ex.agentBusy ? "Homing is answering. Back to the conversation" : "Back to the conversation"}
            </button>
          </motion.div>
        ) : (
          <motion.section
            key="chat"
            aria-label="Assistant"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={spring}
            className="absolute inset-x-0 bottom-0 top-[68px] overflow-hidden rounded-t-[24px] bg-paper-raised shadow-[var(--shadow-overlay)] ring-1 ring-line"
          >
            <Conversation onShowMap={() => setShowMap(true)} />
          </motion.section>
        )}
      </AnimatePresence>
    );
  return (
    <motion.section
      aria-label="Assistant"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute bottom-4 left-4 top-[76px] w-[560px] overflow-hidden rounded-[24px] bg-paper-raised/95 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur"
    >
      <Conversation />
    </motion.section>
  );
}
