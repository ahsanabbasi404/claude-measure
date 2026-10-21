"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ago } from "@/lib/format";
import { FilterBar } from "./filter-bar";
import { useFilters, useNow, type MultiKey } from "./hooks";

const NAV = [
  { href: "/", label: "Overview", icon: "M2.5 9.5h3v4h-3zM6.5 5.5h3v8h-3zM10.5 2.5h3v11h-3z" },
  { href: "/people", label: "People", icon: "M5.5 7a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4M11 7a1.75 1.75 0 1 0 0-3.5M11.5 9.6c1.7.3 3 1.8 3 3.9" },
  { href: "/accounts", label: "Accounts", icon: "M2 4.5h12v8H2zM2 7h12M4.5 10h3" },
  { href: "/sessions", label: "Sessions", icon: "M2.5 3.5h11M2.5 8h11M2.5 12.5h7" },
  { href: "/activity", label: "Activity", icon: "M1.5 8h3l2-5 3 10 2-5h3" },
  { href: "/setup", label: "Setup & devices", icon: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="9" width="3.5" height="8" rx="1" fill="var(--series)" opacity="0.45" />
      <rect x="7.25" y="5" width="3.5" height="12" rx="1" fill="var(--series)" opacity="0.7" />
      <rect x="13.5" y="1" width="3.5" height="16" rx="1" fill="var(--series)" />
    </svg>
  );
}

export function Shell({
  children,
  updatedAt,
  error,
  refreshing,
  filters = true,
  hideFilters,
}: {
  children: ReactNode;
  updatedAt?: string;
  error?: string | null;
  refreshing?: boolean;
  filters?: boolean;
  hideFilters?: MultiKey[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const now = useNow();
  const { href } = useFilters();

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  }

  const isActive = (h: string) => (h === "/" ? pathname === "/" : pathname.startsWith(h));
  const status = (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
      {error ? (
        <><span className="size-2 rounded-full bg-critical" /><span className="text-critical">Update failed · retrying</span></>
      ) : updatedAt ? (
        <><span className="live-dot size-2 rounded-full bg-good" />Live · {ago(updatedAt, now)}</>
      ) : (
        <><span className="size-2 rounded-full bg-axis" />Loading…</>
      )}
    </span>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[216px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-hairline px-3 py-4 lg:flex">
        <div className="flex items-center gap-2 px-2.5 pb-5">
          <Logo />
          <span className="text-sm font-semibold tracking-tight">Claude Code usage</span>
        </div>
        <nav className="space-y-0.5" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href === "/setup" ? n.href : href(n.href)}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors ${
                isActive(n.href) ? "bg-surface font-medium text-ink shadow-panel" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <NavIcon d={n.icon} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-2.5">
          {status}
          <button onClick={signOut} className="block text-xs text-muted hover:text-ink">Sign out</button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-hairline bg-page/90 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center gap-2 px-4">
            <Logo />
            <span className="text-sm font-semibold">Claude Code usage</span>
            <span className="ml-auto">{status}</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-2" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href === "/setup" ? n.href : href(n.href)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-[13px] ${isActive(n.href) ? "bg-surface font-medium text-ink shadow-panel" : "text-muted"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>

        {filters && (
          <div className="sticky top-0 z-20 border-b border-hairline bg-page/90 backdrop-blur max-lg:static">
            <div className="mx-auto max-w-[1400px] px-4 py-2.5 sm:px-6">
              <FilterBar hide={hideFilters} />
            </div>
          </div>
        )}
        <main className={`mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6 ${refreshing ? "is-refetching" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
