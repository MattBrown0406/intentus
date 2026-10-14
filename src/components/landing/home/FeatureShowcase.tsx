import { ArrowUpRight, Bell, CalendarCheck2, Heart, LineChart, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { useInView } from "./useInView";

function MetricVisual() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const stated = [7, 7, 8, 8, 8, 9];
  const actual = [7, 6.5, 6, 5.6, 5.2, 5];
  const w = 260;
  const h = 90;
  const toPts = (arr: number[]) => arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - ((v - 4) / 6) * h}`).join(" ");
  return (
    <div ref={ref} className="rounded-2xl border border-border/60 bg-background/70 p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">Pipeline vs. how you rated your focus</span>
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent">Reality gap</span>
      </div>
      <svg viewBox={`-4 -6 ${w + 8} ${h + 12}`} className="mt-3 h-24 w-full" aria-hidden="true">
        {[["stated", stated, "hsl(37 72% 48%)", "4 5"], ["actual", actual, "hsl(174 72% 36%)", undefined]].map(([key, arr, color, dash]) => (
          <polyline
            key={key as string}
            points={toPts(arr as number[])}
            fill="none"
            stroke={color as string}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dash as string | undefined}
            pathLength={dash ? undefined : 1}
            style={dash ? { opacity: inView ? 1 : 0, transition: "opacity 1s ease-out 0.4s" } : { strokeDasharray: 1, strokeDashoffset: inView ? 0 : 1, transition: "stroke-dashoffset 1.6s ease-out" }}
          />
        ))}
      </svg>
      <div className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />Your self-rating</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-primary" />Google Sheet metric</span>
      </div>
    </div>
  );
}

function PartnerVisual() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="space-y-2.5">
      {[
        { from: "Jordan", text: "You said the job ad goes live today. Did it?", kind: "Nudge", delay: 0 },
        { from: "Jordan", text: "Saw it went up. Proud of you.", kind: "Cheer", delay: 450 },
      ].map((n) => (
        <div
          key={n.text}
          style={{ transitionDelay: `${n.delay}ms` }}
          className={cn(
            "flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-3 transition-all duration-700",
            inView ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0",
          )}
        >
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", n.kind === "Cheer" ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary")}>
            {n.kind === "Cheer" ? <Heart className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </span>
          <div>
            <p className="text-xs font-semibold text-foreground">{n.from} · {n.kind}</p>
            <p className="text-sm text-muted-foreground">{n.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CoachVisual() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const rows = [
    { name: "Dana R.", signal: "No check-in in 12 days", risk: "high" },
    { name: "Marcus T.", signal: "Follow-through 42% (28 days)", risk: "high" },
    { name: "Priya S.", signal: "Focus down 1.8 vs last month", risk: "medium" },
    { name: "Owen L.", signal: "On track · 4-week streak", risk: "low" },
  ];
  return (
    <div ref={ref} className="space-y-2">
      {rows.map((r, i) => (
        <div
          key={r.name}
          style={{ transitionDelay: `${i * 120}ms` }}
          className={cn(
            "flex items-center justify-between rounded-xl border border-border/60 bg-background/80 px-3 py-2.5 transition-all duration-500",
            inView ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
          )}
        >
          <div>
            <p className="text-sm font-semibold text-foreground">{r.name}</p>
            <p className="text-xs text-muted-foreground">{r.signal}</p>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              r.risk === "high" ? "bg-destructive/10 text-destructive" : r.risk === "medium" ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary",
            )}
          >
            {r.risk === "high" ? "At risk" : r.risk === "medium" ? "Watch" : "On track"}
          </span>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  {
    Icon: LineChart,
    eyebrow: "Stated vs. actual",
    title: "Your numbers keep you honest",
    body: "Track the metrics that matter by hand, or connect a published Google Sheet that syncs every day. Intentus puts how you think the week went next to what actually moved.",
    Visual: MetricVisual,
  },
  {
    Icon: Users,
    eyebrow: "Accountability partners",
    title: "Someone in your corner",
    body: "Invite a cofounder, peer or friend with a code. They see your commitments and whether you kept them, never your audit, report or reflections. They can nudge or cheer you on.",
    Visual: PartnerVisual,
  },
  {
    Icon: CalendarCheck2,
    eyebrow: "For coaches",
    title: "Your whole client roster at a glance",
    body: "A portfolio sorted by risk, a weekly digest of who needs attention, shared notes, and plan editing. Clients control exactly what they share and can leave any time.",
    Visual: CoachVisual,
  },
];

export function FeatureShowcase() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container mx-auto px-4">
        <Reveal className="mx-auto mb-16 max-w-2xl text-center">
          <div className="mx-auto mb-4 h-px w-16 rounded-full bg-gradient-gold" />
          <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl">Built for follow-through, not motivation</h2>
          <p className="mt-4 text-lg text-muted-foreground">Everything in Intentus exists to close the gap between what you say matters and what you actually do.</p>
        </Reveal>
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-3">
          {FEATURES.map(({ Icon, eyebrow, title, body, Visual }, i) => (
            <Reveal key={title} delay={i * 120}>
              <article className="group flex h-full flex-col rounded-3xl border border-border/60 bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-glow">
                <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
                <h3 className="mt-2 font-heading text-2xl font-bold text-foreground">{title}</h3>
                <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">{body}</p>
                <div className="mt-6"><Visual /></div>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10 text-center">
          <a href="/for-coaches" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Running a coaching practice? See Intentus for coaches <ArrowUpRight className="h-4 w-4" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
