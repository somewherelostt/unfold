import { PublishingError, type Schedule, type ScheduleInput } from "./types.ts";

function formatter(zone: string) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { throw new PublishingError("INVALID_TIMEZONE", "Choose a valid time zone."); }
}
function parts(at: number, format: Intl.DateTimeFormat) {
  const p = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function localEpoch(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new PublishingError("INVALID_TIME", "Choose a date and time to the nearest minute.");
  const value = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 16) !== local) throw new PublishingError("INVALID_TIME", "Choose a valid date and time.");
  return value;
}
/** Resolve wall time without relying on the browser or worker's host time zone. */
export function resolveSchedule(input: ScheduleInput, now = Date.now()): Schedule {
  if (input.mode === "now") return { mode: "now", at: now, timeZone: "UTC", localDateTime: new Date(now).toISOString().slice(0, 16), offsetMinutes: 0 };
  if (input.mode !== "scheduled" || typeof input.timeZone !== "string" || typeof input.localDateTime !== "string") throw new PublishingError("INVALID_TIME", "Choose a publication time.");
  const format = formatter(input.timeZone), naive = localEpoch(input.localDateTime);
  const offsets = new Set<number>();
  // Sample both sides of any transition; supports non-hour offsets and half-hour DST.
  for (let delta = -36; delta <= 36; delta += 3) {
    const probe = naive + delta * 3_600_000;
    offsets.add((localEpoch(parts(probe, format)) - probe) / 60_000);
  }
  const candidates = [...offsets].map((offset) => ({ at: naive - offset * 60_000, offset })).filter(({ at }) => parts(at, format) === input.localDateTime).sort((a, b) => a.at - b.at);
  if (!candidates.length) throw new PublishingError("TIME_DOES_NOT_EXIST", "This local time is skipped when the clocks change. Choose another time.");
  if (candidates.length > 1 && !["earlier", "later"].includes(input.disambiguation ?? "")) throw new PublishingError("TIME_IS_AMBIGUOUS", "This time occurs twice when the clocks change. Choose the earlier or later occurrence.");
  const chosen = candidates[input.disambiguation === "later" ? candidates.length - 1 : 0];
  if (chosen.at < now + 60_000) throw new PublishingError("TIME_TOO_SOON", "Schedule at least one minute from now.");
  if (chosen.at > now + 365 * 86_400_000) throw new PublishingError("TIME_TOO_FAR", "Choose a date within the next year.");
  return { mode: "scheduled", at: chosen.at, timeZone: format.resolvedOptions().timeZone, localDateTime: input.localDateTime, offsetMinutes: chosen.offset };
}
