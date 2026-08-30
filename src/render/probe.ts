/**
 * The in-page probe.
 *
 * Everything here runs inside the browser, where the fonts actually are. It is
 * one self-contained function because Playwright serialises it across the
 * boundary — no imports, no closure over module scope.
 *
 * Akshara boundaries come back from Node through `window.__aksharaBounds`, so
 * the segmenter has exactly one implementation and the browser copy cannot
 * drift from it.
 */

export interface ProbeNode {
  text: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  /** Ink height of the Indic text, from the baseline box. */
  inkHeightPx: number;
  /** Ink height of a Latin reference string in the same font. */
  latinInkHeightPx: number;
  /** First family in the stack that actually covers this text, if any. */
  resolvedFamily: string | null;
  /** True when the requested family did not render Latin either — it never loaded. */
  requestedFamilyMissing: boolean;
  /** The family the author asked for first. */
  requestedFamily: string;
  /** Characters that rendered as .notdef. */
  tofu: string[];
  /** Aksharas broken apart by an element boundary inside this element. */
  splitClusters: string[];
  overflowHidden: boolean;
  ellipsis: boolean;
  overflowing: boolean;
  /** Horizontal pixels the text needs beyond the box it is given. */
  overflowPx: number;
  /** The box actually clips horizontally, so the overflow is not just scrollable. */
  clipsHorizontally: boolean;
  /** A control whose width was almost certainly sized against English. */
  isControl: boolean;
  lang: string;
}

export interface ProbeResult {
  nodes: ProbeNode[];
  scripts: string[];
  examined: number;
}

declare global {
  interface Window {
    __aksharaBounds?: (text: string) => Promise<Array<[number, number]>>;
  }
}

export async function probePage(): Promise<ProbeResult> {
  // Every Brahmic block Akshara knows about, as one range test.
  const INDIC = /[ऀ-෿]/;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.nodeName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const cls = (node.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean)[0];
      if (cls) part += `.${CSS.escape(cls)}`;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.nodeName === node!.nodeName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  };

  const fontOf = (cs: CSSStyleDeclaration, family?: string, sizePx?: number): string =>
    `${cs.fontStyle} ${cs.fontWeight} ${sizePx ?? parseFloat(cs.fontSize)}px ${family ?? cs.fontFamily}`;

  const inkHeight = (text: string, font: string): number => {
    ctx.font = font;
    const m = ctx.measureText(text);
    return (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
  };

  /**
   * A .notdef glyph is the same shape whatever the character, so render the
   * candidate and a guaranteed-unmapped code point and compare the bitmaps.
   * Width comparison alone gives false positives whenever advances coincide.
   */
  const glyphHash = (ch: string, font: string): string => {
    const c = document.createElement("canvas");
    c.width = 56;
    c.height = 56;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.font = font.replace(/\d+(\.\d+)?px/, "36px");
    x.textBaseline = "alphabetic";
    x.fillStyle = "#000";
    x.fillText(ch, 8, 44);
    const d = x.getImageData(0, 0, 56, 56).data;
    let bits = "";
    for (let i = 3; i < d.length; i += 4) bits += d[i]! > 40 ? "1" : "0";
    // Cheap, stable digest — collisions do not matter across two bitmaps.
    let h = 0;
    for (let i = 0; i < bits.length; i++) h = (Math.imul(h, 31) + bits.charCodeAt(i)) | 0;
    return `${h}:${bits.indexOf("1")}`;
  };

  const BLANK = glyphHash(" ", "36px monospace");

  const isTofu = (ch: string, font: string): boolean => {
    const notdef = glyphHash("￿", font);
    if (notdef === BLANK) return false; // font draws nothing for notdef; can't tell
    return glyphHash(ch, font) === notdef;
  };

  /**
   * Does `family` actually cover this text?
   *
   * Measure it against two very different fallbacks. If the width matches both,
   * the requested family contributed nothing and the browser fell back.
   */
  // Generic keywords must never be quoted: `font: 36px "sans-serif"` asks for a
  // font literally named "sans-serif", finds nothing, and silently falls back —
  // which made every site whose stack ends in sans-serif look broken.
  const GENERIC = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
    "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong",
  ]);

  const asStack = (family: string): string => {
    const bare = family.replace(/^["']|["']$/g, "");
    return GENERIC.has(bare.toLowerCase()) ? bare : `"${bare}"`;
  };

  const covers = (family: string, text: string): boolean => {
    const probe = (stack: string) => {
      ctx.font = `36px ${stack}`;
      return ctx.measureText(text).width;
    };
    const q = asStack(family);
    // A generic keyword always resolves to something that renders; asking
    // whether it "covers" the text the same way is meaningless.
    if (GENERIC.has(q.toLowerCase())) return true;
    // Must differ from BOTH sentinels. Chrome's per-script fallback does not
    // resolve to the last generic in the stack — it picks a system font for the
    // script — so `"LatinOnly", monospace` and bare `monospace` can differ while
    // neither is actually LatinOnly. Matching either sentinel means the family
    // contributed nothing and something else drew the text.
    return probe(`${q}, monospace`) !== probe("monospace") &&
      probe(`${q}, serif`) !== probe("serif");
  };

  /**
   * A family that renders neither Latin nor Indic is not installed or has not
   * loaded — a different problem from one that simply lacks the script, and it
   * deserves a different message. Without this test every missing webfont gets
   * reported as a missing script.
   */
  const available = (family: string): boolean => covers(family, "Ag");

  const families = (stack: string): string[] =>
    stack
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const candidates: Array<{ node: Text; el: HTMLElement }> = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const raw = node.nodeValue ?? "";
    if (!raw.trim() || !INDIC.test(raw)) continue;
    const el = node.parentElement as HTMLElement | null;
    if (!el) continue;
    const tag = el.nodeName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    candidates.push({ node, el });
  }

  const nodes: ProbeNode[] = [];
  const scripts = new Set<string>();

  for (const { node, el } of candidates.slice(0, 400)) {
    const raw = node.nodeValue ?? "";
    const text = raw.trim();
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const fontSizePx = parseFloat(cs.fontSize) || 16;

    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x0900 && cp <= 0x097f) scripts.add("Devanagari");
      else if (cp >= 0x0980 && cp <= 0x09ff) scripts.add("Bengali");
      else if (cp >= 0x0a00 && cp <= 0x0a7f) scripts.add("Gurmukhi");
      else if (cp >= 0x0a80 && cp <= 0x0aff) scripts.add("Gujarati");
      else if (cp >= 0x0b00 && cp <= 0x0b7f) scripts.add("Odia");
      else if (cp >= 0x0b80 && cp <= 0x0bff) scripts.add("Tamil");
      else if (cp >= 0x0c00 && cp <= 0x0c7f) scripts.add("Telugu");
      else if (cp >= 0x0c80 && cp <= 0x0cff) scripts.add("Kannada");
      else if (cp >= 0x0d00 && cp <= 0x0d7f) scripts.add("Malayalam");
      else if (cp >= 0x0d80 && cp <= 0x0dff) scripts.add("Sinhala");
    }

    const font = fontOf(cs, undefined, fontSizePx);

    // line-height: normal has no px value; fall back to the font's own box.
    let lineHeightPx = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeightPx)) {
      ctx.font = font;
      const m = ctx.measureText("Hxg");
      lineHeightPx =
        (m.fontBoundingBoxAscent || fontSizePx * 0.8) +
        (m.fontBoundingBoxDescent || fontSizePx * 0.2);
    }

    const stack = families(cs.fontFamily);
    const requestedFamily = stack[0] ?? "";
    // Test coverage against the Indic characters ONLY. "Wedding · विवाह" in a
    // Latin-only webfont looks covered if you measure the whole string, because
    // the font really does render "Wedding" — which is precisely the bug.
    const indicOnly = [...text].filter((ch) => INDIC.test(ch)).join("");
    let resolvedFamily: string | null = null;
    for (const f of stack) {
      if (covers(f, indicOnly)) {
        resolvedFamily = f;
        break;
      }
    }
    const requestedFamilyMissing = requestedFamily ? !available(requestedFamily) : false;

    const tofu: string[] = [];
    const seen = new Set<string>();
    for (const ch of text) {
      if (seen.has(ch) || !INDIC.test(ch)) continue;
      seen.add(ch);
      if (isTofu(ch, font)) tofu.push(ch);
    }

    /**
     * Aksharas broken apart by markup.
     *
     * Chrome's line breaker is shaping-aware: it wraps between letters and will
     * not split a cluster even under `word-break: break-all` (measured, not
     * assumed — see README). What Chrome cannot save you from is a cluster
     * divided across two DOM nodes: search-term highlighting that wraps part of
     * a word in <mark>, or a component that renders {t.slice(0,3)}<b>{t.slice(3)}</b>.
     * Shaping does not cross an element boundary, so the ligature never forms.
     */
    const splitClusters: string[] = [];
    const parent = node.parentElement;
    if (parent && parent.childNodes.length > 1 && window.__aksharaBounds) {
      try {
        const parts = [...parent.childNodes].map((n) => n.textContent ?? "");
        const joined = parts.join("");
        if (INDIC.test(joined)) {
          const cuts = new Set<number>();
          let acc = 0;
          for (const part of parts.slice(0, -1)) {
            acc += part.length;
            cuts.add(acc);
          }
          for (const [s, e] of await window.__aksharaBounds(joined)) {
            if (e - s < 2) continue;
            for (const cut of cuts) {
              if (cut > s && cut < e) splitClusters.push(joined.slice(s, e));
            }
          }
        }
      } catch {
        /* never fail the scan on one awkward node */
      }
    }

    nodes.push({
      text,
      selector: cssPath(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      fontFamily: cs.fontFamily,
      fontSizePx,
      lineHeightPx,
      inkHeightPx: inkHeight(text, font),
      latinInkHeightPx: inkHeight("Hxdpqg", font),
      resolvedFamily,
      requestedFamily,
      requestedFamilyMissing,
      tofu,
      splitClusters,
      overflowHidden: cs.overflow === "hidden" || cs.overflowX === "hidden",
      ellipsis: cs.textOverflow === "ellipsis",
      overflowing: el.scrollWidth > el.clientWidth + 1,
      overflowPx: Math.max(0, el.scrollWidth - el.clientWidth),
      clipsHorizontally:
        cs.textOverflow === "ellipsis" ||
        ((cs.overflow === "hidden" || cs.overflowX === "hidden") && cs.whiteSpace === "nowrap"),
      isControl:
        /^(BUTTON|A|LABEL|SUMMARY)$/.test(el.nodeName) ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("role") === "tab" ||
        cs.whiteSpace === "nowrap",
      lang: el.closest("[lang]")?.getAttribute("lang") ?? "",
    });
  }

  return { nodes, scripts: [...scripts], examined: candidates.length };
}
