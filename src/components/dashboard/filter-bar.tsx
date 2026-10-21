"use client";

import { useState } from "react";
import { useFilters, useOptions, type MultiKey } from "./hooks";
import { clientLabel } from "./labels";
import { Popover } from "./ui";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const DIMENSIONS: { key: MultiKey; label: string; plural: string }[] = [
  { key: "person", label: "Person", plural: "people" },
  { key: "account", label: "Account", plural: "accounts" },
  { key: "team", label: "Team", plural: "teams" },
  { key: "model", label: "Model", plural: "models" },
  { key: "client", label: "Client", plural: "clients" },
];

function Chevron() {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-muted"><path d="m2.5 3.75 2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Check() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const triggerClass = (active: boolean) =>
  `inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
    active ? "bg-series-wash text-ink ring-1 ring-[color-mix(in_oklab,var(--series)_35%,transparent)]" : "bg-surface text-ink-2 shadow-panel hover:text-ink"
  }`;

export function rangeText(range: string, from: string | null, to: string | null) {
  if (range === "custom" && from && to) {
    const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return from === to ? f(from) : `${f(from)} – ${f(to)}`;
  }
  return PRESETS.find((p) => p.value === range)?.label ?? "Last 7 days";
}

function RangePicker() {
  const { state, set } = useFilters();
  const [from, setFrom] = useState(state.from ?? "");
  const [to, setTo] = useState(state.to ?? "");
  return (
    <Popover
      width={240}
      trigger={({ toggle, open }) => (
        <button onClick={toggle} aria-expanded={open} className={triggerClass(false)}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden className="text-muted"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          <span className="text-ink">{rangeText(state.range, state.from, state.to)}</span>
          <Chevron />
        </button>
      )}
    >
      {(close) => (
        <div>
          <ul role="listbox" aria-label="Time range">
            {PRESETS.map((p) => {
              const selected = state.range === p.value;
              return (
                <li key={p.value}>
                  <button
                    role="option"
                    aria-selected={selected}
                    onClick={() => { set({ range: p.value }); close(); }}
                    className={`flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-[13px] hover:bg-surface-2 ${selected ? "font-semibold text-ink" : "text-ink-2"}`}
                  >
                    {p.label}
                    {selected && <span className="text-series"><Check /></span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <form
            className="mt-1 border-t border-hairline px-2.5 pt-2.5 pb-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (from && to) {
                set({ range: "custom", from: from <= to ? from : to, to: from <= to ? to : from });
                close();
              }
            }}
          >
            <div className="text-[11px] font-medium text-muted">Custom range</div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md bg-page px-1.5 text-xs text-ink outline-none ring-1 ring-hairline focus:ring-series" />
              <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md bg-page px-1.5 text-xs text-ink outline-none ring-1 ring-hairline focus:ring-series" />
            </div>
            <button type="submit" disabled={!from || !to} className="mt-2 h-7 w-full rounded-md bg-ink text-xs font-medium text-page disabled:opacity-40">Apply</button>
          </form>
        </div>
      )}
    </Popover>
  );
}

function MultiSelect({ dim, items }: { dim: (typeof DIMENSIONS)[number]; items: { key: string; label: string; sub?: string | null }[] }) {
  const { state, set } = useFilters();
  const selected = state[dim.key];
  const [query, setQuery] = useState("");
  const shown = items.filter((i) => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (key: string) => set({ [dim.key]: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });
  const labelOf = (key: string) => items.find((i) => i.key === key)?.label ?? key;
  const text = selected.length === 0 ? dim.label : selected.length === 1 ? `${dim.label}: ${labelOf(selected[0])}` : `${dim.label} · ${selected.length}`;

  return (
    <Popover
      width={280}
      trigger={({ toggle: open, open: isOpen }) => (
        <button onClick={open} aria-expanded={isOpen} className={triggerClass(selected.length > 0)}>
          <span className="truncate">{text}</span>
          <Chevron />
        </button>
      )}
    >
      {() => (
        <div>
          {items.length > 6 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${dim.plural}`}
              className="mb-1 h-8 w-full rounded-md bg-page px-2.5 text-[13px] text-ink outline-none ring-1 ring-hairline focus:ring-series"
            />
          )}
          <ul className="max-h-[300px] overflow-y-auto" role="listbox" aria-multiselectable aria-label={dim.label}>
            {shown.map((i) => {
              const on = selected.includes(i.key);
              return (
                <li key={i.key}>
                  <button
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(i.key)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span className={`grid size-4 shrink-0 place-items-center rounded-[4px] ring-1 ${on ? "bg-series text-white ring-series" : "ring-axis"}`}>
                      {on && <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{i.label}</span>
                      {i.sub && <span className="block truncate text-[11px] text-muted">{i.sub}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2.5 py-3 text-xs text-muted">No matches</li>}
          </ul>
          {selected.length > 0 && (
            <div className="mt-1 border-t border-hairline pt-1">
              <button onClick={() => set({ [dim.key]: null })} className="h-7 w-full rounded-md px-2.5 text-left text-xs text-muted hover:bg-surface-2 hover:text-ink">
                Clear {dim.label.toLowerCase()} filter
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

/** One row of filters scoping everything below. `hide` drops filters that a detail page already fixes. */
export function FilterBar({ hide = [] }: { hide?: MultiKey[] }) {
  const { data: options } = useOptions();
  const { activeCount, clearDimensions, state } = useFilters();
  const itemsFor = (key: MultiKey) => {
    if (!options) return [];
    switch (key) {
      case "person": return options.people.map((p) => ({ key: p.key, label: p.key, sub: p.team }));
      case "account": return options.accounts.map((a) => ({ key: a.key, label: a.key }));
      case "team": return options.teams.map((t) => ({ key: t.key, label: t.key }));
      case "model": return options.models.map((m) => ({ key: m.key, label: m.label, sub: m.key }));
      case "client": return options.clients.map((c) => ({ key: c.key, label: clientLabel(c.key) }));
    }
  };
  const hiddenActive = hide.reduce((n, k) => n + state[k].length, 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RangePicker />
      <span className="mx-1 hidden h-5 w-px bg-hairline sm:block" />
      {DIMENSIONS.filter((d) => !hide.includes(d.key) && (d.key !== "team" || (options?.teams.length ?? 0) > 1)).map((d) => (
        <MultiSelect key={d.key} dim={d} items={itemsFor(d.key)} />
      ))}
      {activeCount - hiddenActive > 0 && (
        <button onClick={clearDimensions} className="h-8 rounded-[7px] px-2 text-xs text-muted hover:text-ink">Clear filters</button>
      )}
    </div>
  );
}

