// Rotating coaching questions stored in check_ins.extras
// Tier rules:
//  - free: none of these are asked
//  - pro (Executive $29): always ask the 3 core questions
//  - premium / coach: smart rotation — pick the questions the coach has the
//    least / stalest information on, never repeat the same group inside a
//    7-day window, every question shows up at least 2x per rolling 7 days.

export type QuestionType = "scale" | "text" | "short_text";

export interface CoachingQuestion {
  id: string;             // key in check_ins.extras
  label: string;          // question shown to the user
  helper: string;         // thought-provoking guidance
  placeholder?: string;
  type: QuestionType;
  scaleLabels?: [string, string, string]; // low / mid / high (for scale)
  /** If true, this is one of the 3 core Executive-tier questions. */
  core?: boolean;
}

export const COACHING_QUESTIONS: CoachingQuestion[] = [
  // ─── Core 3 (always shown for pro / premium / coach) ─────────────────────
  {
    id: "avoided_decision",
    type: "text",
    core: true,
    label: "What's one decision you know you need to make but haven't?",
    helper:
      "Avoidance leaks more energy than overwork. Name the decision, the deadline you keep moving, and what you're protecting yourself from by not deciding.",
    placeholder: "I keep avoiding deciding whether to…",
  },
  {
    id: "self_trust",
    type: "scale",
    core: true,
    label: "How much do you trust yourself to follow through on this week's commitments?",
    helper:
      "Be honest. Self-trust is built or eroded by what you do when no one's watching. A low score isn't bad — it's a signal to shrink the commitment, not bury it.",
    scaleLabels: ["🪫 Low — I'll probably slip", "⚖️ Mixed", "🔒 High — I'll do what I said"],
  },
  {
    id: "commitment_confidence",
    type: "scale",
    core: true,
    label: "How likely are you to actually do your 'one thing' this week?",
    helper:
      "Calibration matters more than optimism. We'll compare this number to what actually happens, week over week, so you learn how realistic your promises to yourself are.",
    scaleLabels: ["🌫️ Unlikely", "🤞 50/50", "💪 Almost certain"],
  },

  // ─── Premium rotating pool ───────────────────────────────────────────────
  {
    id: "energy_source",
    type: "short_text",
    label: "What gave you energy this week?",
    helper:
      "Specific moments, not categories. ('The 1:1 with Maya where she pushed back on the roadmap' — not 'good meetings'.) Patterns here tell us what to schedule more of.",
    placeholder: "The thing that lit me up was…",
  },
  {
    id: "energy_drain",
    type: "short_text",
    label: "What drained you this week?",
    helper:
      "Same rule — be specific. The recurring drains usually point to a boundary you haven't set or a decision you haven't made.",
    placeholder: "The thing that pulled the most energy was…",
  },
  {
    id: "relationship_pulse",
    type: "short_text",
    label: "Which relationship needs your attention this week?",
    helper:
      "Co-founder, partner, key team member, key client, family. Executives drift here first and notice last. Name one person and what's actually going on.",
    placeholder: "I need to give attention to…",
  },
  {
    id: "body_baseline",
    type: "scale",
    label: "How is your physical baseline (sleep, movement, recovery)?",
    helper:
      "Mood and energy without the body underneath is noise. Sleep, movement, alcohol, daylight — give yourself an honest 1–10 on how solid the foundation is right now.",
    scaleLabels: ["🛌 Depleted", "🚶 Steady", "🏔 Strong"],
  },
  {
    id: "belief_shift",
    type: "short_text",
    label: "Has anything you believed last week turned out to be wrong?",
    helper:
      "About a person, a market, a strategy, yourself. Updating your model of reality faster than other people is a competitive edge — but only if you actually name the update.",
    placeholder: "I used to think… but now I think…",
  },
  {
    id: "almost_did",
    type: "short_text",
    label: "What did you almost do — but didn't?",
    helper:
      "The opportunities you said no to (or the traps you avoided) are as revealing as what you did. What did you walk away from this week, and why?",
    placeholder: "I almost… but I chose not to because…",
  },
  {
    id: "week_ahead_dread",
    type: "short_text",
    label: "What's coming this week that you're dreading?",
    helper:
      "Naming the dread shrinks it. Be specific — a meeting, a conversation, a decision, a milestone. We'll come back to this in the next check-in.",
    placeholder: "I'm not looking forward to…",
  },
  {
    id: "strategic_time_pct",
    type: "scale",
    label: "What % of your week went to your strategic priority vs. reactive work?",
    helper:
      "Rough estimate is fine. 1 = almost entirely reactive (firefighting, inbox, meetings other people scheduled). 10 = almost entirely on your one thing. Most weeks land 3–6 — the goal is to know.",
    scaleLabels: ["🚒 Reactive", "⚖️ Split", "🎯 Strategic"],
  },
];

export const CORE_QUESTION_IDS = COACHING_QUESTIONS.filter((q) => q.core).map((q) => q.id);
export const ROTATING_QUESTION_IDS = COACHING_QUESTIONS.filter((q) => !q.core).map((q) => q.id);

export type Tier = "free" | "exec" | "premium" | "coach";

/**
 * Pick the questions to ask in this check-in based on the user's tier and
 * the recency map of when each question was last answered.
 *
 * @param tier         User's plan_tier
 * @param recencyDays  Map of questionId -> days since last answered (Infinity if never)
 * @param askedToday   Set of questionIds already asked in any of the last 1 day's check-ins
 *                     (used to avoid repeating the same group same-day if user re-opens)
 */
export function selectQuestionsForCheckIn(
  tier: Tier,
  recencyDays: Record<string, number>,
  recentGroups: string[][] = [], // last 7 days of asked groups (newest first), each sorted
): CoachingQuestion[] {
  if (tier === "free") return [];

  if (tier === "exec") {
    // Executive: always ask the core 3
    return COACHING_QUESTIONS.filter((q) => q.core);
  }

  // Premium / coach: smart rotation. Always include core 3 (they're the
  // highest-leverage signal) plus a variable number of rotating questions
  // chosen by staleness. Daily count adapts: pick more when the picture is
  // staler.
  const core = COACHING_QUESTIONS.filter((q) => q.core);

  // Score each rotating question by staleness — higher = more stale = pick it.
  const scored = ROTATING_QUESTION_IDS.map((id) => {
    const days = recencyDays[id];
    const staleness = days === undefined || !isFinite(days) ? 999 : days;
    return { id, staleness };
  }).sort((a, b) => b.staleness - a.staleness);

  // Adapt count based on staleness of the staleest item:
  //   very stale (>5d or never)  → 4 rotating
  //   moderately stale (3–5d)    → 3 rotating
  //   fresh (<3d)                → 2 rotating
  const topStale = scored[0]?.staleness ?? 0;
  const rotatingCount = topStale > 5 ? 4 : topStale >= 3 ? 3 : 2;

  // Greedy pick from staleest, but reject any pick that would reproduce a
  // group asked in the last 7 days (same exact set of rotating ids).
  const recentGroupKeys = new Set(recentGroups.map((g) => [...g].sort().join("|")));
  const pickedIds: string[] = [];
  for (const candidate of scored) {
    if (pickedIds.length >= rotatingCount) break;
    pickedIds.push(candidate.id);
  }
  // If the resulting group matches a recent group, swap the last pick with
  // the next-staleest unpicked candidate.
  // Track every id already tried so the swap walks forward through the
  // candidates instead of oscillating back to the one it just removed.
  const tried = new Set(pickedIds);
  while (pickedIds.length > 0 && recentGroupKeys.has([...pickedIds].sort().join("|"))) {
    const swapIn = scored.find((s) => !tried.has(s.id));
    if (!swapIn) break;
    tried.add(swapIn.id);
    pickedIds[pickedIds.length - 1] = swapIn.id;
  }

  const rotating = COACHING_QUESTIONS.filter((q) => pickedIds.includes(q.id));
  return [...core, ...rotating];
}

/**
 * Build the recencyDays map from the user's recent check-ins (newest first).
 */
export function buildRecencyMap(
  recentCheckIns: { created_at: string; extras: Record<string, unknown> | null }[],
): Record<string, number> {
  const now = Date.now();
  const map: Record<string, number> = {};
  for (const id of [...CORE_QUESTION_IDS, ...ROTATING_QUESTION_IDS]) {
    map[id] = Infinity;
  }
  for (const ci of recentCheckIns) {
    const ageDays = (now - new Date(ci.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const extras = ci.extras ?? {};
    for (const [k, v] of Object.entries(extras)) {
      if (v === null || v === undefined || v === "") continue;
      if (map[k] === undefined || ageDays < map[k]) map[k] = ageDays;
    }
  }
  return map;
}

/**
 * Extract the last 7 days of asked-question groups from recent check-ins.
 * A "group" is the set of rotating-question ids that have a value in that
 * check-in's extras.
 */
export function extractRecentGroups(
  recentCheckIns: { created_at: string; extras: Record<string, unknown> | null }[],
): string[][] {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return recentCheckIns
    .filter((ci) => new Date(ci.created_at).getTime() >= sevenDaysAgo)
    .map((ci) => {
      const extras = ci.extras ?? {};
      return Object.keys(extras).filter(
        (k) => ROTATING_QUESTION_IDS.includes(k) && extras[k] !== null && extras[k] !== "",
      );
    })
    .filter((g) => g.length > 0);
}
