# Method

Enough detail to repeat this on your own sample and get comparable numbers.

## Environment

| | |
|---|---|
| axe-core | 4.12.1 |
| @axe-core/playwright | 4.12.1 |
| Playwright | 1.62.1 |
| Chromium | 151.0.7922.34 (headless shell) |
| Node | 23.7.0 |
| host OS | macOS (darwin 25.5.0) |
| network position | German exit node, for every measurement |
| dates | 2026-08-05 … 2026-08-08 |

Versions matter more than they look. axe-core changes rule behaviour between minor
releases; a count taken with 4.12.1 is not directly comparable with one from 4.9.

## Browser context

Identical for the survey and for both sides of every ablation pair:

```js
viewport: { width: 1440, height: 900 }
locale:   'de-DE'            // German contour; 'en-US' otherwise
extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' }
userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 a11y-probe/1.0'
headless: true
```

The user agent identifies the crawler rather than pretending to be an ordinary
browser.

## axe-core configuration

```js
new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
```

No rules disabled, no rules added, default impact levels. The unit counted
everywhere is the **violation node** — one element failing one rule — summed across
rules. Not "number of rules violated", not "number of pages with a problem".

## Navigation and settle delay

```js
await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
await page.waitForTimeout(SETTLE);
```

| | timeout | settle |
|---|---|---|
| survey (`a11y-probe.mjs`) | 30 s, retried at 75 s | 5,000 ms |
| ablation (`ablation.mjs`) | 40 s | 12,000 ms |

`domcontentloaded` rather than `networkidle`: storefronts with chat widgets, pixels
and video backgrounds frequently never go idle, and waiting for that silently drops
the slowest sites from the sample. A fixed settle delay is cruder but does not
correlate with what a page happens to load.

The longer settle in ablation exists because an overlay needs time to initialise and
rewrite the DOM. Measuring before it has run would guarantee the answer.

**The settle delay must be identical on both sides of a pair.** This is not a detail.
See "Lazy loading" in [RESULTS.md](RESULTS.md#what-was-thrown-away-and-why): the same
storefront measured 46 violation nodes at 5 s and 21 at 20 s, a 54% swing produced
entirely by the site's own lazy-loading finishing between the two.

In the survey, a 30 s timeout lost 98 of 466 URLs. Retrying the failures at 75 s
recovered 94, bringing completion to 462 of 466 (99.1%). Sites that time out are not
a random subset — they are the slow, heavy ones — so dropping them quietly would bias
the sample.

## The ablation

For each URL, in one process, sequentially:

1. **ON** — load and measure as served.
2. **OFF** — load and measure with every request whose URL contains an overlay host
   aborted via `context.route`.

```js
const OVERLAY_HOSTS = [
  'acsbapp.com', 'accessibe.com', 'userway.org', 'equalweb.com', 'nagich.com',
  'nagich.co.il', 'audioeye.com', 'accessiblyapp.com', 'accessibilityspark.com',
  'maxaccess.io', 'adally.com', 'accessiway.com',
];
```

Sequential rather than parallel, so that both sides see the same network conditions,
the same CDN edge and the same storefront state. A fresh `BrowserContext` per
measurement, so no cache or storage carries between the two sides.

Each ON record also stores `widgetInDom`: whether the widget's own button or panel is
present after the settle delay. A pair where the widget never appeared on the ON side
is not testing anything.

## Pair validity

A pair is discarded when either holds:

- one side has **≤ 3** violation nodes while the other has **≥ 15**
- the two sides **disagree on `document-title`** — one of them had no usable `<title>`

Both signal a page that failed to render rather than a page the widget repaired.
The thresholds were written down before checking which stores they would remove.
They remove **3 pairs of 201 (1.5%)**. Implemented in `scripts/aggregate.mjs`,
function `invalidReason`.

## How results are summarised

Two figures, always both:

- **node-weighted share** — `(OFF − ON) / OFF` summed over all pairs. Every violation
  node counts equally, so a large storefront can dominate a run.
- **median across stores** — per-store share first, then the median. Every store
  counts once.

They answer different questions. Quoting one without the other is how a 0.0% result
gets published as 3.2%, or the reverse.

## Sampling

- **German pool** — domains from a public top-sites list filtered to `.de`, then
  resolved by DNS and kept when they land in Shopify's IP range (`23.227.38.0/24`).
  DNS filtering is roughly two orders of magnitude faster than fetching each site,
  which is what made a pool of this size affordable.
- **International pool** — same approach without the TLD filter.
- **Overlay stores** — the same pools, filtered to stores where the overlay detector
  fired. At 1.8% penetration in the German pool these are rare, so the ablation sample
  is small and is not a random sample of Shopify.
- **Fresh sample** — 20 stores that had never been measured, drawn after the first
  results existed, specifically to check whether the finding survived contact with
  data it had not been derived from.

Two URLs per store: the homepage, and one product URL taken from the store's own
`/products.json`.

## robots.txt

Every URL is checked against the store's `robots.txt` before it is fetched, and
disallowed paths are skipped.

Wildcards must be expanded into a regular expression, not truncated at the first `*`.
Truncating turns `Disallow: /*/cart/` into `Disallow: /`, which reads as "this entire
site is off limits". That bug silently excluded 854 of 900 stores before it was
caught — a sample that shrinks by 95% for a mundane reason looks a lot like a sample
that was simply small.

## Reproducing

```bash
npm install
npx playwright install chromium

# survey
node scripts/a11y-probe.mjs urls.txt --concurrency=4 --out=results

# ablation: urls.txt should contain stores that have an overlay installed
node scripts/ablation.mjs urls.txt --out=run1 --wait=12000 --locale=en-US
node scripts/ablation.mjs urls.txt --out=run2 --wait=12000 --locale=en-US

node scripts/aggregate.mjs run1.jsonl --label="run 1"
node scripts/aggregate.mjs run2.jsonl --label="run 2"
```

Run the ablation at least twice on the same sample. A single run does not tell you
how much of what you are seeing is run-to-run noise, and on this data the answer was
"enough to matter": the same 20 stores gave 4.3% and 5.0% on consecutive runs, and a
different sample gave 2.8% and 1.4%.

## Courtesy

Concurrency 3–4, two pages per store, one pass. This is a lighter load than a single
human browsing the store. Nothing here submits forms, creates accounts, adds to cart
or touches checkout.
