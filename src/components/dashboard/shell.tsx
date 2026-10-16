"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ago } from "@/lib/format";
import { useNow } from "./hooks";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/setup", label: "Setup & devices" },
];

export function Shell({
  children,
  updatedAt,
  error,
  controls,
}: {
  children: ReactNode;
  updatedAt?: string;
  error?: string | null;
  controls?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const now = useNow();

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-hairline bg-page/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-6 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <rect x="1" y="9" width="3.5" height="8" rx="1" fill="var(--series)" opacity="0.45" />
              <rect x="7.25" y="5" width="3.5" height="12" rx="1" fill="var(--series)" opacity="0.7" />
              <rect x="13.5" y="1" width="3.5" height="16" rx="1" fill="var(--series)" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">Claude Code usage</span>
          </div>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted md:inline-flex" aria-live="polite">
              {error ? (
                <>
                  <span className="size-2 rounded-full bg-critical" /> <span className="text-critical">Update failed · retrying</span>
                </>
              ) : updatedAt ? (
                <>
                  <span className="live-dot size-2 rounded-full bg-good" /> Live · updated {ago(updatedAt, now)}
                </>
              ) : null}
            </span>
            {controls}
            <button onClick={signOut} className="rounded-md px-2 py-1.5 text-[13px] text-muted hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1320px] gap-1 px-4 pb-2 sm:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-2.5 py-1 text-[13px] ${pathname === n.href ? "bg-surface-2 text-ink" : "text-muted"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1320px] space-y-4 px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}
