#!/usr/bin/env node
/**
 * ablation — direct test of an overlay effect within one and the same store.
 *
 * Every page is measured twice with an identical settle delay:
 *   ON  — as served: the overlay loads and runs;
 *   OFF — requests to the overlay CDN are aborted, everything else identical.
 *
 * The ON-OFF difference is what the overlay actually repairs in the DOM.
 * Comparing within a store removes the "maybe the stores just differ" objection.
 */

import fs from 'node:fs';
import { chromium } from 'playwright';
import axePkg from '@axe-core/playwright';

const AxeBuilder = axePkg.default ?? axePkg.AxeBuilder ?? axePkg;

const args = process.argv.slice(2);
const urlsFile = args.find((a) => !a.startsWith('--'));
const getFlag = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=')[1] : d;
};
const OUT = getFlag('out', 'ablation');
const SETTLE = Number(getFlag('wait', 12000));
const CONC = Number(getFlag('concurrency', 3));
const LOCALE = getFlag('locale', 'de-DE');

const OVERLAY_HOSTS = [
  'acsbapp.com', 'accessibe.com', 'userway.org', 'equalweb.com', 'nagich.com',
  'nagich.co.il', 'audioeye.com', 'accessiblyapp.com', 'accessibilityspark.com',
  'maxaccess.io', 'adally.com', 'accessiway.com',
];

const DETECT = () => {
  const srcs = [...document.querySelectorAll('script[src], link[href]')]
    .map((n) => n.src || n.href || '').join(' ').toLowerCase();
  const html = document.documentElement.outerHTML.slice(0, 400000).toLowerCase();
  const has = (...n) => n.some((x) => srcs.includes(x) || html.includes(x));
  const o = [];
  if (has('acsbapp.com', 'acsbjs') || window.acsbJS) o.push('accessiBe');
  if (has('userway.org', 'userwayaccessibilityicon') || window.UserWay) o.push('UserWay');
  if (has('equalweb.com', 'nagich.co')) o.push('EqualWeb');
  if (has('audioeye.com') || window.__AudioEyeIsInitialized) o.push('AudioEye');
  if (has('accessiblyapp', 'accessibly-app')) o.push('Accessibly');
  if (has('maxaccess.io')) o.push('MaxAccess');
  return {
    overlays: [...new Set(o)],
    // did the widget actually run? look for its button/panel in the DOM
    widgetInDom: Boolean(
      document.querySelector('[id*="acsb" i], [class*="acsb" i], #userwayAccessibilityIcon, ' +
        '[class*="userway" i], [id*="userway" i], [class*="INDmenu" i], [id*="INDmenu" i], ' +
        '[id*="audioeye" i], [class*="audioeye" i], [class*="accessibly" i], [id*="accessibly" i]')
    ),
    imgTotal: document.querySelectorAll('img').length,
    imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
    imgEmptyAlt: [...document.querySelectorAll('img')].filter((i) => i.getAttribute('alt') === '').length,
  };
};

async function measure(browser, url, blockOverlay) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 a11y-probe/1.0',
    viewport: { width: 1440, height: 900 },
    locale: LOCALE,
    extraHTTPHeaders: { 'Accept-Language': LOCALE === 'de-DE' ? 'de-DE,de;q=0.9,en;q=0.8' : 'en-US,en;q=0.9' },
  });
  const rec = { url, mode: blockOverlay ? 'OFF' : 'ON', ok: false };
  try {
    if (blockOverlay) {
      await context.route('**/*', (route) => {
        const u = route.request().url();
        if (OVERLAY_HOSTS.some((h) => u.includes(h))) return route.abort();
        return route.continue();
      });
    }
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(SETTLE);
    Object.assign(rec, await page.evaluate(DETECT));
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    rec.byRule = {};
    let n = 0;
    for (const v of axe.violations) { rec.byRule[v.id] = v.nodes.length; n += v.nodes.length; }
    rec.violationNodes = n;
    rec.violationRules = axe.violations.length;
    rec.ok = true;
  } catch (e) {
    rec.error = String(e.message || e).slice(0, 160);
  } finally {
    await context.close().catch(() => {});
  }
  return rec;
}

async function main() {
  const urls = fs.readFileSync(urlsFile, 'utf8').split('\n')
    .map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const browser = await chromium.launch({ headless: true });
  const out = fs.createWriteStream(`${OUT}.jsonl`, { flags: 'w' });
  const pairs = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const u = urls[cursor++];
      // strictly sequential ON then OFF for one URL, so conditions match
      const on = await measure(browser, u, false);
      const off = await measure(browser, u, true);
      out.write(JSON.stringify(on) + '\n');
      out.write(JSON.stringify(off) + '\n');
      pairs.push({ url: u, on, off });
      const d = (on.ok && off.ok) ? (off.violationNodes - on.violationNodes) : null;
      console.log(`${u}\n   ON  ${on.ok ? on.violationNodes : 'ERR ' + on.error} (widget in DOM: ${on.widgetInDom})` +
        `\n   OFF ${off.ok ? off.violationNodes : 'ERR ' + off.error}` +
        `\n   nodes removed by overlay: ${d === null ? 'n/a' : d}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  out.end();
  await browser.close();

  const good = pairs.filter((p) => p.on.ok && p.off.ok);
  const diffs = good.map((p) => p.off.violationNodes - p.on.violationNodes);
  const sum = diffs.reduce((a, b) => a + b, 0);
  console.log('\n' + '='.repeat(60));
  console.log(`Pairs measured: ${good.length}`);
  console.log(`Total nodes, widget ON:   ${good.reduce((a, p) => a + p.on.violationNodes, 0)}`);
  console.log(`Total nodes, widget OFF:  ${good.reduce((a, p) => a + p.off.violationNodes, 0)}`);
  console.log(`Nodes removed by overlay: ${sum}`);
  console.log(`Pages where it removed anything: ${diffs.filter((d) => d > 0).length}`);
  console.log(`Pages where it made things WORSE: ${diffs.filter((d) => d < 0).length}`);
  console.log(`Pages with no change:             ${diffs.filter((d) => d === 0).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
