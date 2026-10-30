"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ImagePlus, Map as MapIcon, MessagesSquare, RotateCcw, Square } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore, type ChatTurn } from "./store";
import { api } from "./api";
import { useGoTo, useIsMobile } from "./nav";
import { Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { AgentTurnV2 } from "@/components/agent09/AgentTurn";
import { deriveTurn, liveSteps } from "@/components/agent09/turn";
import { ConstraintChips } from "@/components/agent09/Constraints";
import { WaitNote } from "@/components/agent09/WaitNote";
import { useAgentStore } from "@/components/agent09/useAgentStore";
import type { AgentCardV2, AreaDecision } from "@/components/agent09/types";
type AreaIdentity = AreaDecision["area"];

const MAX = 1000;
const spring = { type: "spring", stiffness: 420, damping: 36 } as const;

/** Starter questions that use the real names on the map right now. Each one is a whole task the assistant can
 *  plan, check and finish, not a single setting. */
function useSuggestions(): string[] {
  const ex = useExplore();
  const top = ex.hoods.data?.[0];
  const city = cityName(ex.state.city);
  const asked = new Set(ex.chat.filter((t) => t.role === "user").map((t) => t.text.toLowerCase()));
  const last = [...ex.chat].reverse().find((t) => t.role === "assistant" && !t.pending);
  const kinds = new Set<string>([...(last?.cards.map((c) => c.kind) ?? []), ...(last?.events ?? []).flatMap((e) => (e.type === "result" ? [e.card.kind] : []))]);
  const hasLoves = activeLoves(ex.state.loves).length > 0;
  const firstLove = activeLoves(ex.state.loves)[0]?.chosen.name;
  const lisbon = city === "Lisbon";
  const address = lisbon ? "Check Rua da Rosa 120 for me. Then plan a relaxed afternoon nearby, no museums, no bars." : top ? `Check an address in ${top.name} for me, then plan a relaxed afternoon nearby.` : null;
  let list: (string | null)[];
  if (kinds.has("visit") || kinds.has("plan"))
    list = ["Replace the second stop and keep the rest.", "Plan the same walk for the evening.", top ? `Why is ${top.name} first?` : null];
  else if (kinds.has("venues"))
    list = ["My partner doesn't like clubs. What could we do near our shortlist together?", address];
  else if (kinds.has("home") || kinds.has("comparison"))
    list = ["Open the closest option on the map.", top ? `Why is ${top.name} first? What if one of my loves mattered less?` : null, address];
  else if (kinds.has("areas") || kinds.has("ranking") || kinds.has("explanation") || kinds.has("decides"))
    list = [top ? `Why ${top.name}?${firstLove ? ` What if ${firstLove} mattered less?` : ""}` : null, address, "Where can I go dancing? No hotel bars and no adult clubs."];
  else if (!hasLoves)
    list = [
      `I'm moving to ${city}. I love Radiohead, Fleabag and Patagonia. I work from cafés. Where should I start looking?`,
      `I loved living in Kreuzberg, Berlin. Where in ${city} could feel familiar? Use my tastes too if the match is weak.`,
      `Would ${lisbon ? "Lisbon or Reykjavík" : `${city} or Lisbon`} feel closer to Kreuzberg?`,
    ];
  else
    list = [
      top ? `Why is ${top.name} first for me?` : null,
      `I loved living in Kreuzberg, Berlin. Where in ${city} could feel familiar?`,
      address,
      "Where can I go dancing? No hotel bars and no adult clubs.",
    ];
  return list.filter((s): s is string => !!s && !asked.has(s.toLowerCase())).slice(0, 4);
}

/** Area IDs for a visit the assistant built: its day areas matched against the current shortlist, else the
 *  areas the agent remembered as selected, else the current selection. */
function visitAreaIds(ex: ReturnType<typeof useAgentStore>, card: Extract<AgentCardV2, { kind: "visit" }>, turn: ChatTurn): string[] {
  const named = new Set(card.result.itinerary.days.map((d) => d.neighborhood.trim().toLowerCase()));
  // areas this turn and the current shortlist know by name: the visit names its areas, not their ids
  const known: AreaIdentity[] = [...(ex.analysis?.data?.areas ?? []).map((a) => a.area)];
  for (const e of turn.events ?? []) {
    if (e.type !== "result") continue;
    const c = e.card;
    if (c.kind === "address" && c.result.area) known.push(c.result.area.area);
    if (c.kind === "areas") known.push(...c.areas.map((a) => a.area));
    if (c.kind === "home") known.push(...c.matches.map((m) => m.area.area));
  }
  const hit = (a: AreaIdentity) => named.has(a.name.trim().toLowerCase()) || a.aliases.some((x) => named.has(x.trim().toLowerCase()));
  const byName = [...new Set(known.filter(hit).map((a) => a.id))];
  if (byName.length) return byName.slice(0, 3);
  const done = [...(turn.events ?? [])].reverse().find((e) => e.type === "done");
  const mem = done && done.type === "done" ? done.memory.selectedAreaIds : [];
  if (mem.length) return mem.slice(0, 3);
  const cur = ex.state.neighborhood ?? ex.analysis?.data?.areas[0]?.area.id;
  return cur ? [cur] : [];
}

function TurnV2({ turn, retry }: { turn: ChatTurn; retry?: () => void }) {
  const ex = useAgentStore();
  const goTo = useGoTo();
  const onOpenVisit = (card: Extract<AgentCardV2, { kind: "visit" }>) => {
    if (ex.openVisit) ex.openVisit(card.result, visitAreaIds(ex, card, turn));
    else ex.showPlan(card.result.itinerary, {});
    goTo("/explore/trip");
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5" data-testid="assistant-turn">
      {turn.retryOf && <p className="text-[12px] font-[560] text-ink-3">Trying one step again</p>}
      <AgentTurnV2
        events={turn.events ?? []}
        currentRevision={ex.revision}
        stopped={turn.stopped}
        ended={!turn.pending}
        onRetryGoal={ex.retryGoal && turn.turnId && !ex.agentBusy ? (goalId) => void ex.retryGoal!(turn.turnId!, goalId) : undefined}
        handlers={{ onOpenVisit }}
        hideTurnErrors={!!turn.error}
      />
      {turn.conflict && <p className="text-[12.5px] text-ink-3">You changed your map while this ran, so the assistant&apos;s own changes were not applied.</p>}
      {turn.error && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-[13.5px] text-[var(--err)]">{turn.error}</p>
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

function Turn({ turn, retry }: { turn: ChatTurn; retry?: () => void }) {
  if (turn.role === "assistant" && turn.events?.some((e) => e.type !== "patch")) return <TurnV2 turn={turn} retry={retry} />;
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
  // a plain line from Homing (what a screenshot added), or a turn that ended before any event arrived
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5" data-testid="assistant-turn">
      {turn.pending && !turn.text && (
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Spinner size={13} /> Reading your question
        </div>
      )}
      <WaitNote active={!!turn.pending} />
      {turn.text && (
        <p data-testid="assistant-reply" className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">
          {turn.text}
        </p>
      )}
      {turn.stopped && <p className="text-[12.5px] text-ink-3">You stopped this answer before it started.</p>}
      {turn.error && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-[13.5px] text-[var(--err)]">{turn.error}</p>
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
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        onPaste={(e) => {
          const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
          if (img) {
            e.preventDefault();
            readImage(img);
          }
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

/** The rules the assistant keeps for the rest of the conversation ("no bars", "$$ with known prices"). */
function SessionRules() {
  const ex = useAgentStore();
  const mobile = useIsMobile();
  const list = ex.constraints ?? [];
  if (!list.length) return null;
  return (
    <div className="mb-2 px-1">
      <ConstraintChips
        constraints={list}
        label={mobile ? null : "Kept for the rest of this conversation"}
        oneLine={mobile}
        onRemove={ex.removeConstraint ? (c) => ex.removeConstraint!(c.id) : undefined}
        disabled={ex.agentBusy}
        testId="session-rules"
      />
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
            <p className="text-[12.5px] leading-snug text-ink-3">Changes show on the map as it works</p>
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
              Describe the move in your own words: what you love, a neighborhood you lived in, an address you are looking at. Homing lists what it will do, checks each result against what you asked, and tells you plainly what it could not confirm.
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
        <SessionRules />
        <Composer autoFocus={empty} />
        <p className="mt-1.5 hidden px-1 text-[11.5px] text-ink-3 md:block">Enter sends, Shift and Enter starts a new line. You can drop a screenshot of a playlist or watchlist here.</p>
      </div>
    </div>
  );
}

/** The Assistant screen: a conversation next to the live map. On a phone the map waits behind a toggle. */
export function AssistantScreen() {
  const mobile = useIsMobile();
  const [showMap, setShowMap] = useState(false);
  const ex = useExplore();
  const last = ex.chat[ex.chat.length - 1];
  const busyStep = ex.agentBusy && last?.events?.length ? liveSteps(deriveTurn(last.events).steps, 1)[0]?.text : null;
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
              <span className="min-w-0 truncate">{ex.agentBusy ? (busyStep ? busyStep : "Homing is working. Back to the conversation") : "Back to the conversation"}</span>
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
