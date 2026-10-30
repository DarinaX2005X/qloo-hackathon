"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp } from "lucide-react";
import { useExplore } from "./store";
import { useGoTo, useScreenHref } from "./nav";
import { Spinner } from "@/components/ui/primitives";

/** A one-line question on the Map screen: it sends the question to the assistant and opens the Assistant screen. */
export function AskBar() {
  const ex = useExplore();
  const goTo = useGoTo();
  const href = useScreenHref();
  const [text, setText] = useState("");
  const turns = ex.chat.filter((t) => t.role === "user").length;
  const send = () => {
    const t = text.trim();
    if (!t || ex.agentBusy) return;
    void ex.askAgent(t);
    setText("");
    goTo("/explore/assistant");
  };
  return (
    <div className="border-t border-line bg-paper-raised/70 px-4 pb-4 pt-3">
      {turns > 0 && (
        <Link href={href("/explore/assistant")} scroll={false} className="mb-2 flex items-center gap-1.5 text-[12.5px] font-[560] text-ink-2 hover:text-ink">
          {ex.agentBusy ? <Spinner size={12} /> : null}
          {ex.agentBusy ? "Homing is answering" : `Back to your conversation (${turns} ${turns === 1 ? "question" : "questions"})`}
          <ArrowRight size={13} />
        </Link>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 rounded-[14px] bg-paper-raised p-1.5 pl-3.5 shadow-[var(--shadow-rest)] ring-1 ring-line focus-within:ring-2 focus-within:ring-you"
      >
        <input
          data-testid="ask-input"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask Homing to adjust the map"
          aria-label="Ask Homing"
          className="h-9 min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={!text.trim() || ex.agentBusy}
          aria-label="Ask"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-you text-white transition-[transform,opacity] active:scale-95 disabled:opacity-35"
        >
          <ArrowUp size={17} strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
