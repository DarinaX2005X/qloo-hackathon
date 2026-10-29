type MarkProps = { size?: number; className?: string; mono?: boolean };

/** Three contour lines of a hill, steep on the north-east side, with you at the summit. */
export function LogoMark({ size = 28, className, mono = false }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <path
        d="M6.6 40.2C4.4 26.9 14.4 9.6 31.4 7.4c15.6-2 26.6 8.6 26 22.8-.6 15.4-12.4 26-27.6 26.2C17.4 56.5 8.4 50.8 6.6 40.2Z"
        stroke="currentColor"
        strokeWidth="3.4"
      />
      <path
        d="M18.6 37.4c-.9-9.3 6.4-20.5 17-21.6 9.8-1 16 5.9 15.2 14.6-.8 9.2-7.8 15.3-16.6 15.1-8.2-.2-14.9-2.6-15.6-8.1Z"
        stroke="currentColor"
        strokeWidth="3.4"
      />
      <path
        d="M30.4 31.9c-.3-4.7 3.4-9.6 8.3-9.9 4.5-.2 7.2 3.1 6.8 7.2-.4 4.3-3.6 7-7.8 6.9-3.9-.1-7.1-1.2-7.3-4.2Z"
        stroke="currentColor"
        strokeWidth="3.4"
      />
      <circle cx="38.2" cy="29.1" r="3.3" fill={mono ? "currentColor" : "var(--you)"} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-ink ${className ?? ""}`}>
      <LogoMark size={30} />
      <span className="text-[23px] font-[680] tracking-[-0.03em] leading-none">homing</span>
    </span>
  );
}
