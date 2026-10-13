import { differenceInCalendarDays, startOfDay } from "date-fns";

/**
 * Consecutive local calendar days with at least one check-in, ending today or
 * yesterday. Several check-ins on one day count once, and an old run of
 * check-ins is not a current streak.
 */
export function calculateDayStreak(createdAts: string[], now = new Date()): number {
  const days = [...new Set(
    createdAts
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .map((date) => startOfDay(date).getTime()),
  )].sort((a, b) => b - a);
  if (days.length === 0 || differenceInCalendarDays(now, days[0]) > 1) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (differenceInCalendarDays(days[i - 1], days[i]) !== 1) break;
    streak++;
  }
  return streak;
}
