# Twenty Indian sites, measured

Run on 31 August 2026 against 23 URLs — national and regional news, plus Wikipedia
in three scripts as a control. Twenty had Indic text on the page scanned; three did
not, and are reported as inconclusive rather than counted as passing.

Every finding below came from `akshara-qc`. The interesting part is that the audit
found more bugs in the scanner than the scanner found classes of bug on the web,
so that comes first.

---

## What the audit found in the tool

Three defects, each of which would have made the published numbers wrong.

**`networkidle` never fires on an ad-funded site.** Six of the first 23 sites timed
out — a quarter of the sample — because beacons, lazy images and polling keep a
request in flight indefinitely. The scanner could not scan the pages most worth
scanning, and reported it as the site's fault. Now it commits on DOM ready and gives
`load` and `document.fonts` a bounded chance to arrive.

**`line-height: 0` is a layout idiom, not a zero-height line box.** It is how people
kill inline-block gaps. Comparing ink against it reported the entire ink height as
the overrun, and produced the three largest clipping findings in the first pass —
16.2px, 14.1px, 12.5px. All meaningless. The real worst overrun is 3.9px.

**A trailing virama is not evidence of truncation, in any script.** The first pass
raised 144 truncation findings. **141 were correctly spelled words.** Telugu ends
words on a bare consonant constantly, above all in the English loanwords a news site
is full of — పార్లమెంట్, పాకిస్తాన్, మయన్మార్, కామన్వెల్త్. Hindi does it too:
वन्दे मातरम् is the national song, spelled with a final halant.

Tamil and Malayalam had already been excluded by a per-script flag. The audit showed
that fix was too clever: no script excludes it reliably, because the orthography was
never carrying the signal. The ellipsis is. Virama-then-ellipsis is what slicing at
a UTF-16 index and appending `…` produces; a bare trailing virama is just a word.

After the correction, truncation drops from 144 elements to 8.

---

## What it found on the web

Seventeen of the twenty sites raised at least one error or warning.

| Check | Sites | Elements |
|---|---|---|
| fallback | 10 / 20 | 269 |
| normalisation | 10 / 20 | 39 |
| clipping | 8 / 20 | 85 |
| overflow | 5 / 20 | 75 |
| truncation | 5 / 20 | 8 |
| linebreak | 1 / 20 | 2 |
| numerals | 1 / 20 | 4 |
| tofu | 0 | 0 |
| lang | 0 | 0 |

**Font fallback is the big one.** Ten of twenty sites declare a font stack with no
Indic face in it, so the browser silently substitutes. On one site a single
`Arial, sans-serif` declaration meant **220 elements** of Hindi rendered in whatever
the device happened to have — different on every phone, and never the one anybody
designed with. The English on that page renders in Arial as intended. Nobody files
that bug and everybody sees it.

The pattern repeats with `Noto Sans`, `Montserrat` and `Linux Libertine`: all fine
Latin faces, none of which cover Devanagari, all of them first in a stack.

**Encoding is quietly wrong on half the sample.** Ten sites carry text that is not in
canonical form — 27 uses of deprecated precomposed characters and 12 strings not in
NFC. These render identically and compare as different, so search misses one spelling
and deduplication keeps both. Nothing looks broken on screen, which is why it
survives to production.

**Clipping is real but modest.** Eight sites set a line-height that the script does
not fit into, worst case 3.9px of overrun. Visible as sheared vowel signs rather
than anything dramatic.

**Overflow is worse than it looks.** Five sites clip labels horizontally, the worst
by 155px — a control sized against English with an Indic string in it, cut off with
no ellipsis so the text simply stops.

**Nothing tofu'd.** Zero missing glyphs across the whole sample — see the caveat
below, because this number is the least trustworthy one here.

---

## Who gets it right

Named deliberately, because the failures are anonymised and the successes should not
be.

- **mathrubhumi.com** — 67 Malayalam nodes, nothing above a note
- **hindutamil.in** — 156 Tamil nodes, nothing above a note
- **maalaimalar.com** — 34 Tamil nodes, entirely clean

All three are South Indian language publishers. Three sites is far too small a sample
to claim a pattern, and it is noted only because it is the obvious next question.

Failures are reported in aggregate. The point is the bug classes, not a scoreboard,
and every site here is someone's work.

---

## Method, and what it does not support

- One page per site — homepage or a single article — at a 393×852 viewport, the
  mid-range Android where these bugs bite hardest.
- Chromium on macOS. **This is the biggest limitation.** macOS ships Devanagari,
  Tamil, Telugu, Kannada and Malayalam faces, so any missing glyph gets covered by a
  system font. The zero tofu count says nothing about a cheap Android or a Linux
  desktop, where the same pages may well show boxes.
- A point-in-time snapshot of pages that change hourly. Re-running tomorrow will not
  reproduce these counts exactly.
- Findings are grouped by root cause. "269 elements" across 10 sites is a much
  smaller number of actual CSS declarations — one rule can break hundreds of nodes.
- Twenty sites is a sample, not a survey. It supports "this class of bug is common"
  and not "N% of the Indian web is broken".

Reproduce any of it:

```bash
npx akshara-qc https://example.in --fail-on never
```
