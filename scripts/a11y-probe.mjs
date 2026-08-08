#!/usr/bin/env node
/**
 * a11y-probe — bulk WCAG 2.1 AA scan of Shopify storefronts,
 * plus detection of installed accessibility-overlay apps.
 *
 * The survey answers two questions.
 *   1. How bad is it on average (violation nodes per store)?
 *   2. Do stores WITH an overlay differ from stores WITHOUT one?
 *      A between-store comparison is only a hint: see ablation.mjs for the
 *
 *      decisive within-store test.
 *
 * Install:
 *   npm init -y && npm pkg set type=module
 *   npm i playwright @axe-core/playwright
 *   npx playwright install chromium
 *
 * Run:
 *   node a11y-probe.mjs urls.txt --concurrency=4 --out=results
 *
 * urls.txt — one domain per line, protocol optional.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import axePkg from '@axe-core/playwright';

const AxeBuilder = axePkg.default ?? axePkg.AxeBuilder ?? axePkg;

// ------------------------------------------------------------- parameters

const args = process.argv.slice(2);
const urlsFile = args.find((a) => !a.startsWith('--'));
const getFlag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};

const CONCURRENCY = Number(getFlag('concurrency', 4));
const OUT_PREFIX = getFlag('out', 'results');
const NAV_TIMEOUT = Number(getFlag('timeout', 30000));
const SETTLE = Number(getFlag('wait', 5000));

if (!urlsFile) {
  console.error('Usage: node a11y-probe.mjs urls.txt [--concurrency=4] [--out=results]');
  process.exit(1);
}

// ------------------------------------------------------ violation buckets
//
// auto   — deterministically fixable without generating meaning (attributes,
//          ordering, structure).
// ai     — detection is deterministic, but the fix requires generating text
//          (alt text, link/button name).
// design — fixable but changes the visual design (contrast, target size).
// manual — needs a human (captions, focus logic, custom widgets).

const BUCKETS = {
  auto: new Set([
    'html-has-lang', 'html-lang-valid', 'valid-lang', 'html-xml-lang-mismatch',
    'document-title', 'frame-title', 'frame-title-unique',
    'duplicate-id-aria', 'duplicate-id-active', 'duplicate-id',
    'aria-required-attr', 'aria-required-children', 'aria-required-parent',
    'aria-valid-attr', 'aria-valid-attr-value', 'aria-allowed-attr',
    'aria-allowed-role', 'aria-hidden-body', 'aria-hidden-focus',
    'aria-roles', 'aria-text', 'aria-toggle-field-name',
    'heading-order', 'empty-heading', 'empty-table-header',
    'list', 'listitem', 'definition-list', 'dlitem',
    'meta-viewport', 'meta-viewport-large', 'meta-refresh',
    'td-headers-attr', 'th-has-data-cells', 'table-fake-caption',
    'scrollable-region-focusable', 'tabindex', 'bypass',
    'landmark-one-main', 'landmark-unique', 'region',
    'nested-interactive', 'presentation-role-conflict',
    'form-field-multiple-labels', 'select-name', 'label-title-only',
    'autocomplete-valid', 'identical-links-same-purpose',
  ]),
  ai: new Set([
    'image-alt', 'input-image-alt', 'area-alt', 'role-img-alt',
    'svg-img-alt', 'object-alt', 'image-redundant-alt',
    'link-name', 'button-name', 'input-button-name', 'label',
    'aria-command-name', 'aria-input-field-name', 'aria-meter-name',
    'aria-progressbar-name', 'aria-tooltip-name', 'aria-dialog-name',
    'link-in-text-block',
  ]),
  design: new Set([
    'color-contrast', 'color-contrast-enhanced', 'target-size',
    'focus-order-semantics',
  ]),
};

const bucketOf = (ruleId) => {
  if (BUCKETS.auto.has(ruleId)) return 'auto';
  if (BUCKETS.ai.has(ruleId)) return 'ai';
  if (BUCKETS.design.has(ruleId)) return 'design';
  return 'manual';
};

// -------------------------------------------------------- overlay detect
// Runs in page context after the settle delay.

const DETECT_JS = () => {
  const srcs = [...document.querySelectorAll('script[src], link[href]')]
    .map((n) => n.src || n.href || '')
    .join(' ')
    .toLowerCase();
  const html = document.documentElement.outerHTML.slice(0, 400000).toLowerCase();

  const has = (...needles) => needles.some((n) => srcs.includes(n) || html.includes(n));

  const overlays = [];
  if (has('acsbapp.com', 'acsbjs', 'acsb-trigger') || window.acsbJS) overlays.push('accessiBe');
  if (has('userway.org', 'userwayaccessibilityicon') || window.UserWay) overlays.push('UserWay');
  if (has('equalweb.com', 'nagich.co.il', 'initpath')) overlays.push('EqualWeb');
  if (has('audioeye.com', 'ae-observer') || window.__AudioEyeIsInitialized) overlays.push('AudioEye');
  if (has('accessibe.com')) overlays.push('accessiBe');
  if (has('accessiblyapp', 'accessibly-app')) overlays.push('Accessibly');
  if (has('accessibilityspark')) overlays.push('AccessibilitySpark');
  if (has('maxaccess.io')) overlays.push('MaxAccess');
  if (has('adally.com')) overlays.push('Adally');

  // Shopify-specific fields
  const S = window.Shopify || {};
  const themeName = (S.theme && (S.theme.name || S.theme.theme_store_id)) || null;

  return {
    isShopify: Boolean(S.shop || document.querySelector('link[href*="cdn.shopify.com"]')),
    shop: S.shop || null,
    themeName: themeName ? String(themeName) : null,
    themeRole: (S.theme && S.theme.role) || null,
    locale: S.locale || document.documentElement.lang || null,
    currency: (S.currency && S.currency.active) || null,
    countryHint: (S.country) || null,
    overlays: [...new Set(overlays)],
    domNodes: document.querySelectorAll('*').length,
    hasAccessibilityStatement: /barrierefreiheit|accessibility statement|erkl(ä|ae)rung zur barrierefreiheit|d(é|e)claration d'accessibilit(é|e)/i
      .test(document.body ? document.body.innerText.slice(0, 200000) : ''),
  };
};

// ---------------------------------------------------------------- one site

async function probe(context, rawUrl) {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  const page = await context.newPage();
  const record = { url, ok: false };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    // Give the overlay time to run. This matters: the question is whether it
    // repairs anything AFTER initialisation.
    await page.waitForTimeout(SETTLE);

    const meta = await page.evaluate(DETECT_JS);
    Object.assign(record, meta);

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const byRule = {};
    const byBucket = { auto: 0, ai: 0, design: 0, manual: 0 };
    let nodesTotal = 0;

    for (const v of axe.violations) {
      const n = v.nodes.length;
      nodesTotal += n;
      byRule[v.id] = { count: n, impact: v.impact, bucket: bucketOf(v.id) };
      byBucket[bucketOf(v.id)] += n;
    }

    record.ok = true;
    record.violationRules = axe.violations.length;
    record.violationNodes = nodesTotal;
    record.byBucket = byBucket;
    record.byRule = byRule;
    record.fixableShare = nodesTotal
      ? Number(((byBucket.auto + byBucket.ai) / nodesTotal).toFixed(3))
      : null;
    record.incomplete = axe.incomplete.length;
  } catch (err) {
    record.error = String(err.message || err).slice(0, 200);
  } finally {
    await page.close().catch(() => {});
  }

  return record;
}

// ------------------------------------------------------------ worker pool

async function run() {
  const urls = fs.readFileSync(urlsFile, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));

  console.log(`Scanning ${urls.length} sites, concurrency ${CONCURRENCY}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 a11y-probe/1.0',
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' },
  });

  const results = [];
  const jsonl = fs.createWriteStream(`${OUT_PREFIX}.jsonl`, { flags: 'w' });
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      const r = await probe(context, urls[i]);
      results.push(r);
      jsonl.write(JSON.stringify(r) + '\n');
      done++;
      const tag = r.ok
        ? `${String(r.violationNodes).padStart(4)} violation nodes` +
          (r.overlays?.length ? `  [${r.overlays.join(',')}]` : '')
        : `ERROR: ${r.error}`;
      console.log(`[${String(done).padStart(4)}/${urls.length}] ${r.url} — ${tag}`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  jsonl.end();
  await browser.close();

  report(results);
}

// ---------------------------------------------------------------- summary

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function report(results) {
  const ok = results.filter((r) => r.ok);
  const shopify = ok.filter((r) => r.isShopify);
  const withOverlay = ok.filter((r) => r.overlays?.length);
  const without = ok.filter((r) => !r.overlays?.length);

  const stat = (set) => ({
    n: set.length,
    median: median(set.map((r) => r.violationNodes)),
    mean: set.length
      ? Math.round(set.reduce((s, r) => s + r.violationNodes, 0) / set.length)
      : null,
    clean: set.filter((r) => r.violationNodes === 0).length,
  });

  const a = stat(withOverlay);
  const b = stat(without);

  const bucketTotals = ok.reduce((acc, r) => {
    for (const k of Object.keys(acc)) acc[k] += r.byBucket?.[k] || 0;
    return acc;
  }, { auto: 0, ai: 0, design: 0, manual: 0 });
  const grand = Object.values(bucketTotals).reduce((s, v) => s + v, 0) || 1;

  const ruleFreq = {};
  for (const r of ok) {
    for (const [id, v] of Object.entries(r.byRule || {})) {
      ruleFreq[id] = ruleFreq[id] || { nodes: 0, sites: 0, bucket: v.bucket };
      ruleFreq[id].nodes += v.count;
      ruleFreq[id].sites += 1;
    }
  }
  const topRules = Object.entries(ruleFreq)
    .sort((x, y) => y[1].sites - x[1].sites)
    .slice(0, 20);

  const L = [];
  L.push('');
  L.push('='.repeat(72));
  L.push('  SUMMARY');
  L.push('='.repeat(72));
  L.push(`Sites total: ${results.length}   ok: ${ok.length}   Shopify: ${shopify.length}`);
  L.push(`With an overlay: ${withOverlay.length} (${((withOverlay.length / (ok.length || 1)) * 100).toFixed(1)}%)`);
  L.push('');
  L.push('--- Between-store comparison (a hint, not proof) ---------------------');
  L.push(`  with overlay     n=${a.n}  median ${a.median}  mean ${a.mean}  clean ${a.clean}`);
  L.push(`  without overlay  n=${b.n}  median ${b.median}  mean ${b.mean}  clean ${b.clean}`);
  if (a.n >= 5 && b.n >= 5 && a.median !== null && b.median !== null) {
    const delta = ((1 - a.median / b.median) * 100).toFixed(1);
    L.push(`  difference of medians: ${delta}%`);
    L.push(delta < 25
      ? '  => medians close: no visible overlay effect. Confirm with ablation.mjs.'
      : '  => medians differ: could be the overlay, could be site selection.');
  } else {
    L.push('  (too few sites in one group — at least 5 per group are needed)');
  }
  L.push('');
  L.push('--- How much of the violation mass is machine-fixable ----------------');
  for (const [k, v] of Object.entries(bucketTotals)) {
    L.push(`  ${k.padEnd(7)} ${String(v).padStart(6)}  ${((v / grand) * 100).toFixed(1)}%`);
  }
  const auto = (bucketTotals.auto + bucketTotals.ai) / grand;
  L.push(`  auto+ai = ${(auto * 100).toFixed(1)}%  ` +
    (auto >= 0.6 ? '=> above the 60% threshold' : '=> below the 60% threshold'));
  L.push('');
  L.push('--- Top 20 rules by number of sites affected -------------------------');
  for (const [id, v] of topRules) {
    L.push(`  ${id.padEnd(30)} sites ${String(v.sites).padStart(4)}  nodes ${String(v.nodes).padStart(6)}  [${v.bucket}]`);
  }
  L.push('='.repeat(72));

  const text = L.join('\n');
  console.log(text);
  fs.writeFileSync(`${OUT_PREFIX}-summary.txt`, text);

  const csv = ['url,shopify,theme,overlays,violation_nodes,auto,ai,design,manual,fixable_share'];
  for (const r of ok) {
    csv.push([
      r.url, r.isShopify, JSON.stringify(r.themeName || ''),
      JSON.stringify((r.overlays || []).join('|')),
      r.violationNodes, r.byBucket.auto, r.byBucket.ai,
      r.byBucket.design, r.byBucket.manual, r.fixableShare,
    ].join(','));
  }
  fs.writeFileSync(`${OUT_PREFIX}.csv`, csv.join('\n'));

  console.log(`\nFiles: ${OUT_PREFIX}.jsonl, ${OUT_PREFIX}.csv, ${OUT_PREFIX}-summary.txt`);
}

run().catch((e) => { console.error(e); process.exit(1); });
