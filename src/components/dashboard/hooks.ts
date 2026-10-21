"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Options } from "./types";

export const REFRESH_MS = 15_000;

/** URL parameters that scope data on every page. */
export const FILTER_KEYS = ["range", "from", "to", "person", "account", "team", "model", "client"] as const;
export type MultiKey = "person" | "account" | "team" | "model" | "client";
export const MULTI_KEYS: MultiKey[] = ["person", "account", "team", "model", "client"];

class UnauthorizedError extends Error {}

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** The current filter part of the URL, normalized so equal filters share one cache entry. */
export function useFilterQuery(): string {
  const params = useSearchParams();
  return useMemo(() => {
    const out = new URLSearchParams();
    for (const key of FILTER_KEYS) for (const v of [...params.getAll(key)].sort()) out.append(key, v);
    return out.toString();
  }, [params]);
}

export function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useFilterQuery();

  const state = useMemo(() => ({
    range: params.get("range") ?? "7d",
    from: params.get("from"),
    to: params.get("to"),
    person: params.getAll("person"),
    account: params.getAll("account"),
    team: params.getAll("team"),
    model: params.getAll("model"),
    client: params.getAll("client"),
  }), [params]);

  const set = useCallback((patch: Partial<Record<string, string | string[] | null>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value) next.set(key, value);
    }
    if (next.get("range") === "7d") next.delete("range");
    if (next.get("range") !== "custom") {
      next.delete("from");
      next.delete("to");
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const clearDimensions = useCallback(() => set(Object.fromEntries(MULTI_KEYS.map((k) => [k, null]))), [set]);

  /** Link to another page keeping the current filters. */
  const href = useCallback((path: string, extra?: Record<string, string>) => {
    const qs = new URLSearchParams(query);
    for (const [k, v] of Object.entries(extra ?? {})) qs.set(k, v);
    const s = qs.toString();
    return s ? `${path}?${s}` : path;
  }, [query]);

  const activeCount = MULTI_KEYS.reduce((n, k) => n + state[k].length, 0);
  return { state, set, clearDimensions, href, query, activeCount };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Fetches an analytics endpoint with the current filters, polling for live updates. */
export function useApi<T>(path: string | null, extra: Record<string, string> = {}) {
  const router = useRouter();
  const filters = useFilterQuery();
  const extraQs = new URLSearchParams(extra).toString();
  return useQuery<T>({
    queryKey: [path, filters, extraQs],
    enabled: path !== null,
    queryFn: async () => {
      const qs = new URLSearchParams(filters);
      qs.set("tz", timeZone());
      for (const [k, v] of Object.entries(extra)) qs.set(k, v);
      try {
        return await getJson<T>(`${path}?${qs}`);
      } catch (err) {
        if (err instanceof UnauthorizedError) router.replace("/login");
        throw err;
      }
    },
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/** Filter choices and the stable entity order used for colors. */
export function useOptions() {
  return useQuery<Options>({
    queryKey: ["options"],
    queryFn: () => getJson<Options>("/api/options"),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ---------------------------------------------------------------- shared clock
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  timer ??= setInterval(() => listeners.forEach((l) => l()), 1000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const snapshot = () => Math.floor(Date.now() / 1000) * 1000;

/** Current time, updated every second; keeps relative timestamps fresh without impure renders. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

/** Route segment value, decoded once; tolerates values that are already decoded. */
export function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
