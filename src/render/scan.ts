import { chromium, type Browser, type Page } from "playwright";
import { segment } from "../scripts/segment.js";
import { checkText } from "../checks/static.js";
import { sortFindings, type Finding, type ScanResult } from "../checks/types.js";
import { probePage, type ProbeNode } from "./probe.js";

export interface ScanOptions {
  /** Viewport. Defaults to a mid-range Android, where these bugs bite hardest. */
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  /** Extra wait after network idle, for late-loading webfonts. */
  settleMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Write an annotated screenshot here. */
  screenshotPath?: string;
}

const DEFAULTS = {
  width: 393,
  height: 852,
  deviceScaleFactor: 2,
  settleMs: 600,
  timeoutMs: 30_000,
} satisfies Required<Omit<ScanOptions, "userAgent" | "screenshotPath">>;

/**
 * Ink taller than the line box means the glyphs cannot fit. Allow a small
 * margin: antialiasing and hinting make the measured ink a fraction taller than
 * the design, and a hair of overlap is not what anyone would call a bug.
 */
const CLIP_TOLERANCE = 1.02;

export async function scan(url: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const o = { ...DEFAULTS, ...opts };
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: o.deviceScaleFactor,
      ...(o.userAgent ? { userAgent: o.userAgent } : {}),
    });
    const page = await context.newPage();

    // One segmenter, called from the page. The browser never gets its own copy.
    await page.exposeFunction("__aksharaBounds", (text: string) =>
      segment(text).map((s) => [s.start, s.end] as [number, number]),
    );

    await page.goto(url, { waitUntil: "networkidle", timeout: o.timeoutMs });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(o.settleMs);

    const probe = await page.evaluate(probePage);
    const findings = analyse(probe.nodes);

    if (o.screenshotPath) {
      await annotate(page, findings);
      await page.screenshot({ path: o.screenshotPath, fullPage: true });
    }

    return {
      url,
      scannedAt: new Date().toISOString(),
      viewport: { width: o.width, height: o.height },
      scripts: probe.scripts,
      examined: probe.examined,
      findings: sortFindings(findings),
    };
  } finally {
    await browser?.close();
  }
}

/** Turn raw measurements into findings. Kept pure so it is testable without a browser. */
/**
 * What makes two findings the same problem.
 *
 * A single `font-family: Arial, sans-serif` can produce a correct fallback
 * finding on every Hindi string on the page — 215 of them on one real site.
 * They are one bug in one CSS rule, so they group by the rule, not the element.
 * Text-level findings stay per-string: each damaged string is its own defect.
 */
function groupKey(f: Finding, n: ProbeNode): string {
  switch (f.check) {
    case "fallback":
      return `fallback|${n.requestedFamily}|${n.resolvedFamily ?? "none"}`;
    case "clipping":
      return `clipping|${n.fontFamily}|${Math.round(n.fontSizePx)}|${Math.round(n.lineHeightPx)}`;
    case "tofu":
      return `tofu|${n.fontFamily}|${n.tofu.join("")}`;
    case "lang":
      return "lang";
    default:
      // truncation, normalisation, numerals, linebreak — one per damaged string.
      return `${f.check}|${f.selector ?? ""}|${f.text}`;
  }
}

export function analyse(nodes: ProbeNode[]): Finding[] {
  const groups = new Map<string, { finding: Finding; count: number; where: string[] }>();

  const add = (f: Finding, n: ProbeNode) => {
    const key = groupKey(f, n);
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (g.where.length < 4 && f.selector && !g.where.includes(f.selector)) {
        g.where.push(f.selector);
      }
      return;
    }
    groups.set(key, { finding: f, count: 1, where: [] });
  };

  for (const n of nodes) {
    const where = { selector: n.selector, rect: n.rect };

    for (const f of checkText(n.text)) add({ ...f, ...where }, n);

    if (n.tofu.length) {
      add({
        check: "tofu",
        severity: "error",
        title: `${n.tofu.length} character${n.tofu.length > 1 ? "s" : ""} rendering as a blank box`,
        detail:
          `No font in this element's stack has a glyph for ${n.tofu
            .map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`)
            .join(", ")}, so the reader sees □. Usually a webfont subset that dropped the block, ` +
          `or a conjunct outside the subsetted range.`,
        text: n.text,
        fix: "Widen the webfont subset, or add a Noto font for this script to the stack.",
        evidence: { fontFamily: n.fontFamily, characters: n.tofu.join(" ") },
        ...where,
      }, n);
    }

    if (n.requestedFamilyMissing && n.resolvedFamily === null) {
      add({
        check: "fallback",
        severity: "warning",
        title: `"${n.requestedFamily}" never loaded`,
        detail:
          `This family renders neither Latin nor Indic here, which means the webfont failed to ` +
          `load or the family name is wrong — not that it lacks the script. Everything in this ` +
          `element is being drawn by a system fallback.`,
        text: n.text,
        fix: "Check the @font-face src and the exact family name.",
        evidence: { requested: n.requestedFamily },
        ...where,
      }, n);
    } else if (n.resolvedFamily === null) {
      add({
        check: "fallback",
        severity: "warning",
        title: "No font in the stack covers this script",
        detail:
          "Every family the CSS asks for lacks these glyphs, so the browser is picking a system " +
          "font of its own. What renders is whatever the device happens to have — different on " +
          "every phone, and never the one you designed with.",
        text: n.text,
        fix: `Add a font that covers this script to \`font-family\` before the generic fallback.`,
        evidence: { requested: n.fontFamily },
        ...where,
      }, n);
    } else if (n.requestedFamily && n.resolvedFamily !== n.requestedFamily) {
      add({
        check: "fallback",
        severity: "warning",
        title: `Falls back to ${n.resolvedFamily} — your English is in ${n.requestedFamily}`,
        detail:
          `"${n.requestedFamily}" has no glyphs for this script, so this text renders in ` +
          `"${n.resolvedFamily}" instead. Latin and Indic then sit side by side at different ` +
          `weights and x-heights. Nobody files this bug; everybody sees it.`,
        text: n.text,
        fix: `Pick an Indic companion face with matching weight and x-height, or use a family that covers both.`,
        evidence: { requested: n.requestedFamily, resolved: n.resolvedFamily },
        ...where,
      }, n);
    }

    if (n.inkHeightPx > n.lineHeightPx * CLIP_TOLERANCE) {
      const over = n.inkHeightPx - n.lineHeightPx;
      const ratio = n.latinInkHeightPx > 0 ? n.inkHeightPx / n.latinInkHeightPx : 0;
      add({
        check: "clipping",
        severity: n.overflowHidden ? "error" : "warning",
        title: `Glyphs are ${over.toFixed(1)}px taller than the line box`,
        detail:
          `This text needs ${n.inkHeightPx.toFixed(1)}px of vertical ink but the line box is ` +
          `${n.lineHeightPx.toFixed(1)}px${
            ratio ? `, and it is ${ratio.toFixed(2)}× the height of Latin text in the same font` : ""
          }. Ascenders and vowel signs stack higher than Latin does; a line-height tuned on ` +
          `English clips them. ${
            n.overflowHidden
              ? "The element hides its overflow, so the tops or bottoms are cut off."
              : "They will collide with the line above or below."
          }`,
        text: n.text,
        fix: `Raise line-height to at least ${(n.inkHeightPx / n.fontSizePx).toFixed(2)} for this script — Indic text needs roughly 1.5–1.7 where Latin is happy at 1.2.`,
        evidence: {
          inkHeightPx: round(n.inkHeightPx),
          lineHeightPx: round(n.lineHeightPx),
          fontSizePx: round(n.fontSizePx),
          latinInkHeightPx: round(n.latinInkHeightPx),
          overflowHidden: n.overflowHidden,
        },
        ...where,
      }, n);
    }

    if (n.splitClusters.length) {
      add({
        check: "linebreak",
        severity: "error",
        title: "Markup cuts through the middle of a letter",
        detail:
          `${n.splitClusters
            .slice(0, 3)
            .map((c) => `"${c}"`)
            .join(", ")} ${n.splitClusters.length > 1 ? "are" : "is"} split across two DOM ` +
          `nodes. Shaping does not cross an element boundary, so the two halves are drawn ` +
          `separately and the conjunct never forms. Usually search-term highlighting, or a ` +
          `component that renders {text.slice(0, n)} beside the remainder.`,
        text: n.text,
        fix: "Split on akshara boundaries before wrapping either half in an element.",
        evidence: { clusters: n.splitClusters.slice(0, 5).join(" ") },
        ...where,
      }, n);
    }

    if (n.ellipsis && n.overflowing) {
      add({
        check: "truncation",
        severity: "info",
        title: "Text is being ellipsised by CSS",
        detail:
          "The browser's own ellipsis is shaping-aware, so this is probably fine — but check the " +
          "same string is not also cut in JavaScript before it gets here, which is where the " +
          "mid-letter breaks come from.",
        text: n.text,
        ...where,
      }, n);
    }

    if (!n.lang) {
      add({
        check: "lang",
        severity: "info",
        title: "No lang attribute on this text",
        detail:
          "Without a language tag the browser guesses which font and line-breaking rules to use, " +
          "and a screen reader reads this in whatever voice it was last using — Telugu in an " +
          "English voice is unintelligible.",
        text: n.text,
        fix: 'Set lang on the nearest container, e.g. <div lang="te">.',
        ...where,
      }, n);
    }
  }

  return [...groups.values()].map(({ finding, count, where }) =>
    count > 1
      ? { ...finding, occurrences: count, ...(where.length ? { alsoAt: where } : {}) }
      : finding,
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Draw boxes over the offending elements before the screenshot is taken. */
async function annotate(page: Page, findings: Finding[]): Promise<void> {
  const boxes = findings
    .filter((f) => f.rect && f.severity !== "info")
    .map((f) => ({ rect: f.rect!, severity: f.severity, label: f.check }));
  if (!boxes.length) return;

  await page.evaluate((items) => {
    const layer = document.createElement("div");
    layer.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:2147483647";
    for (const b of items) {
      const colour = b.severity === "error" ? "#e5484d" : "#f5a524";
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${b.rect.x + scrollX}px;top:${
        b.rect.y + scrollY
      }px;width:${b.rect.width}px;height:${b.rect.height}px;border:2px solid ${colour};border-radius:2px`;
      const tag = document.createElement("span");
      tag.textContent = b.label;
      tag.style.cssText = `position:absolute;top:-15px;left:0;font:600 10px/1.4 ui-monospace,monospace;background:${colour};color:#fff;padding:0 4px;border-radius:2px;white-space:nowrap`;
      box.appendChild(tag);
      layer.appendChild(box);
    }
    document.body.appendChild(layer);
  }, boxes);
}
