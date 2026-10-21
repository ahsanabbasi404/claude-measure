import { parseFilters, type Filters } from "./filters";

export const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...init?.headers } });

export function requestFilters(req: Request): { f: Filters; params: URLSearchParams } {
  const params = new URL(req.url).searchParams;
  return { f: parseFilters(params), params };
}

export function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Filters spanning all stored data, for views of a single session or entity regardless of range. */
export function allTime(f: Filters): Filters {
  return { ...f, from: new Date(0), to: new Date(Date.now() + 86400_000), people: [], accounts: [], teams: [], models: [], clients: [] };
}

/** Route params may arrive encoded or decoded depending on the caller; decode once, safely. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
