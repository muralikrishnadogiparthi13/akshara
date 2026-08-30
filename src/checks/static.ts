import { aksharas, segment } from "../scripts/segment.js";
import { hasIndic, isIndicDigit, scriptsIn } from "../scripts/tables.js";
import type { Finding } from "./types.js";

/**
 * Checks that need only the string — no browser, no fonts, microseconds each.
 *
 * These catch the bugs that happen before rendering: the string was already
 * damaged in the database, the API response or the JavaScript that cut it.
 */

const ELLIPSIS = /(?:…|\.\.\.)\s*$/;

function display(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

/**
 * A cluster cut in half.
 *
 * Two shapes. An orphaned mark — a vowel sign with no consonant — is damage in
 * every script, always. A trailing virama is only damage in scripts where words
 * do not normally end on one: flagging it in Tamil would condemn வணக்கம், which
 * is simply how the language is spelled.
 */
export function checkTruncation(text: string): Finding[] {
  const out: Finding[] = [];
  const segs = aksharas(text);
  if (segs.length === 0) return out;

  for (const s of segs) {
    if (!s.broken) continue;
    out.push({
      check: "truncation",
      severity: "error",
      title: "A vowel sign with nothing to attach to",
      detail:
        `The text opens on ${describeMark(s.text)}, which decorates the letter before it — ` +
        `and there is no letter before it. The string was cut at a UTF-16 index instead of a ` +
        `letter boundary.`,
      text: display(text),
      script: s.script!.name,
      fix: "Count in aksharas, not code units: akshara.truncate(text, limit).",
      evidence: { fragment: s.text, offset: s.start },
    });
  }

  /* A trailing virama used to be reported on its own. Auditing nineteen real
   * sites showed why that was wrong: 141 of 144 such findings were correctly
   * spelled words.
   *
   * Telugu ends words on a bare consonant constantly, above all in the English
   * loanwords a news site is full of — పార్లమెంట్, పాకిస్తాన్, మయన్మార్. Hindi does
   * it too: వన్దే మాతరమ् is spelled with a final halant. Tamil and Malayalam were
   * already excluded, and the honest conclusion is that no script excludes it
   * reliably.
   *
   * So the signal is not the virama; it is the ellipsis sitting after it. That
   * combination means something cut the string and then admitted to it. */
  const last = segs[segs.length - 1]!;
  if (last.openVirama && ELLIPSIS.test(text)) {
    const common = last.script!.wordFinalViramaCommon;
    out.push({
      check: "truncation",
      severity: common ? "info" : "warning",
      title: "Cut mid-letter, then given an ellipsis",
      detail:
        `The text ends on a bare ${last.script!.name} virama and then an ellipsis, which is what ` +
        `slicing at a UTF-16 index and appending "…" produces. It draws as half a consonant with ` +
        `a visible killer stroke.` +
        (common
          ? ` ${last.script!.languages[0]} does end words this way, so this may be a whole word ` +
            `that simply reached the limit — worth an eye rather than a fix.`
          : ""),
      text: display(text),
      script: last.script!.name,
      fix: "Truncate on akshara boundaries. `text.slice(0, n)` cannot do this correctly.",
      evidence: { fragment: last.text },
    });
  }

  return out;
}

function describeMark(fragment: string): string {
  const cp = fragment.codePointAt(0)!;
  const name = cp.toString(16).toUpperCase().padStart(4, "0");
  return `a combining mark (U+${name})`;
}

/**
 * The same letter, encoded two ways.
 *
 * क़ exists twice in Unicode: U+0958, and क + the nukta U+093C. They render
 * identically and compare as different, so search misses, deduplication fails,
 * and two "identical" names sort apart.
 *
 * The subtlety that makes this worth a dedicated check: the precomposed forms
 * are *composition exclusions*, so NFC deliberately does not produce them and
 * `text === text.normalize("NFC")` cannot see the problem. The canonical form
 * is the decomposed one. A character is one of these exactly when decomposing
 * it and recomposing does not get you back — no table needed, and it stays
 * correct as Unicode grows.
 */
function isDeprecatedPrecomposed(ch: string): boolean {
  const d = ch.normalize("NFD");
  return d !== ch && d.normalize("NFC") !== ch;
}

export function checkNormalisation(text: string): Finding[] {
  if (!hasIndic(text)) return [];
  const out: Finding[] = [];

  const legacy = [...new Set([...text].filter(isDeprecatedPrecomposed))];
  if (legacy.length) {
    out.push({
      check: "normalisation",
      severity: "warning",
      title: `Uses deprecated precomposed ${legacy.length > 1 ? "characters" : "character"} ${legacy.join(" ")}`,
      detail:
        `${legacy
          .map((c) => `${c} (U+${cp(c)})`)
          .join(", ")} ${legacy.length > 1 ? "are" : "is"} a legacy precomposed form. Unicode ` +
        `excludes ${legacy.length > 1 ? "them" : "it"} from composition, so the canonical spelling ` +
        `is the decomposed one and NFC will not convert ${legacy.length > 1 ? "them" : "it"} for ` +
        `you. The same letter typed on a normal keyboard produces different bytes, and the two ` +
        `will never compare equal.`,
      text: display(text),
      script: scriptsIn(text)[0]?.name ?? "",
      fix: "Normalise to NFD then NFC at your API and database boundaries, which maps these away.",
      evidence: { characters: legacy.join(" ") },
    });
  }

  // NFC rewrites these singletons too, so reporting both would be the same bug
  // twice — and "you used U+0958" is far more actionable than "not in NFC form".
  if (legacy.length) return out;

  const nfc = text.normalize("NFC");
  if (nfc !== text) {
    out.push({
      check: "normalisation",
      severity: "warning",
      title: "Text is not in NFC form",
      detail:
        "The same letters can be encoded more than one way, and these are not in the canonical " +
        "form. Two strings that look identical on screen will compare, sort and deduplicate as " +
        "different, and a search for one will not find the other.",
      text: display(text),
      script: scriptsIn(text)[0]?.name ?? "",
      fix: "Normalise on the way in: `text.normalize('NFC')` at your API and database boundaries.",
      evidence: { codeUnitsNow: text.length, codeUnitsNFC: nfc.length },
    });
  }

  return out;
}

function cp(ch: string): string {
  return ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Devanagari digits next to ASCII digits in one string. Both are correct in
 * isolation; together they read as a mistake.
 */
export function checkNumerals(text: string): Finding[] {
  let indic = false;
  let ascii = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isIndicDigit(cp)) indic = true;
    else if (cp >= 0x30 && cp <= 0x39) ascii = true;
  }
  if (!indic || !ascii) return [];

  return [
    {
      check: "numerals",
      severity: "info",
      title: "Two numeral systems in one string",
      detail:
        "This string mixes script-specific digits with ASCII digits. Pick one per locale — " +
        "most Indian products use ASCII digits even in Indic text, and mixing them mid-sentence " +
        "looks like a data error.",
      text: display(text),
      fix: "Choose a numeral system per locale and normalise at render time.",
    },
  ];
}

/** Every string-level check, in one call. */
export function checkText(text: string): Finding[] {
  if (!hasIndic(text)) return [];
  return [...checkTruncation(text), ...checkNormalisation(text), ...checkNumerals(text)];
}

/**
 * How much longer this text is than its English source, in aksharas.
 *
 * Indic translations run materially longer than English, which is what bursts
 * fixed-width buttons. Only meaningful when the caller can supply both strings.
 */
export function expansionRatio(source: string, translated: string): number {
  const a = segment(source).length;
  const b = segment(translated).length;
  return a === 0 ? 0 : b / a;
}
