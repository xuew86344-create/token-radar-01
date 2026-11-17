# Token Radar — peer-implied pre-token ranking

A transparent, reproducible estimator of pre-token protocol value — a peer-derived
valuation and farming intelligence system, **not** an accurate predictor. It reads one
frozen snapshot, ranks every rankable protocol that records no token by a
peer-implied value, shows the peer evidence behind every number, and gives every
protocol a farm plan with honest cost classes. Offline and deterministic: the same
snapshot always produces the same bytes, with no network and no clock.

## What the headline number is

**Peer-implied value** is a peer-derived circulating-market-cap proxy:

```
peer-implied value = TVL × curve multiple × survivor discount
```

It is **not** a predicted launch price and **not** an FDV. The snapshot carries
market cap only — no FDV field — so every multiple here is circulating-mcap-based,
and the entry never claims otherwise. Each row also carries a range (the fitted
log value shifted by the fit's own residual quartiles) and is ranked by the
midpoint. The curve was chosen by a twelve-variant sweep under the blind test
(see Model selection), not assumed.

## The snapshot

- Source: DefiLlama protocols snapshot, as of **2026-11-14** (758 protocols,
  10 fields each: slug, name, category, chains, tvl_usd, change_7d, mcap_usd,
  listed_at, gecko_id, symbol).
- Watchlist floor: **$50,000,000**; the snapshot's own watchlist holds **40** slugs.
- **342** protocols record no token (market cap, CoinGecko id and symbol all
  absent). The entry says "no token recorded", never "tokenless": an absent record
  is not proof no token exists.
- **272** further records are ambiguous (no market cap but a CoinGecko id or
  symbol) and are set aside from both the board and the peer set.
- The board covers all **40** watchlist protocols plus every other rankable
  protocol below the floor — pre-token, not an exchange, not a versioned pool
  name — **226 rows** in total (40 watchlist + 186 early). Protocols at or above
  the floor that the snapshot's own list leaves out (wrapped, staked and bridge
  products such as WBTC) stay out: the board does not second-guess the list
  upward.
- Sort: peer-implied value down, then TVL, then 7d change (unknown last), then
  slug. Peer-implied values on this snapshot run from **$2,381,693** to
  **$78,165,968**, all 226 distinct. The board's column headers are clickable
  to re-sort the filtered list (ties break by slug); the default order above
  is the shipped ranking.

## The size curve

Peers are the **118** protocols with a usable market cap and TVL, excluding
exchanges and versioned pool names. Multiple = mcap_usd / tvl_usd.

- Multiples are winsorized at the global 5th/95th percentiles (**0.0076 /
  3.8466**) before the fit.
- Global median **0.2410** (Q1 0.0483, Q3 1.0533). Size tercile cuts from the
  peers: **$11,725,362 / $56,421,343** (used by the sweep's tercile variant).
- The curve is ordinary least squares of log market cap on log TVL over the
  winsorized peers:

  ```
  log(market cap) = 6.3111 + 0.5533 × log(TVL)
  ```

  The slope below 1 is the curve's content: market cap grows more slowly than
  TVL, so the implied multiple falls as protocols get bigger. A protocol's
  multiple is the curve read at its TVL, bounded to **[0.01, 10]**.
- The range comes from the fit's own log residuals (Q1 **−1.0040**, Q3
  **+1.3466**, IQR 2.3506): the fitted log value shifted by each quartile, so
  the range is the middle half of peer outcomes around the curve, and
  low ≤ mid ≤ high on every row.
- Because the fitted curve increases with TVL, the ranking follows TVL order;
  what the curve adds over a fixed multiple is the sublinear scaling, and the
  blind test is what justifies it. No protocol is silently dropped for
  looking odd; the exclusion rules are stated in the dashboard's methodology
  panel.

## Model selection: the twelve-variant sweep

The shipped model was chosen, not assumed. Twelve candidates were scored
under the identical leave-one-out protocol (118 refits, no survivor discount,
all statistics and fits recomputed inside each fold), and the lowest median
absolute log error won. Every variant tried is listed; none was dropped
silently. The sweep is computed by the program itself at build time and
ships in `data.js`, so the table below is reproducible from the snapshot.

| Variant | Median \|log error\| | Median \|% error\| | Win vs flat | Win vs global | Beats both |
|---|---|---|---|---|---|
| Shrunk k=10 + adjustments (v1 model) | 1.6143 | 92.8% | 38.1% | 44.1% | no |
| Shrunk k=10, no adjustments | 1.6009 | 92.1% | 40.7% | 38.1% | no |
| Shrunk k=0 + adjustments | 1.6917 | 93.5% | 38.1% | 42.4% | no |
| Shrunk k=5 + adjustments | 1.6301 | 93.4% | 37.3% | 42.4% | no |
| Shrunk k=20 + adjustments | 1.6599 | 91.2% | 39.0% | 47.5% | no |
| Shrunk k=50 + adjustments | 1.6271 | 89.3% | 42.4% | 49.2% | no |
| Tercile-median only | 1.4722 | 88.3% | 55.1% | 55.1% | yes |
| Category-median only | 1.6044 | 92.1% | 40.7% | 40.7% | no |
| Global-median + adjustments | 1.6332 | 88.5% | 38.1% | 48.3% | no |
| **Log-log size curve alone** | **1.1960** | **86.3%** | **59.3%** | **60.2%** | **yes** |
| Log-log size curve + adjustments | 1.1997 | 86.6% | 60.2% | 61.0% | yes |
| Shrunk k=0, no adjustments | 1.6804 | 92.8% | 36.4% | 34.8% | no |

The adjustments — growth from the 7d change, maturity from the listing age,
chain breadth from the chain count — lost every pairing: each adjusted
variant scored worse than its unadjusted twin, so the shipped model carries
none of them. The curve with adjustments (1.1997) is a close second to the
curve alone (1.1960), and the selection rule takes the lowest score, so the
curve alone ships. **Selection-score caveat:** the winning variant was
picked using the same 118 peers it was tested on, so its blind-test score is
a selection score, not an unbiased estimate of performance on unseen
protocols. The dashboard states this caveat beside the sweep table.

## The constants

All constants live in one place (`MODEL` in `lib/model.ts`, mirrored into
`data.js`). The survivor discount, winsor percentiles and multiple bounds
are editable in the dashboard's Model Lab, which refits the curve and
recomputes every value; the shrinkage, growth, maturity and breadth
constants are retained because the sweep's other variants use them.

| Parameter | Default | Meaning |
|---|---|---|
| Survivor discount S | **0.85** | Explicit, named haircut: launched peers skew toward the hyped and successful, so the peer fit overstates what a pre-token protocol would fetch. Omitted from blind-test predictions. |
| Winsor percentiles | **5th / 95th** | Multiples are clamped to the global 5th/95th percentiles before the fit. |
| Multiple bounds | **[0.01, 10]** | The curve's implied multiple is bounded to this range. |

## Honesty notes (measured on this snapshot, not asserted)

- **Chain breadth does not predict the multiple.** Across the 118 peers, the
  Pearson correlation between distinct-chain count and the winsorized mcap/TVL
  multiple is **r = −0.0175** — essentially no linear relationship. Chain
  breadth was dropped with the other adjustments, not kept as a decorative
  term. The methodology panel states this plainly.
- **The ranges are wide, and the page says so.** The fit's residual quartiles
  span −1.0040 to +1.3466 in log terms, so a typical row's range covers
  roughly a 10× span. Confidence is Medium inside the peers' TVL range
  ($5.0M–$18.7B) and Low outside it: on this snapshot **0 High, 225 Medium,
  1 Low**. The one Low row (nucleus, $5.0M TVL) sits just below the peers'
  TVL range and carries the `extrapolated` flag. No row earns High: the blind
  test's median error near 90% does not support it.
- **No launch probability anywhere.** Ten fields and no price history cannot
  support one. The entry reports the blind-test result and scenario robustness
  instead, and never promises an airdrop or a return.

## Farm plans

Each row carries **6 steps** (249–485 characters each on this snapshot), built
from the protocol's own category, chains, TVL and age — category-typical actions
only, never invented pool names, button labels or points-program details.

- Costs are transaction counts and fee tiers, never invented dollar gas prices,
  in three labeled classes: **Known** (action count, wallet, chain, approvals),
  **Estimated** (transaction counts, time, complexity — planning assumptions),
  **Live quote unavailable** (gas, bridge, swap, slippage — get a quote before
  executing).
- Capital at risk is separate from sunk cost. Capital tiers are planning
  assumptions from TVL: Low (under $1,000), Medium ($1,000–$10,000), High (over
  $10,000); capital is recoverable on exit, fees are not. On this snapshot: 199
  Low, 23 Medium, 4 High.
- Plans prefer the cheapest chain in the protocol's record, using one labeled
  static fee-tier map (78 chains named; unmapped chains default to Tier B):
  Tier A ≈ cents, Tier B ≈ dimes to a dollar, Tier C ≈ several dollars per
  transaction. Fee tiers on this snapshot: A 138, B 44, C 44.
- Times are ranges on a stated heuristic (sustained activity over a multi-week
  window: 30/45/60-day holds), not a known snapshot date. One step in every plan
  carries the risk note: no token is confirmed, smart-contract risk applies,
  sybil filtering may exclude wallets, farming is speculative.
- Farm priority (dashboard only, never a second ranking or an ROI score): Easy,
  Moderate or Complex from transaction count, bridge need, fee tier and chain
  spread, or High uncertainty when the record names no chain.

## Blind-test validation (leave-one-out over the 118 peers)

Each peer is held out once: the size curve is refitted from the other 117, and
the held-out protocol's market cap is predicted with the same pipeline —
curve multiple × TVL — but **without** the survivor discount, because that
haircut prices pre-token risk and would bias predictions of traded tokens
down. Two baselines are scored blind the same way: a flat 0.25× multiple (the
starter multiple, no adjustments), and the refit global-median multiple (no
adjustments, no shrinkage; the median comes from the 117, so no baseline
peeks at the protocol it predicts). A win is a strictly smaller absolute log
error; ties count for neither side.

**The result on this snapshot: the model beats both baselines.**

| Method | Median \|log error\| | Median \|% error\| | Model win rate |
|---|---|---|---|
| This model | **1.1960** | **86.3%** | — |
| Flat 0.25× multiple | 1.5914 | 87.9% | 59.3% |
| Global-median multiple | 1.5752 | 88.3% | 60.2% |

Even the winner errs by 86% at the median: predicting a traded token's market
cap from these ten fields is intrinsically noisy. And the score is a
selection score — the curve was picked using the same 118 peers (see Model
selection) — not an unbiased generalization estimate. The Model Lab shows
every one of the 118 held-out predictions, worst first (worst: rain, 6.7436;
best: stusdt, 0.0009), so the result can be checked rather than taken on
trust.

Re-ranking the full board under each of the 118 refits gives every row a rank
range, shown in the detail view: on this snapshot **no row moves at all** —
all 226 rank ranges are zero-width. The fitted curve barely shifts when one
peer is dropped, and the ranking follows TVL order through any increasing
curve, so the ranges demonstrate stability rather than uncertainty.

## Farm verdicts

Each row carries a verdict — FARM, THIN or SKIP — from stated sunk-cost
assumptions netted against an assumed claimable slice of the low end of its
range. Assumed cost per transaction: Tier A **$0.05**, Tier B **$0.50**,
Tier C **$5.00**, matching the cents / dimes-to-a-dollar / several-dollars
tiers; a bridge is assumed to cost **2×** one transaction on the same chain.
Assumed sunk cost = maximum setup transactions × per-transaction cost +
bridges × bridge cost. Capital is NOT netted: it is recoverable on exit, only
fees are sunk. The assumed capture share is **0.01%** of the low end — a
planning assumption, not a forecast of any allocation. net_low =
capture share × implied_low − assumed sunk cost; ratio = net_low / assumed
sunk cost. **FARM** above ratio **10**, **THIN** from **1** to 10, **SKIP**
below 1. The detail view also shows the break-even capture share
(assumed sunk cost / low end): the slice a farmer must capture for the
assumed costs to wash out. Costs, the capture share and the thresholds live
in the same constants block (`MODEL` in `lib/model.ts`) and are editable in
the Model Lab, which recomputes the verdict distribution live. Low confidence
does not override the verdict; it rides alongside as the existing flag. The
verdict is assumption-based, never an expected return, and no airdrop is
promised.

Measured on this snapshot under the defaults: **199 FARM, 27 THIN, 0 SKIP**.
Assumed sunk costs are $0.20 (tier A), $2 (tier B) or $20 (tier C). Raise the
assumed costs, or lower the capture share, in the lab to see where SKIP
begins. No row's record names zero chains, so no row needed the default-tier
fallback.

## Starter comparison

The dashboard recomputes the starter formula for every row — TVL × 0.25 ×
(1 + 0.5 × clamp(7d change, −60%, +120%)) × (0.6 + 0.4 × min(age, 1095) / 1095),
unknown age = 365 days — ranks by it, and shows the starter rank beside the peer
rank plus the biggest rank movers, so the improvement over a fixed-multiple
clone is demonstrable, not asserted.

## How to run

Node 22, standard library only. In the grader's container the program reads the
sealed snapshot from `/input/snapshot.json` and writes to `/output`:

```
node main.ts
```

Locally, pass the snapshot and an output directory:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
# or: node main.ts --input <snapshot.json|directory> --output <dir>
```

The run takes under a second, exits 0, and writes identical bytes on repeat
runs (verified: two runs, `diff -r` clean, dossier included).

## Output layout

```
board.json      the ranked board: 226 rows (slug, name, rank, rank_range,
                implied_value_usd, implied_low_usd, implied_high_usd, model
                breakdown, farm_steps, farm_verdict, verdict_inputs)
data.js         the same board plus peer evidence, constants, counts, the
                fitted curve, the twelve-variant sweep and the blind-test
                validation, as window.RADAR, for the dashboard
dashboard/      the static page: index.html, app.css, app.js (55,726 bytes total,
                under the 64 KiB source cap; no network addresses, no framework)
screenshots/    3 PNG screenshots of the built page (1440×800)
dossier.json    the makefun/dossier/v1 dossier, written by the vendored library
                (669,035 bytes; text 55,994 bytes, under the 65,536 cap)
```

## Dashboard sections

1. **Radar Board** — rank, peer-implied range, confidence, TVL, 7d, category,
   flags, farm verdict, starter rank; filters for category, chain, minimum TVL,
   confidence, watchlist-only, and search by name/slug; clickable column
   headers re-sort the filtered list; biggest rank movers vs the starter.
2. **Protocol Intelligence** — per-protocol waterfall from TVL to peer-implied
   value with every component (curve multiple, survivor discount), the fitted
   curve's equation, rank range across the 118 refits, farm verdict with its
   inputs including the break-even capture share, the peer list behind its
   category, starter comparison, and the farm plan.
3. **Live Token Comps** — the fitted size curve, per-category medians,
   quartiles, peer counts, individual comparables, and the top 24 live-token
   protocols by market cap.
4. **Model Lab** — the sandbox: survivor discount, winsor percentiles and
   multiple bounds, refitting the curve and recomputing every value live, with
   a rank stability indicator, reset to defaults, and top-10 membership across
   three winsor scenarios; the blind-test block with the model's errors vs
   both baselines and every held-out prediction; the twelve-variant sweep
   table with the selection-score caveat; and the farm-verdict cost
   assumptions with a live verdict distribution.
5. **Farm Planner** — per-protocol checklist with transaction counts, time
   estimates, the assumed sunk-cost line, the farm-priority rule and the farm
   verdict with its inputs, plus a manual cost calculator fed by user-entered
   costs, labeled "User-supplied cost estimate — not a live quote."

A persistent methodology panel states the model, the snapshot facts, the
exclusion rules and the limits; the footer reconciles the counts (758 / 342 /
40 / 226 / 118).

## Limitations

- Circulating-mcap multiples only; no FDV, no revenue, no user, no price
  history in the snapshot. The ranking is an estimator with stated limits, not
  a valuation.
- The blind-test win is a selection score: the curve was picked using the
  same 118 peers it was tested on, so 1.1960 overstates how it would do on
  unseen protocols. Even taken at face value, the median error is 86%.
- The ranking follows TVL order through the fitted curve. The curve's content
  is the sublinear scaling of value with size, not a reordering of protocols
  by growth, age or category — the blind test rejected those terms.
- The ranges are wide: the fit's residual quartiles span a roughly 10× band
  around the midpoint. Read the range before trusting a point value.
- Farm costs and the capture share are planning assumptions, never live
  quotes or allocation forecasts. Get a live quote before executing anything.
- Everything is frozen at the 2026-11-14 snapshot. Nothing here updates, and
  nothing here calls the network.

## Files

- `main.ts` — the entrypoint: reads the snapshot, scores the board, writes the
  outputs and the dossier.
- `lib/model.ts` — the peer-implied model, the farm-plan generator, the board
  builder, the snapshot parser and the gate self-check.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte-identical to the
  kit's copy.
- `dashboard/` — the static page (source under the 64 KiB dossier text cap).
- `screenshots/` — the three dossier screenshots, rendered from the built page
  with headless Chromium at 1440×800: the Radar Board, one Protocol
  Intelligence detail view, and the watchlist-only filtered view.
