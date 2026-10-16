const integer = new Intl.NumberFormat("en-US");

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return integer.format(Math.round(n));
}

export function usd(n: number): string {
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.01) return "<$0.01";
  if (Math.abs(n) >= 1000) return `$${compact(n)}`;
  return `$${n.toFixed(2)}`;
}

export const int = (n: number) => integer.format(Math.round(n));

export function percent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

export const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export function duration(seconds = 0): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Relative time against an explicit clock so rendering stays pure. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function resetsIn(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const s = (Date.parse(iso) - now) / 1000;
  if (s <= 0) return "reset";
  if (s < 3600) return `resets in ${Math.round(s / 60)}m`;
  if (s < 86400) return `resets in ${Math.round(s / 3600)}h`;
  return `resets in ${Math.round(s / 86400)}d`;
}

export const shortModel = (m: string) => m.replace(/^claude-/, "");
