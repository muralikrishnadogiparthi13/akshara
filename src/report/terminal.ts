import { summarise, type Finding, type ScanResult, type Severity } from "../checks/types.js";

const useColour = process.stdout.isTTY && !process.env["NO_COLOR"];
const c = (code: string, s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);

const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const blue = (s: string) => c("34", s);
const green = (s: string) => c("32", s);

const MARK: Record<Severity, (s: string) => string> = {
  error: red,
  warning: yellow,
  info: blue,
};

const LABEL: Record<Severity, string> = {
  error: "error",
  warning: "warn ",
  info: "info ",
};

export function renderTerminal(result: ScanResult): string {
  const lines: string[] = [];
  const counts = summarise(result.findings);

  lines.push("");
  lines.push(bold(result.url));
  lines.push(
    dim(
      `${result.viewport.width}×${result.viewport.height} · ` +
        `${result.examined} text node${result.examined === 1 ? "" : "s"} with Indic text · ` +
        `${result.scripts.length ? result.scripts.join(", ") : "no Indic script found"}`,
    ),
  );
  lines.push("");

  if (!result.findings.length) {
    lines.push(green("  No issues found."));
    lines.push("");
    return lines.join("\n");
  }

  let current = "";
  for (const f of result.findings) {
    if (f.check !== current) {
      current = f.check;
      lines.push(bold(`  ${f.check}`));
    }
    const times = f.occurrences && f.occurrences > 1
      ? dim(`  × ${f.occurrences} elements`)
      : "";
    lines.push(`    ${MARK[f.severity](LABEL[f.severity])} ${f.title}${times}`);
    lines.push(`          ${dim(quote(f.text))}`);
    lines.push(`          ${wrap(f.detail, 74, 10)}`);
    if (f.fix) lines.push(`          ${green("fix")} ${wrap(f.fix, 70, 14)}`);
    if (f.selector) lines.push(`          ${dim(f.selector)}`);
    lines.push("");
  }

  lines.push(
    "  " +
      [
        counts.error ? red(`${counts.error} error${counts.error === 1 ? "" : "s"}`) : "",
        counts.warning ? yellow(`${counts.warning} warning${counts.warning === 1 ? "" : "s"}`) : "",
        counts.info ? blue(`${counts.info} info`) : "",
      ]
        .filter(Boolean)
        .join(dim(" · ")),
  );
  lines.push("");
  return lines.join("\n");
}

function quote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return `"${t.length > 64 ? t.slice(0, 64) + "…" : t}"`;
}

function wrap(text: string, width: number, indent: number): string {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out.join("\n" + " ".repeat(indent));
}

/** Exit code: non-zero when anything at or above `failOn` was found. */
export function exitCode(findings: Finding[], failOn: Severity): number {
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return findings.some((f) => rank[f.severity] <= rank[failOn]) ? 1 : 0;
}
