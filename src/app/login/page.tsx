"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Sign-in failed");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-[12px] bg-surface p-6 shadow-panel">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <rect x="1" y="9" width="3.5" height="8" rx="1" fill="var(--series)" opacity="0.45" />
            <rect x="7.25" y="5" width="3.5" height="12" rx="1" fill="var(--series)" opacity="0.7" />
            <rect x="13.5" y="1" width="3.5" height="16" rx="1" fill="var(--series)" />
          </svg>
          <h1 className="text-sm font-semibold">Claude Code usage</h1>
        </div>
        <label htmlFor="password" className="mt-6 block text-xs font-medium text-ink-2">
          Dashboard password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 h-9 w-full rounded-md border border-hairline bg-page px-3 text-sm outline-none focus:border-series"
        />
        {error && <p className="mt-2 text-xs text-critical" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 h-9 w-full rounded-md bg-ink text-sm font-medium text-page transition-opacity disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
