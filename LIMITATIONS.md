# Limitations

These are not caveats added at the end. They bound what the numbers in
[RESULTS.md](RESULTS.md) are allowed to mean, and several of them are large.

## What the tool can see

**Automated testing catches a minority of WCAG.** axe-core checks a subset of the
success criteria — the ones a machine can decide. Whether a label describes its
field, whether reading order makes sense, whether a video's captions are correct,
whether a custom widget is operable by keyboard: none of that is in these numbers.
A page with zero axe violations can be unusable. A page with many can be fine to
use. "Violation nodes" is a proxy, and a narrow one.

**Node counts are not severity.** One missing `alt` on a decorative icon and one
missing label on the checkout button each count as one node. Nothing in this
repository weights them.

**A node count is not a user.** Nobody in this study tried to buy anything with a
screen reader.

## What was measured

**Two pages per store.** Homepage and one product page. Checkout was never
measured — it is Shopify-hosted, and testing someone's checkout without permission
is not something I was willing to do. That means the single most important page in
a store is absent from every number here.

**One moment in time.** Storefronts change; apps get installed and removed; themes
get updated. Measurements ran 2026-08-05 to 2026-08-08 and are a snapshot.

**One network position.** All measurements ran from a German exit node, at
`locale: 'de-DE'` for the German contour and `en-US` otherwise. Geo-routing, CDN
edge, consent banners and currency switchers all vary with where the request comes
from, and all of them can change what axe-core sees. This affects the survey
figures. It affects the ablation figures much less, because both sides of a pair
were measured from the same position within seconds of each other — that is the
point of pairing.

**Headless Chromium.** A real browser engine, but not a real browser session: no
extensions, no profile, no prior consent state.

## What the ablation does and does not establish

**It measures DOM repair, and only DOM repair.** The ablation answers one question:
does the source markup contain fewer violations when the widget runs than when it is
blocked? It does not answer whether the widget helps anyone. An overlay can offer a
usable toolbar — larger text, a reading mode, a contrast switch — and still leave the
underlying markup exactly as it was. **Such a widget scores 0.0% here and may still
be useful to a person.** These numbers cannot be used to say a product does not work.

**Blocking a CDN is not identical to uninstalling.** Aborting requests to the
overlay's host is the closest thing to a controlled off-switch that can be done from
the outside, but a page could in principle behave differently when a script fails to
load than when it was never there. And the block only works if the host list is right:
one vendor was never switched off at all for the first five runs because its real CDN
was not in the list. That is now checked per pair rather than assumed, but the class of
error is worth naming, because it fails silently and in the flattering direction.

**The German contour is very small.** Most of the German ablation sample ran the vendor
above, so excluding the unblocked pairs cut it from 16 stores to 7. Treat that row as
an indication, not a country-level result.

**Small samples.** 92 store-run observations, 179 page pairs, three samples. The
per-run share ranges from −0.3% to 5.5% — that spread is the honest measure of how
much a single run can move, and it is why the headline is a median across stores
rather than any one run's total.

**Overlay stores are rare, so the ablation sample is small and not random.** At 1.8%
penetration in the German pool, stores with a widget installed had to be hunted for.
They are not a random sample of anything.

## What is not in this repository

**No store domains, and no data that would identify a store.** Aggregate tables and
anonymised per-store rows only. The stores did not agree to be measured, and naming
them would turn a methods note into a list of targets. `data/ablation-by-store-anonymised.csv`
carries an index, not a name, and the index order is not meaningful.

**No raw HTML or screenshots**, for the same reason.

This means you cannot verify my numbers by re-reading my files. You can only verify
them by re-running the method on a sample you draw yourself, which is what
[README.md](README.md) explains how to do. That is a real weakness of this
publication and I would rather state it than hide it behind the aggregates.

## What this is not

Not legal advice. Not a compliance assessment. Nothing here establishes whether any
site meets any legal requirement, in any jurisdiction. Conformance is a legal and
human judgement about a whole product, and an automated scanner is not competent to
make it.

## Known open questions

- The contrast tie-break landed at 39.6% against a 40% threshold — four nodes of 990.
  Undecided, and honestly so; the sample is too small to call.
- 132 contrast nodes with a ratio below 1.1 were never visually inspected. They are
  probably invisible elements rather than unreadable text, and they are included in
  the totals.
- Two stores appear in both the German and international contours, so the contour
  store counts sum to 369 while the distinct-store count is 367.
