/**
 * Script tables for the Brahmic scripts Akshara understands.
 *
 * Every one of these descends from Brahmi and shares a structure: a consonant
 * carries an inherent vowel, a *virama* (halant) kills that vowel so the
 * consonant can bind to the next one, and dependent vowel signs (matras) attach
 * around the cluster — above, below, before or after, sometimes several at once.
 *
 * That structure is why byte offsets and even Unicode's default grapheme
 * clusters are the wrong unit for this text. The right unit is the akshara.
 */

export type ScriptId =
  | "deva"
  | "beng"
  | "guru"
  | "gujr"
  | "orya"
  | "taml"
  | "telu"
  | "knda"
  | "mlym"
  | "sinh";

export interface IndicScript {
  id: ScriptId;
  /** Human name, as it appears in reports. */
  name: string;
  /** Unicode Script property value — usable in /\p{Script=…}/u. */
  unicodeScript: string;
  /** Primary block. Script_Extensions can place a few marks outside it. */
  block: [start: number, end: number];
  /** The virama / halant / pulli / chandrakkala for this script. */
  virama: number;
  /** Script-specific digits, where the script has its own. */
  digits: [start: number, end: number] | null;
  /**
   * Whether a word may legitimately end on a bare virama.
   *
   * In Tamil this is ordinary — வணக்கம், தமிழ் — because the pulli marks a pure
   * consonant, and Malayalam's chillu letters behave similarly. In Devanagari,
   * Bengali, Telugu and Kannada a word-final halant is rare enough that finding
   * one at the end of a UI string almost always means the string was cut.
   *
   * Get this wrong in either direction and you either miss every truncation bug
   * or you flag an entire language as broken.
   */
  wordFinalViramaCommon: boolean;
  /** Languages commonly written in it — used only to make reports readable. */
  languages: string[];
}

export const SCRIPTS: readonly IndicScript[] = [
  {
    id: "deva",
    name: "Devanagari",
    unicodeScript: "Devanagari",
    block: [0x0900, 0x097f],
    virama: 0x094d,
    digits: [0x0966, 0x096f],
    wordFinalViramaCommon: false,
    languages: ["Hindi", "Marathi", "Nepali", "Sanskrit"],
  },
  {
    id: "beng",
    name: "Bengali",
    unicodeScript: "Bengali",
    block: [0x0980, 0x09ff],
    virama: 0x09cd,
    digits: [0x09e6, 0x09ef],
    wordFinalViramaCommon: false,
    languages: ["Bengali", "Assamese"],
  },
  {
    id: "guru",
    name: "Gurmukhi",
    unicodeScript: "Gurmukhi",
    block: [0x0a00, 0x0a7f],
    virama: 0x0a4d,
    digits: [0x0a66, 0x0a6f],
    wordFinalViramaCommon: false,
    languages: ["Punjabi"],
  },
  {
    id: "gujr",
    name: "Gujarati",
    unicodeScript: "Gujarati",
    block: [0x0a80, 0x0aff],
    virama: 0x0acd,
    digits: [0x0ae6, 0x0aef],
    wordFinalViramaCommon: false,
    languages: ["Gujarati"],
  },
  {
    id: "orya",
    name: "Odia",
    unicodeScript: "Oriya",
    block: [0x0b00, 0x0b7f],
    virama: 0x0b4d,
    digits: [0x0b66, 0x0b6f],
    wordFinalViramaCommon: false,
    languages: ["Odia"],
  },
  {
    id: "taml",
    name: "Tamil",
    unicodeScript: "Tamil",
    block: [0x0b80, 0x0bff],
    virama: 0x0bcd,
    digits: [0x0be6, 0x0bef],
    wordFinalViramaCommon: true,
    languages: ["Tamil"],
  },
  {
    id: "telu",
    name: "Telugu",
    unicodeScript: "Telugu",
    block: [0x0c00, 0x0c7f],
    virama: 0x0c4d,
    digits: [0x0c66, 0x0c6f],
    wordFinalViramaCommon: false,
    languages: ["Telugu"],
  },
  {
    id: "knda",
    name: "Kannada",
    unicodeScript: "Kannada",
    block: [0x0c80, 0x0cff],
    virama: 0x0ccd,
    digits: [0x0ce6, 0x0cef],
    wordFinalViramaCommon: false,
    languages: ["Kannada"],
  },
  {
    id: "mlym",
    name: "Malayalam",
    unicodeScript: "Malayalam",
    block: [0x0d00, 0x0d7f],
    virama: 0x0d4d,
    digits: [0x0d66, 0x0d6f],
    wordFinalViramaCommon: true,
    languages: ["Malayalam"],
  },
  {
    id: "sinh",
    name: "Sinhala",
    unicodeScript: "Sinhala",
    block: [0x0d80, 0x0dff],
    virama: 0x0dca, // al-lakuna
    digits: null, // Sinhala uses ASCII digits in practice
    wordFinalViramaCommon: true,
    languages: ["Sinhala"],
  },
] as const;

const BY_ID = new Map<ScriptId, IndicScript>(SCRIPTS.map((s) => [s.id, s]));
const VIRAMAS = new Set<number>(SCRIPTS.map((s) => s.virama));

export const ZWNJ = 0x200c;
export const ZWJ = 0x200d;

export function getScript(id: ScriptId): IndicScript {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown script: ${id}`);
  return s;
}

/** Which Indic script this code point belongs to, if any. */
export function scriptOf(cp: number): IndicScript | null {
  for (const s of SCRIPTS) {
    if (cp >= s.block[0] && cp <= s.block[1]) return s;
  }
  return null;
}

export function isVirama(cp: number): boolean {
  return VIRAMAS.has(cp);
}

export function isJoinControl(cp: number): boolean {
  return cp === ZWJ || cp === ZWNJ;
}

/**
 * Combining marks: dependent vowel signs, anusvara, visarga, nukta, and the
 * rest of the furniture that hangs off a cluster.
 *
 * Mn (non-spacing) covers marks drawn above or below; Mc (spacing combining)
 * covers those that occupy their own advance width, like Devanagari ा. Both
 * belong to the akshara that precedes them.
 */
const MARK_RE = /\p{Mn}|\p{Mc}/u;

export function isMark(cp: number): boolean {
  return MARK_RE.test(String.fromCodePoint(cp));
}

/** A cluster-initial character: consonant, independent vowel, or digit. */
export function isBase(cp: number): boolean {
  return scriptOf(cp) !== null && !isMark(cp) && !isVirama(cp);
}

export function isIndicDigit(cp: number): boolean {
  for (const s of SCRIPTS) {
    if (s.digits && cp >= s.digits[0] && cp <= s.digits[1]) return true;
  }
  return false;
}

export function hasIndic(text: string): boolean {
  for (const ch of text) {
    if (scriptOf(ch.codePointAt(0)!) !== null) return true;
  }
  return false;
}

/** Every Indic script present in the string, in first-seen order. */
export function scriptsIn(text: string): IndicScript[] {
  const seen = new Map<ScriptId, IndicScript>();
  for (const ch of text) {
    const s = scriptOf(ch.codePointAt(0)!);
    if (s && !seen.has(s.id)) seen.set(s.id, s);
  }
  return [...seen.values()];
}
