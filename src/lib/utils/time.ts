const DURATION_REGEX = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i;

const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/**
 * Parses a human-readable duration string into milliseconds.
 * Supports: s, m, h, d, w (and their long forms).
 * @example parseDuration('1h') // 3600000
 * @example parseDuration('30m') // 1800000
 * @example parseDuration('7d') // 604800000
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  const match = DURATION_REGEX.exec(trimmed);

  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multiplier = UNIT_TO_MS[unit];

  if (!multiplier || value <= 0) return null;

  return value * multiplier;
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * @example formatDuration(5400000) // '1h 30m'
 * @example formatDuration(90061000) // '1d 1h 1m 1s'
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;

  const days = Math.floor(ms / 86_400_000);
  ms %= 86_400_000;

  const hours = Math.floor(ms / 3_600_000);
  ms %= 3_600_000;

  const minutes = Math.floor(ms / 60_000);
  ms %= 60_000;

  const seconds = Math.floor(ms / 1_000);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.length > 0 ? parts.join(' ') : '0s';
}

/**
 * Formats a Date object as a Discord relative timestamp.
 * @example formatRelative(new Date()) // '<t:1234567890:R>'
 */
export function formatRelative(date: Date): string {
  const unix = Math.floor(date.getTime() / 1_000);
  return `<t:${unix}:R>`;
}
