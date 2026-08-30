/**
 * Akshara — find broken Indic text rendering.
 *
 * Two layers. The segmenter and the string checks are pure and run anywhere;
 * `scan()` drives a headless browser and needs Playwright.
 */
export {
  segment,
  aksharas,
  aksharaLength,
  truncate,
  splitsCluster,
  type Segment,
} from "./scripts/segment.js";

export {
  SCRIPTS,
  getScript,
  scriptOf,
  scriptsIn,
  hasIndic,
  type IndicScript,
  type ScriptId,
} from "./scripts/tables.js";

export {
  checkText,
  checkTruncation,
  checkNormalisation,
  checkNumerals,
  expansionRatio,
} from "./checks/static.js";

export {
  sortFindings,
  summarise,
  type Finding,
  type CheckId,
  type Severity,
  type ScanResult,
} from "./checks/types.js";

export { scan, analyse, type ScanOptions } from "./render/scan.js";
export { type ProbeNode, type ProbeResult } from "./render/probe.js";
