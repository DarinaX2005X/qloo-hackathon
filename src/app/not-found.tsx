import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <main className="paper-noise grid min-h-dvh place-items-center bg-paper px-6">
      <div className="max-w-[440px] text-center">
        <LogoMark size={56} className="mx-auto text-ink" />
        <h1 className="mt-6 text-[40px] font-[690] leading-[1.05] tracking-[-0.035em]">This street isn&apos;t on the map</h1>
        <p className="mt-3 text-[17px] text-ink-2">The page you followed doesn&apos;t exist. Your taste map is one click away.</p>
        <Link href="/explore" className="mt-7 inline-flex h-[52px] items-center rounded-[14px] bg-you px-6 text-[17px] font-[560] text-white shadow-[var(--shadow-rest)] transition-transform hover:-translate-y-px active:scale-[0.97]">
          Map my taste
        </Link>
      </div>
    </main>
  );
}
