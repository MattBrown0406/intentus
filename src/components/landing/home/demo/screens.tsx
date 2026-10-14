// Faithful replicas of the Intentus iOS app screens (colors, layout and copy
// mirror ~/repos/intentus-app). All data is an illustrative sample persona.
import { useEffect, useState, type ReactNode } from "react";
import { Check, Map, MessagesSquare, Sparkles, Sun, TrendingUp, UserCircle2, Flame, Target, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

const APP = {
  teal: "#0E8C80",
  tealBright: "#21CAB9",
  gold: "#D38F22",
  goldText: "#8A5A0F",
  goldSoft: "#F4E3C4",
  ink: "#131820",
  slate: "#5E6573",
  bg: "#F8FAFC",
  border: "#E3E8EF",
  muted: "#F0F3F7",
};

export type DemoScreenId = "today" | "audit" | "report" | "plan" | "checkin" | "coach" | "progress";

/** Reveals `text` one character at a time while `play` is true. */
function useTypewriter(text: string, play: boolean, speed = 28, startDelay = 300) {
  const [count, setCount] = useState(play ? 0 : text.length);
  useEffect(() => {
    if (!play) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length && interval) clearInterval(interval);
      }, speed);
    }, startDelay);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, play, speed, startDelay]);
  return text.slice(0, count);
}

/** Becomes true `ms` after mount while `play` is true. */
function useAfter(ms: number, play: boolean) {
  const [on, setOn] = useState(!play);
  useEffect(() => {
    if (!play) {
      setOn(true);
      return;
    }
    setOn(false);
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [ms, play]);
  return on;
}

function MiniLabel({ children }: { children: ReactNode }) {
  return <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5E6573]">{children}</p>;
}

function MiniCard({ children, className, tone = "default", style }: { children: ReactNode; className?: string; tone?: "default" | "gold" | "muted"; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        "rounded-[16px] border p-3",
        tone === "gold" ? "border-[#EAD3A6] bg-[#F4E3C4]" : tone === "muted" ? "border-[#E3E8EF] bg-[#F0F3F7]" : "border-[#E3E8EF] bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PrimaryButton({ children, pressed }: { children: ReactNode; pressed?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-9 items-center justify-center rounded-[11px] bg-[#0E8C80] text-[12px] font-semibold text-white transition-transform duration-200",
        pressed && "scale-95",
      )}
    >
      {children}
    </div>
  );
}

function TabBar({ active }: { active: "today" | "plan" | "coach" | "progress" | "you" }) {
  const tabs = [
    { id: "today", label: "Today", Icon: Sun },
    { id: "plan", label: "Plan", Icon: Map },
    { id: "coach", label: "Coach", Icon: MessagesSquare },
    { id: "progress", label: "Progress", Icon: TrendingUp },
    { id: "you", label: "You", Icon: UserCircle2 },
  ] as const;
  return (
    <div className="absolute inset-x-3 bottom-4 z-20 flex h-[52px] items-center justify-around rounded-full border border-white/70 bg-white/80 px-2 shadow-[0_8px_24px_-8px_rgba(19,24,32,0.18)] backdrop-blur-md">
      {tabs.map(({ id, label, Icon }) => (
        <div key={id} className={cn("flex flex-col items-center gap-0.5 rounded-full px-2 py-1", id === active && "bg-[#0E8C80]/10")}>
          <Icon className="h-[15px] w-[15px]" style={{ color: id === active ? APP.teal : APP.slate }} strokeWidth={2.2} />
          <span className="text-[8px] font-semibold" style={{ color: id === active ? APP.teal : APP.slate }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function ScreenBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("h-full overflow-hidden px-4 pb-20 pt-2 text-[#131820]", className)}>{children}</div>;
}

function Stagger({ children, index, play }: { children: ReactNode; index: number; play: boolean }) {
  const shown = useAfter(180 + index * 260, play);
  return (
    <div className={cn("transition-all duration-500 ease-out", shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------
export function TodayScreen({ play }: { play: boolean }) {
  return (
    <>
      <ScreenBody className="space-y-2.5">
        <div className="pt-1">
          <p className="text-[11px] text-[#5E6573]">Friday, October 16</p>
          <p className="font-heading text-[22px] font-bold leading-tight tracking-tight">Good afternoon, Alex</p>
        </div>
        <Stagger index={0} play={play}>
          <div className="rounded-[18px] bg-[#0E8C80] p-3.5 text-white shadow-[0_10px_24px_-10px_rgba(14,140,128,0.7)]">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/70">Next action</p>
            <p className="mt-1 font-heading text-[15px] font-bold leading-snug">Check in on this week’s one thing</p>
            <p className="mt-0.5 text-[10.5px] text-white/80">Takes about 30 seconds</p>
            <div className="mt-2.5 inline-flex h-7 items-center rounded-full bg-white px-3 text-[11px] font-semibold text-[#0E8C80]">Check in now</div>
          </div>
        </Stagger>
        <Stagger index={1} play={play}>
          <MiniCard>
            <MiniLabel>This week’s one thing</MiniLabel>
            <p className="mt-1 text-[12.5px] font-semibold leading-snug">Post the sales lead job ad and block 3 hours for interviews</p>
            <div className="mt-2 flex gap-1.5">
              {["Kept", "Partly", "Missed"].map((o) => (
                <span key={o} className="rounded-full border border-[#E3E8EF] px-2.5 py-1 text-[10px] font-semibold text-[#131820]">{o}</span>
              ))}
            </div>
          </MiniCard>
        </Stagger>
        <Stagger index={2} play={play}>
          <div className="grid grid-cols-2 gap-2.5">
            <MiniCard>
              <div className="flex items-center gap-1 text-[#D38F22]"><Flame className="h-3.5 w-3.5" /><MiniLabel>Streak</MiniLabel></div>
              <p className="mt-1 font-heading text-[22px] font-bold leading-none">6<span className="ml-1 text-[11px] font-medium text-[#5E6573]">weeks</span></p>
            </MiniCard>
            <MiniCard>
              <div className="flex items-center gap-1 text-[#0E8C80]"><Target className="h-3.5 w-3.5" /><MiniLabel>Follow-through</MiniLabel></div>
              <p className="mt-1 font-heading text-[22px] font-bold leading-none">83<span className="text-[13px]">%</span></p>
            </MiniCard>
          </div>
        </Stagger>
        <Stagger index={3} play={play}>
          <MiniCard>
            <MiniLabel>Stated vs actual</MiniLabel>
            <div className="mt-1.5 flex items-center justify-between text-[11.5px]">
              <span className="font-semibold">Qualified pipeline</span>
              <span className="flex items-center gap-0.5 font-semibold text-[#2E9E5B]"><ArrowUpRight className="h-3 w-3" />18%</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11.5px]">
              <span className="font-semibold">Hours in delivery</span>
              <span className="flex items-center gap-0.5 font-semibold text-[#2E9E5B]"><ArrowDownRight className="h-3 w-3" />9 hrs</span>
            </div>
          </MiniCard>
        </Stagger>
      </ScreenBody>
      <TabBar active="today" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
const AUDIT_ANSWER = "I keep calling the sales hire my top priority, but most of my week still goes to client delivery. I haven’t posted the role.";
const AUDIT_REFLECTION = "You named the priority twice, then described a week built around something else. What would have to be true for you to post the role this week?";

export function AuditScreen({ play }: { play: boolean }) {
  const typed = useTypewriter(AUDIT_ANSWER, play, 22, 500);
  const pressed = useAfter(3900, play);
  const reflection = useAfter(4400, play);
  return (
    <>
      <ScreenBody className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-[#0E8C80]">Operating audit</p>
          <div className="mt-1.5 flex gap-1">
            {[1, 1, 0.45, 0].map((v, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-[#E3E8EF]">
                <span className="block h-full rounded-full bg-[#0E8C80]" style={{ width: `${v * 100}%` }} />
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-[#5E6573]">Section 2 of 4 · Reality Check</p>
        </div>
        <p className="font-heading text-[16px] font-bold leading-snug">Where is your time actually going, versus where you say it should go?</p>
        <div className="min-h-[104px] rounded-[14px] border border-[#0E8C80]/50 bg-white p-3 text-[12px] leading-relaxed shadow-[0_0_0_3px_rgba(14,140,128,0.08)]">
          {typed}
          {play && typed.length < AUDIT_ANSWER.length && <span className="ml-px inline-block h-3.5 w-[1.5px] translate-y-0.5 animate-pulse bg-[#0E8C80]" />}
        </div>
        <div className={cn("flex h-8 items-center justify-center gap-1.5 rounded-[11px] border border-[#E3E8EF] bg-white text-[11.5px] font-semibold text-[#0E8C80] transition-transform", pressed && reflection ? "" : pressed && "scale-95")}>
          <Sparkles className="h-3.5 w-3.5" /> Reflect with AI
        </div>
        <div className={cn("transition-all duration-500", reflection ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")}>
          <MiniCard tone="gold">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A5A0F]">Reflection</p>
            <p className="mt-1 text-[11.5px] leading-relaxed">{AUDIT_REFLECTION}</p>
          </MiniCard>
        </div>
      </ScreenBody>
      <div className="absolute inset-x-4 bottom-5 z-20"><PrimaryButton>Next question</PrimaryButton></div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
export function ReportScreen({ play }: { play: boolean }) {
  return (
    <>
      <ScreenBody className="space-y-2.5">
        <div>
          <p className="text-[11px] font-semibold text-[#0E8C80]">Strategic report</p>
          <p className="font-heading text-[19px] font-bold leading-tight tracking-tight">Here’s what your answers show</p>
        </div>
        <Stagger index={0} play={play}>
          <MiniCard tone="gold">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A5A0F]">Forced choice</p>
            <p className="mt-1 text-[11.5px] font-semibold leading-snug">
              Hire the sales lead and pull yourself out of enough delivery to make it work, or stop calling it the priority. Staying in between is also a choice.
            </p>
          </MiniCard>
        </Stagger>
        <Stagger index={1} play={play}>
          <MiniCard>
            <MiniLabel>North star · next 90 days</MiniLabel>
            <p className="mt-1 text-[11.5px] leading-snug">A sales lead hired and onboarding, with your calendar showing delivery moved off your plate.</p>
          </MiniCard>
        </Stagger>
        <Stagger index={2} play={play}>
          <MiniCard>
            <MiniLabel>Contradiction</MiniLabel>
            <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10.5px] leading-snug">
              <div className="rounded-[10px] bg-[#F0F3F7] p-2"><p className="font-semibold text-[#5E6573]">You said</p><p className="mt-0.5">“Growth is the priority.”</p></div>
              <div className="rounded-[10px] bg-[#F0F3F7] p-2"><p className="font-semibold text-[#5E6573]">You do</p><p className="mt-0.5">70% of hours on delivery.</p></div>
            </div>
          </MiniCard>
        </Stagger>
        <Stagger index={3} play={play}>
          <MiniCard>
            <MiniLabel>Strengths</MiniLabel>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {["Client trust", "Delivery quality", "Honest self-assessment"].map((s) => (
                <span key={s} className="rounded-full bg-[#0E8C80]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0E8C80]">{s}</span>
              ))}
            </div>
          </MiniCard>
        </Stagger>
      </ScreenBody>
      <TabBar active="plan" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
const PLAN_ACTIONS = [
  "Write the sales lead scorecard and post the role",
  "Hand two delivery accounts to your senior PM",
  "Block Tuesday and Thursday mornings for hiring",
];

export function PlanScreen({ play }: { play: boolean }) {
  const t1 = useAfter(900, play);
  const t2 = useAfter(1700, play);
  const t3 = useAfter(2500, play);
  const done = [t1, t2, t3];
  const progress = 12 + done.filter(Boolean).length * 4;
  return (
    <>
      <ScreenBody className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-[#0E8C80]">90-day plan</p>
          <p className="font-heading text-[19px] font-bold leading-tight tracking-tight">Day 12 of 90</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E3E8EF]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#0E8C80] to-[#21CAB9] transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="rounded-[16px] border-2 border-[#0E8C80] bg-white p-3">
          <div className="flex items-center justify-between">
            <MiniLabel>Phase 1 · Days 1–30</MiniLabel>
            <span className="rounded-full bg-[#0E8C80] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-white">Now</span>
          </div>
          <p className="mt-1 font-heading text-[13.5px] font-bold">Decide and clear the runway</p>
          <div className="mt-2 space-y-2">
            {PLAN_ACTIONS.map((a, i) => (
              <div key={a} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-all duration-300",
                    done[i] ? "scale-100 border-[#0E8C80] bg-[#0E8C80]" : "border-[#C9D1DC] bg-white",
                  )}
                >
                  {done[i] && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <span className={cn("text-[11.5px] leading-snug transition-colors duration-300", done[i] && "text-[#5E6573] line-through decoration-[#0E8C80]/50")}>{a}</span>
              </div>
            ))}
          </div>
        </div>
        {["Run the search under pressure", "Hire and raise the standard"].map((title, i) => (
          <MiniCard key={title} tone="muted">
            <MiniLabel>Phase {i + 2} · Days {i === 0 ? "31–60" : "61–90"}</MiniLabel>
            <p className="mt-0.5 text-[12px] font-semibold text-[#5E6573]">{title}</p>
          </MiniCard>
        ))}
      </ScreenBody>
      <TabBar active="plan" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Quick check-in (form sheet over Today)
// ---------------------------------------------------------------------------
export function CheckInScreen({ play }: { play: boolean }) {
  const sheet = useAfter(250, play);
  const tapped = useAfter(1700, play);
  const saved = useAfter(2300, play);
  return (
    <>
      <div className="pointer-events-none scale-[0.94] opacity-60 blur-[0.5px] transition-all"><TodayScreen play={false} /></div>
      <div className={cn("absolute inset-0 bg-black/25 transition-opacity duration-500", sheet ? "opacity-100" : "opacity-0")} />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 rounded-t-[24px] bg-white px-4 pb-8 pt-2.5 shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.3)] transition-transform duration-500 ease-out",
          sheet ? "translate-y-0" : "translate-y-full",
        )}
      >
        <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-[#C9D1DC]" />
        {saved ? (
          <div className="flex flex-col items-center py-6 text-center">
            <span className="flex h-14 w-14 animate-[pop_0.4s_ease-out] items-center justify-center rounded-full bg-[#0E8C80]">
              <Check className="h-7 w-7 text-white" strokeWidth={3} />
            </span>
            <p className="mt-3 font-heading text-[17px] font-bold">Kept. Nice work.</p>
            <p className="mt-1 text-[11.5px] text-[#5E6573]">That’s 7 weeks in a row. Set next week’s one thing when you’re ready.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-[#0E8C80]">Quick check-in · 30 seconds</p>
            <p className="mt-1 font-heading text-[15px] font-bold leading-snug">Did you post the sales lead job ad?</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {["Kept", "Partly", "Missed"].map((o) => (
                <div
                  key={o}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-[12px] border text-[12px] font-semibold transition-all duration-200",
                    o === "Kept" && tapped ? "scale-95 border-[#2E9E5B] bg-[#2E9E5B] text-white" : "border-[#E3E8EF] text-[#131820]",
                  )}
                >
                  {o}
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[12px] border border-[#E3E8EF] px-3 py-2.5 text-[11px] text-[#5E6573]">Add a line (optional)</div>
            <p className="mt-3 text-[10px] text-[#5E6573]">Also works straight from the reminder notification.</p>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AI coach
// ---------------------------------------------------------------------------
const COACH_REPLY =
  "You’ve said the hire matters three weeks running. The plan only needs one thing from you this week: post the role. Book 45 minutes on Monday morning and write the scorecard before you open email. What’s most likely to pull you off it?";

export function CoachScreen({ play }: { play: boolean }) {
  const userMsg = useAfter(300, play);
  const typingVisible = useAfter(1100, play);
  const replyStart = useAfter(2400, play);
  const reply = useTypewriter(COACH_REPLY, play && replyStart, 14, 0);
  return (
    <>
      <ScreenBody className="flex flex-col">
        <div className="pb-2">
          <p className="text-[11px] font-semibold text-[#0E8C80]">AI operating coach</p>
          <p className="font-heading text-[19px] font-bold leading-tight tracking-tight">Coach</p>
        </div>
        <div className="flex flex-1 flex-col gap-2.5">
          <div className={cn("ml-auto max-w-[82%] rounded-[16px] rounded-br-[6px] bg-[#0E8C80] px-3 py-2 text-[11.5px] leading-snug text-white transition-all duration-500", userMsg ? "opacity-100" : "translate-y-2 opacity-0")}>
            I keep avoiding the hiring decision. What should I actually do this week?
          </div>
          {typingVisible && !replyStart && (
            <div className="flex w-14 items-center justify-center gap-1 rounded-[16px] rounded-bl-[6px] border border-[#E3E8EF] bg-white py-2.5">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5E6573]" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          )}
          {replyStart && (
            <div className="max-w-[88%] rounded-[16px] rounded-bl-[6px] border border-[#E3E8EF] bg-white px-3 py-2 text-[11.5px] leading-relaxed">
              {reply}
            </div>
          )}
        </div>
      </ScreenBody>
      <div className="absolute inset-x-3 bottom-[78px] z-20 flex h-9 items-center rounded-full border border-[#E3E8EF] bg-white px-3 text-[11px] text-[#5E6573]">
        Ask your coach…
      </div>
      <TabBar active="coach" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
const FOCUS = [5, 6, 5, 7, 6, 7, 8, 8];

export function ProgressScreen({ play }: { play: boolean }) {
  const drawn = useAfter(200, play);
  const bars = useAfter(900, play);
  const w = 230;
  const h = 70;
  const pts = FOCUS.map((v, i) => `${(i / (FOCUS.length - 1)) * w},${h - ((v - 3) / 6) * h}`).join(" ");
  const weeks: ("kept" | "partial" | "missed")[] = ["kept", "partial", "kept", "missed", "kept", "kept", "kept", "kept"];
  return (
    <>
      <ScreenBody className="space-y-2.5">
        <div>
          <p className="text-[11px] font-semibold text-[#0E8C80]">Progress</p>
          <p className="font-heading text-[19px] font-bold leading-tight tracking-tight">Your quarter so far</p>
        </div>
        <MiniCard>
          <div className="flex items-center justify-between">
            <MiniLabel>Focus · 8 weeks</MiniLabel>
            <span className="text-[10.5px] font-semibold text-[#2E9E5B]">+3 pts</span>
          </div>
          <svg viewBox={`-4 -6 ${w + 8} ${h + 12}`} className="mt-2 h-[78px] w-full" aria-hidden="true">
            <defs>
              <linearGradient id="focusFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#21CAB9" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#21CAB9" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#focusFill)" className={cn("transition-opacity duration-1000", drawn ? "opacity-100" : "opacity-0")} />
            <polyline
              points={pts}
              fill="none"
              stroke="#0E8C80"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray="1"
              strokeDashoffset={drawn ? 0 : 1}
              style={{ transition: "stroke-dashoffset 1.4s ease-out" }}
            />
          </svg>
        </MiniCard>
        <MiniCard>
          <MiniLabel>One thing · kept / partly / missed</MiniLabel>
          <div className="mt-2 flex h-12 items-end gap-1.5">
            {weeks.map((s, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[4px] transition-all duration-500"
                style={{
                  height: bars ? (s === "kept" ? "100%" : s === "partial" ? "55%" : "22%") : "6%",
                  background: s === "kept" ? APP.teal : s === "partial" ? APP.gold : "#C9D1DC",
                  transitionDelay: `${i * 70}ms`,
                }}
              />
            ))}
          </div>
        </MiniCard>
        <MiniCard tone="gold">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A5A0F]">Quarter in review · day 75</p>
          <p className="mt-1 text-[11.5px] font-semibold leading-snug">6 of 8 commitments kept. Focus up 3 points since you moved delivery off your calendar.</p>
          <p className="mt-1.5 text-[10.5px] font-semibold text-[#0E8C80]">Start your next audit →</p>
        </MiniCard>
      </ScreenBody>
      <TabBar active="progress" />
    </>
  );
}

export function DemoScreen({ id, play }: { id: DemoScreenId; play: boolean }) {
  switch (id) {
    case "today":
      return <TodayScreen play={play} />;
    case "audit":
      return <AuditScreen play={play} />;
    case "report":
      return <ReportScreen play={play} />;
    case "plan":
      return <PlanScreen play={play} />;
    case "checkin":
      return <CheckInScreen play={play} />;
    case "coach":
      return <CoachScreen play={play} />;
    case "progress":
      return <ProgressScreen play={play} />;
  }
}
