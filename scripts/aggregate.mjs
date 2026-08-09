#!/usr/bin/env node
/**
 * aggregate — turns raw ablation output into the tables published in RESULTS.md.
 *
 *   node aggregate.mjs run-a.jsonl run-b.jsonl --label="my sample"
 *
 * Two things happen here that are worth reading before trusting any number.
 *
 * 1. Pair validity. A page that failed to render produces a tiny node count on
 *    one side and a normal one on the other, and the difference is then read as
 *    a huge overlay effect. In this study a single such pair contributed +98
 *    nodes to a run whose total was +116. The guard below drops a pair when one
 *    side is nearly empty while the other is not, or when the two sides disagree
 *    about whether the page even had a <title>. See METHOD.md.
 *
 * 2. Two summaries, not one. The node-weighted share treats every violation node
 *    equally, so one large store dominates. The median across stores treats every
 *    store equally. They answer different questions and both are printed.
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flag = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const LABEL = flag('label', files.join(', '));

if (!files.length) {
  console.error('Usage: node aggregate.mjs <ablation-output.jsonl> [more.jsonl ...] [--label="..."]');
  process.exit(1);
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// A record carries byRule; document-title present means the rule FIRED, i.e. the
// page had no usable <title>.
const missingTitle = (rec) => Boolean(rec.byRule && rec.byRule['document-title']);

/**
 * Pair validity guard. Returns a reason string when the pair must be discarded.
 *
 * Thresholds were fixed before looking at which stores they would remove:
 * "nearly empty" is <= 3 violation nodes, "normal" is >= 15.
 */
function invalidReason(on, off) {
  // The manipulation must be verified, not assumed. If the OFF side aborted nothing,
  // the host list did not match the vendor's real CDN and both sides are the same
  // page — which yields a difference near zero and looks like a finding.
  // Older records predate this field; they are checked on the other two rules only.
  if (off.vendorHits === 0 && on.vendorHits > 0) return 'the OFF side blocked nothing — host list does not match this vendor';
  if (off.vendorHits === 0 && on.vendorHits === 0 && on.overlays?.length) {
    return 'no request to any known overlay host in either mode — nothing was switched off';
  }
  const lo = Math.min(on.violationNodes, off.violationNodes);
  const hi = Math.max(on.violationNodes, off.violationNodes);
  if (lo <= 3 && hi >= 15) return 'one side nearly empty while the other is not — a page that did not render';
  if (missingTitle(on) !== missingTitle(off)) return 'sides disagree on document-title — one of them is not the same page';
  return null;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ------------------------------------------------------------------ pairing

const byUrl = new Map();
for (const f of files) {
  for (const rec of readJsonl(f)) {
    if (!byUrl.has(rec.url)) byUrl.set(rec.url, {});
    byUrl.get(rec.url)[rec.mode] = rec;
  }
}

const pairs = [];
const dropped = [];
let incomplete = 0;
for (const [url, p] of byUrl) {
  if (!p.ON?.ok || !p.OFF?.ok) { incomplete++; continue; }
  const bad = invalidReason(p.ON, p.OFF);
  if (bad) { dropped.push({ url, on: p.ON.violationNodes, off: p.OFF.violationNodes, why: bad }); continue; }
  pairs.push({ url, store: hostOf(url), on: p.ON.violationNodes, off: p.OFF.violationNodes });
}

// ------------------------------------------------------------- aggregation

const perStore = new Map();
for (const p of pairs) {
  const s = perStore.get(p.store) || { pages: 0, on: 0, off: 0 };
  s.pages++; s.on += p.on; s.off += p.off;
  perStore.set(p.store, s);
}
const stores = [...perStore.values()];

const onTotal = pairs.reduce((a, p) => a + p.on, 0);
const offTotal = pairs.reduce((a, p) => a + p.off, 0);
const removed = offTotal - onTotal;
const shareRemoved = offTotal ? (100 * removed / offTotal) : 0;

const perStoreShares = stores.filter((s) => s.off > 0).map((s) => 100 * (s.off - s.on) / s.off);
const medianShare = median(perStoreShares) ?? 0;

const noChange = stores.filter((s) => s.off - s.on === 0).length;
const better = stores.filter((s) => s.off - s.on > 0).length;
const worse = stores.filter((s) => s.off - s.on < 0).length;

// ------------------------------------------------------------------ output

const pct = (x) => `${x.toFixed(1)}%`;
console.log('='.repeat(70));
console.log(`  ${LABEL}`);
console.log('='.repeat(70));
console.log(`Pairs usable:            ${pairs.length}`);
console.log(`Pairs dropped (invalid): ${dropped.length}`);
console.log(`Pairs incomplete:        ${incomplete}   (one side errored)`);
console.log(`Stores:                  ${stores.length}`);
console.log('');
console.log('--- node-weighted (one large store can dominate) ---------------------');
console.log(`  violation nodes, widget ON:   ${onTotal}`);
console.log(`  violation nodes, widget OFF:  ${offTotal}`);
console.log(`  removed by the overlay:       ${removed}  (${pct(shareRemoved)} of OFF)`);
console.log('');
console.log('--- per store (every store counts once) ------------------------------');
console.log(`  median share removed:         ${pct(medianShare)}`);
console.log(`  stores with no change:        ${noChange} of ${stores.length}`);
console.log(`  stores where ON was cleaner:  ${better}`);
console.log(`  stores where ON was worse:    ${worse}`);

if (dropped.length) {
  console.log('');
  console.log('--- dropped pairs ----------------------------------------------------');
  for (const d of dropped) console.log(`  ON=${d.on} OFF=${d.off}  ${d.why}`);
}
console.log('='.repeat(70));
