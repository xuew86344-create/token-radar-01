// Token Radar dashboard: renders the board, protocol detail, peer evidence, model sandbox
// and farm planner from window.RADAR, the data file beside dashboard/. No network: every
// byte shown comes from that file, and every recompute is deterministic.
(function () {
'use strict';
var D = window.RADAR;
var OUT_IDS = ['boardOut', 'movers', 'detailOut', 'compsOut', 'labOut', 'sensOut', 'blindOut', 'sweepOut', 'verdictNote', 'planOut', 'cOut'];
if (!D || !D.rows || !D.rows.length) {
  OUT_IDS.forEach(function (id) { var n = document.getElementById(id); if (n) n.textContent = 'No radar data: data.js did not load.'; });
  return;
}
var rows = D.rows, cats = D.categories, M = D.model, ST = D.starter, G = D.global;

// ---------- formatting and math helpers ----------
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function money(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; var a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K'; return '$' + Math.round(n); }
function pct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
function f4(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : Number(n).toFixed(4); }
function ageFmt(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return d + 'd'; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function quantile(sorted, p) { if (!sorted.length) return 0; var at = p * (sorted.length - 1), lo = Math.floor(at), hi = Math.ceil(at); return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo); }
function normChain(c) { return c.trim().toLowerCase().replace(/\s+/g, ' '); }
function nChains(chains) { var seen = {}, n = 0; (chains || []).forEach(function (c) { var k = normChain(c); if (!seen[k]) { seen[k] = 1; n++; } }); return n; }

// ---------- the peer set, flat, so the sandbox can refit the size curve ----------
// The comps carry full-precision TVL and market cap; the sandbox winsorizes and refits the
// curve with the same quantile rule and least squares the model uses, so the lab reproduces
// the board under the defaults and shows what moves when the winsor bounds move.
var compList = [];
cats.forEach(function (c) { c.comps.forEach(function (x) { compList.push(x); }); });
compList.sort(function (a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
var catSet = {};
cats.forEach(function (c) { catSet[c.category] = 1; });

function fitCurve(wLo, wHi) {
  var raw = compList.map(function (x) { return x.mcap_usd / x.tvl_usd; }).sort(function (a, b) { return a - b; });
  var lo = quantile(raw, wLo), hi = quantile(raw, wHi);
  var xs = [], ys = [];
  compList.forEach(function (x) {
    var mult = clamp(x.mcap_usd / x.tvl_usd, lo, hi);
    xs.push(Math.log(x.tvl_usd));
    ys.push(Math.log(mult * x.tvl_usd));
  });
  var n = xs.length, mx = 0, my = 0, i;
  for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  var sxy = 0, sxx = 0;
  for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
  var b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b: b };
}

// ---------- the model, as the sandbox runs it ----------
function curveMultiple(tvl, fit, p) {
  return clamp(Math.exp(fit.a + fit.b * Math.log(tvl)) / tvl, p.mflo, p.mcap);
}
function scoreRow(row, p, fit) {
  return Math.max(1, Math.round(row.tvl_usd * curveMultiple(row.tvl_usd, fit, p) * p.surv));
}
// The board's sort: value down, then TVL, then 7d growth (unknown last), then slug.
function byRank(a, b) {
  if (b.value !== a.value) return b.value - a.value;
  if (b.row.tvl_usd !== a.row.tvl_usd) return b.row.tvl_usd - a.row.tvl_usd;
  var ga = a.row.change_7d, gb = b.row.change_7d;
  if (ga !== null && gb !== null && gb !== ga) return gb - ga;
  if ((ga === null) !== (gb === null)) return ga === null ? 1 : -1;
  return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
}
function rerank(p) {
  var fit = fitCurve(p.wlo, p.whi);
  var scored = rows.map(function (r) { return { row: r, value: scoreRow(r, p, fit) }; });
  scored.sort(byRank);
  var rank = {};
  scored.forEach(function (s, i) { rank[s.row.slug] = i + 1; });
  return { order: scored, rank: rank, fit: fit };
}

// ---------- the starter model, for the comparison the methodology promises ----------
function starterValue(row) {
  var g = clamp(row.change_7d === null ? 0 : row.change_7d, ST.growth_floor, ST.growth_cap);
  var gm = 1 + (g / 100) * ST.growth_weight;
  var age = row.age_days === null ? ST.unknown_age_days : row.age_days;
  var mat = ST.maturity_floor + (clamp(age, 0, ST.maturity_days) / ST.maturity_days) * ST.maturity_range;
  return Math.max(1, Math.round(row.tvl_usd * ST.base_multiple * gm * mat));
}
var starterRank = {}, starterVal = {};
(function () {
  var s = rows.map(function (r) { return { row: r, value: starterValue(r) }; });
  s.sort(byRank);
  s.forEach(function (x, i) { starterRank[x.row.slug] = i + 1; starterVal[x.row.slug] = x.value; });
})();

// ---------- farm verdict: an assumption-based label, never an expected return ----------
function verdictBadge(v) {
  if (!v) return '';
  var cls = v === 'FARM' ? 'up' : v === 'SKIP' ? 'down' : 'flag';
  return '<span class="' + cls + '">' + esc(v) + '</span>';
}
function fmtShare(s) { if (s === null || s === undefined || !isFinite(s)) return 'n/a'; return (s * 100).toPrecision(3) + '%'; }
function verdictLine(r) {
  if (!r.farm_verdict || !r.verdict_inputs) return 'n/a';
  var vi = r.verdict_inputs;
  return verdictBadge(r.farm_verdict) + ' <span class="dim">sunk $' + vi.sunk_cost_usd.toFixed(2) + ' assumed · capture ' + fmtShare(vi.capture_share) + ' of low · net low ' + money(vi.net_low_usd) + ' · ratio ' + (isFinite(vi.ratio) ? vi.ratio.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'n/a') + ' · break-even ' + fmtShare(vi.breakeven_share) + (vi.tier_defaulted ? ' · tier defaulted' : '') + '</span>';
}

// ---------- farm priority: an execution label, never an ROI score ----------
function farmPriority(row) {
  var f = row.farm;
  if (!f.chain) return 'High uncertainty';
  var score = f.tx_max + f.bridge_tx + (f.fee_tier === 'C' ? 1 : 0) + (nChains(row.chains) > 8 ? 1 : 0);
  return score <= 3 ? 'Easy' : score === 4 ? 'Moderate' : 'Complex';
}

// ---------- state and navigation ----------
var state = { q: '', cat: '', chain: '', tvl: 0, conf: '', watch: false, selected: rows[0].slug, planSlug: rows[0].slug, sort: { key: 'rank', dir: 1 } };
var SECTIONS = ['board', 'detail', 'comps', 'lab', 'planner'];
function show(sec) {
  SECTIONS.forEach(function (s) { document.getElementById('sec-' + s).hidden = s !== sec; });
  var btns = document.querySelectorAll('#nav button');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-sec') === sec);
}
function rowBySlug(slug) { for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i]; return null; }
function selectRow(slug) {
  state.selected = slug; state.planSlug = slug;
  var sel = document.getElementById('pSel');
  if (sel) sel.value = slug;
  renderDetail(); renderPlanner(); renderCalc(); show('detail');
  if (window.scrollTo) window.scrollTo(0, 0);
}
function rowClick(e) {
  var tr = e.target && e.target.closest ? e.target.closest('tr[data-slug]') : null;
  if (tr) selectRow(tr.getAttribute('data-slug'));
}

// ---------- 01 Radar Board ----------
function filteredRows() {
  var q = state.q.toLowerCase();
  return rows.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
    if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (r.tvl_usd < state.tvl) return false;
    if (state.conf && r.model.confidence !== state.conf) return false;
    if (state.watch && !r.watchlist) return false;
    return true;
  });
}
function sortVal(r, key) {
  switch (key) {
    case 'rank': return r.rank;
    case 'name': return r.name.toLowerCase();
    case 'category': return (r.category || 'Uncategorized').toLowerCase();
    case 'tvl': return r.tvl_usd;
    case 'change': return r.change_7d;
    case 'value': return r.implied_value_usd;
    case 'confidence': return { High: 0, Medium: 1, Low: 2 }[r.model.confidence];
    case 'verdict': return { FARM: 0, THIN: 1, SKIP: 2 }[r.farm_verdict];
    case 'starter': return starterRank[r.slug];
  }
  return 0;
}
// Sorting applies to the filtered list; ties break by slug, so the order is deterministic.
// Unknown 7d values sort last in both directions.
function sortList(list) {
  var key = state.sort.key, dir = state.sort.dir;
  return list.slice().sort(function (a, b) {
    var va = sortVal(a, key), vb = sortVal(b, key);
    if (va === null && vb === null) return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    var c = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
    if (c !== 0) return dir * c;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}
function renderBoard() {
  var list = sortList(filteredRows());
  document.getElementById('boardCount').textContent = list.length + ' of ' + rows.length + ' protocols match. Click a column header to sort; click a row for the full breakdown.';
  var out = document.getElementById('boardOut');
  if (!list.length) { out.innerHTML = '<p class="empty">No protocols match these filters. Loosen a filter to see the board again.</p>'; return; }
  var cols = [['rank', 'Rank'], ['name', 'Protocol'], ['category', 'Category'], ['tvl', 'TVL'], ['change', '7d'], ['value', 'Peer-implied value'], ['confidence', 'Confidence'], [null, 'Flags'], ['verdict', 'Verdict'], ['starter', 'Starter rank']];
  var h = '<table><thead><tr>' + cols.map(function (c) {
    if (!c[0]) return '<th>' + c[1] + '</th>';
    var arrow = state.sort.key === c[0] ? (state.sort.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
    return '<th data-key="' + c[0] + '" title="Click to sort">' + c[1] + arrow + '</th>';
  }).join('') + '</tr></thead><tbody>';
  list.forEach(function (r) {
    var d = starterRank[r.slug] - r.rank;
    h += '<tr data-slug="' + esc(r.slug) + '" tabindex="0"><td>' + r.rank + '</td>'
      + '<td><strong>' + esc(r.name) + '</strong><br><span class="dim">' + esc(r.slug) + (r.watchlist ? ' · <span class="watch">Watchlist</span>' : '') + '</span></td>'
      + '<td>' + esc(r.category || 'Uncategorized') + '</td><td>' + money(r.tvl_usd) + '</td><td>' + pct(r.change_7d) + '</td>'
      + '<td><strong>' + money(r.implied_value_usd) + '</strong><br><span class="dim">' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</span></td>'
      + '<td>' + esc(r.model.confidence) + '</td><td>' + r.model.flags.map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join(' ') + '</td>'
      + '<td>' + verdictBadge(r.farm_verdict) + '</td>'
      + '<td>' + starterRank[r.slug] + (d > 0 ? ' <span class="up">▲' + d + '</span>' : d < 0 ? ' <span class="down">▼' + (-d) + '</span>' : '') + '</td></tr>';
  });
  out.innerHTML = h + '</tbody></table>';
}
function renderMovers() {
  var deltas = rows.map(function (r) { return { row: r, d: starterRank[r.slug] - r.rank }; });
  function table(arr, title) {
    if (!arr.length) return '<h3>' + title + '</h3><p class="dim">None.</p>';
    return '<h3>' + title + '</h3><table><thead><tr><th>Protocol</th><th>Our rank</th><th>Starter rank</th><th>Move</th></tr></thead><tbody>'
      + arr.map(function (x) { return '<tr data-slug="' + esc(x.row.slug) + '"><td>' + esc(x.row.name) + '</td><td>' + x.row.rank + '</td><td>' + starterRank[x.row.slug] + '</td><td><span class="' + (x.d > 0 ? 'up' : 'down') + '">' + (x.d > 0 ? '▲' : '▼') + Math.abs(x.d) + '</span></td></tr>'; }).join('') + '</tbody></table>';
  }
  var up = deltas.filter(function (x) { return x.d > 0; }).sort(function (a, b) { return b.d - a.d; }).slice(0, 5);
  var down = deltas.filter(function (x) { return x.d < 0; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
  document.getElementById('movers').innerHTML = table(up, 'Rank higher under the peer model') + table(down, 'Rank lower under the peer model');
}

// ---------- 02 Protocol Intelligence ----------
function renderDetail() {
  var r = rowBySlug(state.selected) || rows[0];
  var m = r.model, cat = null;
  cats.forEach(function (c) { if (c.category === r.category) cat = c; });
  var d = starterRank[r.slug] - r.rank;
  var move = d > 0 ? 'ranks ' + d + ' places higher than the starter' : d < 0 ? 'ranks ' + (-d) + ' places lower than the starter' : 'ranks the same as the starter';
  var h = '<h2>' + esc(r.name) + (r.watchlist ? ' <span class="watch">Watchlist</span>' : '') + '</h2>'
    + '<p class="dim">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorized') + ' · ' + esc((r.chains || []).join(', ') || 'no chains recorded') + '</p>'
    + '<label class="dim">Protocol <select id="dSel">' + rows.map(function (x) { return '<option value="' + esc(x.slug) + '"' + (x.slug === r.slug ? ' selected' : '') + '>#' + x.rank + ' ' + esc(x.name) + '</option>'; }).join('') + '</select></label>'
    + '<div class="grid"><div class="card"><h3>Waterfall: TVL to peer-implied value</h3><table class="kv"><tbody>'
    + '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>'
    + '<tr><td>× curve multiple</td><td>' + f4(m.peer_multiple) + ' <span class="dim">(fitted size curve at this TVL, n=' + m.comp_n + ' peers, residual IQR ' + f4(m.resid_iqr) + ' in log terms)</span></td></tr>'
    + '<tr><td>× survivor discount</td><td>' + m.survivor_discount + '</td></tr>'
    + '<tr><td><strong>Peer-implied value</strong></td><td><strong>' + money(r.implied_value_usd) + '</strong> <span class="dim">range ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + ' from the fit\u2019s residual quartiles</span></td></tr>'
    + '</tbody></table>'
    + (D.curve ? '<p class="dim">Size curve: log market cap = ' + D.curve.intercept.toFixed(4) + ' + ' + D.curve.slope.toFixed(4) + ' × log TVL, fitted on ' + D.curve.n + ' winsorized peers. Chosen by the twelve-variant sweep in the Model Lab; growth, age and chain-count terms were tried and rejected by the blind test.</p>' : '')
    + '</div>'
    + '<div class="card"><h3>Facts</h3><table class="kv"><tbody>'
    + '<tr><td>7d TVL change</td><td>' + pct(r.change_7d) + '</td></tr>'
    + '<tr><td>Listed</td><td>' + esc(r.listed_at || 'unknown') + ' (' + ageFmt(r.age_days) + ')</td></tr>'
    + '<tr><td>Chains</td><td>' + nChains(r.chains) + ' distinct</td></tr>'
    + '<tr><td>Flags</td><td>' + (m.flags.length ? m.flags.map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join(' ') : 'none') + '</td></tr>'
    + '<tr><td>Rank range</td><td>#' + r.rank + (r.rank_range ? ' (range #' + r.rank_range[0] + '–#' + r.rank_range[1] + ' across ' + (D.validation ? D.validation.n : '—') + ' refits)' : '') + '</td></tr>'
    + '<tr><td>Farm verdict</td><td>' + verdictLine(r) + ' <span class="dim">— assumption-based, not an expected return; no airdrop is promised.</span></td></tr>'
    + '<tr><td>Starter model</td><td>' + money(starterVal[r.slug]) + ', rank ' + starterRank[r.slug] + ' — ' + move + '</td></tr>'
    + '</tbody></table></div></div>';
  if (cat) {
    h += '<h3>Peer evidence: ' + esc(cat.category) + ' (' + cat.n + ' live-token peer' + (cat.n === 1 ? '' : 's') + ')</h3>'
      + '<p class="dim">Category median ' + f4(cat.median) + ' · Q1 ' + f4(cat.q1) + ' · Q3 ' + f4(cat.q3) + '. The row\u2019s value comes from the global size curve, not this category median — the table below is the peer context the curve was fitted on, and the Model Lab sweep shows the category median losing to the curve.</p>'
      + '<table><thead><tr><th>Peer</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th></tr></thead><tbody>'
      + cat.comps.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + money(c.tvl_usd) + '</td><td>' + money(c.mcap_usd) + '</td><td>' + f4(c.multiple) + '</td></tr>'; }).join('') + '</tbody></table>';
  } else {
    h += '<h3>Peer evidence: no category peers</h3><p>' + esc(r.category || 'Uncategorized') + ' has no live-token peers in this snapshot. The row uses the same global size curve as every row, fitted on all ' + G.n + ' peers (median multiple ' + f4(G.median) + ', Q1 ' + f4(G.q1) + ', Q3 ' + f4(G.q3) + ').</p>';
  }
  var f = r.farm;
  h += '<h3>Farm plan</h3><p class="dim">Chain: ' + esc(f.chain || 'none recorded') + ' · fee tier ' + (f.fee_tier ? esc(f.fee_tier) + ' (' + esc(D.fee_tiers.labels[f.fee_tier]) + ')' : 'unknown') + ' · capital tier ' + esc(f.capital_tier) + ' · hold ' + f.hold_days + ' days · ' + f.tx_min + '–' + f.tx_max + ' transactions + ' + f.bridge_tx + ' bridge · farm priority: <strong>' + farmPriority(r) + '</strong></p>';
  h += '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  document.getElementById('detailOut').innerHTML = h;
}

// ---------- 03 Live Token Comps ----------
function renderComps() {
  var h = '<div class="card"><h3>Global peer set</h3><p>' + G.n + ' live-token peers · median multiple ' + f4(G.median) + ' · Q1 ' + f4(G.q1) + ' · Q3 ' + f4(G.q3) + ' · winsorized at ' + f4(G.winsor_low) + ' / ' + f4(G.winsor_high) + ' (5th/95th percentiles) · TVL tercile cuts ' + money(G.tercile_cuts[0]) + ' / ' + money(G.tercile_cuts[1]) + '</p>'
    + (D.curve ? '<p>Fitted size curve: log market cap = ' + D.curve.intercept.toFixed(4) + ' + ' + D.curve.slope.toFixed(4) + ' × log TVL · residual quartiles ' + D.curve.resid_q1.toFixed(4) + ' / ' + D.curve.resid_q3.toFixed(4) + ' · peer TVL range ' + money(D.curve.tvl_min) + ' – ' + money(D.curve.tvl_max) + '</p>' : '')
    + '</div>';
  h += '<h2>TVL against market cap</h2><p class="dim">Blue: 118 peers at actual market cap. Grey: 226 board rows at peer-implied value. Red: the 40 watchlist rows. Line: the fitted curve; board rows sit below it by the ' + M.survivor_discount + ' discount. Log-log axes.</p>' + renderScatter();
  h += '<h2>Categories</h2>';
  cats.forEach(function (c) {
    h += '<details><summary>' + esc(c.category) + ' <span>· ' + c.n + ' peers · median ' + f4(c.median) + ' · Q1–Q3 ' + f4(c.q1) + '–' + f4(c.q3) + '</span></summary>'
      + '<table><thead><tr><th>Peer</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th></tr></thead><tbody>'
      + c.comps.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + money(x.tvl_usd) + '</td><td>' + money(x.mcap_usd) + '</td><td>' + f4(x.multiple) + '</td></tr>'; }).join('') + '</tbody></table></details>';
  });
  var missing = [];
  rows.forEach(function (r) { var c = r.category || 'Uncategorized'; if (!catSet[c] && missing.indexOf(c) < 0) missing.push(c); });
  if (missing.length) h += '<h3>Categories with no live-token peers</h3><p>' + missing.map(esc).join(', ') + ' — rows in these categories use the same global size curve as every row.</p>';
  h += '<h2>Live-token view: top ' + D.live.length + ' by market cap</h2><p class="dim">These protocols already trade, so the page shows the market\u2019s own value, not a model\u2019s.</p>';
  h += '<table><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th><th>7d</th></tr></thead><tbody>'
    + D.live.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || 'Uncategorized') + '</td><td>' + money(p.tvl_usd) + '</td><td>' + money(p.mcap_usd) + '</td><td>' + (p.mcap_usd === null ? 'n/a' : f4(p.mcap_usd / p.tvl_usd)) + '</td><td>' + pct(p.change_7d) + '</td></tr>'; }).join('') + '</tbody></table>';
  h += renderAmbig();
  document.getElementById('compsOut').innerHTML = h;
}

// ---------- 04 Model Lab ----------
var defaults = { surv: M.survivor_discount, wlo: M.winsor_low, whi: M.winsor_high, mflo: M.multiple_floor, mcap: M.multiple_cap };
var baseRerank = rerank(defaults);
function num(id, fb) { var v = parseFloat(document.getElementById(id).value); return isFinite(v) ? v : fb; }
function labParams() {
  return {
    surv: clamp(num('Lsurv', defaults.surv), 0.5, 1),
    wlo: clamp(num('LwLo', defaults.wlo), 0.01, 0.2),
    whi: clamp(num('LwHi', defaults.whi), 0.8, 0.99),
    mflo: clamp(num('Lmflo', defaults.mflo), 0.001, 1),
    mcap: clamp(num('Lmcap', defaults.mcap), 1, 20)
  };
}
function renderLab() {
  var p = labParams();
  var res = rerank(p);
  var baseTop = baseRerank.order.slice(0, 10).map(function (s) { return s.row.slug; });
  var curTop = res.order.slice(0, 10).map(function (s) { return s.row.slug; });
  var stay = baseTop.filter(function (s) { return curTop.indexOf(s) >= 0; }).length;
  document.getElementById('labNote').textContent = 'Rank stability: ' + stay + ' of the default top 10 remain in the top 10 under these settings. Showing the top 20 of ' + rows.length + ' recomputed rows; click a row for its breakdown.';
  var h = '<table><thead><tr><th>New rank</th><th>Protocol</th><th>Recomputed value</th><th>Default rank</th><th>Move</th></tr></thead><tbody>';
  res.order.slice(0, 20).forEach(function (s, i) {
    var br = baseRerank.rank[s.row.slug], d = br - (i + 1);
    h += '<tr data-slug="' + esc(s.row.slug) + '"><td>' + (i + 1) + '</td><td>' + esc(s.row.name) + '</td><td>' + money(s.value) + '</td><td>' + br + '</td><td>' + (d > 0 ? '<span class="up">▲' + d + '</span>' : d < 0 ? '<span class="down">▼' + (-d) + '</span>' : '—') + '</td></tr>';
  });
  document.getElementById('labOut').innerHTML = h + '</tbody></table>';
}
function renderSens() {
  var scenarios = [
    { name: 'Narrow winsor (1/99)', p: { surv: 0.85, wlo: 0.01, whi: 0.99, mflo: 0.01, mcap: 10 } },
    { name: 'Base', p: defaults },
    { name: 'Wide winsor (10/90)', p: { surv: 0.85, wlo: 0.1, whi: 0.9, mflo: 0.01, mcap: 10 } }
  ];
  var tops = scenarios.map(function (sc) { return rerank(sc.p).order.slice(0, 10).map(function (s) { return s.row.slug; }); });
  var h = '<table><thead><tr><th>Protocol</th><th>Base rank</th><th>Scenarios in top 10</th><th>Narrow winsor</th><th>Base</th><th>Wide winsor</th></tr></thead><tbody>';
  baseRerank.order.slice(0, 10).forEach(function (s, i) {
    var cells = tops.map(function (t) { return t.indexOf(s.row.slug) >= 0 ? 'yes' : 'no'; });
    var count = cells.filter(function (c) { return c === 'yes'; }).length;
    h += '<tr data-slug="' + esc(s.row.slug) + '"><td>' + esc(s.row.name) + '</td><td>' + (i + 1) + '</td><td>' + count + ' of 3</td><td>' + cells[0] + '</td><td>' + cells[1] + '</td><td>' + cells[2] + '</td></tr>';
  });
  document.getElementById('sensOut').innerHTML = h + '</tbody></table>';
}

// ---------- Blind test: the model against two baselines, every prediction shown ----------
function renderBlind() {
  var out = document.getElementById('blindOut');
  var v = D.validation;
  if (!v || !v.baselines) { out.innerHTML = '<p class="dim">No blind-test data in this build.</p>'; return; }
  function pc(x) { return (x * 100).toFixed(1) + '%'; }
  var h = '<p>Each of the ' + v.n + ' peers was held out once; the curve was refitted from the other ' + (v.n - 1) + ' and its market cap predicted with the same pipeline, without the survivor discount. Lower error is better; win rate is the share of peers where the model\u2019s absolute log error is strictly smaller.</p>'
    + '<table><thead><tr><th>Method</th><th>Median |log error|</th><th>Median |% error|</th><th>Model win rate</th></tr></thead><tbody>'
    + '<tr><td><strong>This model</strong></td><td>' + v.median_abs_log_error.toFixed(4) + '</td><td>' + pc(v.median_abs_pct_error) + '</td><td>—</td></tr>'
    + v.baselines.map(function (b) { return '<tr><td>' + esc(b.name) + '</td><td>' + b.median_abs_log_error.toFixed(4) + '</td><td>' + pc(b.median_abs_pct_error) + '</td><td>' + pc(b.model_win_rate) + '</td></tr>'; }).join('')
    + '</tbody></table>'
    + '<p class="dim">Read plainly: on this snapshot the model ' + (v.median_abs_log_error < v.baselines[0].median_abs_log_error && v.median_abs_log_error < v.baselines[1].median_abs_log_error ? 'beats both baselines' : 'does not beat both baselines') + ' on median absolute log error. Median absolute percentage error is still ' + pc(v.median_abs_pct_error) + ': the curve is the best of the twelve variants tried, and still wrong by most of the value at the median. The sweep table below shows every candidate, and the methodology states the selection-score caveat.</p>';
  var widths = rows.map(function (r) { return r.rank_range ? r.rank_range[1] - r.rank_range[0] : 0; }).sort(function (a, b) { return a - b; });
  var still = widths.filter(function (w) { return w === 0; }).length;
  h += '<p class="dim">Rank ranges: re-ranking the full board under each of the ' + v.n + ' refits gives every row a min–max rank, shown in the detail view. On this snapshot ' + still + ' of ' + rows.length + ' rows never move (median width ' + widths[Math.floor(widths.length / 2)] + ' ranks): the fitted curve barely moves when one peer is dropped.</p>';
  if (v.per_comp && v.per_comp.length) {
    h += '<details><summary>Every held-out prediction, worst first (' + v.per_comp.length + ' peers)</summary>'
      + '<table><thead><tr><th>Peer</th><th>Actual mcap</th><th>Predicted</th><th>Flat 0.25×</th><th>Global median</th><th>|log error|</th></tr></thead><tbody>'
      + v.per_comp.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + money(c.actual_mcap_usd) + '</td><td>' + money(c.predicted_mcap_usd) + '</td><td>' + money(c.flat_mcap_usd) + '</td><td>' + money(c.global_mcap_usd) + '</td><td>' + c.abs_log_error.toFixed(4) + '</td></tr>'; }).join('')
      + '</tbody></table></details>';
  }
  out.innerHTML = h;
}

// ---------- Model selection: twelve variants, one blind test ----------
function renderSweep() {
  var out = document.getElementById('sweepOut');
  var s = D.sweep;
  if (!s || !s.length) { out.innerHTML = '<p class="dim">No sweep data in this build.</p>'; return; }
  function pc(x) { return (x * 100).toFixed(1) + '%'; }
  var h = '<p>Twelve candidates, one blind test: each variant was scored by the same leave-one-out protocol, and the lowest median absolute log error won. The shipped model is the log-log size curve alone.</p>'
    + '<table><thead><tr><th>Variant</th><th>Median |log error|</th><th>Win vs flat</th><th>Win vs global</th><th>Beats both</th></tr></thead><tbody>'
    + s.map(function (v) { return '<tr><td>' + esc(v.name) + '</td><td>' + v.median_abs_log_error.toFixed(4) + '</td><td>' + pc(v.win_vs_flat) + '</td><td>' + pc(v.win_vs_global) + '</td><td>' + (v.beats_both ? 'yes' : 'no') + '</td></tr>'; }).join('')
    + '</tbody></table>'
    + '<p class="dim">Selection-score caveat: the winning variant was picked using the same 118 peers it was tested on, so its blind-test score is a selection score, not an unbiased estimate of how it would do on unseen protocols. Every variant tried is listed; none was dropped. The full table, with median percentage errors, is in the repository README.</p>';
  out.innerHTML = h;
}

// ---------- Farm verdicts under the lab's cost assumptions ----------
function verdictParams() {
  var tc = (M.verdict_tx_cost || { A: 0.05, B: 0.5, C: 5 });
  return {
    a: Math.max(0, num('LtxA', tc.A)),
    b: Math.max(0, num('LtxB', tc.B)),
    c: Math.max(0, num('LtxC', tc.C)),
    share: Math.max(0, num('Lshare', M.verdict_capture_share === undefined ? 0.0001 : M.verdict_capture_share)),
    farm: Math.max(1, num('LvFarm', M.verdict_farm_ratio === undefined ? 10 : M.verdict_farm_ratio)),
    thin: Math.max(0, num('LvThin', M.verdict_thin_ratio === undefined ? 1 : M.verdict_thin_ratio))
  };
}
function verdictUnder(row, p) {
  var tier = (row.farm && row.farm.fee_tier) || D.fee_tiers.default;
  var perTx = tier === 'A' ? p.a : tier === 'C' ? p.c : p.b;
  var mult = M.verdict_bridge_multiplier === undefined ? 2 : M.verdict_bridge_multiplier;
  var sunk = row.farm.tx_max * perTx + row.farm.bridge_tx * mult * perTx;
  var ratio = sunk > 0 ? (p.share * row.implied_low_usd - sunk) / sunk : 1e12;
  return ratio > p.farm ? 'FARM' : ratio >= p.thin ? 'THIN' : 'SKIP';
}
function renderVerdicts() {
  var p = verdictParams();
  var counts = { FARM: 0, THIN: 0, SKIP: 0 };
  rows.forEach(function (r) { counts[verdictUnder(r, p)]++; });
  document.getElementById('verdictNote').textContent = 'Farm verdicts under these cost assumptions (capture share ' + fmtShare(p.share) + ' of the low end, bridge = 2× one transaction): FARM ' + counts.FARM + ' · THIN ' + counts.THIN + ' · SKIP ' + counts.SKIP + ' of ' + rows.length + '. Assumption-based, not expected returns; no airdrop is promised.';
}

// ---------- 05 Farm Planner ----------
function sunkLine(r) {
  var vi = r.verdict_inputs, f = r.farm;
  if (!vi) return 'n/a';
  var tier = vi.fee_tier ? 'tier ' + vi.fee_tier : 'default tier ' + D.fee_tiers.default;
  return tier + ' · ' + f.tx_max + ' setup transactions + ' + f.bridge_tx + ' bridge at $' + vi.per_tx_usd.toFixed(2) + ' per transaction (bridge 2×) = $' + vi.sunk_cost_usd.toFixed(2) + ' assumed — a planning assumption, not a live quote' + (vi.tier_defaulted ? ' · tier defaulted' : '');
}
function renderPlanner() {
  var r = rowBySlug(state.planSlug) || rows[0];
  var f = r.farm;
  var h = '<h2>' + esc(r.name) + ' <span class="dim">#' + r.rank + ' · ' + esc(r.category || 'Uncategorized') + '</span></h2>'
    + '<div class="grid"><div class="card"><h3>Plan facts</h3><table class="kv"><tbody>'
    + '<tr><td>Chain</td><td>' + esc(f.chain || 'none recorded') + '</td></tr>'
    + '<tr><td>Fee tier</td><td>' + (f.fee_tier ? 'Tier ' + esc(f.fee_tier) + ' (' + esc(D.fee_tiers.labels[f.fee_tier]) + ', a planning assumption)' : 'unknown') + '</td></tr>'
    + '<tr><td>Capital tier</td><td>' + esc(f.capital_tier) + ' (planning assumption; capital is recoverable on exit)</td></tr>'
    + '<tr><td>Hold</td><td>' + f.hold_days + ' days (heuristic window)</td></tr>'
    + '<tr><td>Transactions</td><td>' + f.tx_min + '–' + f.tx_max + ' to set up, about ' + f.tx_weekly + ' a week, ' + f.bridge_tx + ' bridge</td></tr>'
    + '<tr><td>Assumed sunk cost</td><td>' + sunkLine(r) + '</td></tr>'
    + '<tr><td>Farm priority</td><td><strong>' + farmPriority(r) + '</strong></td></tr>'
    + '<tr><td>Farm verdict</td><td>' + verdictLine(r) + '</td></tr>'
    + '</tbody></table></div>'
    + '<div class="card"><h3>Farm priority rule</h3><p>Score = setup transactions + bridges + 1 if fee tier C + 1 if more than 8 distinct chains. 3 or fewer is Easy, 4 is Moderate, 5 or more is Complex; no chain recorded is High uncertainty. An execution label only — never an ROI score or a promise of return.</p>'
    + '<h3>Cost classes</h3><p>Known: action count, wallet, chain, approvals. Estimated: transaction counts, time, complexity. Live quote unavailable: gas, bridge, swap, slippage — get a quote before executing.</p></div></div>';
  h += '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li><label><input type="checkbox"> <span>' + esc(s) + '</span></label></li>'; }).join('') + '</ol>';
  h += renderGas();
  document.getElementById('planOut').innerHTML = h;
}
function renderCalc() {
  var r = rowBySlug(state.planSlug) || rows[0];
  var gas = Math.max(0, num('cGas', 0)), bridge = Math.max(0, num('cBridge', 0)), other = Math.max(0, num('cOther', 0));
  var lo = r.farm.tx_min * gas + r.farm.bridge_tx * bridge + other;
  var hi = r.farm.tx_max * gas + r.farm.bridge_tx * bridge + other;
  document.getElementById('cOut').textContent = 'Estimated total for ' + r.name + ': $' + lo.toFixed(2) + ' – $' + hi.toFixed(2) + ' (' + r.farm.tx_min + '–' + r.farm.tx_max + ' transactions × $' + gas.toFixed(2) + ' + ' + r.farm.bridge_tx + ' bridge × $' + bridge.toFixed(2) + ' + $' + other.toFixed(2) + '). User-supplied cost estimate — not a live quote.';
}

// Scatter: 118 peers (blue), 226 rows (grey), 40 watchlist (red), fitted curve. Log-log.
function renderScatter(){
  var cv=D.curve,pts=[],x0=1/0,x1=0,y0=1/0,y1=0,i,p;
  compList.forEach(function(c){pts.push([c.tvl_usd,c.mcap_usd,0]);});
  rows.forEach(function(r){pts.push([r.tvl_usd,r.implied_value_usd,r.watchlist?2:1]);});
  for(i=0;i<pts.length;i++){p=pts[i];if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];}
  x0=Math.pow(10,Math.floor(Math.log10(x0)));x1=Math.pow(10,Math.ceil(Math.log10(x1)));
  y0=Math.pow(10,Math.floor(Math.log10(y0)));y1=Math.pow(10,Math.ceil(Math.log10(y1)));
  var W=640,H=400,L=62,R=10,T=10,B=34,lx=Math.log10(x1/x0),ly=Math.log10(y1/y0);
  function X(v){return (L+Math.log10(v/x0)/lx*(W-L-R)).toFixed(1);}
  function Y(v,o){return (H-B-Math.log10(v/y0)/ly*(H-T-B)+(o||0)).toFixed(1);}
  var h='<svg class="scatter" viewBox="0 0 640 400">';
  for(p=x0;p<=x1;p*=10)h+='<line x1="'+X(p)+'" y1="'+T+'" x2="'+X(p)+'" y2="'+(H-B)+'" stroke="#d9dee4"/><text x="'+X(p)+'" y="'+(H-12)+'" font-size="11" fill="#5c6672" text-anchor="middle">'+money(p)+'</text>';
  for(p=y0;p<=y1;p*=10)h+='<line x1="'+L+'" y1="'+Y(p)+'" x2="'+(W-R)+'" y2="'+Y(p)+'" stroke="#d9dee4"/><text x="'+(L-6)+'" y="'+Y(p,4)+'" font-size="11" fill="#5c6672" text-anchor="end">'+money(p)+'</text>';
  var d='',v;
  for(v=x0;v<=x1;v*=1.4){var m=Math.exp(cv.intercept+cv.slope*Math.log(v));d+=(d?'L':'M')+X(v)+' '+Y(m)+' ';}
  h+='<path d="'+d+'" fill="none" stroke="#1d2530" stroke-width="2"/>';
  var col=['#0b5cad','#9aa5b1','#a33a00'];
  pts.forEach(function(q){h+='<circle cx="'+X(q[0])+'" cy="'+Y(q[1])+'" r="'+(q[2]===0?3:2.2)+'" fill="'+col[q[2]]+'"/>';});
  return h+'</svg>';
}

// Ambiguous records, delta-coded: 1st base36 char = shared slug prefix; then rest : TVL $K base36 : symbol. 272 rows.
var AMBIG='0aave-horizon-rwa:4ppw:AAVE,5v1:4zd:AAVE,63:8jsvg:AAVE,64:gtu0:AAVE,1di-bridge:4fq:ADI,1ero-basic:14t2:AERO,5slipstream:2ng9:AERO,4drome-ignition:f03:AERO,aslipstream:1is2:AERO,av1:wxp:AERO,2vo-perps:bdj:AEVO,1lchemix-v3:qgn:ALCX,2paca-finance-2.0:8sd:ALPACA,7leveraged-yield-farming:nur:ALPACA,1o-bridge:1l6j:AO,1peswap-amm:5xu:ABOND,1rbitrum-bridge:1snyb:ARB,9nova-bridge:6bc:ARB,2cadia-v2:3vx:AAA,1ster-asbnb:14gq:ASTER,6usdf:2eaf:ASTER,1valanche-core-bridge:2rkz:AVAX,4on-cedefi:1v5g:AVL,7superearn:31rz:AVL,1xelar:2rcv:AXL,0balancer-v2:azw:BAL,a3:7kd:BAL,2ncor-v2.1:5xz:BNT,83:9mu:BNT,1edrock-unibtc:5i2t:BR,beth:f6d:BR,2nqi-staked-avax:48i0:QI,1ifrost-liquid-staking:815:BNC,2nance-cex:1x42px:BNB,1lend-pools-v2:2d68:BLND,2uefin-spot:7vq:BLUE,1onk-staked-sol:4gu:BONK,1uzz-farming:lza:B2,0cetus-clmm:iit:CETUS,1hainflip-amm:83o:FLIP,3mber-vaults:gq5:DHT,1learpool-tpool:ap1:CPOOL,1ompound-v2:1tky:COMP,a3:ntrd:COMP,2nnext:h2p:NEXT,3tango-v2:4kf:TANGO,2oler-loans:3x3j:OHM,1rvusd:1ni6:CRV,1urve-dex:m6vg:CRV,6llamalend:1xlw:CRV,f-v2:oa6:CRV,0deepbook-v3:958:DEEP,2ri-v4:4v3:DERI,4ve-v3-options:3byr:DRV,2xalot-portfolio:45i:ALOT,1odo-amm:9q2:DODO,1rift-staked-sol:4n43:DRIFT,1xsale:cmq:DX,1ydx-v3:4jv:DYDX,64:1gj5:dYdX,0edgex-bridge:198m:EDGE,1thena-usde:2x2hv:ENA,atb:6t9o:ENA,4r.fi-liquid:6ymy:ETHFI,9stake:26pmr:ETHFI,5fi-borrowing-market:6blh:ETHFI,8cash-liquid:4wvh:ETHFI,1uler-v2:59si:EUL,1xtra-finance-leverage-farming:5ze:EXTRA,0fluid-dex:4efx:FLUID,6lending:cz15:FLUID,7ite:3piz:FLUID,1olks-finance-lending:fpt:FOLKS,1rax:kcu:FRAX,4-ether:20wj:FRAX,5swap:7f4:FRAX,5usd:20w6:FRAX,4lend:e9m:FRAX,4tal:3hge:FXTL,1utarchy-amm:a82:META,0gain:fb3:KERNEL,2te-us:14hu:GT,1lif:eim:GLF,1mx-evm:42u0:GMX,1oldfinger:i5p:ART,2plus-locker-v3:kve:GPS,1rvt-bridge:rt4:GRVT,0haedal-lending-vault:4x0:HAEDAL,7protocol:m0m:HAEDAL,2tom-lending:4uj:HTM,1ydration-lending:gex:HDX,4o-lending:43i:HDRO,7st:9al:HDRO,2perlend-pooled:5wtx:HPL,6iquid-bridge:3kezu:HYPE,cearn:vp37:HYPE,chlp:38bs:HYPE,cspot-orderbook:2j3a:HYPE,5swap-v2:4b9:SWAP,b3:81f:SWAP,0ichi:3ye:ICHI,1dex-v1:n3g:IDEX,1mmutable-zkevm:fob:IMX,0jito-liquid-staking:h07a:JTO,5restaking:aes:JTO,1oe-dex:722:JOE,1uicebox-v1:7mo:JBX,2piter-lend:jwv7:JUP,c-dex:qmm:JUP,8perpetual-exchange:cxcw:JUP,8staked-sol:8hvi:JUP,3usd:vkl:JUP,2stcryptos:19n1f:JST,4lend-strx:1u05h:JST,9v1:1wiy5:JST,0kamino-lend:p06m:KMNO,8iquidity:1cib:KMNO,1elp:f2qo:KERNEL,1inetiq-earn:mov:KNTQ,9lysium-bridge:141u:KNTQ,8khype:f8kw:KNTQ,9mhype:r1w:KNTQ,1odiak-islands:cpk:KDK,7v3:ago:KDK,1pk:4ay4:KPK,0layerbank:3vy:LAB,5zero-v2:aiq0m:ZRO,1ighter-bridge:c8ta:LIT,8llp:258c:LIT,8robinhood-perps:2drs:LIT,2near-protocol:wlw:LNR,2quity-v1:2xr1:LQTY,92:1mff:LQTY,2sta-cdp:16qu:LISTA,6dex:rgb:LISTA,6lending:i9wf:LISTA,7iquid-staking:dhd3:LISTA,1ombard-btc.b:34qj:BARD,8lbtc:9k2l:BARD,8vaults:1bzq:BARD,2renzo-enzobtc:8rkq:BANK,8susd1+:1pmq:BANK,0m0:5dgw:POWER,1aple:1bkxv:SYRUP,2rinade-liquid-staking:3rm2:MNDE,9native:5g62:MNDE,9select:1pma:MNDE,1ento-v2:6lc:MENTO,2rchant-moe-liquidity-book:7xm:MOE,2ta-pool-eth:fn7:MPDAO,anear:1kyi:MPDAO,3eora-damm-v1:vqc:MET,e2:du7:MET,9lmm:2sdy:MET,8vaults:uq4:MET,3is-bridge:hbo:METIS,3ronome-synth:6eo:MET,2zo-bridge:6gc:MEZO,1inswap-dex:9kw:MIN,1oonwell-lending:5c4:WELL,9vaults:5oa:WELL,2rpho-blue:673ur:MORPHO,7midnight:4cgf:MORPHO,1stable-v2:3zv:DHT,1ux-perps:6az:MCB,0navi-curator:brc:NAVX,5lending:29pk:NAVX,1ear-bridge:2bex:NEAR,5intents:3sci:NEAR,2opin-staking:v2e:NPT,2st-cl:ifu:NEST,2xus-mutual-insurance:1q5q:NXM,0optimism-bridge:a2if:OP,1rca-dex:5p8z:ORCA,2derly-bridge:e6p:ORDER,2igin-arm:84v:OGN,7dollar:46v:OGN,7ether:yxp:OGN,0pancakeswap-amm:soxb:CAKE,f-v3:ea6o:CAKE,cinfinity:1h0l:CAKE,2pertrade:g1w:PAPER,2radex-bridge:go8:DIME,1endle-loop:ui0:PENDLE,7v2:li9x:PENDLE,1haraoh-dlmm:51t:PHAR,8v3:kpd:PHAR,1robit-global:8oj:PROB,3xy:dod:PRXY,1uffer-stake:el0:PUFFER,2lsex-v1:l9e:PLSX,82:9nf:PLSX,2mpswap:5lny:PUMP,0quickswap-v3:c25:QUICK,0ramses-cl-v2:6be:RAM,2ydium-amm:jaoc:RAY,1ealt-rmm-marketplace-v2:mf0:REG,6tokens:3bmm:REG,1hea-dex:gqw:RHEA,5lend:2w21:RHEA,1iver-omni-cdp:1g1a:RIVER,1nt-lend:gpe:RNT,0sanctum-infinity:358d:SANC,8reserve:117q:SANC,8validator-lsts:vdat:SANC,2phyre-v3:8re:DRG,2ucerswap-v1:568:SAUCE,c2:9na:SAUCE,2ve:1d21:SAVE,4-sol:3xs:SAVE,1callop-lend:6av:SCA,1eamless-v2:41d:SEAM,1ky-lending:28qb5:SKY,4money:1v1k:SKY,4rwa:1bai:SKY,1odex-bridge:16xr:SOSO,2layer-restaking:5yt:LAYER,3v-basis-trading:3ocs:SOLV,5rwa:63h:SOLV,4btc:8m6z:SOLV,2sovalue-indexes:1tg1:SOSO,2vryn-dex:3ye:SOV,7zero:c7k:SOV,1park-liquidity-layer:1p2sd:SPK,6savings:q4u0:SPK,5dex-v3.1:3yb:SPRK,a4:95k:SPRK,5lend:2m5oy:SPK,2ectra-metavaults:4fm:SPECTRA,8v2:9j1:SPECTRA,1take-dao-yield:2k5v:SDT,5.link-liquid:1jww:SDL,5stone-stone:bed:STO,5wise-v3:g91f:SWISE,3rgate-v1:69p:STG,a2:1m67:STG,1uilend:2qfc:SEND,2mmer.fi-pro:9sc:SUMR,2nswap-v1:117k:SUN,92:5e2w:SUN,93:3azg:SUN,94:2skg:SUN,3x-bridge:g41:SUN,2perform:9la:UP,2shi-stellar:c7o:SUSHI,5swap-v3:rtq:SUSHI,1well-liquid-restaking:glr:SWELL,dstaking:g8r:SWELL,0tangible-rwa:vzm:TNGBL,1btc:64fr:T,1he-idols:404:VIRTUE,4vault-liquid-staking:27fh:V,0uncx-network-v2:2kkx:UNCX,e3:glp:UNCX,2iswap-v2:g67h:UNI,93:u7lb:UNI,94:nr6q:UNI,3tas-usdu:ygm:UP,4us:4pb:UTS,0vaulta-rex:ml9:EOS,1enus-core-pool:lq6f:XVS,2sper-v1:1kdu:VSP,82:6tx:VSP,1ires-finance:4i0:VIRES,1olo-lst:hek:NAVX,1vs-standard:1eqj:VVS,0xalgo-liquid-staking:gsg:FOLKS,0yearn-curating:12vt:YFI,6finance:2xxv:YFI,1o-protocol:nx5:YO,2uves:cp0:YOU,0zest-v2:xmm:ZEST';
function renderAmbig(){
  var prev='',list=AMBIG.split(',').map(function(s){var q=s.split(':'),n=parseInt(q[0][0],36);prev=prev.slice(0,n)+q[0].slice(1);return [prev,parseInt(q[1],36)*1000,q[2]];});
  var h='<details><summary>Ambiguous records — set aside, unverified <span>· 272 records · no market cap, but a symbol or CoinGecko id</span></summary>'
  +'<p class="dim">Each carries a symbol or a CoinGecko id but no market cap, so the board cannot tell whether a token exists: set aside, never tokenless. 14 share a symbol with a protocol here that records a market cap; 66 are versioned names; 3 are exchanges.</p>'
  +'<table><thead><tr><th>Protocol (slug)</th><th>TVL</th><th>Token identifier</th></tr></thead><tbody>'
  +list.map(function(r){return '<tr><td>'+esc(r[0])+'</td><td>'+money(r[1])+'</td><td>'+esc(r[2])+'</td></tr>';}).join('')
  +'</tbody></table></details>';
  return h;
}

// Gas snapshot: fee-tier map as assumed $ per transaction, from data.js.
function renderGas(){
  var tc=M.verdict_tx_cost||{A:0.05,B:0.5,C:5};
  var h='<details><summary>Gas cost snapshot <span>· '+D.fee_tiers.chains.length+' named chains · model planning assumptions, as of '+esc(D.as_of)+' — not live quotes</span></summary>'
  +'<p class="dim">Assumed cost of one transaction per named chain, from the fee-tier map: tier A $'+tc.A.toFixed(2)+', tier B $'+tc.B.toFixed(2)+', tier C $'+tc.C.toFixed(2)+'. '+esc(D.fee_tiers.note)+' Get a live quote before executing.</p>'
  +'<table><thead><tr><th>Chain</th><th>Tier</th><th>Assumed $ / tx</th></tr></thead><tbody>'
  +D.fee_tiers.chains.concat([{chain:'All other chains',tier:D.fee_tiers.default}]).map(function(c){return '<tr><td>'+esc(c.chain)+'</td><td>'+c.tier+'</td><td>$'+tc[c.tier].toFixed(2)+'</td></tr>';}).join('')
  +'</tbody></table></details>';
  return h;
}

// ---------- wiring and first render ----------
function fillSelect(id, values) {
  var sel = document.getElementById(id);
  values.forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
}
(function init() {
  var catSet = {}, chainSet = {};
  rows.forEach(function (r) { catSet[r.category || 'Uncategorized'] = 1; (r.chains || []).forEach(function (c) { chainSet[c] = 1; }); });
  fillSelect('fCat', Object.keys(catSet).sort());
  fillSelect('fChain', Object.keys(chainSet).sort());
  var pSel = document.getElementById('pSel');
  rows.forEach(function (r) { var o = document.createElement('option'); o.value = r.slug; o.textContent = '#' + r.rank + ' ' + r.name; pSel.appendChild(o); });
  document.getElementById('nav').addEventListener('click', function (e) { var b = e.target && e.target.closest ? e.target.closest('button[data-sec]') : null; if (b) show(b.getAttribute('data-sec')); });
  document.getElementById('fQ').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('fCat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('fChain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('fTvl').addEventListener('change', function (e) { state.tvl = parseFloat(e.target.value) || 0; renderBoard(); });
  document.getElementById('fConf').addEventListener('change', function (e) { state.conf = e.target.value; renderBoard(); });
  document.getElementById('fWatch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  document.getElementById('boardOut').addEventListener('click', function (e) {
    var th = e.target && e.target.closest ? e.target.closest('th[data-key]') : null;
    if (th) {
      var key = th.getAttribute('data-key');
      if (state.sort.key === key) state.sort.dir = -state.sort.dir;
      else state.sort = { key: key, dir: ({ rank: 1, name: 1, category: 1, tvl: -1, change: -1, value: -1, confidence: 1, verdict: 1, starter: 1 })[key] || 1 };
      renderBoard();
      return;
    }
    rowClick(e);
  });
  document.getElementById('movers').addEventListener('click', rowClick);
  document.getElementById('labOut').addEventListener('click', rowClick);
  document.getElementById('sensOut').addEventListener('click', rowClick);
  document.getElementById('detailOut').addEventListener('change', function (e) { if (e.target && e.target.id === 'dSel') selectRow(e.target.value); });
  ['Lsurv', 'LwLo', 'LwHi', 'Lmflo', 'Lmcap'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderLab); });
  ['LtxA', 'LtxB', 'LtxC', 'Lshare', 'LvFarm', 'LvThin'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderVerdicts); });
  document.getElementById('Lreset').addEventListener('click', function () {
    document.getElementById('Lsurv').value = defaults.surv;
    document.getElementById('LwLo').value = defaults.wlo;
    document.getElementById('LwHi').value = defaults.whi;
    document.getElementById('Lmflo').value = defaults.mflo;
    document.getElementById('Lmcap').value = defaults.mcap;
    var tc = M.verdict_tx_cost || { A: 0.05, B: 0.5, C: 5 };
    document.getElementById('LtxA').value = tc.A;
    document.getElementById('LtxB').value = tc.B;
    document.getElementById('LtxC').value = tc.C;
    document.getElementById('Lshare').value = M.verdict_capture_share === undefined ? 0.0001 : M.verdict_capture_share;
    document.getElementById('LvFarm').value = M.verdict_farm_ratio === undefined ? 10 : M.verdict_farm_ratio;
    document.getElementById('LvThin').value = M.verdict_thin_ratio === undefined ? 1 : M.verdict_thin_ratio;
    renderLab(); renderVerdicts();
  });
  pSel.addEventListener('change', function (e) { state.planSlug = e.target.value; renderPlanner(); renderCalc(); });
  ['cGas', 'cBridge', 'cOther'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderCalc); });
  var tc0 = M.verdict_tx_cost || { A: 0.05, B: 0.5, C: 5 };
  document.getElementById('LtxA').value = tc0.A;
  document.getElementById('LtxB').value = tc0.B;
  document.getElementById('LtxC').value = tc0.C;
  document.getElementById('Lshare').value = M.verdict_capture_share === undefined ? 0.0001 : M.verdict_capture_share;
  document.getElementById('LvFarm').value = M.verdict_farm_ratio === undefined ? 10 : M.verdict_farm_ratio;
  document.getElementById('LvThin').value = M.verdict_thin_ratio === undefined ? 1 : M.verdict_thin_ratio;
  renderBoard(); renderMovers(); renderDetail(); renderComps(); renderLab(); renderSens(); renderBlind(); renderSweep(); renderVerdicts(); renderPlanner(); renderCalc();
})();
})();
