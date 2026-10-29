"use client";

import { LogoMark } from "@/components/brand/Logo";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="paper-noise grid min-h-dvh place-items-center bg-paper px-6">
      <div className="max-w-[440px] text-center">
        <LogoMark size={56} className="mx-auto text-ink" />
        <h1 className="mt-6 text-[36px] font-[690] leading-[1.05] tracking-[-0.035em]">Something broke on our side</h1>
        <p className="mt-3 text-[17px] text-ink-2">Your map is saved in the address bar, so trying again picks up where you were.</p>
        <button onClick={reset} className="mt-7 inline-flex h-[52px] items-center rounded-[14px] bg-you px-6 text-[17px] font-[560] text-white shadow-[var(--shadow-rest)] transition-transform hover:-translate-y-px active:scale-[0.97]">
          Try again
        </button>
      </div>
    </main>
  );
}
