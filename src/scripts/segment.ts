import {
  isBase,
  isJoinControl,
  isMark,
  isVirama,
  scriptOf,
  type IndicScript,
} from "./tables.js";

/**
 * Akshara segmentation.
 *
 * ## Why not Intl.Segmenter
 *
 * `Intl.Segmenter` implements UAX #29 extended grapheme clusters, and for
 * Brahmic scripts those are not the unit a reader — or a truncating string
 * function — should respect.
 *
 * Take क्षि (kṣi): क + ्(virama) + ष + ि. UAX #29 historically split that into
 * two clusters, and Unicode 15's GB9c rule only partially closes the gap: it
 * covers the "consonant + virama + consonant" conjunct case for a specific set
 * of scripts, and does not treat every script's ligating behaviour alike. What
 * a Hindi reader sees is one indivisible letter. Cut it anywhere and you get
 * either a dangling halant or a vowel sign attached to nothing.
 *
 * So Akshara segments on the orthographic unit instead:
 *
 *     akshara := Base Nukta? ( Virama Join? Base Nukta? )* Mark*
 *
 * where a virama binds forward into the next consonant, and every combining
 * mark binds backward onto the cluster it decorates. Non-Indic runs fall
 * through to `Intl.Segmenter`, so mixed strings segment correctly end to end.
 */

export interface Segment {
  /** The text of this segment. */
  text: string;
  /** Index of the first UTF-16 code unit, into the original string. */
  start: number;
  /** Index one past the last UTF-16 code unit. */
  end: number;
  /** The Indic script, or null for Latin, punctuation, emoji and the rest. */
  script: IndicScript | null;
  /**
   * The cluster opens on a combining mark or a virama that has nothing to
   * attach to. This is unambiguous damage in every script: a vowel sign cannot
   * decorate empty space. It is the fingerprint of a cut made too far left.
   */
  broken: boolean;
  /**
   * The cluster ends on a virama that bound to nothing — the fingerprint of a
   * cut made too far right.
   *
   * On its own this is NOT a bug. Tamil and Malayalam end words on a bare pulli
   * or chandrakkala constantly (வணக்கம், തമിഴ്). Callers must weigh it against
   * `script.wordFinalViramaCommon` and the surrounding context before reporting
   * anything; see checks/truncation.ts.
   */
  openVirama: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split a string into aksharas (Indic) and grapheme clusters (everything else). */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  const cps = [...text];

  // Map code point index → UTF-16 offset, so callers can slice the original.
  const offsets: number[] = [];
  let off = 0;
  for (const cp of cps) {
    offsets.push(off);
    off += cp.length;
  }
  offsets.push(off);

  let i = 0;
  while (i < cps.length) {
    const cp = cps[i]!.codePointAt(0)!;
    const script = scriptOf(cp);

    if (!script) {
      // Non-Indic: hand the whole run to Intl.Segmenter, which is correct there.
      let j = i;
      while (j < cps.length && scriptOf(cps[j]!.codePointAt(0)!) === null) j++;
      const runStart = offsets[i]!;
      const run = text.slice(runStart, offsets[j]!);
      for (const g of graphemes.segment(run)) {
        out.push({
          text: g.segment,
          start: runStart + g.index,
          end: runStart + g.index + g.segment.length,
          script: null,
          broken: false,
          openVirama: false,
        });
      }
      i = j;
      continue;
    }

    const start = i;
    let broken = false;
    let openVirama = false;

    // A cluster that opens on a mark or a virama is already damaged — the thing
    // it attaches to was cut away. Consume the orphaned run and flag it.
    if (isMark(cp) || isVirama(cp)) {
      broken = true;
      while (
        i < cps.length &&
        (isMark(cps[i]!.codePointAt(0)!) ||
          isVirama(cps[i]!.codePointAt(0)!) ||
          isJoinControl(cps[i]!.codePointAt(0)!))
      ) {
        i++;
      }
    } else {
      i++; // the base
      for (;;) {
        if (i >= cps.length) break;
        const next = cps[i]!.codePointAt(0)!;

        // Virama is tested first, and the order is load-bearing: every virama
        // carries General_Category=Mn, so a plain "is it a mark" test matches
        // it and swallows the one character that binds the next consonant in.
        if (isVirama(next)) {
          i++;
          // Optional join control between the virama and what it binds to.
          while (i < cps.length && isJoinControl(cps[i]!.codePointAt(0)!)) i++;
          if (i < cps.length && isBase(cps[i]!.codePointAt(0)!)) {
            i++; // the consonant the virama bound to
            continue;
          }
          // Virama with nothing after it: half a letter. Suspicious, but
          // legitimate at the end of a Tamil or Malayalam word, so it is
          // reported separately rather than called damage here.
          openVirama = true;
          break;
        }

        if (isMark(next)) {
          i++;
          continue;
        }

        if (isJoinControl(next)) {
          // ZWJ/ZWNJ steer conjunct formation; they belong to this cluster.
          i++;
          continue;
        }

        break;
      }
    }

    out.push({
      text: text.slice(offsets[start]!, offsets[i]!),
      start: offsets[start]!,
      end: offsets[i]!,
      script,
      broken,
      openVirama,
    });
  }

  return out;
}

/** Just the aksharas, dropping non-Indic segments. */
export function aksharas(text: string): Segment[] {
  return segment(text).filter((s) => s.script !== null);
}

/**
 * How many aksharas long a string is — the number a truncation limit should be
 * counted in. `"क्षिति".length` is 6 UTF-16 units and 4 code points; it is 3
 * letters.
 */
export function aksharaLength(text: string): number {
  return segment(text).length;
}

/**
 * Truncate to `limit` aksharas without breaking one apart.
 *
 * This is the function whose absence causes most of the mid-cluster truncation
 * on the Indian web. `String.prototype.slice` counts UTF-16 code units, and
 * every dependent vowel sign is its own code unit.
 */
export function truncate(text: string, limit: number, ellipsis = "…"): string {
  const segs = segment(text);
  if (segs.length <= limit) return text;
  const kept = segs.slice(0, Math.max(0, limit));
  const end = kept.length ? kept[kept.length - 1]!.end : 0;
  return text.slice(0, end) + ellipsis;
}

/** True when a cut at this UTF-16 index would land inside an akshara. */
export function splitsCluster(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  return !segment(text).some((s) => s.start === index || s.end === index);
}
