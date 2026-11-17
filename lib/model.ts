// The token radar's peer-implied model: one sealed snapshot in, one ranked board out.
//
// The board ranks every rankable protocol that records no token: the snapshot's whole watchlist
// (the floor, never a ceiling) plus every other rankable protocol below it. A protocol is
// pre-token when its record carries no market cap, no CoinGecko id and no symbol; the live-token
// protocols are kept apart as the peer set the curve is fitted on, never mixed into the board.
//
// The peer-implied value is a peer-derived circulating-market-cap proxy, never a predicted launch
// price or an FDV: the snapshot carries no FDV field, and the output says so. It follows only from
// the snapshot's own figures, through a size curve fitted on the peers:
//
//   curve      = OLS of log(market cap) on log(TVL) over the winsorized peers
//   multiple   = the curve's implied mcap/TVL multiple at the protocol's TVL, bounded [0.01, 10]
//   survivor   = SURVIVOR_DISCOUNT, an explicit haircut for survivorship in the peer set
//   implied    = max(1, round(tvl_usd x multiple x survivor))
//
// Low and high shift the fitted log value by the first and third quartiles of the fit's own
// log residuals, so the range is the middle half of peer outcomes around the curve. Every
// constant lives in MODEL, the one place the dashboard's sandbox edits. No protocol name is
// ever special-cased: the same functions score every row.
//
// The curve was CHOSEN, not assumed: a twelve-variant sweep scores every candidate — the old
// shrunk-median model at several shrinkages, tercile/category/global medians, and the size
// curve, with and without the growth/maturity/breadth adjustments — under the same
// leave-one-out blind test, and the lowest median absolute log error wins. The adjustments
// lost: every adjusted variant scored worse than its unadjusted twin, so the shipped model
// carries none of them. The sweep table ships in the dashboard data, and the chosen variant's
// blind-test score is labeled a selection score, not an unbiased generalization estimate.
//
// Two additions ride on the same pipeline without changing the ranking. The leave-one-out blind
// test holds each of the 118 peers out in turn, refits the curve from the other 117, and
// predicts the held-out protocol's market cap with the same pipeline — but without the
// survivor discount, a pre-token haircut that would bias predictions of traded tokens down —
// against two baselines, a flat 0.25x multiple and the global-median multiple. Re-ranking the
// full board under each of the 118 refits gives every row a rank range. And each row carries a
// farm verdict (FARM / THIN / SKIP) from stated sunk-cost assumptions netted against an assumed
// claimable slice of the low end: an assumption-based label, never an expected return, with
// capital excluded because capital is recoverable and only sunk costs are netted.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One maturity band: protocols up to `max_days` old take `factor`; a null cap is the last band. */
export interface MaturityBand {
  max_days: number | null;
  factor: number;
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrinkage_k: number;
  shrinkage_min_cell: number;
  winsor_low: number;
  winsor_high: number;
  multiple_floor: number;
  multiple_cap: number;
  survivor_discount: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_bands: MaturityBand[];
  unknown_age_factor: number;
  chain_coefficient: number;
  adjustment_floor: number;
  adjustment_cap: number;
  confidence_high_n: number;
  confidence_high_iqr_ratio: number;
  confidence_medium_n: number;
  /** Assumed sunk cost of one transaction per fee tier, in USD: planning assumptions, not live quotes. */
  verdict_tx_cost: Record<FeeTier, number>;
  /** A bridge is assumed to cost this many times one transaction on the same chain. */
  verdict_bridge_multiplier: number;
  /** The assumed claimable slice of the low end a farmer captures: a planning assumption, not a promise. */
  verdict_capture_share: number;
  /** A row is FARM when net_low / sunk cost is above this ratio. */
  verdict_farm_ratio: number;
  /** A row is THIN when net_low / sunk cost is at or above this ratio (and at most the FARM ratio). */
  verdict_thin_ratio: number;
}

/** The model's constants: the single place every assumption is defined. */
export const MODEL: ModelConstants = {
  shrinkage_k: 10,
  shrinkage_min_cell: 3,
  winsor_low: 0.05,
  winsor_high: 0.95,
  multiple_floor: 0.01,
  multiple_cap: 10,
  survivor_discount: 0.85,
  growth_weight: 0.25,
  growth_floor: -0.5,
  growth_cap: 0.5,
  maturity_bands: [
    { max_days: 89, factor: 0.75 },
    { max_days: 180, factor: 0.85 },
    { max_days: 365, factor: 0.92 },
    { max_days: 730, factor: 0.97 },
    { max_days: null, factor: 1.0 },
  ],
  unknown_age_factor: 0.92,
  chain_coefficient: 0.04,
  adjustment_floor: 0.7,
  adjustment_cap: 1.3,
  confidence_high_n: 10,
  confidence_high_iqr_ratio: 1,
  confidence_medium_n: 4,
  verdict_tx_cost: { A: 0.05, B: 0.5, C: 5 },
  verdict_bridge_multiplier: 2,
  verdict_capture_share: 0.0001,
  verdict_farm_ratio: 10,
  verdict_thin_ratio: 1,
};

/** The starter's published constants, carried so the page can rank every row under both models. */
export const STARTER = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peer-radar-2';

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A fee tier: the planning assumption for one transaction's cost on a chain, never a live quote. */
export type FeeTier = 'A' | 'B' | 'C';

/** What each fee tier means, in the words the dashboard states beside every farm plan. */
export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  A: 'about cents per transaction',
  B: 'about dimes to a dollar per transaction',
  C: 'several dollars per transaction',
};

/**
 * The static fee-tier map: chains whose tier is stated, by the name DefiLlama writes. Every chain
 * not named here defaults to tier B, and the dashboard says so. A planning assumption, editable in
 * the sandbox, never a live quote.
 */
export const FEE_TIER_CHAINS: Array<{ chain: string; tier: FeeTier }> = [
  { chain: 'Ethereum', tier: 'C' },
  { chain: 'Bitcoin', tier: 'C' },
  { chain: 'Solana', tier: 'A' },
  { chain: 'Base', tier: 'A' },
  { chain: 'Arbitrum', tier: 'A' },
  { chain: 'Optimism', tier: 'A' },
  { chain: 'Polygon', tier: 'A' },
  { chain: 'Linea', tier: 'A' },
  { chain: 'Scroll', tier: 'A' },
  { chain: 'zkSync Era', tier: 'A' },
  { chain: 'Sui', tier: 'A' },
  { chain: 'Aptos', tier: 'A' },
  { chain: 'Near', tier: 'A' },
  { chain: 'Sei', tier: 'A' },
  { chain: 'Sonic', tier: 'A' },
  { chain: 'Berachain', tier: 'A' },
  { chain: 'Mantle', tier: 'A' },
  { chain: 'Monad', tier: 'A' },
  { chain: 'Hyperliquid L1', tier: 'A' },
  { chain: 'Unichain', tier: 'A' },
  { chain: 'Celo', tier: 'A' },
  { chain: 'xDai', tier: 'A' },
  { chain: 'Starknet', tier: 'A' },
  { chain: 'Blast', tier: 'A' },
  { chain: 'Mode', tier: 'A' },
  { chain: 'Zora', tier: 'A' },
  { chain: 'World Chain', tier: 'A' },
  { chain: 'Ink', tier: 'A' },
  { chain: 'Fraxtal', tier: 'A' },
  { chain: 'Metis', tier: 'A' },
  { chain: 'Polygon zkEVM', tier: 'A' },
  { chain: 'Arbitrum Nova', tier: 'A' },
  { chain: 'Abstract', tier: 'A' },
  { chain: 'ApeChain', tier: 'A' },
  { chain: 'Katana', tier: 'A' },
  { chain: 'Plume Mainnet', tier: 'A' },
  { chain: 'Hemi', tier: 'A' },
  { chain: 'Op_Bnb', tier: 'A' },
  { chain: 'Taiko', tier: 'A' },
  { chain: 'Morph', tier: 'A' },
  { chain: 'Soneium', tier: 'A' },
  { chain: 'MegaETH', tier: 'A' },
  { chain: 'BOB', tier: 'A' },
  { chain: 'Manta', tier: 'A' },
  { chain: 'Moonriver', tier: 'A' },
  { chain: 'Aurora', tier: 'A' },
  { chain: 'Fuse', tier: 'A' },
  { chain: 'Canto', tier: 'A' },
  { chain: 'Kroma', tier: 'A' },
  { chain: 'Zircuit', tier: 'A' },
  { chain: 'Swellchain', tier: 'A' },
  { chain: 'X Layer', tier: 'A' },
  { chain: 'Astar zkEVM', tier: 'A' },
  { chain: 'Immutable zkEVM', tier: 'A' },
  { chain: 'Eclipse', tier: 'A' },
  { chain: 'LightLink', tier: 'A' },
  { chain: 'Mint', tier: 'A' },
  { chain: 'Gravity', tier: 'A' },
  { chain: 'Cronos zkEVM', tier: 'A' },
  { chain: 'Boba', tier: 'A' },
  { chain: 'Boba_Bnb', tier: 'A' },
  { chain: 'Boba_Avax', tier: 'A' },
  { chain: 'Degen', tier: 'A' },
  { chain: 'Zkfair', tier: 'A' },
  { chain: 'PGN', tier: 'A' },
  { chain: 'Palm', tier: 'A' },
  { chain: 'MetalL2', tier: 'A' },
  { chain: 'Lens', tier: 'A' },
  { chain: 'Doma', tier: 'A' },
  { chain: 'Hedera', tier: 'A' },
  { chain: 'Algorand', tier: 'A' },
  { chain: 'Stellar', tier: 'A' },
  { chain: 'Ripple', tier: 'A' },
  { chain: 'Klaytn', tier: 'A' },
  { chain: 'Evmos', tier: 'A' },
  { chain: 'Conflux', tier: 'A' },
  { chain: 'IoTeX', tier: 'A' },
  { chain: 'Oasis', tier: 'A' },
];

/** The tier a chain falls back to when the map names no tier for it. */
export const FEE_TIER_DEFAULT: FeeTier = 'B';

/** One row's model breakdown: every number behind its peer-implied value, for the waterfall view. */
export interface ModelBreakdown {
  peer_multiple: number;
  multiple_low: number;
  multiple_high: number;
  survivor_discount: number;
  comp_n: number;
  /** The interquartile range of the curve fit's log residuals: the spread the range comes from. */
  resid_iqr: number;
  confidence: 'High' | 'Medium' | 'Low';
  flags: string[];
}

/** A farm verdict: FARM, THIN or SKIP, from the stated sunk-cost assumptions — never an expected return. */
export type FarmVerdict = 'FARM' | 'THIN' | 'SKIP';

/** The inputs behind one row's farm verdict, so the page can show the arithmetic whole. */
export interface VerdictInputs {
  sunk_cost_usd: number;
  per_tx_usd: number;
  fee_tier: FeeTier | null;
  tier_defaulted: boolean;
  capture_share: number;
  net_low_usd: number;
  ratio: number;
  /** The slice of the low end a farmer must capture to break even: sunk cost / low end. */
  breakeven_share: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  rank_range: [number, number];
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
  farm_verdict: FarmVerdict;
  verdict_inputs: VerdictInputs;
}

/** A farm plan's structured facts: what the page's Farm Planner computes its totals from. */
export interface FarmFacts {
  chain: string | null;
  fee_tier: FeeTier | null;
  capital_tier: 'Low' | 'Medium' | 'High';
  hold_days: number;
  tx_min: number;
  tx_max: number;
  tx_weekly: number;
  bridge_tx: number;
}

/** The dashboard's view of one row, with its farm plan and the numbers behind it. */
export interface RadarRow {
  rank: number;
  rank_range: [number, number];
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
  farm: FarmFacts;
  farm_verdict: FarmVerdict;
  verdict_inputs: VerdictInputs;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One comparable in the dashboard's comps view, with its winsorized multiple. */
export interface CompRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** One category's peer evidence: its comps and its quartiles. */
export interface CategoryComps {
  category: string;
  n: number;
  median: number;
  q1: number;
  q3: number;
  comps: CompRow[];
}

/** The fitted size curve: OLS of log market cap on log TVL over the winsorized peers. */
export interface CurveFit {
  intercept: number;
  slope: number;
  resid_q1: number;
  resid_q3: number;
  resid_iqr: number;
  tvl_min: number;
  tvl_max: number;
  n: number;
}

/** One sweep variant's blind-test score: every candidate tried, none dropped silently. */
export interface SweepVariantResult {
  name: string;
  median_abs_log_error: number;
  median_abs_pct_error: number;
  win_vs_flat: number;
  win_vs_global: number;
  beats_both: boolean;
}

/** One baseline in the blind test: its errors, and how often the model's prediction beat it. */
export interface BaselineResult {
  name: string;
  median_abs_log_error: number;
  median_abs_pct_error: number;
  model_win_rate: number;
}

/** One held-out peer's blind-test prediction, for the dashboard's detail table. */
export interface BlindTestRow {
  slug: string;
  name: string;
  actual_mcap_usd: number;
  predicted_mcap_usd: number;
  flat_mcap_usd: number;
  global_mcap_usd: number;
  abs_log_error: number;
}

/** The leave-one-out blind test over the peer set: the model predicting traded tokens it never saw. */
export interface ValidationResult {
  n: number;
  median_abs_log_error: number;
  median_abs_pct_error: number;
  baselines: BaselineResult[];
  per_comp: BlindTestRow[];
}

/** Everything the dashboard needs: the board, the peer evidence, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  starter: typeof STARTER;
  model_version: string;
  validation: ValidationResult;
  sweep: SweepVariantResult[];
  curve: CurveFit;
  counts: {
    protocols: number;
    watchlist: number;
    board: number;
    early: number;
    live: number;
    comps: number;
    no_token_recorded: number;
    ambiguous: number;
  };
  global: {
    n: number;
    median: number;
    q1: number;
    q3: number;
    winsor_low: number;
    winsor_high: number;
    tercile_cuts: [number, number];
  };
  chain_correlation: { r: number | null; n: number };
  fee_tiers: {
    labels: Record<FeeTier, string>;
    default: FeeTier;
    chains: Array<{ chain: string; tier: FeeTier }>;
    note: string;
  };
  categories: CategoryComps[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The p-th quantile of a sorted-ascending array, by linear interpolation. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = p * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const low = sorted[lo]!;
  const high = sorted[hi]!;
  return low + (high - low) * (at - lo);
}

/** A group's quartiles and median from its values. */
interface LevelStats {
  n: number;
  median: number;
  q1: number;
  q3: number;
}

function statsOf(values: number[]): LevelStats {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75) };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A chain name reduced to its lookup form: lower case, one space between words. */
function normalizeChain(chain: string): string {
  return chain.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A protocol's chains with duplicates (by normalized name) removed, in first-seen order. */
export function distinctChains(chains: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chains) {
    const key = normalizeChain(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const FEE_TIER_LOOKUP = new Map(FEE_TIER_CHAINS.map((e) => [normalizeChain(e.chain), e.tier]));

/** The fee tier of one chain: the map's, or the default when the map names none. */
export function feeTierOf(chain: string): FeeTier {
  return FEE_TIER_LOOKUP.get(normalizeChain(chain)) ?? FEE_TIER_DEFAULT;
}

/** The cheapest chain a protocol runs on: the lowest tier, ties to the first chain named. */
export function preferredChain(p: SnapshotProtocol): { chain: string; tier: FeeTier } | null {
  const chains = distinctChains(p.chains);
  if (chains.length === 0) return null;
  let best = chains[0]!;
  let bestTier = feeTierOf(best);
  for (const c of chains.slice(1)) {
    const tier = feeTierOf(c);
    if (tier < bestTier) {
      best = c;
      bestTier = tier;
    }
  }
  return { chain: best, tier: bestTier };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol's token record is ambiguous: no market cap, but a CoinGecko id or a symbol. */
export function isAmbiguous(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null);
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a protocol is a peer: a live token with a usable market cap and TVL, not an exchange pool. */
export function isComp(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    Number.isFinite(p.mcap_usd) &&
    p.category !== 'CEX' &&
    !VERSIONED.test(p.name)
  );
}

/** A peer with its multiple, winsorized at the global percentiles. */
interface CompRecord {
  protocol: SnapshotProtocol;
  multiple: number;
  tercile: number;
}

/** The peer set's statistics: global, per category, and per category-by-size cell. */
interface CompStats {
  comps: CompRecord[];
  global: LevelStats;
  winsorLow: number;
  winsorHigh: number;
  tercileCuts: [number, number];
  byCategory: Map<string, LevelStats>;
  byCell: Map<string, LevelStats>;
  byTercile: Map<number, LevelStats>;
  curve: CurveFit;
  chainCorrelation: { r: number | null; n: number };
}

const cellKey = (category: string, tercile: number): string => JSON.stringify([category, tercile]);

/** The TVL tercile a value falls in: 0 below the first cut, 1 between the cuts, 2 above the second. */
function tercileOf(tvl: number, cuts: [number, number]): number {
  return tvl <= cuts[0] ? 0 : tvl <= cuts[1] ? 1 : 2;
}

/** Pearson's r for paired values, or null when either side never varies. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * The peer set's statistics from the snapshot: winsorized multiples, the global and per-category
 * quartiles, the size terciles, and the chain-count correlation the methodology panel reports.
 * `excludeSlug` holds one peer out, so the blind test can rebuild the statistics without it.
 */
function buildCompStats(snapshot: Snapshot, model: ModelConstants, excludeSlug?: string): CompStats {
  const peers = snapshot.protocols.filter(isComp).filter((p) => p.slug !== excludeSlug);
  const raw = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const winsorLow = quantile(raw, model.winsor_low);
  const winsorHigh = quantile(raw, model.winsor_high);
  const tvls = peers.map((p) => p.tvl_usd).sort((a, b) => a - b);
  const cuts: [number, number] = [quantile(tvls, 1 / 3), quantile(tvls, 2 / 3)];
  const comps: CompRecord[] = peers.map((p) => ({
    protocol: p,
    multiple: clamp(p.mcap_usd! / p.tvl_usd, winsorLow, winsorHigh),
    tercile: tercileOf(p.tvl_usd, cuts),
  }));
  const global = statsOf(comps.map((c) => c.multiple));
  const byCategory = new Map<string, LevelStats>();
  const byCell = new Map<string, LevelStats>();
  const byTercile = new Map<number, LevelStats>();
  const catValues = new Map<string, number[]>();
  const cellValues = new Map<string, number[]>();
  const tercileValues = new Map<number, number[]>();
  for (const c of comps) {
    const cat = c.protocol.category ?? '';
    const catList = catValues.get(cat) ?? [];
    catList.push(c.multiple);
    catValues.set(cat, catList);
    const key = cellKey(cat, c.tercile);
    const cellList = cellValues.get(key) ?? [];
    cellList.push(c.multiple);
    cellValues.set(key, cellList);
    const tercileList = tercileValues.get(c.tercile) ?? [];
    tercileList.push(c.multiple);
    tercileValues.set(c.tercile, tercileList);
  }
  for (const [cat, values] of catValues) byCategory.set(cat, statsOf(values));
  for (const [key, values] of cellValues) byCell.set(key, statsOf(values));
  for (const [t, values] of tercileValues) byTercile.set(t, statsOf(values));
  const chainCorrelation = {
    r: pearson(
      comps.map((c) => distinctChains(c.protocol.chains).length),
      comps.map((c) => c.multiple),
    ),
    n: comps.length,
  };
  return { comps, global, winsorLow, winsorHigh, tercileCuts: cuts, byCategory, byCell, byTercile, curve: fitCurve(comps), chainCorrelation };
}

/**
 * The size curve: ordinary least squares of log market cap on log TVL over the winsorized
 * peers, in peer order. Each peer's fitted market cap is its winsorized multiple times its
 * TVL. The residual quartiles are the band the board's ranges come from, and the TVL range
 * marks where the curve stops interpolating and starts extrapolating.
 */
function fitCurve(comps: CompRecord[]): CurveFit {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of comps) {
    xs.push(Math.log(c.protocol.tvl_usd));
    ys.push(Math.log(c.multiple * c.protocol.tvl_usd));
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = xs.map((x, i) => ys[i]! - (intercept + slope * x));
  const resid = statsOf(residuals);
  const tvls = comps.map((c) => c.protocol.tvl_usd);
  return {
    intercept,
    slope,
    resid_q1: resid.q1,
    resid_q3: resid.q3,
    resid_iqr: resid.q3 - resid.q1,
    tvl_min: Math.min(...tvls),
    tvl_max: Math.max(...tvls),
    n,
  };
}

/** One shrinkage step: the child's quartiles pulled toward the parent's, weighted by n/(n+k). */
function shrinkStep(child: LevelStats, parent: LevelStats, k: number): LevelStats {
  const w = child.n / (child.n + k);
  return {
    n: child.n,
    median: w * child.median + (1 - w) * parent.median,
    q1: w * child.q1 + (1 - w) * parent.q1,
    q3: w * child.q3 + (1 - w) * parent.q3,
  };
}

/** A protocol's peer multiple: the shrunk quartiles, the evidence behind them, and its flags. */
interface PeerMultiple {
  multiple: number;
  multipleLow: number;
  multipleHigh: number;
  n: number;
  iqr: number;
  confidence: 'High' | 'Medium' | 'Low';
  flags: string[];
}

/**
 * A protocol's curve multiple: the fitted size curve read at its TVL, with the band from the
 * fit's own residual quartiles. The band edges are pinned to the fit itself when a quartile
 * falls on the wrong side, so low never exceeds the midpoint and high never falls below it.
 * Confidence is Medium inside the peers' TVL range and Low outside it, where the curve
 * extrapolates; no row earns High, because the blind test's median error near 90% does not
 * support it. Every row draws on all the peers, so n is the whole peer count.
 */
function curveMultiple(p: SnapshotProtocol, stats: CompStats, model: ModelConstants): PeerMultiple {
  const fit = stats.curve.intercept + stats.curve.slope * Math.log(p.tvl_usd);
  const multiple = clamp(Math.exp(fit) / p.tvl_usd, model.multiple_floor, model.multiple_cap);
  const low = clamp(Math.exp(fit + stats.curve.resid_q1) / p.tvl_usd, model.multiple_floor, model.multiple_cap);
  const high = clamp(Math.exp(fit + stats.curve.resid_q3) / p.tvl_usd, model.multiple_floor, model.multiple_cap);
  const extrapolated = p.tvl_usd < stats.curve.tvl_min || p.tvl_usd > stats.curve.tvl_max;
  return {
    multiple,
    multipleLow: Math.min(low, multiple),
    multipleHigh: Math.max(high, multiple),
    n: stats.comps.length,
    iqr: stats.curve.resid_iqr,
    confidence: extrapolated ? 'Low' : 'Medium',
    flags: extrapolated ? ['extrapolated'] : [],
  };
}

function peerMultiple(p: SnapshotProtocol, stats: CompStats, model: ModelConstants): PeerMultiple {
  const flags: string[] = [];
  const cat = p.category;
  let level: LevelStats;
  let evidence: LevelStats;
  if (cat === null) {
    flags.push('category-missing');
    level = stats.global;
    evidence = stats.global;
  } else {
    const catStats = stats.byCategory.get(cat);
    if (catStats === undefined) {
      flags.push('global-fallback');
      level = stats.global;
      evidence = stats.global;
    } else {
      const cellStats = stats.byCell.get(cellKey(cat, tercileOf(p.tvl_usd, stats.tercileCuts)));
      const shrunkCat = shrinkStep(catStats, stats.global, model.shrinkage_k);
      if (cellStats !== undefined && cellStats.n >= model.shrinkage_min_cell) {
        level = shrinkStep(cellStats, shrunkCat, model.shrinkage_k);
        evidence = cellStats;
      } else {
        level = shrunkCat;
        evidence = catStats;
      }
    }
  }
  const n = evidence.n;
  const iqr = evidence.q3 - evidence.q1;
  if (n < model.confidence_medium_n) flags.push('thin-comps');
  const ratio = evidence.median > 0 ? iqr / evidence.median : Number.POSITIVE_INFINITY;
  const confidence =
    n >= model.confidence_high_n && ratio <= model.confidence_high_iqr_ratio
      ? 'High'
      : n >= model.confidence_medium_n
        ? 'Medium'
        : 'Low';
  return {
    multiple: clamp(level.median, model.multiple_floor, model.multiple_cap),
    multipleLow: clamp(level.q1, model.multiple_floor, model.multiple_cap),
    multipleHigh: clamp(level.q3, model.multiple_floor, model.multiple_cap),
    n,
    iqr,
    confidence,
    flags,
  };
}

/** The growth factor: a weak, bounded signal from the seven-day TVL change. */
function growthFactor(change7d: number | null, model: ModelConstants): { factor: number; unknown: boolean } {
  if (change7d === null || !Number.isFinite(change7d)) return { factor: 1, unknown: true };
  return { factor: 1 + model.growth_weight * clamp(change7d / 100, model.growth_floor, model.growth_cap), unknown: false };
}

/** The maturity factor: an age band, or the neutral band when the listing date is unknown. */
function maturityFactor(age: number | null, model: ModelConstants): { factor: number; unknown: boolean } {
  if (age === null) return { factor: model.unknown_age_factor, unknown: true };
  for (const band of model.maturity_bands) {
    if (band.max_days === null || age <= band.max_days) return { factor: band.factor, unknown: false };
  }
  return { factor: 1, unknown: false };
}

/** The chain-breadth factor: diminishing returns on the number of distinct chains. */
function breadthFactor(p: SnapshotProtocol, model: ModelConstants): number {
  return 1 + model.chain_coefficient * Math.log(1 + distinctChains(p.chains).length);
}

/** The combined adjustment the sweep's adjusted variants apply: growth × maturity × breadth, clamped. */
function adjustmentFactor(p: SnapshotProtocol, age: number | null, model: ModelConstants): number {
  const growth = growthFactor(p.change_7d, model);
  const maturity = maturityFactor(age, model);
  return clamp(growth.factor * maturity.factor * breadthFactor(p, model), model.adjustment_floor, model.adjustment_cap);
}

/** One protocol scored: its peer-implied value, its range, and every number behind them. */
interface Scored {
  protocol: SnapshotProtocol;
  age: number | null;
  implied: number;
  low: number;
  high: number;
  breakdown: ModelBreakdown;
}

function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  stats: CompStats,
  model: ModelConstants,
  survivorOverride?: number,
): Scored {
  const age = ageDays(asOf, p.listed_at);
  const peer = curveMultiple(p, stats, model);
  // The survivor discount is the model's own haircut; the blind test overrides it to 1 when
  // predicting a token that already trades, because the haircut prices pre-token risk.
  const survivor = survivorOverride ?? model.survivor_discount;
  const value = (multiple: number): number => Math.max(1, Math.round(p.tvl_usd * multiple * survivor));
  return {
    protocol: p,
    age,
    implied: value(peer.multiple),
    low: value(peer.multipleLow),
    high: value(peer.multipleHigh),
    breakdown: {
      peer_multiple: round4(peer.multiple),
      multiple_low: round4(peer.multipleLow),
      multiple_high: round4(peer.multipleHigh),
      survivor_discount: survivor,
      comp_n: peer.n,
      resid_iqr: round4(peer.iqr),
      confidence: peer.confidence,
      flags: peer.flags,
    },
  };
}

/** One sweep candidate: its name and its prediction for a held-out protocol, no survivor discount. */
interface SweepVariant {
  name: string;
  predict: (p: SnapshotProtocol, age: number | null, stats: CompStats, model: ModelConstants) => number;
}

/** The shrunk multiple at one shrinkage, for the sweep's shrunk-median variants. */
function shrunkMultipleAt(p: SnapshotProtocol, stats: CompStats, model: ModelConstants, k: number): number {
  return peerMultiple(p, stats, { ...model, shrinkage_k: k }).multiple;
}

/** The size curve's multiple at one TVL, for the sweep's curve variants. */
function curveMultipleAt(tvl: number, stats: CompStats, model: ModelConstants): number {
  const fit = stats.curve.intercept + stats.curve.slope * Math.log(tvl);
  return clamp(Math.exp(fit) / tvl, model.multiple_floor, model.multiple_cap);
}

/**
 * The twelve sweep candidates, in the order the table reports them. Every variant tried is
 * listed; none is dropped silently. The winner is the lowest median absolute log error; the
 * shipped model is the curve alone, and its blind-test block must match this sweep's row.
 */
const SWEEP_VARIANTS: SweepVariant[] = [
  { name: 'Shrunk k=10 + adjustments (v1 model)', predict: (p, age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 10) * adjustmentFactor(p, age, m) },
  { name: 'Shrunk k=10, no adjustments', predict: (p, _age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 10) },
  { name: 'Shrunk k=0 + adjustments', predict: (p, age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 0) * adjustmentFactor(p, age, m) },
  { name: 'Shrunk k=5 + adjustments', predict: (p, age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 5) * adjustmentFactor(p, age, m) },
  { name: 'Shrunk k=20 + adjustments', predict: (p, age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 20) * adjustmentFactor(p, age, m) },
  { name: 'Shrunk k=50 + adjustments', predict: (p, age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 50) * adjustmentFactor(p, age, m) },
  {
    name: 'Tercile-median only',
    predict: (p, _age, s, m) => {
      const level = s.byTercile.get(tercileOf(p.tvl_usd, s.tercileCuts));
      return p.tvl_usd * clamp(level === undefined ? s.global.median : level.median, m.multiple_floor, m.multiple_cap);
    },
  },
  {
    name: 'Category-median only',
    predict: (p, _age, s, m) => {
      const cat = p.category;
      const level = cat !== null && s.byCategory.has(cat) ? s.byCategory.get(cat)!.median : s.global.median;
      return p.tvl_usd * clamp(level, m.multiple_floor, m.multiple_cap);
    },
  },
  { name: 'Global-median + adjustments', predict: (p, age, s, m) => p.tvl_usd * clamp(s.global.median, m.multiple_floor, m.multiple_cap) * adjustmentFactor(p, age, m) },
  { name: 'Log-log size curve alone', predict: (p, _age, s, m) => p.tvl_usd * curveMultipleAt(p.tvl_usd, s, m) },
  { name: 'Log-log size curve + adjustments', predict: (p, age, s, m) => p.tvl_usd * curveMultipleAt(p.tvl_usd, s, m) * adjustmentFactor(p, age, m) },
  { name: 'Shrunk k=0, no adjustments', predict: (p, _age, s, m) => p.tvl_usd * shrunkMultipleAt(p, s, m, 0) },
];

// ---------------------------------------------------------------- blind test

/** The median of a list of errors, by the same quantile rule the model uses everywhere. */
function medianOf(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * The leave-one-out blind test, the twelve-variant sweep, and the rank ranges. Each peer is
 * held out once: the peer statistics are rebuilt from the other 117, the held-out protocol's
 * market cap is predicted with the same pipeline but no survivor discount, every sweep
 * candidate is scored on the same refit, and the full board is re-ranked under the refit
 * statistics with the shipped pipeline. The baselines are scored blind too: the flat
 * 0.25x multiple needs no data, and the global-median baseline uses the refit median, so no
 * baseline peeks at the protocol it predicts. A win is a strictly smaller absolute log error;
 * ties count for neither side. Whatever the test says is reported, including a loss.
 */
function blindTest(
  snapshot: Snapshot,
  chosen: SnapshotProtocol[],
  stats: CompStats,
  model: ModelConstants,
): { validation: ValidationResult; sweep: SweepVariantResult[]; rankRanges: Map<string, [number, number]> } {
  const modelLog: number[] = [];
  const modelPct: number[] = [];
  const flatLog: number[] = [];
  const flatPct: number[] = [];
  const globalLog: number[] = [];
  const globalPct: number[] = [];
  let winsVsFlat = 0;
  let winsVsGlobal = 0;
  const sweepAcc = SWEEP_VARIANTS.map(() => ({ log: [] as number[], pct: [] as number[], winsFlat: 0, winsGlobal: 0 }));
  const perComp: BlindTestRow[] = [];
  const rankRanges = new Map<string, [number, number]>();
  for (const p of chosen) rankRanges.set(p.slug, [Number.POSITIVE_INFINITY, 0]);
  for (const comp of stats.comps) {
    const held = comp.protocol;
    const refit = buildCompStats(snapshot, model, held.slug);
    const predicted = scoreProtocol(held, snapshot.as_of, refit, model, 1).implied;
    const flat = Math.max(1, Math.round(held.tvl_usd * STARTER.base_multiple));
    const global = Math.max(1, Math.round(held.tvl_usd * clamp(refit.global.median, model.multiple_floor, model.multiple_cap)));
    const actual = held.mcap_usd!;
    const mErr = Math.abs(Math.log(predicted / actual));
    const fErr = Math.abs(Math.log(flat / actual));
    const gErr = Math.abs(Math.log(global / actual));
    modelLog.push(mErr);
    modelPct.push(Math.abs(predicted - actual) / actual);
    flatLog.push(fErr);
    flatPct.push(Math.abs(flat - actual) / actual);
    globalLog.push(gErr);
    globalPct.push(Math.abs(global - actual) / actual);
    if (mErr < fErr) winsVsFlat++;
    if (mErr < gErr) winsVsGlobal++;
    const heldAge = ageDays(snapshot.as_of, held.listed_at);
    SWEEP_VARIANTS.forEach((variant, i) => {
      const sweepPred = Math.max(1, Math.round(variant.predict(held, heldAge, refit, model)));
      const err = Math.abs(Math.log(sweepPred / actual));
      sweepAcc[i]!.log.push(err);
      sweepAcc[i]!.pct.push(Math.abs(sweepPred - actual) / actual);
      if (err < fErr) sweepAcc[i]!.winsFlat++;
      if (err < gErr) sweepAcc[i]!.winsGlobal++;
    });
    perComp.push({
      slug: held.slug,
      name: held.name,
      actual_mcap_usd: actual,
      predicted_mcap_usd: predicted,
      flat_mcap_usd: flat,
      global_mcap_usd: global,
      abs_log_error: round4(mErr),
    });
    const rescored = chosen.map((p) => scoreProtocol(p, snapshot.as_of, refit, model));
    rescored.sort(byRank);
    rescored.forEach((s, i) => {
      const range = rankRanges.get(s.protocol.slug)!;
      const rank = i + 1;
      if (rank < range[0]) range[0] = rank;
      if (rank > range[1]) range[1] = rank;
    });
  }
  perComp.sort((a, b) => b.abs_log_error - a.abs_log_error || (a.slug < b.slug ? -1 : 1));
  const n = stats.comps.length;
  const flatMedian = medianOf(flatLog);
  const globalMedian = medianOf(globalLog);
  const validation: ValidationResult = {
    n,
    median_abs_log_error: round4(medianOf(modelLog)),
    median_abs_pct_error: round4(medianOf(modelPct)),
    baselines: [
      {
        name: 'Flat 0.25x multiple',
        median_abs_log_error: round4(flatMedian),
        median_abs_pct_error: round4(medianOf(flatPct)),
        model_win_rate: round4(n === 0 ? 0 : winsVsFlat / n),
      },
      {
        name: 'Global-median multiple',
        median_abs_log_error: round4(globalMedian),
        median_abs_pct_error: round4(medianOf(globalPct)),
        model_win_rate: round4(n === 0 ? 0 : winsVsGlobal / n),
      },
    ],
    per_comp: perComp,
  };
  const sweep: SweepVariantResult[] = SWEEP_VARIANTS.map((variant, i) => {
    const med = medianOf(sweepAcc[i]!.log);
    return {
      name: variant.name,
      median_abs_log_error: round4(med),
      median_abs_pct_error: round4(medianOf(sweepAcc[i]!.pct)),
      win_vs_flat: round4(n === 0 ? 0 : sweepAcc[i]!.winsFlat / n),
      win_vs_global: round4(n === 0 ? 0 : sweepAcc[i]!.winsGlobal / n),
      beats_both: med < flatMedian && med < globalMedian,
    };
  });
  return { validation, sweep, rankRanges };
}

// ---------------------------------------------------------------- farm plans

/** How much capital one farm position needs, as a tier from the protocol's own TVL. */
function capitalTierFor(p: SnapshotProtocol): { tier: 'Low' | 'Medium' | 'High'; range: string } {
  if (p.tvl_usd >= 1_000_000_000) return { tier: 'High', range: 'over $10,000' };
  if (p.tvl_usd >= 100_000_000) return { tier: 'Medium', range: '$1,000–$10,000' };
  return { tier: 'Low', range: 'under $1,000' };
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply the deposit to ${name}'s lending market on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge funds to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit margin on ${name} and open one small position on ${chain}.`;
  if (c.includes('prediction')) return `Fund the account and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('yield')) return `Deposit into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint or deposit the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint the protocol's yield asset on ${chain} through ${name} and hold it.`;
  if (c.includes('insurance')) return `Buy cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Use ${name} to move funds on ${chain} and keep the transaction record.`;
  if (c.includes('nft')) return `Use ${name}'s marketplace on ${chain} for one genuine trade and keep the receipt.`;
  if (c.includes('launchpad')) return `Join one ${name} sale allocation on ${chain} and complete its required steps.`;
  if (c.includes('privacy')) return `Use ${name}'s shielded pool on ${chain} for one genuine transaction.`;
  if (c === 'chain') return `Bridge a small amount to the ${name} network and use its native apps — a swap, a deposit or a stake — so the wallet shows sustained on-chain activity.`;
  return `Deposit into ${name} on ${chain} and keep the position open.`;
}

/** A farm step: the action, what it costs, and how long it takes. */
interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`.trim();
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. Costs are transaction
 * counts and fee tiers, never invented dollar gas prices: each cost names whether it is known, an
 * estimate, or a live quote the reader must get before executing. The plan derives from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; facts: FarmFacts } {
  const preferred = preferredChain(p);
  const chain = preferred?.chain ?? 'its main chain';
  const tier = preferred?.tier ?? null;
  const capital = capitalTierFor(p);
  const hold = holdDaysFor(age);
  const chainCount = distinctChains(p.chains).length;
  const tierNote =
    tier === null
      ? 'the fee tier is unknown, so get a live quote before executing'
      : `fee tier ${tier} (${FEE_TIER_LABELS[tier]}, a planning assumption, not a live quote)`;
  const preferNote =
    preferred !== null && chainCount > 1
      ? ` ${chain} is the cheapest chain in its record under the fee-tier map (${tierNote}).`
      : '';
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with ${chain}'s gas token before the first transaction.`,
      cost: 'known: no fee to create a wallet; the gas-token amount varies with the live price',
      time: '5–10 minutes',
    },
    {
      text: `${actionFor(p, chain)}${preferNote}`,
      cost: `estimated: ${capital.tier} capital tier (${capital.range}, a planning assumption; capital is recoverable on exit) and 1–2 transactions, an approval plus the action when approval is needed; gas is a live quote`,
      time: '10–20 minutes',
    },
    {
      text: 'Repeat one qualifying interaction each week — a deposit, a swap, a vote or a borrow — so the activity spans more than one snapshot window.',
      cost: `estimated: about 1 transaction a week on ${chain} (${tierNote})`,
      time: 'about 10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days. Sustained activity is the usual basis for eligibility where a token later appears; this window is a heuristic, not a known snapshot date.`,
      cost: 'known: the deposit stays in the position; sunk cost so far is only the transaction fees already paid',
      time: `${hold} days`,
    },
    {
      text: `Before claiming anything, open the protocol's own rewards page from its official channels and verify the link. Never pay anyone to claim for you.`,
      cost: `live quote unavailable: claim gas on ${chain} varies — get a quote before executing`,
      time: '10 minutes',
    },
    {
      text: `Risk note: ${p.name} records no token in this snapshot, which is not proof it will issue one. Farming is speculative, smart-contract risk applies, and sybil filtering may exclude wallets. Keep a log of the wallet, dates and transactions.`,
      cost: 'known: nothing but the log',
      time: '5 minutes',
    },
  ];
  return {
    steps: steps.map(stepText),
    facts: {
      chain: preferred?.chain ?? null,
      fee_tier: tier,
      capital_tier: capital.tier,
      hold_days: hold,
      tx_min: 1,
      tx_max: 2,
      tx_weekly: 1,
      bridge_tx: 1,
    },
  };
}

/**
 * One row's farm verdict from the stated sunk-cost assumptions. The assumed sunk cost is the
 * plan's maximum transaction count at the preferred chain's assumed per-transaction cost, plus
 * each bridge at the assumed bridge multiple of that cost. Capital is NOT netted: it is
 * recoverable on exit, while fees are not. net_low nets the assumed sunk cost against an
 * assumed claimable slice of the low end — the capture share, a planning assumption — and the
 * verdict compares that net to the sunk cost itself. The break-even share is the slice the
 * farmer must capture for the assumed costs to wash out. A row whose record names no chain
 * takes the default tier's cost, and says so in its inputs. The verdict is an
 * assumption-based label, never an expected return, and no airdrop is promised.
 */
export function farmVerdict(
  low: number,
  facts: FarmFacts,
  model: ModelConstants,
): { verdict: FarmVerdict; inputs: VerdictInputs } {
  const tier = facts.fee_tier ?? FEE_TIER_DEFAULT;
  const perTx = model.verdict_tx_cost[tier];
  const sunk = Math.round((facts.tx_max * perTx + facts.bridge_tx * model.verdict_bridge_multiplier * perTx) * 100) / 100;
  const share = model.verdict_capture_share;
  const netLow = Math.round((share * low - sunk) * 100) / 100;
  const ratio = sunk > 0 ? netLow / sunk : 1e12;
  const verdict: FarmVerdict =
    ratio > model.verdict_farm_ratio ? 'FARM' : ratio >= model.verdict_thin_ratio ? 'THIN' : 'SKIP';
  return {
    verdict,
    inputs: {
      sunk_cost_usd: sunk,
      per_tx_usd: perTx,
      fee_tier: facts.fee_tier,
      tier_defaulted: facts.fee_tier === null,
      capture_share: share,
      net_low_usd: netLow,
      ratio: Math.round(ratio * 100) / 100,
      breakeven_share: low > 0 ? sunk / low : 0,
    },
  };
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board's sort: implied value down, then TVL, then seven-day growth (unknown last), then slug. */
function byRank(a: Scored, b: Scored): number {
  if (b.implied !== a.implied) return b.implied - a.implied;
  if (b.protocol.tvl_usd !== a.protocol.tvl_usd) return b.protocol.tvl_usd - a.protocol.tvl_usd;
  const ga = a.protocol.change_7d;
  const gb = b.protocol.change_7d;
  if (ga !== null && gb !== null && gb !== ga) return gb - ga;
  if ((ga === null) !== (gb === null)) return ga === null ? 1 : -1;
  return a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const stats = buildCompStats(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names. A slug the snapshot no longer carries cannot
  // be scored; boardIssue names it rather than the board silently dropping coverage.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every other rankable protocol below the watchlist floor: the early radar has no cap, and the
  // floor is never the ceiling. A protocol at or above the floor that the watchlist leaves out
  // stays out: the house's rule kept it off for reasons the ten fields cannot see (a parent
  // protocol, or a wrapped, staked or bridged product of a token that already trades — WBTC and
  // the exchange staking products among them), and the board does not second-guess the list
  // upward. Ranking those at the top would present products of trading tokens as future launches.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const chosenList = [...chosen.values()];
  const scored = chosenList.map((p) => scoreProtocol(p, snapshot.as_of, stats, model));
  scored.sort(byRank);
  // The blind test, the sweep and rank ranges ride on the same scored set; they add evidence
  // and verdicts and never change the ranking above.
  const { validation, sweep, rankRanges } = blindTest(snapshot, chosenList, stats, model);
  const built = scored.map((s, i) => {
    const plan = farmPlan(s.protocol, s.age);
    const verdict = farmVerdict(s.low, plan.facts, model);
    const p = s.protocol;
    return {
      facts: plan.facts,
      row: {
        rank: i + 1,
        rank_range: rankRanges.get(p.slug) ?? ([i + 1, i + 1] as [number, number]),
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: p.mcap_usd,
        listed_at: p.listed_at,
        gecko_id: p.gecko_id,
        symbol: p.symbol,
        token_status: 'pre-token' as const,
        age_days: s.age,
        watchlist: watchlist.has(p.slug),
        implied_value_usd: s.implied,
        implied_low_usd: s.low,
        implied_high_usd: s.high,
        model: s.breakdown,
        farm_steps: plan.steps,
        farm_verdict: verdict.verdict,
        verdict_inputs: verdict.inputs,
      } satisfies BoardRow,
    };
  });
  const board: BoardRow[] = built.map((b) => b.row);
  const live = liveRows(snapshot);
  const categories = categoryComps(snapshot, stats, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    starter: STARTER,
    model_version: MODEL_VERSION,
    validation,
    sweep,
    curve: {
      intercept: round4(stats.curve.intercept),
      slope: round4(stats.curve.slope),
      resid_q1: round4(stats.curve.resid_q1),
      resid_q3: round4(stats.curve.resid_q3),
      resid_iqr: round4(stats.curve.resid_iqr),
      tvl_min: stats.curve.tvl_min,
      tvl_max: stats.curve.tvl_max,
      n: stats.curve.n,
    },
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !r.watchlist).length,
      live: live.length,
      comps: stats.comps.length,
      no_token_recorded: snapshot.protocols.filter(isPreToken).length,
      ambiguous: snapshot.protocols.filter(isAmbiguous).length,
    },
    global: {
      n: stats.global.n,
      median: round4(stats.global.median),
      q1: round4(stats.global.q1),
      q3: round4(stats.global.q3),
      winsor_low: round4(stats.winsorLow),
      winsor_high: round4(stats.winsorHigh),
      tercile_cuts: stats.tercileCuts,
    },
    chain_correlation: {
      r: stats.chainCorrelation.r === null ? null : round4(stats.chainCorrelation.r),
      n: stats.chainCorrelation.n,
    },
    fee_tiers: {
      labels: FEE_TIER_LABELS,
      default: FEE_TIER_DEFAULT,
      chains: [...FEE_TIER_CHAINS].sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0)),
      note: 'Planning assumptions, not live quotes. Chains the map does not name default to tier B.',
    },
    categories,
    rows: built.map((b) => {
      const row = b.row;
      return {
        rank: row.rank,
        rank_range: row.rank_range,
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        listed_at: row.listed_at,
        age_days: row.age_days,
        watchlist: row.watchlist,
        implied_value_usd: row.implied_value_usd,
        implied_low_usd: row.implied_low_usd,
        implied_high_usd: row.implied_high_usd,
        model: row.model,
        farm_steps: row.farm_steps,
        farm: b.facts,
        farm_verdict: row.farm_verdict,
        verdict_inputs: row.verdict_inputs,
      };
    }),
    live,
  };
  return { board, radar };
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Every category's peer evidence: its comps, its quartiles, and its shrunk multiple. */
function categoryComps(snapshot: Snapshot, stats: CompStats, model: ModelConstants): CategoryComps[] {
  const byCat = new Map<string, CompRecord[]>();
  for (const c of stats.comps) {
    const cat = c.protocol.category ?? '';
    const list = byCat.get(cat) ?? [];
    list.push(c);
    byCat.set(cat, list);
  }
  const out: CategoryComps[] = [];
  for (const [category, list] of byCat) {
    const level = stats.byCategory.get(category)!;
    out.push({
      category,
      n: level.n,
      median: round4(level.median),
      q1: round4(level.q1),
      q3: round4(level.q3),
      comps: [...list]
        .sort((a, b) => b.multiple - a.multiple || (a.protocol.slug < b.protocol.slug ? -1 : 1))
        .map((c) => ({
          slug: c.protocol.slug,
          name: c.protocol.name,
          tvl_usd: c.protocol.tvl_usd,
          mcap_usd: c.protocol.mcap_usd!,
          multiple: round4(c.multiple),
        })),
    });
  }
  out.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return out;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside the gate's 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters once trimmed`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
