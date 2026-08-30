import { describe, expect, it } from "vitest";
import { analyse } from "../src/render/scan.js";
import { checkNormalisation, checkNumerals, checkTruncation } from "../src/checks/static.js";
import type { ProbeNode } from "../src/render/probe.js";

/* analyse() is deliberately pure — the browser produces measurements, this turns
 * them into findings. Which means the judgement calls are testable without
 * launching anything. */

const node = (over: Partial<ProbeNode> = {}): ProbeNode => ({
  text: "नमस्ते",
  selector: "div.x",
  rect: { x: 0, y: 0, width: 100, height: 20 },
  fontFamily: "Inter, sans-serif",
  fontSizePx: 16,
  lineHeightPx: 26,
  inkHeightPx: 20,
  latinInkHeightPx: 15,
  resolvedFamily: "Inter",
  requestedFamily: "Inter",
  requestedFamilyMissing: false,
  tofu: [],
  splitClusters: [],
  overflowHidden: false,
  ellipsis: false,
  overflowing: false,
  lang: "hi",
  ...over,
});

const checks = (ns: ProbeNode[]) => analyse(ns).map((f) => f.check);

describe("clipping", () => {
  it("stays quiet when the ink fits the line box", () => {
    expect(checks([node({ inkHeightPx: 20, lineHeightPx: 26 })])).not.toContain("clipping");
  });

  it("fires when the ink is taller than the line box", () => {
    expect(checks([node({ inkHeightPx: 30, lineHeightPx: 26 })])).toContain("clipping");
  });

  it("tolerates a hairline overshoot from antialiasing", () => {
    // 26.2 over 26 is hinting noise, not a bug worth a developer's afternoon.
    expect(checks([node({ inkHeightPx: 26.2, lineHeightPx: 26 })])).not.toContain("clipping");
  });

  it("escalates to error when overflow is hidden, because it is truly cut", () => {
    const [f] = analyse([node({ inkHeightPx: 30, lineHeightPx: 26, overflowHidden: true })]);
    expect(f!.severity).toBe("error");
    const [g] = analyse([node({ inkHeightPx: 30, lineHeightPx: 26, overflowHidden: false })]);
    expect(g!.severity).toBe("warning");
  });

  it("suggests a line-height that would actually fit", () => {
    const [f] = analyse([node({ inkHeightPx: 30, lineHeightPx: 26, fontSizePx: 16 })]);
    expect(f!.fix).toContain("1.88"); // 30 / 16
  });
});

describe("fallback", () => {
  it("says nothing when the requested family renders the text", () => {
    expect(checks([node({ requestedFamily: "Inter", resolvedFamily: "Inter" })])).not.toContain(
      "fallback",
    );
  });

  it("distinguishes a font that never loaded from one lacking the script", () => {
    const [missing] = analyse([
      node({ resolvedFamily: null, requestedFamilyMissing: true, requestedFamily: "BrandSans" }),
    ]);
    expect(missing!.title).toContain("never loaded");

    const [gap] = analyse([
      node({ resolvedFamily: null, requestedFamilyMissing: false, requestedFamily: "BrandSans" }),
    ]);
    expect(gap!.title).toContain("No font in the stack covers this script");
  });

  it("names both faces when Indic and Latin diverge", () => {
    const [f] = analyse([node({ requestedFamily: "Inter", resolvedFamily: "Noto Sans Devanagari" })]);
    expect(f!.title).toContain("Noto Sans Devanagari");
    expect(f!.title).toContain("Inter");
  });
});

describe("tofu and markup splits", () => {
  it("reports unmapped characters with their code points", () => {
    const [f] = analyse([node({ tofu: ["क"] })]);
    expect(f!.check).toBe("tofu");
    expect(f!.detail).toContain("U+0915");
  });

  it("reports a cluster divided across two DOM nodes", () => {
    const [f] = analyse([node({ splitClusters: ["स्कृ"] })]);
    expect(f!.check).toBe("linebreak");
    expect(f!.severity).toBe("error");
  });
});

describe("deduplication", () => {
  it("collapses the same finding repeated by a repeated component", () => {
    const n = node({ inkHeightPx: 30, lineHeightPx: 26 });
    expect(analyse([n, n, n]).filter((f) => f.check === "clipping")).toHaveLength(1);
  });

  it("keeps findings from different elements apart", () => {
    const a = node({ inkHeightPx: 30, lineHeightPx: 26, selector: "div.a" });
    const b = node({ inkHeightPx: 30, lineHeightPx: 26, selector: "div.b" });
    expect(analyse([a, b]).filter((f) => f.check === "clipping")).toHaveLength(2);
  });
});

describe("string checks", () => {
  it("calls an orphaned matra an error", () => {
    const [f] = checkTruncation("ेलुगु");
    expect(f!.severity).toBe("error");
  });

  it("escalates a dangling virama when an ellipsis confirms the cut", () => {
    expect(checkTruncation("नमस्…")[0]!.severity).toBe("error");
    expect(checkTruncation("नमस्")[0]!.severity).toBe("warning");
  });

  it("stays silent on Tamil and Malayalam word-final viramas", () => {
    // The false positive that would make the tool unusable for two languages.
    expect(checkTruncation("வணக்கம்")).toHaveLength(0);
    expect(checkTruncation("മലയാളം")).toHaveLength(0);
    expect(checkTruncation("தமிழ்")).toHaveLength(0);
  });

  it("names the deprecated precomposed character rather than just 'not NFC'", () => {
    // U+0958 is a composition exclusion. NFC rewrites it to क + nukta, so the
    // generic check would fire too — but naming the character is what tells a
    // developer which of their two spellings to migrate.
    const found = checkNormalisation("\u0958");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toContain("deprecated precomposed");
    expect(found[0]!.evidence!["characters"]).toBe("\u0958");
  });

  it("passes the canonical spelling of the same letter", () => {
    // क + nukta is what a keyboard produces and what NFC settles on.
    expect(checkNormalisation("\u0915\u093C")).toHaveLength(0);
  });

  it("proves the two spellings really are different bytes", () => {
    expect("\u0958").not.toBe("\u0915\u093C");
    expect("\u0958".normalize("NFC")).toBe("\u0915\u093C");
  });

  it("ignores Latin-only strings entirely", () => {
    expect(checkNormalisation("café")).toHaveLength(0);
  });

  it("notices two numeral systems in one string", () => {
    expect(checkNumerals("२० November 2026")).toHaveLength(1);
    expect(checkNumerals("२० नवंबर")).toHaveLength(0);
    expect(checkNumerals("20 November")).toHaveLength(0);
  });
});
