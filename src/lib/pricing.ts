import { db } from "./db";

/*
 * Claude Code reports cost_usd on every api_request from its own price table, so new models are
 * priced as soon as clients update. This module is the fallback for requests without cost_usd:
 * prices are synced daily from LiteLLM's public model list into model_prices.
 */

const PRICE_SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

type Price = {
  model: string;
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
};

type LiteLlmEntry = {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
};

const perMtok = (v: number | undefined) => (typeof v === "number" ? v * 1e6 : null);

export async function syncModelPrices(): Promise<number> {
  const res = await fetch(PRICE_SOURCE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`price source returned HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, LiteLlmEntry>;
  const rows = Object.entries(data)
    .filter(([name, e]) => e.litellm_provider === "anthropic" && name.startsWith("claude"))
    .map(([name, e]) => ({
      model: name,
      input_per_mtok: perMtok(e.input_cost_per_token),
      output_per_mtok: perMtok(e.output_cost_per_token),
      cache_read_per_mtok: perMtok(e.cache_read_input_token_cost),
      cache_write_per_mtok: perMtok(e.cache_creation_input_token_cost),
      source: "litellm",
    }));
  if (rows.length === 0) return 0;
  const sql = db();
  await sql`
    INSERT INTO model_prices ${sql(rows)}
    ON CONFLICT (model) DO UPDATE SET
      input_per_mtok = EXCLUDED.input_per_mtok,
      output_per_mtok = EXCLUDED.output_per_mtok,
      cache_read_per_mtok = EXCLUDED.cache_read_per_mtok,
      cache_write_per_mtok = EXCLUDED.cache_write_per_mtok,
      source = EXCLUDED.source,
      updated_at = now()
    WHERE model_prices.source = 'litellm'`;
  priceCache = null;
  return rows.length;
}

let priceCache: { at: number; prices: Price[] } | null = null;

async function loadPrices(): Promise<Price[]> {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.prices;
  const prices = await db()<Price[]>`
    SELECT model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok FROM model_prices`;
  priceCache = { at: Date.now(), prices };
  return prices;
}

/** Exact match first, then the longest known model id that prefixes the requested one (dated variants). */
function findPrice(prices: Price[], model: string): Price | undefined {
  const exact = prices.find((p) => p.model === model);
  if (exact) return exact;
  return prices
    .filter((p) => model.startsWith(p.model) || p.model.startsWith(model))
    .sort((a, b) => b.model.length - a.model.length)[0];
}

type CostRow = {
  event_name: string;
  model: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  attrs: Record<string, unknown>;
};

/** Fills cost_usd on api_request rows that arrived without it. Never overrides a client-reported cost. */
export async function fillMissingCosts(rows: CostRow[]): Promise<void> {
  const missing = rows.filter((r) => r.event_name === "api_request" && r.cost_usd === null && r.model);
  if (missing.length === 0) return;
  let prices: Price[];
  try {
    prices = await loadPrices();
  } catch {
    return;
  }
  for (const r of missing) {
    const p = findPrice(prices, r.model!);
    if (!p) continue;
    r.cost_usd =
      ((r.input_tokens ?? 0) * (p.input_per_mtok ?? 0) +
        (r.output_tokens ?? 0) * (p.output_per_mtok ?? 0) +
        (r.cache_read_tokens ?? 0) * (p.cache_read_per_mtok ?? 0) +
        (r.cache_creation_tokens ?? 0) * (p.cache_write_per_mtok ?? 0)) /
      1e6;
    r.attrs = { ...r.attrs, "ccm.cost_source": `fallback:${p.model}` };
  }
}
