import { ClipboardList, FileText, Map, RefreshCw, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { useInView } from "./useInView";

const STAGES = [
  { Icon: ClipboardList, title: "Audit", body: "An honest look at how you actually operate." },
  { Icon: FileText, title: "Report", body: "Blind spots, contradictions and one forced choice." },
  { Icon: Map, title: "Plan", body: "Ninety days, three phases, a few concrete actions." },
  { Icon: Zap, title: "Check in", body: "One commitment a week, closed out in seconds." },
  { Icon: RefreshCw, title: "Review", body: "Quarter in review, then audit again, sharper." },
];

export function RhythmLoop() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.3 });
  return (
    <section id="how-it-works" className="relative scroll-mt-24 bg-[hsl(220_25%_10%)] [overflow:clip] py-24 text-white sm:py-32">
      <div aria-hidden="true" className="absolute inset-0 opacity-60 [background:radial-gradient(50%_60%_at_50%_0%,hsl(174_72%_46%/0.25),transparent_70%)]" />
      <div className="container relative mx-auto px-4">
        <Reveal className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[hsl(174_72%_56%)]">The operating rhythm</p>
          <h2 className="font-heading text-3xl font-bold tracking-tight md:text-5xl">One loop. Every quarter. Compounding.</h2>
          <p className="mt-4 text-lg text-white/70">Intentus doesn’t give you more to do. It gives you a rhythm that makes drift obvious and follow-through normal.</p>
        </Reveal>
        <div ref={ref} className="relative mx-auto max-w-6xl">
          {/* connector line */}
          <div className="absolute left-[10%] right-[10%] top-8 hidden h-px bg-white/10 md:block">
            <div
              className="h-full origin-left bg-gradient-to-r from-[hsl(174_72%_46%)] via-[hsl(190_80%_50%)] to-[hsl(37_72%_48%)] transition-transform duration-[1800ms] ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${inView ? 1 : 0})` }}
            />
          </div>
          <ol className="grid gap-10 md:grid-cols-5 md:gap-6">
            {STAGES.map(({ Icon, title, body }, i) => (
              <li
                key={title}
                style={{ transitionDelay: `${300 + i * 260}ms` }}
                className={cn(
                  "relative flex flex-col items-center text-center transition-all duration-700 motion-reduce:transition-none",
                  inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
                )}
              >
                <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/5 backdrop-blur">
                  <Icon className="h-7 w-7 text-[hsl(174_72%_60%)]" />
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-gold text-[11px] font-bold text-[hsl(220_25%_10%)]">{i + 1}</span>
                </span>
                <h3 className="mt-5 font-heading text-xl font-bold">{title}</h3>
                <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-white/65">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
