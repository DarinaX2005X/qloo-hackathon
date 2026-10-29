"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check } from "lucide-react";
import { useExplore } from "./store";
import { Spinner } from "@/components/ui/primitives";

const SUGGESTIONS = ["Less touristy", "On a budget, I sleep late", "I work from cafés", "Add my partner: techno and Succession"];

/** Conversation with the agent. Tool calls show as they happen, and their changes land on the map. */
export function AgentChat({ compact = false }: { compact?: boolean }) {
  const { chat, askAgent, agentBusy } = useExplore();
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  const send = (t: string) => {
    if (!t.trim() || agentBusy) return;
    void askAgent(t);
    setText("");
  };

  return (
    <div className="border-t border-line bg-paper-raised/70 px-4 pb-4 pt-3">
      {chat.length > 0 && (
        <div ref={list} className={`mb-3 overflow-y-auto overscroll-contain pr-1 space-y-3 ${compact ? "max-h-[18vh]" : "max-h-[34vh]"}`}>
          {chat.map((t) =>
            t.role === "user" ? (
              <motion.p
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-[6px] bg-ink px-3 py-2 text-[14px] leading-snug text-paper [overflow-wrap:anywhere]"
              >
                {t.text}
              </motion.p>
            ) : (
              <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {t.trace.map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-2"
                    >
                      <Check size={13} strokeWidth={2.4} className="mt-[3px] shrink-0 text-ok" />
                      <span>{s.summary}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {t.pending && !t.text && (
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
                    <Spinner size={13} /> Working on it
                  </div>
                )}
                {t.text && <p className="text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">{t.text}</p>}
                {t.error && <p className="text-[13px] text-err">{t.error}</p>}
              </motion.div>
            ),
          )}
        </div>
      )}
      {chat.length === 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {(compact ? SUGGESTIONS.slice(0, 2) : SUGGESTIONS).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-[9px] bg-paper-sunk px-2.5 py-1.5 text-[12.5px] font-[520] text-ink-2 transition-colors hover:bg-[color-mix(in_oklch,var(--you)_12%,var(--paper-sunk))] hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-end gap-2 rounded-[14px] bg-paper-raised p-1.5 pl-3.5 shadow-[var(--shadow-rest)] ring-1 ring-line focus-within:ring-2 focus-within:ring-you"
      >
        <textarea
          data-testid="agent-input"
          rows={1}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), send(text));
          }}
          placeholder="Ask Homing to adjust the map"
          className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-snug text-ink outline-none placeholder:text-ink-3"
        />
        {text.length > 800 && <span className="tnum self-center text-[12px] text-ink-3">{1000 - text.length}</span>}
        <button
          type="submit"
          disabled={!text.trim() || agentBusy}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-you text-white transition-[transform,opacity] active:scale-95 disabled:opacity-35"
        >
          {agentBusy ? <Spinner size={15} /> : <ArrowUp size={17} strokeWidth={2.2} />}
        </button>
      </form>
    </div>
  );
}
