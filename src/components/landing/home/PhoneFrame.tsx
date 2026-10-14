import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** An iPhone-style frame. Children render inside a 290×620 screen. */
export function PhoneFrame({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      className={cn(
        "relative mx-auto w-[312px] shrink-0 rounded-[52px] bg-[#0d1117] p-[11px] shadow-[0_40px_80px_-24px_rgba(19,24,32,0.45),0_0_0_1px_rgba(255,255,255,0.06)_inset]",
        className,
      )}
      role="img"
      aria-label={label}
    >
      {/* side buttons */}
      <span className="absolute -left-[3px] top-[118px] h-8 w-[3px] rounded-l bg-[#1f2630]" />
      <span className="absolute -left-[3px] top-[166px] h-14 w-[3px] rounded-l bg-[#1f2630]" />
      <span className="absolute -right-[3px] top-[150px] h-20 w-[3px] rounded-r bg-[#1f2630]" />
      <div className="relative h-[620px] w-[290px] overflow-hidden rounded-[42px] bg-[#F8FAFC]">
        {/* status bar */}
        <div className="absolute inset-x-0 top-0 z-30 flex h-11 items-center justify-between px-7 text-[12px] font-semibold text-[#131820]">
          <span>9:41</span>
          <span className="absolute left-1/2 top-2.5 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1">
            <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><rect x="0" y="6" width="3" height="4" rx="1" fill="currentColor"/><rect x="4.5" y="4" width="3" height="6" rx="1" fill="currentColor"/><rect x="9" y="2" width="3" height="8" rx="1" fill="currentColor"/><rect x="13" y="0" width="3" height="10" rx="1" fill="currentColor"/></svg>
            <svg width="22" height="11" viewBox="0 0 22 11" aria-hidden="true"><rect x="0.5" y="0.5" width="18" height="10" rx="3" stroke="currentColor" fill="none" opacity="0.5"/><rect x="2" y="2" width="14" height="7" rx="1.6" fill="currentColor"/><rect x="19.5" y="3.5" width="1.5" height="4" rx="0.7" fill="currentColor" opacity="0.5"/></svg>
          </span>
        </div>
        <div className="absolute inset-0 pt-11">{children}</div>
        {/* home indicator */}
        <span className="absolute bottom-1.5 left-1/2 z-30 h-[5px] w-[110px] -translate-x-1/2 rounded-full bg-[#131820]/80" />
      </div>
    </div>
  );
}
