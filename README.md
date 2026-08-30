# Akshara

**Find broken Indic text rendering before your users do.**

[**Live demo and write-up →**](https://muralikrishnadogiparthi13.github.io/akshara/)

Point it at a page. It reports where your Hindi, Telugu, Tamil, Kannada, Bengali or Marathi text is clipped, tofu'd, silently rendered in the wrong font, or cut in half.

```bash
npx akshara-qc https://example.in
```

```
  clipping
    error Glyphs are 2.9px taller than the line box
          "शुभ विवाह की हार्दिक शुभकामनाएँ"
          This text needs 26.0px of vertical ink but the line box is 23.1px, and it
          is 1.31× the height of Latin text in the same font. The element hides its
          overflow, so the tops or bottoms are cut off.
          fix Raise line-height to at least 1.18 for this script — Indic text needs
              roughly 1.5–1.7 where Latin is happy at 1.2.
```

---

## Why this exists

Every Indian consumer app ships Indic text. Almost none test it, because the people doing the testing read English and these bugs are invisible unless you read the script. A clipped shirorekha looks like "the font is a bit odd". A fallback font looks like "the design is a bit cheap". Nobody files those bugs, and everybody sees them.

## What it finds

| Check | What breaks |
|---|---|
| **clipping** | Devanagari's shirorekha sits above Latin cap-height and Telugu vowel signs stack higher still. A `line-height` tuned on English shears the tops off. The single most common bug in this space. |
| **fallback** | Your brand font has no Devanagari, so the browser silently substitutes a system font. English and Hindi then sit side by side at different weights and x-heights. |
| **tofu** | A missing glyph — usually a webfont subset that dropped the block, or a conjunct outside the subsetted range. |
| **truncation** | `name.slice(0, 20)` cuts between a consonant and its vowel sign. `.length` counts UTF-16 code units; a letter is several of them. |
| **linebreak** | A cluster split across two DOM nodes — search highlighting, or `{t.slice(0,3)}<b>{t.slice(3)}</b>`. Shaping doesn't cross an element boundary, so the conjunct never forms. |
| **normalisation** | क़ exists twice in Unicode. Both render identically and compare as different, so search misses and deduplication fails. |
| **numerals** | Devanagari digits beside ASCII digits in one string. |
| **lang** | No language tag, so the browser guesses the font and a screen reader reads Telugu in an English voice. |

## The bookmarklet

Drag one link to your bookmarks bar and the full scan runs on whatever page you are looking
at — no terminal, no install, nothing sent anywhere. Grab it from the
[live page](https://muralikrishnadogiparthi13.github.io/akshara/).

It works because it is not cross-origin. A bookmarklet is first-party script in a document
you have already loaded, so it reads that page's DOM, computed styles and font metrics the
way the site's own code would — including pages behind a login, which a scanner can never
reach. It ships as a single inline `javascript:` URL rather than injecting a `<script src>`,
because `script-src` would block the latter on exactly the sites worth auditing. The UI
lives in a shadow root so the host page's CSS cannot reach it.

Source: [`site/bookmarklet.src.js`](site/bookmarklet.src.js), built by
`node scripts/build-bookmarklet.mjs`.

## Install

```bash
npm install -D akshara-qc
npx playwright install chromium
```

Node 20+. Chromium comes from Playwright; the string-level API has no browser dependency at all.

## Use it

**Scan a page**

```bash
akshara https://example.in
akshara ./index.html --screenshot findings.png
akshara https://example.in --json report.json --fail-on warning
```

| Flag | |
|---|---|
| `--json <path>` | Full result as JSON |
| `--screenshot <path>` | Screenshot with every finding boxed and labelled |
| `--width` / `--height` | Viewport. Defaults to 393×852 — a mid-range Android, where these bugs bite hardest |
| `--fail-on` | `error` (default), `warning`, `info` or `never` |

Exit code is non-zero when anything at or above `--fail-on` is found, so it drops straight into CI.

**As a library**

```ts
import { truncate, aksharaLength, segment, checkText } from "akshara-qc";

truncate("नमस्ते दोस्तों", 3);   // "नमस्ते…"  — never a dangling halant
"नमस्ते".slice(0, 4);            // "नमस्"    — half a letter

aksharaLength("नमस्ते");         // 3   (न · म · स्ते)
"नमस्ते".length;                 // 6   (UTF-16 code units)

checkText("नमस्…");              // [{ check: "truncation", severity: "error", … }]
```

`segment()`, `truncate()` and the `check*` functions are pure and dependency-free. `scan()` is the only thing that needs Playwright.

## The segmentation problem

`Intl.Segmenter` implements UAX #29 extended grapheme clusters, and for Brahmic scripts those are not the unit a reader — or a truncating string function — should respect.

Take **क्षि**: क + ् + ष + ि. Four code points, six UTF-16 units, **one letter**. UAX #29 historically split it, and Unicode 15's GB9c rule only partially closes the gap. Cut it anywhere and you get a dangling halant or a vowel sign attached to nothing.

So Akshara segments on the orthographic unit:

```
akshara := Base Nukta? ( Virama Join? Base Nukta? )* Mark*
```

A virama binds forward into the next consonant; every combining mark binds backward onto the cluster it decorates. Non-Indic runs fall through to `Intl.Segmenter`, so mixed strings segment correctly end to end.

**The trap that catches naive implementations:** every virama carries `General_Category=Mn`, so a plain "is this a combining mark" test swallows the one character that binds the next consonant in, and every conjunct silently splits in two.

## Two things Akshara refuses to report

**Word-final viramas in Tamil, Malayalam and Sinhala.** வணக்கம் and தமிழ் both end on a bare pulli — that is simply how the language is spelled. A checker that calls a trailing virama "truncation" condemns two entire languages, so the rule is script-specific.

**Line breaks splitting a cluster.** Chrome's line breaker is shaping-aware: it wraps *between* letters and will not split an akshara even under `word-break: break-all` or `overflow-wrap: anywhere`. Measured, not assumed — see the note in `src/render/probe.ts`. The `linebreak` check therefore looks for clusters broken by **markup**, which is a real bug Chrome cannot save you from.

## In CI

```yaml
- run: npx playwright install --with-deps chromium
- run: npx akshara-qc http://localhost:3000 --fail-on error
```

## The torture test

`fixtures/torture.html` reproduces every bug class deliberately, broken and correct side by side. It is the regression suite, and it is the fastest way to see what these bugs actually look like:

```bash
npx akshara-qc ./fixtures/torture.html --screenshot torture.png --fail-on never
```

## Limitations

- **Chromium only.** The measurements come from Canvas and the DOM; a Firefox or WebKit backend would need its own calibration.
- **Static pages.** It scans what is rendered after `networkidle` plus a settle delay. Content behind an interaction is not visited.
- **Tofu detection needs a real `.notdef`.** Fonts that draw nothing for unmapped characters are indistinguishable from whitespace, and those are skipped rather than guessed at.
- **The `lang` check is noisy by design.** It is `info`, not `warning`, because plenty of pages are legitimately monolingual.
- **Ten scripts.** Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Sinhala. No Arabic-script or Southeast Asian coverage — those have their own shaping rules and deserve their own tool.

## Contributing

`fixtures/torture.html` is the contract. A new check needs a case there, broken and correct, before it needs code.

```bash
npm install
npm test
npm run build
node dist/cli.js ./fixtures/torture.html --fail-on never
```

## Licence

MIT
