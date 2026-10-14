import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhoneFrame } from "./PhoneFrame";
import { TodayScreen } from "./demo/screens";
import { AppStoreBadge } from "./AppStoreBadge";
import { usePrefersReducedMotion } from "./useInView";

const ROTATING = ["honest audit.", "focused plan.", "weekly rhythm.", "kept promise."];

function RotatingWord() {
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % ROTATING.length), 2600);
    return () => clearInterval(t);
  }, [reduced]);
  return (
    <span className="relative inline-grid overflow-hidden whitespace-nowrap align-bottom">
      {/* invisible sizer keeps the line height/width stable */}
      <span className="invisible col-start-1 row-start-1">kept promise.</span>
      {ROTATING.map((w, n) => (
        <span
          key={w}
          aria-hidden={n !== i}
          className={cn(
            "text-gradient-gold col-start-1 row-start-1 transition-all duration-700 ease-out",
            n === i ? "translate-y-0 opacity-100" : n === (i - 1 + ROTATING.length) % ROTATING.length ? "-translate-y-full opacity-0" : "translate-y-full opacity-0",
          )}
        >
          {w}
        </span>
      ))}
    </span>
  );
}

function NotificationCard() {
  return (
    <div className="w-[264px] rounded-[22px] border border-white/60 bg-white/85 p-3 shadow-[0_24px_48px_-16px_rgba(19,24,32,0.35)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <img src="/favicon.png" alt="" className="h-5 w-5 rounded-md" />
        <span className="text-[11px] font-semibold text-[#131820]">INTENTUS</span>
        <span className="ml-auto text-[10px] text-[#5E6573]">now</span>
      </div>
      <p className="mt-1.5 text-[12.5px] font-semibold text-[#131820]">Friday check-in</p>
      <p className="text-[12px] leading-snug text-[#5E6573]">Did you post the sales lead job ad?</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {["Kept", "Partly", "Missed"].map((o) => (
          <span key={o} className={cn("rounded-lg py-1.5 text-center text-[11px] font-semibold", o === "Kept" ? "bg-[#0E8C80] text-white" : "bg-[#F0F3F7] text-[#131820]")}>
            {o}
          </span>
        ))}
      </div>
    </div>
  );
}

function WidgetCard() {
  return (
    <div className="h-[150px] w-[150px] rounded-[30px] bg-gradient-to-br from-[#0E8C80] to-[#0a5f57] p-4 text-white shadow-[0_24px_48px_-16px_rgba(14,140,128,0.6)]">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/70">This week</p>
      <p className="mt-1 text-[12.5px] font-semibold leading-snug">Post the sales lead job ad</p>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="font-heading text-[26px] font-bold leading-none">6</p>
          <p className="text-[9px] text-white/75">week streak</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-[#0E8C80]">Check in</span>
      </div>
    </div>
  );
}

export function HomeHero() {
  const reduced = usePrefersReducedMotion();
  return (
    <section className="relative pb-16 [overflow:clip] pt-[calc(env(safe-area-inset-top,0px)+112px)] sm:pb-24 sm:pt-36">
      {/* animated backdrop */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-subtle opacity-70" />
        <div className="absolute -right-32 top-10 h-[560px] w-[560px] rounded-full bg-primary/15 blur-3xl motion-safe:animate-[drift_18s_ease-in-out_infinite]" />
        <div className="absolute -left-40 bottom-0 h-[460px] w-[460px] rounded-full bg-accent/15 blur-3xl motion-safe:animate-[drift_22s_ease-in-out_infinite_reverse]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.5)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.5)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" />
      </div>

      <div className="container mx-auto px-4">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
          <div className="text-center lg:text-left">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/70 px-4 py-1.5 text-sm font-medium text-primary shadow-soft backdrop-blur motion-safe:animate-fade-up">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              New: Intentus 3.0 for iPhone
            </div>
            <h1 className="font-heading text-[2.4rem] font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl xl:text-7xl motion-safe:animate-fade-up" style={{ animationDelay: "0.08s" }}>
              Execution starts
              <br />
              with an <RotatingWord />
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground lg:mx-0 sm:text-xl motion-safe:animate-fade-up" style={{ animationDelay: "0.16s" }}>
              Intentus is the accountability app for founders, executives and coaches. Run an honest operating audit, get a focused 90-day plan, and keep your word to yourself in 30 seconds a week.
            </p>
            <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row lg:justify-start sm:justify-center motion-safe:animate-fade-up" style={{ animationDelay: "0.24s" }}>
              <AppStoreBadge />
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card/80 px-6 py-4 font-semibold text-foreground shadow-soft backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-medium"
              >
                Watch the live demo <ArrowDown className="h-4 w-4 motion-safe:animate-bounce" />
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground lg:justify-start motion-safe:animate-fade-up" style={{ animationDelay: "0.32s" }}>
              {["Free to start", "Private by design", "Built for coaches too"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" />{t}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground motion-safe:animate-fade-up" style={{ animationDelay: "0.36s" }}>
              Not ready to download? <Link to="/sample" className="font-semibold text-primary underline-offset-4 hover:underline">Try a 2-minute sample in your browser</Link>.
            </p>
          </div>

          {/* phone + floating cards */}
          <div className="relative mx-auto flex justify-center motion-safe:animate-fade-up" style={{ animationDelay: "0.2s" }}>
            <div className="absolute inset-0 -z-10 m-auto h-[520px] w-[520px] rounded-full bg-gradient-primary opacity-20 blur-3xl" />
            <div className="motion-safe:animate-float">
              <PhoneFrame label="Intentus Today screen">
                <TodayScreen play={!reduced} />
              </PhoneFrame>
            </div>
            <div className="absolute -left-6 top-6 hidden scale-[0.9] sm:block lg:-left-12 xl:-left-44 motion-safe:animate-[float-slow_7s_ease-in-out_infinite]">
              <NotificationCard />
            </div>
            <div className="absolute -right-4 bottom-10 hidden scale-[0.92] sm:block lg:-right-6 xl:-right-32 motion-safe:animate-[float-slow_8s_ease-in-out_1.2s_infinite]">
              <WidgetCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
