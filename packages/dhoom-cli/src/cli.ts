#!/usr/bin/env node

/**
 * DHOOM CLI — convert between JSON and DHOOM format.
 *
 * Usage:
 *   dhoom input.json              # encode JSON -> DHOOM (stdout)
 *   dhoom input.json -o out.dhoom # encode JSON -> DHOOM (file)
 *   dhoom input.dhoom             # decode DHOOM -> JSON (stdout)
 *   dhoom input.dhoom -o out.json # decode DHOOM -> JSON (file)
 *   echo '{}' | dhoom             # pipe from stdin (JSON -> DHOOM)
 *   dhoom input.json --stats      # show token/char stats
 *   dhoom --encode                # force encode direction (stdin)
 *   dhoom --decode                # force decode direction (stdin)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { encode, decode } from "@dhoom-format/dhoom";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface Args {
  input?: string;
  output?: string;
  direction?: "encode" | "decode";
  stats: boolean;
  help: boolean;
  compact: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { stats: false, help: false, compact: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      args.help = true;
    } else if (a === "-o" || a === "--output") {
      args.output = argv[++i];
    } else if (a === "--stats") {
      args.stats = true;
    } else if (a === "--encode") {
      args.direction = "encode";
    } else if (a === "--decode") {
      args.direction = "decode";
    } else if (a === "--compact") {
      args.compact = true;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  if (positional.length > 0) args.input = positional[0];
  return args;
}

// ---------------------------------------------------------------------------
// Token approximation (o200k_base-like)
// ---------------------------------------------------------------------------

function approxTokens(s: string): number {
  // Rough approximation: ~3.7 chars per token for o200k_base
  return Math.ceil(s.length / 3.7);
}

// ---------------------------------------------------------------------------
// Direction detection
// ---------------------------------------------------------------------------

function detectDirection(
  inputFile: string | undefined,
  content: string,
  explicit?: "encode" | "decode",
): "encode" | "decode" {
  if (explicit) return explicit;

  // By file extension
  if (inputFile) {
    const ext = extname(inputFile).toLowerCase();
    if (ext === ".json") return "encode";
    if (ext === ".dhoom") return "decode";
  }

  // By content heuristic: if it starts with { or [, it's JSON
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "encode";
  return "decode";
}

// ---------------------------------------------------------------------------
// Stats display
// ---------------------------------------------------------------------------

function showStats(jsonStr: string, dhoomStr: string): void {
  const jsonMin = JSON.stringify(JSON.parse(jsonStr));
  const jc = jsonMin.length;
  const dc = dhoomStr.length;
  const jt = approxTokens(jsonMin);
  const dt = approxTokens(dhoomStr);
  const charSaved = (((jc - dc) / jc) * 100).toFixed(1);
  const tokSaved = (((jt - dt) / jt) * 100).toFixed(1);

  process.stderr.write("\n");
  process.stderr.write(`  JSON:  ${jc.toLocaleString()} chars · ~${jt.toLocaleString()} tokens\n`);
  process.stderr.write(`  DHOOM: ${dc.toLocaleString()} chars · ~${dt.toLocaleString()} tokens\n`);
  process.stderr.write(`  Saved: ${charSaved}% chars · ${tokSaved}% tokens\n`);
  process.stderr.write("\n");
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP = `
dhoom — convert between JSON and DHOOM format

Usage:
  dhoom <input>              Convert file (auto-detects direction)
  dhoom <input> -o <output>  Convert and write to file
  cat data.json | dhoom      Pipe from stdin
  dhoom --stats input.json   Show token/char savings

Options:
  -o, --output <file>   Write output to file instead of stdout
  --encode              Force JSON → DHOOM direction
  --decode              Force DHOOM → JSON direction
  --stats               Show character and token comparison
  --compact             Compact JSON output (no indentation)
  -h, --help            Show this help

Examples:
  dhoom data.json                      # JSON → DHOOM
  dhoom data.dhoom                     # DHOOM → JSON
  dhoom data.json -o data.dhoom        # JSON → DHOOM (file)
  dhoom data.json --stats              # Convert + show stats
  echo '{"users":[...]}' | dhoom       # Pipe JSON → DHOOM
  cat data.dhoom | dhoom --decode      # Pipe DHOOM → JSON

Format auto-detection:
  .json extension  →  encode (JSON to DHOOM)
  .dhoom extension →  decode (DHOOM to JSON)
  stdin            →  detect by content (JSON starts with { or [)
`;

// ---------------------------------------------------------------------------
// Read stdin
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new Error("No input file and no data on stdin. Use --help for usage."));
      return;
    }
    const chunks: string[] = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => chunks.push(chunk as string));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  // Read input
  let content: string;
  if (args.input) {
    content = readFileSync(args.input, "utf-8");
  } else {
    content = await readStdin();
  }

  const direction = detectDirection(args.input, content, args.direction);
  let result: string;
  let jsonStr: string;

  if (direction === "encode") {
    // JSON → DHOOM
    jsonStr = content;
    const parsed = JSON.parse(content);
    result = encode(parsed);
  } else {
    // DHOOM → JSON
    const parsed = decode(content);
    const indent = args.compact ? undefined : 2;
    result = JSON.stringify(parsed, null, indent) + "\n";
    jsonStr = JSON.stringify(parsed);
  }

  // Output
  if (args.output) {
    writeFileSync(args.output, result, "utf-8");
    const label = direction === "encode" ? "DHOOM" : "JSON";
    const dest = basename(args.output);
    process.stderr.write(`  ✓ ${label} written to ${dest}\n`);
  } else {
    process.stdout.write(result);
  }

  // Stats
  if (args.stats) {
    if (direction === "encode") {
      showStats(jsonStr, result);
    } else {
      showStats(result.trim(), content);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
