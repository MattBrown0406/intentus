import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, FileText, Map, Zap, MessagesSquare, TrendingUp, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhoneFrame } from "./PhoneFrame";
import { DemoScreen, type DemoScreenId } from "./demo/screens";
import { useInView, usePrefersReducedMotion } from "./useInView";
import { Reveal } from "./Reveal";
import { AppStoreBadge } from "./AppStoreBadge";

const STEPS: { id: DemoScreenId; short: string; title: string; body: string; Icon: typeof Map; ms: number }[] = [
  { id: "audit", short: "Audit", title: "Take the operating audit", body: "A guided set of honest questions about how you actually operate. Ask AI to reflect any answer back before you move on.", Icon: ClipboardList, ms: 8000 },
  { id: "report", short: "Report", title: "Get a report that doesn’t flatter you", body: "Strengths, blind spots, the contradiction you keep living with, and one forced choice to make.", Icon: FileText, ms: 6500 },
  { id: "plan", short: "Plan", title: "Run a focused 90-day plan", body: "Three phases, a handful of concrete actions each. Check them off as you go; refresh the plan as reality changes.", Icon: Map, ms: 5500 },
  { id: "checkin", short: "Check-in", title: "Check in in 30 seconds", body: "One commitment a week. Answer Kept, Partly or Missed straight from the reminder or the home-screen widget.", Icon: Zap, ms: 5000 },
  { id: "coach", short: "Coach", title: "Talk it through with your AI coach", body: "It knows your plan, your commitments and your patterns, so the advice is about your week, not anyone’s.", Icon: MessagesSquare, ms: 9500 },
  { id: "progress", short: "Progress", title: "Watch follow-through compound", body: "Focus trends, commitments kept, and a quarter-in-review that rolls straight into your next audit.", Icon: TrendingUp, ms: 6000 },
];

export function InteractiveDemo() {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLElement>({ once: false, threshold: 0.25 });
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0); // remounts the screen so its animation replays
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const running = inView && !paused && !hovering && !reduced;
  const step = STEPS[index];
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const go = useCallback((next: number) => {
    setIndex((next + STEPS.length) % STEPS.length);
    setCycle((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!running) return;
    timer.current = setTimeout(() => go(index + 1), step.ms);
    return () => clearTimeout(timer.current);
  }, [running, index, step.ms, go, cycle]);

  return (
    <section id="demo" ref={ref} className="relative scroll-mt-20 py-20 [overflow:clip] sm:py-24">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_70%_40%,hsl(174_72%_46%/0.10),transparent_70%),radial-gradient(40%_40%_at_20%_80%,hsl(37_72%_48%/0.08),transparent_70%)]" />
      <div className="container mx-auto px-4">
        <Reveal className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Try the app before you download it</p>
          <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl">See Intentus in action</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            This is the real app, running a sample founder through a quarter. Tap any step to jump to it.
          </p>
        </Reveal>

        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          {/* Steps */}
          <div className="order-2 hidden lg:order-1 lg:block" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
            <ol className="space-y-2" role="tablist" aria-label="App demo steps">
              {STEPS.map((s, i) => {
                const active = i === index;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls="intentus-demo-phone"
                      onClick={() => go(i)}
                      className={cn(
                        "group relative w-full overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "border-primary/30 bg-card shadow-medium" : "border-transparent hover:bg-card/60",
                      )}
                    >
                      <div className="flex items-start gap-4">
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300",
                            active ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          <s.Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className={cn("font-heading text-lg font-bold transition-colors", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                            {s.title}
                          </p>
                          <div className={cn("grid transition-all duration-500 ease-out", active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                            <p className="overflow-hidden pt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                          </div>
                        </div>
                      </div>
                      {active && (
                        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-border">
                          <span
                            key={`${cycle}-${running}`}
                            className="block h-full bg-gradient-primary"
                            style={
                              running
                                ? { animation: `demo-progress ${s.ms}ms linear forwards` }
                                : { width: reduced ? "100%" : "0%" }
                            }
                          />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-4 pl-1">
              {!reduced && (
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? "Play tour" : "Pause tour"}
                </button>
              )}
              <span className="text-xs text-muted-foreground">Sample data · Intentus for iPhone</span>
            </div>
          </div>

          {/* Mobile: tabs above the phone so the change is visible where you tap */}
          <div className="order-1 -mx-4 min-w-0 lg:hidden">
            <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="App demo steps">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-controls="intentus-demo-phone"
                  onClick={() => go(i)}
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                    i === index ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {s.short}
                </button>
              ))}
            </div>
            <p className="mt-4 px-4 text-center text-sm leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{step.title}.</span> {step.body}
            </p>
          </div>

          {/* Phone */}
          <div className="order-2 flex justify-center lg:order-2 lg:origin-top lg:scale-[0.9] xl:scale-95">
            <div className="relative">
              <div className="absolute -inset-10 -z-10 rounded-full bg-gradient-primary opacity-20 blur-3xl motion-safe:animate-[pulse-soft_6s_ease-in-out_infinite]" />
              <div id="intentus-demo-phone" aria-live="polite">
                <PhoneFrame label={`Intentus app demo: ${step.title}`}>
                  <div key={`${step.id}-${cycle}`} className="h-full motion-safe:animate-[screen-in_0.45s_ease-out]">
                    <DemoScreen id={step.id} play={!reduced} />
                  </div>
                </PhoneFrame>
              </div>
            </div>
          </div>
        </div>

        <Reveal className="mt-16 flex flex-col items-center gap-3">
          <AppStoreBadge />
          <p className="text-sm text-muted-foreground">Free to start. Executive, Premium and Coach plans available in the app.</p>
        </Reveal>
      </div>
    </section>
  );
}
