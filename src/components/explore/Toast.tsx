"use client";

import { AnimatePresence, motion } from "motion/react";
import { useExplore } from "./store";

/** Feedback for actions that changed something, with undo where the change can be reverted. */
export function Toast() {
  const { toast, setToast } = useExplore();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex items-center gap-4 rounded-[14px] bg-ink py-2.5 pl-4 pr-2 text-[14px] text-paper shadow-[var(--shadow-overlay)]"
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
                className="rounded-[9px] px-2.5 py-1 font-[600] text-[oklch(78%_0.13_40)] hover:bg-white/10"
              >
                Undo
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
