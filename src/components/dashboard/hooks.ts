"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Range, Stats } from "./types";

export const REFRESH_MS = 10_000;

class UnauthorizedError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function useAuthedQuery<T>(key: unknown[], url: string) {
  const router = useRouter();
  const query = useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      try {
        return await getJson<T>(url);
      } catch (err) {
        if (err instanceof UnauthorizedError) router.replace("/login");
        throw err;
      }
    },
    refetchInterval: REFRESH_MS,
    placeholderData: (prev) => prev,
  });
  return query;
}

export const useStats = (range: Range) => useAuthedQuery<Stats>(["stats", range], `/api/stats?range=${range}`);

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
