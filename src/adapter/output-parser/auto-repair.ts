/**
 * Seven YAML auto-repair rules for common LLM output errors.
 *
 * Application order (by dependency tier):
 *
 * Tier 1 — Character-level cleanup (prerequisite for all subsequent rules):
 *   R6 (Unicode smart quotes → ASCII)
 *
 * Tier 2 — Structural punctuation cleanup (before indentation, because
 *   dangling commas can cause indent regexes to miscount line breaks):
 *   R5 (JSON trailing commas)
 *   R7 (missing leading zero in floats)
 *
 * Tier 3 — Line-level whitespace normalization:
 *   R2 (tabs → 2 spaces, odd indentation → even)
 *
 * Tier 4 — Semantic value fixes (depend on clean indent + punctuation):
 *   R3 (boolean confidence → numeric)
 *   R4 (missing list item dash prefix)
 *
 * Tier 5 — Key-value quoting (must run last — depends on all prior fixes):
 *   R1 (unquoted colons in values)
 *
 * See spec: §8
 */

export interface RepairResult {
  text: string;
  appliedRules: string[];
}

/**
 * Apply all seven repair rules in dependency order.
 */
export function applyRepairRules(yamlText: string): RepairResult {
  let text = yamlText;
  const appliedRules: string[] = [];

  // Tier 1: Character-level cleanup
  // R6: Unicode smart quotes → ASCII (~1% trigger, ~99% success)
  const r6 = applyR6(text);
  if (r6 !== text) { text = r6; appliedRules.push('R6'); }

  // Tier 2: Structural punctuation cleanup (before indentation!)
  // R5: JSON-style trailing commas (~2% trigger, ~99% success)
  const r5 = applyR5(text);
  if (r5 !== text) { text = r5; appliedRules.push('R5'); }

  // R7: Missing leading zero in floats (~4% trigger, ~99% success)
  const r7 = applyR7(text);
  if (r7 !== text) { text = r7; appliedRules.push('R7'); }

  // Tier 3: Line-level whitespace normalization (after punctuation cleanup)
  // R2: Tab/indentation normalization (~5% trigger, ~95% success)
  const r2 = applyR2(text);
  if (r2 !== text) { text = r2; appliedRules.push('R2'); }

  // Tier 4: Semantic value fixes
  // R3: Boolean confidence values (~3% trigger, ~95% success)
  const r3 = applyR3(text);
  if (r3 !== text) { text = r3; appliedRules.push('R3'); }

  // R4: Missing list item dash prefix (~8% trigger, ~80% success)
  const r4 = applyR4(text);
  if (r4 !== text) { text = r4; appliedRules.push('R4'); }

  // Tier 5: Key-value quoting (last — depends on all prior fixes)
  // R1: Unquoted colons in values (~15% trigger, ~90% success)
  const r1 = applyR1(text);
  if (r1 !== text) { text = r1; appliedRules.push('R1'); }

  return { text, appliedRules };
}

// ─── R1: Unquoted colons in evidence/value fields (§8.3) ───
//
// Problem: YAML treats colons as key-value separators.
// "The paper argues that: affordances are..." breaks parsing.
// Detection: line has key: value where value also contains ":"
// Fix: wrap value in double quotes.

function applyR1(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^(\s*)([\w_-]+):\s+(.+)$/);
    if (!match) continue;

    const [, indent, key, value] = match as [string, string, string, string];
    if (!value.includes(':')) continue;
    if (value.startsWith('"') || value.startsWith("'")) continue;

    // §7.2: Exclude legitimate YAML values containing colons
    // ISO date/time (e.g., 2026-03-25T14:30:00)
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
    // URLs (e.g., https://example.com)
    if (/^https?:\/\//.test(value)) continue;

    // Value contains a colon and is not already quoted — wrap in double quotes
    const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines[i] = `${indent}${key}: "${escapedValue}"`;
  }
  return lines.join('\n');
}

// ─── R2: Tab and indentation normalization ───
//
// Problem: Mixed tabs and spaces, or inconsistent indentation depth.
// Fix: Replace tabs with 2 spaces, normalize indentation to multiples of 2.

function applyR2(text: string): string {
  let result = text;

  // Replace all tabs with 2 spaces
  result = result.replace(/\t/g, '  ');

  // Normalize odd indentation to nearest even multiple of 2
  result = result.replace(/^( +)/gm, (_match, spaces: string) => {
    const len = spaces.length;
    if (len % 2 === 0) return spaces;
    // Round up to nearest multiple of 2
    const normalized = Math.ceil(len / 2) * 2;
    return ' '.repeat(normalized);
  });

  return result;
}

// ─── R3: Boolean confidence values ───
//
// Problem: "confidence: yes" parsed as boolean true by YAML.
// Fix: Map yes/no/true/false to numeric values.

function applyR3(text: string): string {
  return text.replace(
    /^(\s*confidence:\s*)(yes|no|true|false)\s*$/gim,
    (_match, prefix: string, value: string) => {
      const mapping: Record<string, string> = {
        yes: '0.85',
        true: '0.85',
        no: '0.15',
        false: '0.15',
      };
      return `${prefix}${mapping[value.toLowerCase()] ?? '0.50'}`;
    },
  );
}

// ─── R4: Missing list item dash prefix ───
//
// Problem: Consecutive key: value lines that should be list items lack "- ".
// Detection: Lines under a list parent (ending with ":") that look like key-value
//            pairs at the same indentation but lack a dash.
// Fix: Add "- " prefix to the first item of each block.

function applyR4(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  // Fix #11: Track multi-line scalar blocks (| or >) to avoid false positives.
  // Lines inside a block scalar are literal text, NOT YAML structure.
  let inBlockScalar = false;
  let blockScalarIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const prevLine = i > 0 ? lines[i - 1]! : '';
    const lineIndent = (line.match(/^(\s*)/)?.[1] ?? '').length;

    // Track block scalar state
    if (inBlockScalar) {
      // Block scalar ends when indentation drops to or below the parent level
      if (line.trim().length > 0 && lineIndent <= blockScalarIndent) {
        inBlockScalar = false;
      } else {
        result.push(line); // Inside block scalar — never modify
        continue;
      }
    }

    // Detect block scalar start: any line ending with | or > (optionally with modifiers like |2, >-)
    if (/:\s*[|>][+-]?\d*\s*$/.test(prevLine)) {
      const prevIndent = (prevLine.match(/^(\s*)/)?.[1] ?? '').length;
      if (lineIndent > prevIndent) {
        inBlockScalar = true;
        blockScalarIndent = prevIndent;
        result.push(line);
        continue;
      }
    }

    // Check if previous line ends with ":" (list parent) and current line
    // is an indented key: value without dash
    const parentMatch = prevLine.match(/^(\s*)([\w_-]+):\s*$/);
    const childMatch = line.match(/^(\s+)([\w_-]+):\s+/);

    if (parentMatch && childMatch) {
      const parentIndent = parentMatch[1]!.length;
      const childIndent = childMatch[1]!.length;

      if (childIndent > parentIndent && !line.trimStart().startsWith('-')) {
        const indent = childMatch[1]!;
        const adjustedIndent = indent.slice(0, -2) || '';
        result.push(`${adjustedIndent}- ${line.trimStart()}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

// ─── R5: JSON-style trailing commas ───
//
// Problem: LLMs trained on JSON sometimes add trailing commas in YAML.
// Fix: Remove commas before closing braces/brackets or end of line.

function applyR5(text: string): string {
  // Remove trailing commas before } or ]
  let result = text.replace(/,\s*\n(\s*[}\]])/g, '\n$1');
  // Remove trailing commas at end of lines (not in quoted strings)
  result = result.replace(/,\s*$/gm, '');
  return result;
}

// ─── R6: Unicode smart quotes → ASCII ───
//
// Problem: Word processors and some LLMs emit smart quotes that YAML parsers reject.
// Fix: Replace all Unicode quote variants with ASCII equivalents.

function applyR6(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')  // left/right/low double smart quotes + double prime
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")  // left/right/low single smart quotes + single prime
    .replace(/\uFF1A/g, ':');  // §7.7: fullwidth colon → ASCII colon
}

// ─── R7: Missing leading zero in floats ───
//
// Problem: "confidence: .85" instead of "confidence: 0.85"
// YAML parsers may treat ".85" as a string rather than a number.
// Fix: Prepend "0" before the decimal point.

function applyR7(text: string): string {
  return text.replace(
    /^(\s*confidence:\s*)\.(\d+)/gm,
    '$10.$2',
  );
}
