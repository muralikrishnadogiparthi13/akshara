import { describe, expect, it } from "vitest";
import {
  aksharaLength,
  aksharas,
  segment,
  splitsCluster,
  truncate,
} from "../src/scripts/segment.js";

/* The reference cases every claim in the README rests on. If these pass, the
 * segmenter understands what a letter is in each of these scripts. */

describe("segment — Devanagari", () => {
  it("keeps a conjunct together where UAX #29 splits it", () => {
    // क् + ष + ि — one letter to a reader, several grapheme clusters to Intl.
    const s = aksharas("क्षि");
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe("क्षि");
  });

  it("counts letters, not code units", () => {
    expect("नमस्ते".length).toBe(6); // UTF-16 units
    expect(aksharaLength("नमस्ते")).toBe(3); // न · म · स्ते
  });

  it("binds the pre-base i-matra to its consonant", () => {
    // ि is stored after क but drawn before it. It is not a separate letter.
    expect(aksharas("कि")).toHaveLength(1);
  });

  it("keeps nukta and matra on the same cluster", () => {
    expect(aksharas("क़ी")).toHaveLength(1);
  });

  it("treats ZWNJ as part of the cluster it steers", () => {
    // ZWNJ requests the half-form rather than the ligature; still one letter.
    expect(aksharas("क्‌ष")).toHaveLength(1);
  });
});

describe("segment — Telugu, Tamil, Kannada, Malayalam, Bengali", () => {
  it("holds a Telugu consonant with its subscript vattu", () => {
    expect(aksharas("క్ష")).toHaveLength(1);
  });

  it("holds a Tamil consonant with pulli", () => {
    // க் — the pulli kills the inherent vowel; the pair is one unit.
    expect(aksharas("க்")[0]!.text).toBe("க்");
  });

  it("holds a Kannada conjunct", () => {
    expect(aksharas("ಕ್ಷ")).toHaveLength(1);
  });

  it("holds a Malayalam chillu-forming sequence", () => {
    expect(aksharas("ന്‍റ")).toHaveLength(1);
  });

  it("holds a Bengali conjunct", () => {
    expect(aksharas("ক্ষ")).toHaveLength(1);
  });

  it("names the script it found", () => {
    expect(aksharas("తెలుగు")[0]!.script!.id).toBe("telu");
    expect(aksharas("हिन्दी")[0]!.script!.id).toBe("deva");
  });
});

describe("segment — damage detection", () => {
  it("flags a trailing virama as broken", () => {
    // What `slice()` leaves when it cuts after the halant.
    const s = aksharas("नमस्");
    expect(s[s.length - 1]!.openVirama).toBe(true);
  });

  it("flags a leading matra as broken", () => {
    // What `slice()` leaves when it cuts before the vowel sign.
    expect(aksharas("ेस्ते")[0]!.broken).toBe(true);
  });

  it("finds nothing broken in well-formed text", () => {
    for (const t of ["नमस्ते", "తెలుగు", "வணக்கம்", "ಕನ್ನಡ", "മലയാളം", "বাংলা"]) {
      expect(aksharas(t).some((s) => s.broken)).toBe(false);
    }
  });

  it("does not call a Tamil word-final pulli damage", () => {
    // வணக்கம் and தமிழ் both end on a bare pulli. An analyser that calls this
    // broken condemns the entire language.
    for (const t of ["வணக்கம்", "தமிழ்"]) {
      const last = aksharas(t).at(-1)!;
      expect(last.openVirama).toBe(true);
      expect(last.script!.wordFinalViramaCommon).toBe(true);
      expect(last.broken).toBe(false);
    }
  });
});

describe("segment — mixed and non-Indic text", () => {
  it("segments Latin, Indic and emoji in one pass", () => {
    const s = segment("Hi नमस्ते 👋");
    expect(s.map((x) => x.text).join("")).toBe("Hi नमस्ते 👋");
    expect(s.filter((x) => x.script !== null)).toHaveLength(3);
  });

  it("does not split an emoji ZWJ sequence", () => {
    const s = segment("👨‍👩‍👧");
    expect(s).toHaveLength(1);
  });

  it("round-trips any input", () => {
    for (const t of ["", "abc", "नमस्ते world 123", "क्षि॥", "🇮🇳 भारत"]) {
      expect(segment(t).map((x) => x.text).join("")).toBe(t);
    }
  });

  it("reports offsets that slice the original correctly", () => {
    const t = "Hi नमस्ते";
    for (const s of segment(t)) {
      expect(t.slice(s.start, s.end)).toBe(s.text);
    }
  });
});

describe("truncate", () => {
  it("never leaves a dangling halant", () => {
    const cut = truncate("नमस्ते दोस्तों", 3);
    expect(cut).toBe("नमस्ते…");
    expect(aksharas(cut).some((s) => s.broken)).toBe(false);
  });

  it("is a no-op below the limit", () => {
    expect(truncate("नमस्ते", 10)).toBe("नमस्ते");
  });

  it("beats slice, which is the whole point", () => {
    const naive = "नमस्ते".slice(0, 4) + "…"; // cuts after the virama
    expect(aksharas(naive).some((s) => s.openVirama)).toBe(true);
    expect(aksharas(truncate("नमस्ते", 3)).some((s) => s.openVirama)).toBe(false);
  });

  it("does not leave a space stranded before the ellipsis", () => {
    // "नमस्ते …" reads as a gap where a word was removed.
    expect(truncate("नमस्ते दोस्तों", 4)).toBe("नमस्ते…");
  });

  it("handles a zero limit", () => {
    expect(truncate("नमस्ते", 0)).toBe("…");
  });
});

describe("splitsCluster", () => {
  it("is true inside a conjunct and false on its edges", () => {
    const t = "क्षि";
    expect(splitsCluster(t, 1)).toBe(true);
    expect(splitsCluster(t, 0)).toBe(false);
    expect(splitsCluster(t, t.length)).toBe(false);
  });
});
