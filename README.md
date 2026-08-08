# Do accessibility overlays change the page underneath?

A measurement of what accessibility-overlay widgets do to the markup of Shopify
storefronts, using an ablation design: the same page, measured twice, seconds apart,
with the widget's script allowed and then blocked.

**Median change across stores: 0.0%. Reproduced in all five runs, across three
independently drawn samples.**

Node-weighted across all 186 page pairs the figure is 3.2%, with individual runs
ranging from 0.9% to 5.0%. Those two numbers answer different questions and
[RESULTS.md](RESULTS.md) reports both.

This measures **one thing only**: whether the source markup contains fewer WCAG
violations when the widget runs. It does not measure whether a widget helps anyone.
A tool that offers a genuinely useful reading mode or contrast switch scores 0.0%
here. Please read [LIMITATIONS.md](LIMITATIONS.md) before quoting any of this.

## Why ablation

The usual comparison — stores with a widget against stores without one — cannot work,
and the data shows why. Stores with a widget installed had *more* violations, not
fewer (median 25 against 14 in the German contour, p = 0.013). That is almost
certainly selection: you go looking for an accessibility tool because you have a
problem. The comparison cannot separate the effect of the tool from the reason
someone installed it.

Comparing a store against itself removes the problem. Same page, same network, same
viewport, same settle delay, same axe-core configuration, sixty seconds apart. One
variable: whether requests to the overlay's CDN succeed.

## What is here

| | |
|---|---|
| [METHOD.md](METHOD.md) | versions, browser context, delays, sampling, pair-validity rule |
| [RESULTS.md](RESULTS.md) | every table, with n |
| [LIMITATIONS.md](LIMITATIONS.md) | what these numbers are not allowed to mean |
| `scripts/a11y-probe.mjs` | bulk survey + overlay detection |
| `scripts/ablation.mjs` | paired ON/OFF measurement |
| `scripts/aggregate.mjs` | raw output → the published tables |
| `data/` | aggregated results, no store identifiers |

## Reproducing it

```bash
npm install
npx playwright install chromium

# urls.txt: one URL per line, stores that have an overlay installed
node scripts/ablation.mjs urls.txt --out=run1 --wait=12000 --locale=en-US
node scripts/ablation.mjs urls.txt --out=run2 --wait=12000 --locale=en-US
node scripts/aggregate.mjs run1.jsonl --label="run 1"
```

Run it at least twice on the same sample before believing a number. On this data the
same 20 stores gave 4.3% and 5.0% on consecutive runs.

Two mistakes are easy to make and both flatter the widget:

- **Unequal settle delays.** A storefront's own lazy-loading is still running early
  on, and its placeholders count as images with no alt text. One store measured 46
  nodes at a 5 s delay and 21 at 20 s — a 54% "improvement" produced entirely by
  waiting longer. At equal delays, widget on against widget blocked, it was 46 and 46.
- **Pages that did not render.** A blank page returns a handful of nodes instead of
  dozens, and the pair reports a huge effect. One such pair contributed +98 nodes to
  a run whose total was +116. `aggregate.mjs` drops these; the rule is in
  [METHOD.md](METHOD.md#pair-validity).

## Store identifiers

Deliberately absent — no domains, no raw HTML, no screenshots. These stores did not
agree to be measured, and a list of named sites with their violation counts is a list
of targets, not a methods note. The cost is that you cannot check my arithmetic
against my inputs; you can only re-run the method on a sample you draw yourself.
That trade-off is stated again in [LIMITATIONS.md](LIMITATIONS.md).

## Scope

Not legal advice, and not a compliance assessment. Nothing here establishes whether
any site meets any legal requirement anywhere. Automated tooling checks a minority of
WCAG success criteria; conformance is a judgement about a whole product that a
scanner is not competent to make.

## Licence

MIT for the code, CC BY 4.0 for the text and data. See [LICENSE](LICENSE).
