export type Severity = "error" | "warning" | "info";

export type CheckId =
  | "clipping"
  | "fallback"
  | "tofu"
  | "truncation"
  | "linebreak"
  | "normalisation"
  | "numerals"
  | "lang";

export interface Finding {
  check: CheckId;
  severity: Severity;
  /** One line, specific, no jargon. Shown as the headline. */
  title: string;
  /** Why it is wrong and what a reader sees. */
  detail: string;
  /** The offending text, trimmed for display. */
  text: string;
  /** Script name, where the finding is script-specific. */
  script?: string;
  /** CSS selector path to the element, for rendered findings. */
  selector?: string;
  /** Viewport rect, for annotating the screenshot. */
  rect?: { x: number; y: number; width: number; height: number };
  /** The change that fixes it. */
  fix?: string;
  /** Numbers behind the call, so a reader can check our working. */
  evidence?: Record<string, string | number | boolean>;
  /**
   * How many elements share this root cause. One CSS rule can produce hundreds
   * of individually-correct findings; a report that prints each one is a report
   * nobody reads.
   */
  occurrences?: number;
  /** A few more places it appears, for orientation. */
  alsoAt?: string[];
}

export interface ScanResult {
  url: string;
  scannedAt: string;
  viewport: { width: number; height: number };
  /** Every Indic script found on the page. */
  scripts: string[];
  /** Text nodes containing Indic text that were examined. */
  examined: number;
  findings: Finding[];
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.check.localeCompare(b.check),
  );
}

export function summarise(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}
