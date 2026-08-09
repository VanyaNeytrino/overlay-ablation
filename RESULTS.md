# Results

Every number here was re-derived from the raw measurement files by
`scripts/aggregate.mjs` and the survey summary, not copied from notes.
Raw per-store files are not published — see [LIMITATIONS.md](LIMITATIONS.md).

Measured 2026-08-05 … 2026-08-08.

---

## 1. The survey

A one-shot scan of Shopify storefronts, homepage plus one product page per store.

| | |
|---|---|
| URLs attempted | 744 |
| pages measured successfully and confirmed Shopify | 729 |
| distinct stores | **367** |
| violation nodes found in total | **18,383** |

The 367 stores were drawn in two contours: a German-domain pool (233 stores) and an
international pool (136 stores). Those add up to 369, not 367, because two stores
appear in both pools; they are counted once each in the contour tables below and
once overall.

### What kind of violations they are

Buckets are defined in `scripts/a11y-probe.mjs` and were fixed before the scan.

| bucket | what it means | nodes | share |
|---|---|---|---|
| `auto` | deterministic fix, no meaning to invent (attributes, structure, ordering) | 3,037 | 16.5% |
| `ai` | deterministic to detect, but the fix is generated text (alt, link/button name) | 5,824 | 31.7% |
| `design` | fixable, but the visual design changes (contrast, target size) | 9,219 | 50.1% |
| `manual` | needs a human (captions, focus logic, custom widgets) | 303 | 1.6% |
| | **total** | **18,383** | |

A single rule, `color-contrast`, accounts for 9,219 nodes — **50.1% of everything
found**. Any statement of the form "N% of accessibility problems are automatable"
is really a statement about how you treat contrast.

`auto` + `ai` together are **48.2%**.

### Overlay penetration

| pool | stores with an overlay | of | share |
|---|---|---|---|
| German-domain Shopify stores | 16 | 886 | **1.8%** |
| global Shopify sample | 370 | 5,326 | **6.9%** |

Note the tension with the section below: 17 of the 233 measured German stores carry an
overlay, which is 7.3%, not 1.8%. Both figures are right. The measured set was
deliberately enriched with overlay stores — at their natural 1.8% rate a draw of 233
would hold about four of them, too few to compare. The enrichment does not affect the
ablation, where each store is its own control, but it is one more reason the
between-store comparison is not representative.

---

## 2. Comparing stores with and without an overlay

The obvious first cut, and the weakest one. Group A has an overlay installed,
group B does not. Median violation nodes per store:

| contour | A (overlay) | B (no overlay) | median A | median B | difference | Mann–Whitney |
|---|---|---|---|---|---|---|
| German | 17 stores | 216 stores | 25 | 14 | **+78.6%** | z = 2.48, p = 0.013 |
| international | 65 stores | 71 stores | 18.5 | 17.5 | +5.7% | z = −0.90, p = 0.369 |

Stores with an overlay were not cleaner. In the German contour they were
measurably *worse*.

**This proves nothing about overlays.** Stores that buy an accessibility widget
plausibly had more problems to begin with — that is why someone went looking for a
widget. The comparison cannot separate the effect of the tool from the reason it
was installed. It is reported because it is the analysis most people run, and
because its result points in the opposite direction from the marketing.

Nor is the reason for the German gap identified here. The obvious candidate — that
overlay stores simply serve heavier pages — does not account for it: their median page
carries 3,068 DOM nodes against 2,714 for the group without a widget, and in the
international contour the two groups are indistinguishable (2,744 against 2,769). A
13% difference in page weight does not produce a 78.6% difference in violation nodes.
What does produce it is unknown, and that is precisely why this comparison cannot be
used.

The next section is the test that does separate them.

---

## 3. Ablation — the actual test

Each page is measured twice, with an identical settle delay, in the same session
conditions. The only difference between the two runs is that requests to the
overlay's CDN are aborted in one of them. Everything else — network, viewport,
locale, wait, axe-core configuration — is held fixed. The difference between the
two measurements is what the widget does to the page.

Comparing a store against itself removes the selection problem entirely.

The ablation covers **56 distinct stores**: 16 German, 20 international, 20 fresh. Two
of the three samples were measured twice, and one vendor had to be measured again after
the host-list bug described below, which is how 56 stores give **92 store-runs**.

| run | page pairs | stores | nodes removed | out of | share | median per store |
|---|---|---|---|---|---|---|
| German | 14 | 7 | 12 | 468 | 2.6% | 0.0% |
| English, run 1 | 35 | 18 | 106 | 1,920 | 5.5% | 0.0% |
| English, run 2 | 35 | 18 | 99 | 1,921 | 5.2% | 0.0% |
| Fresh, run 1 | 37 | 19 | 41 | 1,343 | 3.1% | 0.0% |
| Fresh, run 2 | 35 | 18 | 17 | 1,215 | 1.4% | 0.0% |
| Accessibly, re-measured | 23 | 12 | −3 | 905 | −0.3% | 0.0% |
| **all six** | **179** | **56** | **272** | **7,772** | **3.5%** | **0.0%** |

Read the last two columns together, because they disagree on purpose:

- **3.5%** is node-weighted. Every violation node counts equally, so a single
  large storefront can carry the whole figure.
- **0.0%** is the median across stores. Every store counts once. It came out at
  zero in all six runs, across three samples drawn at different times.

The widgets present in the ablation sample were UserWay (23 stores), accessiBe (15),
Accessibly (12), EqualWeb (4) and AudioEye (2). **Results are not broken down by
product.** The split is uneven and no per-vendor figure drawn from this sample would
survive its own sample size. Nothing in these tables should be attached to any one
named product.

Supporting counts:

- per-run share ranges from **−0.3% to 5.5%**
- **56 of 92** store-run observations showed no change at all — 61%
- in every run, some stores came out *worse* with the widget enabled than with it
  blocked (1, 3, 2, 2, 4, 2 stores respectively). Mostly noise: across the two English
  runs 3 different stores came out worse and only 2 did so both times; across the two
  fresh runs, 4 different stores and again only 2 both times
- the selection chain, so the denominator can be reconstructed: **192** pairs attempted
  in the five original runs, **3** lost to a 40 s navigation timeout, **3** discarded by
  the render rules, **30** excluded because the block never engaged for one vendor,
  **+23** re-measured with the host list corrected, **179** analysed

Run-to-run reproducibility, measured on the samples that were run twice: **17 of 18**
stores in the English sample and **16 of 18** in the fresh one landed within three
violation nodes of their first result, and the direction of change agreed for 14 of 18
and 15 of 18 respectively. **No store was ever dropped for failing to reproduce** —
the only exclusions are the render rules and the vendor whose script was never blocked.

Per-run and per-store figures: [`data/ablation-by-run.csv`](data/ablation-by-run.csv),
[`data/ablation-by-store-anonymised.csv`](data/ablation-by-store-anonymised.csv).

### What was thrown away, and why

Three failure modes were found while checking these runs. All three are easy to hit and
all three push the result in the flattering direction, so they are worth naming.

**Lazy loading.** Two measurements of one storefront at different settle delays, 5 s
and 20 s, gave 46 violation nodes and 21 — a 54% drop that looked like the widget
working. It was not. Almost all of the difference is one rule: `image-alt` fell from
31 to 7, while the page's DOM grew from 2,336 nodes to 2,466. The storefront's own
lazy-loading was still running at 5 s, and the placeholders it had not yet swapped
out were counted as images with no alt text. Re-measured as a proper pair at an
identical delay, ON and OFF gave 46 and 46. The fix belongs in the method, not the
analysis: `ablation.mjs` measures ON and OFF strictly sequentially for one URL with a
single `SETTLE` value.

**Pages that did not render.** A page that fails to load returns a handful of nodes
instead of dozens, and the pair then reports an enormous difference. One such pair
contributed +98 nodes to a run whose total was +116 — that one broken render was
most of the run. `aggregate.mjs` now drops a pair when one side has ≤ 3 violation
nodes while the other has ≥ 15, or when the two sides disagree about whether the
page had a `<title>` at all. The thresholds were written down before checking which
stores they would remove. They remove 4 pairs across the whole study.

**A vendor that was never switched off.** The OFF side aborts requests whose URL
contains one of the hosts in `OVERLAY_HOSTS`. That list read `accessiblyapp.com`;
Accessibly serves from `cdn.accessibly.app`. The substring never matched, so across
every run that vendor's script loaded on both sides and 30 pairs counted as ablations
were the same page measured twice.

Nothing looked wrong, which is the point. Those pairs produced small differences around
zero — the study's own conclusion — so the bug was holding the result up rather than
knocking it down.

Two corrections came out of it. The 30 pairs are excluded and those 12 stores were
re-measured with the list fixed; properly switched off, that vendor removes −3 nodes
across 23 pairs. And `widgetInDom` was retired as a validity signal: it is
vendor-dependent, because Accessibly's trigger button is rendered into the page by the
Shopify app and stays there whether or not the script loads. What settles the question
is the request log, now recorded as `vendorHits` on both sides and enforced in
`aggregate.mjs`.

None of the three was invented for this write-up; all three were found by re-running
measurements that had already been recorded as results.

---

## 4. Contrast

`color-contrast` is half the violation mass, so it was examined separately: if a
small number of colour pairs generated most of the contrast nodes, contrast would be
fixable centrally, in a theme, rather than node by node.

- 990 contrast nodes examined across 30 stores
- the median store needs **2 colour pairs to cover 80%** of its contrast nodes
- share of stores where a central fix reaches the pre-set coverage bar: **39.6%**,
  against a threshold of **40%** fixed in advance

The threshold was not moved. 39.6% against 40% is a difference of four nodes out of
990 — this is a coin landing on its edge, not a finding. It is reported as
"undecided at this sample size", and the honest read is that the test needs a larger
sample rather than a verdict.

A further caveat on contrast: **132 nodes (13.3%), across five stores, have a
computed contrast ratio below 1.1** — text essentially the same colour as its
background. That is the signature of an element that is invisible for some other
reason, not of unreadable text. Those nodes were not visually inspected, and they
are counted in the totals above.

---

## 5. Stability checks

| check | result |
|---|---|
| pages re-measured to test drift | 48 of 60 identical; overall drift −1.1% |
| `label` rule as a share of all findings | 89 nodes of 18,383 = 0.5% |

The `label` line is a ceiling, not a finding. Hidden anti-spam honeypot fields have
no label deliberately, and axe-core counts them. 0.5% is the largest amount by
which honeypots could distort anything above, and the real number is smaller.

---

## 6. What these numbers do not say

Collected in [LIMITATIONS.md](LIMITATIONS.md). Read it before quoting anything here.
The short version: axe-core detects a minority of WCAG criteria; two pages per store
is not a store; a widget that does not change the DOM may still help a keyboard user
through its own interface, and that was not measured.
