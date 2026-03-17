/**
 * DHOOM — Davis Human-readable Optimized Object Markup
 *
 * A compact, human-readable serialization format built on fiber bundle geometry.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Modifier {
  type: "arithmetic" | "default" | "nested" | "delta" | "morphism" | "interned" | "computed" | "constraint";
  start?: JsonValue;
  step?: number;
  defaultValue?: JsonValue;
  target?: string;
  pool?: string[];
  expr?: string;
  constraint?: string;
}

export interface FieldDecl {
  name: string;
  modifier?: Modifier;
}

export interface Fiber {
  name?: string;
  fields: FieldDecl[];
  sparse?: boolean;
}

export class DhoomError extends Error {
  constructor(
    message: string,
    public line?: number,
  ) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = "DhoomError";
  }
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

function coerce(s: string): JsonValue {
  if (s === "T") return true;
  if (s === "F") return false;
  if (s === "null") return null;
  if (s === "") return "";
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function valueTodhoom(v: JsonValue): string {
  if (v === true) return "T";
  if (v === false) return "F";
  if (v === null) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (v.includes(",") || v.includes(":") || v.includes("\n") || v.includes('"')) {
      return `"${v.replace(/"/g, '""').replace(/\n/g, '\\n')}"`;
    }
    return v;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

function parseStringPattern(s: string): { prefix: string; num: number; width: number } | null {
  const match = s.match(/^(.*\D)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], num: parseInt(match[2], 10), width: match[2].length };
}

function arithmeticValue(start: JsonValue, step: number, i: number): JsonValue {
  if (typeof start === "number") {
    return start + step * i;
  }
  if (typeof start === "string") {
    const pat = parseStringPattern(start);
    if (pat) {
      const val = pat.num + step * i;
      return pat.prefix + String(val).padStart(pat.width, "0");
    }
    return start;
  }
  return start;
}

// ---------------------------------------------------------------------------
// Fiber parser
// ---------------------------------------------------------------------------

function parseFieldDecl(token: string): FieldDecl {
  // Morphism: field->target (must check before nested >)
  const arrowIdx = token.indexOf("->");
  if (arrowIdx !== -1) {
    const name = token.slice(0, arrowIdx);
    const target = token.slice(arrowIdx + 2);
    return { name, modifier: { type: "morphism", target } };
  }

  // Computed: field#expr
  const hashIdx = token.indexOf("#");
  if (hashIdx !== -1) {
    const name = token.slice(0, hashIdx);
    const expr = token.slice(hashIdx + 1);
    return { name, modifier: { type: "computed", expr } };
  }

  // Constraint: field!constraint
  const bangIdx = token.indexOf("!");
  if (bangIdx !== -1) {
    const name = token.slice(0, bangIdx);
    const constraint = token.slice(bangIdx + 1);
    return { name, modifier: { type: "constraint", constraint } };
  }

  // Interned: field&
  if (token.endsWith("&")) {
    return { name: token.slice(0, -1), modifier: { type: "interned" } };
  }

  // Delta: field^
  if (token.endsWith("^")) {
    return { name: token.slice(0, -1), modifier: { type: "delta" } };
  }

  // Nested: field>
  if (token.endsWith(">")) {
    return { name: token.slice(0, -1), modifier: { type: "nested" } };
  }

  // Arithmetic: field@start or field@start+step
  const atIdx = token.indexOf("@");
  if (atIdx !== -1) {
    const name = token.slice(0, atIdx);
    const rest = token.slice(atIdx + 1);
    const plusIdx = rest.indexOf("+");
    if (plusIdx !== -1) {
      const start = coerce(rest.slice(0, plusIdx));
      const step = parseFloat(rest.slice(plusIdx + 1));
      return { name, modifier: { type: "arithmetic", start, step } };
    }
    return { name, modifier: { type: "arithmetic", start: coerce(rest) } };
  }

  // Default: field|value
  const pipeIdx = token.indexOf("|");
  if (pipeIdx !== -1) {
    const name = token.slice(0, pipeIdx);
    let raw = token.slice(pipeIdx + 1);
    // Strip quotes from default values (e.g. field|"value with:colon")
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1).replace(/""/g, '"');
    }
    const defaultValue = coerce(raw);
    return { name, modifier: { type: "default", defaultValue } };
  }

  return { name: token };
}

export function parseFiber(input: string): Fiber {
  input = input.trim();
  const braceStart = input.indexOf("{");
  const braceEnd = input.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1) {
    throw new DhoomError("Missing braces in fiber header");
  }

  const rawName = braceStart > 0 ? input.slice(0, braceStart).trim() : undefined;
  let sparse = false;
  let name: string | undefined;

  if (rawName) {
    if (rawName.startsWith("~")) {
      sparse = true;
      name = rawName.slice(1).trim() || undefined;
    } else {
      name = rawName;
    }
  }

  const fieldsStr = input.slice(braceStart + 1, braceEnd);
  const fields = fieldsStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseFieldDecl);

  return { name: name || undefined, fields, sparse: sparse || undefined };
}

// ---------------------------------------------------------------------------
// Record field splitter (respects quotes)
// ---------------------------------------------------------------------------

function splitRecordFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (c === '\\' && i + 1 < line.length && line[i + 1] === 'n') {
        current += '\n';
        i++;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

function findHeaderEnd(input: string): number {
  const brace = input.indexOf("}");
  if (brace === -1) return -1;
  const colon = input.indexOf(":", brace + 1);
  if (colon === -1) return -1;
  return colon + 1;
}

function recordFields(fiber: Fiber): FieldDecl[] {
  return fiber.fields.filter((f) => f.modifier?.type !== "arithmetic" && f.modifier?.type !== "computed");
}

function decodeFlatRecords(body: string, fiber: Fiber): JsonValue[] {
  const recFields = recordFields(fiber);
  const records: JsonValue[] = [];
  let ordinal = 0;
  const deltaAccum = new Map<string, number>();

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const raw = splitRecordFields(trimmed);
    const obj: Record<string, JsonValue> = {};

    // Arithmetic fields
    for (const fd of fiber.fields) {
      if (fd.modifier?.type === "arithmetic") {
        obj[fd.name] = arithmeticValue(fd.modifier.start!, fd.modifier.step ?? 1, ordinal);
      }
    }

    // Positional values
    for (let j = 0; j < recFields.length; j++) {
      const rf = recFields[j];
      if (j < raw.length) {
        const val = raw[j];
        let resolved: JsonValue;
        if (val === "") {
          resolved = rf.modifier?.type === "default" ? rf.modifier.defaultValue! : "";
        } else if (val.startsWith(":")) {
          resolved = coerce(val.slice(1));
        } else {
          resolved = coerce(val);
        }

        // Delta accumulation
        if (rf.modifier?.type === "delta" && typeof resolved === "number") {
          if (ordinal === 0) {
            deltaAccum.set(rf.name, resolved);
          } else {
            const prev = deltaAccum.get(rf.name) ?? 0;
            resolved = prev + resolved;
            deltaAccum.set(rf.name, resolved);
          }
        }

        obj[rf.name] = resolved;
      } else {
        // Trailing elision
        if (rf.modifier?.type === "default") {
          obj[rf.name] = rf.modifier.defaultValue!;
        }
      }
    }

    records.push(obj);
    ordinal++;
  }

  return records;
}

function decodeSparseRecords(body: string, fiber: Fiber): JsonValue[] {
  const records: JsonValue[] = [];
  let ordinal = 0;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const obj: Record<string, JsonValue> = {};

    // Arithmetic fields
    for (const fd of fiber.fields) {
      if (fd.modifier?.type === "arithmetic") {
        obj[fd.name] = arithmeticValue(fd.modifier.start!, fd.modifier.step ?? 1, ordinal);
      }
    }

    // Parse name:value pairs
    const pairs = splitRecordFields(trimmed);
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(":");
      if (colonIdx === -1) continue;
      const fieldName = pair.slice(0, colonIdx).trim();
      const rawValue = pair.slice(colonIdx + 1).trim();
      obj[fieldName] = coerce(rawValue);
    }

    // Fill defaults for missing fields
    for (const fd of fiber.fields) {
      if (!(fd.name in obj)) {
        if (fd.modifier?.type === "default") {
          obj[fd.name] = fd.modifier.defaultValue!;
        } else if (fd.modifier?.type !== "arithmetic") {
          obj[fd.name] = null;
        }
      }
    }

    records.push(obj);
    ordinal++;
  }

  return records;
}

function decodeBundle(input: string): { name?: string; value: JsonValue } {
  const headerEnd = findHeaderEnd(input);
  if (headerEnd === -1) {
    throw new DhoomError("Missing '}:' header terminator");
  }

  const header = input.slice(0, headerEnd - 1).trim();
  let body = input.slice(headerEnd);
  const fiber = parseFiber(header);

  // Parse pool lines for interned fields
  const pools = new Map<string, string[]>();
  const bodyLines = body.split("\n");
  let poolEnd = 0;
  for (let i = 0; i < bodyLines.length; i++) {
    const trimmed = bodyLines[i].trim();
    if (trimmed === "") { poolEnd = i + 1; continue; }
    const poolMatch = trimmed.match(/^&(\w[\w-]*)?\[(.+)\]$/);
    if (poolMatch) {
      const fieldName = poolMatch[1];
      const poolValues = poolMatch[2].split(",").map((s) => s.trim());
      pools.set(fieldName, poolValues);
      // Store pool on the field modifier
      for (const fd of fiber.fields) {
        if (fd.name === fieldName && fd.modifier?.type === "interned") {
          fd.modifier.pool = poolValues;
        }
      }
      poolEnd = i + 1;
    } else {
      break;
    }
  }
  if (poolEnd > 0) {
    body = bodyLines.slice(poolEnd).join("\n");
  }

  const recFields = recordFields(fiber);
  const hasNested = recFields.some((f) => f.modifier?.type === "nested");

  let records: JsonValue[];
  if (fiber.sparse) {
    records = decodeSparseRecords(body, fiber);
  } else if (hasNested) {
    records = decodeNestedRecords(body, fiber);
  } else {
    records = decodeFlatRecords(body, fiber);
  }

  // Resolve interned fields (map integer indices to pool values)
  for (const fd of fiber.fields) {
    if (fd.modifier?.type === "interned" && fd.modifier.pool) {
      const pool = fd.modifier.pool;
      for (const rec of records) {
        const obj = rec as Record<string, JsonValue>;
        const idx = obj[fd.name];
        if (typeof idx === "number" && idx >= 0 && idx < pool.length) {
          obj[fd.name] = pool[idx];
        }
      }
    }
  }

  // Evaluate computed fields
  for (const fd of fiber.fields) {
    if (fd.modifier?.type === "computed" && fd.modifier.expr) {
      const expr = fd.modifier.expr;
      const opMatch = expr.match(/^(\w[\w-]*)\s*([+\-*])\s*(\w[\w-]*)$/);
      if (opMatch) {
        const [, leftField, op, rightField] = opMatch;
        for (const rec of records) {
          const obj = rec as Record<string, JsonValue>;
          const left = obj[leftField];
          const right = obj[rightField];
          if (typeof left === "number" && typeof right === "number") {
            let result: number;
            switch (op) {
              case "*": result = left * right; break;
              case "+": result = left + right; break;
              case "-": result = left - right; break;
              default: result = 0;
            }
            // Round to avoid floating point artifacts
            obj[fd.name] = Math.round(result * 1e10) / 1e10;
          }
        }
      }
    }
  }

  return { name: fiber.name, value: records };
}

function decodeNestedRecords(body: string, fiber: Fiber): JsonValue[] {
  const recFields = recordFields(fiber);
  const records: JsonValue[] = [];
  const lines = body.split("\n");
  let lineIdx = 0;
  let ordinal = 0;

  while (lineIdx < lines.length) {
    const trimmed = lines[lineIdx].trim();
    if (trimmed === "") {
      lineIdx++;
      continue;
    }

    const obj: Record<string, JsonValue> = {};

    // Arithmetic fields
    for (const fd of fiber.fields) {
      if (fd.modifier?.type === "arithmetic") {
        obj[fd.name] = arithmeticValue(fd.modifier.start!, fd.modifier.step ?? 1, ordinal);
      }
    }

    // Parse parent record line
    const raw = splitRecordFields(trimmed);
    const nestedFields: FieldDecl[] = [];
    let rfIdx = 0;

    for (const rf of recFields) {
      if (rf.modifier?.type === "nested") {
        nestedFields.push(rf);
      } else {
        if (rfIdx < raw.length) {
          const val = raw[rfIdx];
          if (val === "") {
            obj[rf.name] = rf.modifier?.type === "default" ? rf.modifier.defaultValue! : "";
          } else if (val.startsWith(":")) {
            obj[rf.name] = coerce(val.slice(1));
          } else {
            obj[rf.name] = coerce(val);
          }
        } else if (rf.modifier?.type === "default") {
          obj[rf.name] = rf.modifier.defaultValue!;
        }
        rfIdx++;
      }
    }

    lineIdx++;

    // Parse nested bundles
    for (const nf of nestedFields) {
      let nestedText = "";
      while (lineIdx < lines.length) {
        const l = lines[lineIdx];
        if (l !== "" && !l.startsWith(" ") && !l.startsWith("\t") && nestedText !== "") {
          break;
        }
        if (l.trim() === "" && nestedText === "") {
          lineIdx++;
          continue;
        }
        if (nestedText.includes("}:\n") && l.trim().startsWith("{")) {
          break;
        }
        nestedText += l.trim() + "\n";
        lineIdx++;
      }

      if (nestedText.trim() !== "") {
        const { value } = decodeBundle(nestedText.trim());
        obj[nf.name] = value;
      }
    }

    records.push(obj);
    ordinal++;
  }

  return records;
}

/** Decode a DHOOM string into a JSON value. */
export function decode(input: string): JsonValue {
  input = input.trim();
  if (input === "") return null;

  const { name, value } = decodeBundle(input);
  if (name) {
    return { [name]: value };
  }
  return value;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

function detectArithmetic(values: JsonValue[]): { start: JsonValue; step: number } | null {
  if (values.length < 3) return null;

  // Numeric
  if (values.every((v) => typeof v === "number")) {
    const nums = values as number[];
    const step = nums[1] - nums[0];
    if (nums.every((_, i) => i === 0 || nums[i] - nums[i - 1] === step)) {
      return { start: nums[0], step };
    }
  }

  // String pattern
  if (values.every((v) => typeof v === "string")) {
    const strs = values as string[];
    const patterns = strs.map(parseStringPattern);
    if (patterns.every((p) => p !== null)) {
      const ps = patterns as NonNullable<ReturnType<typeof parseStringPattern>>[];
      if (ps.every((p) => p.prefix === ps[0].prefix && p.width === ps[0].width)) {
        const step = ps[1].num - ps[0].num;
        if (ps.every((_, i) => i === 0 || ps[i].num - ps[i - 1].num === step)) {
          return { start: strs[0], step };
        }
      }
    }
  }

  return null;
}

function findModalDefault(values: JsonValue[]): { value: JsonValue; count: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<string, { value: JsonValue; count: number }>();
  for (const v of values) {
    const key = JSON.stringify(v);
    const entry = counts.get(key);
    if (entry) {
      entry.count++;
    } else {
      counts.set(key, { value: v, count: 1 });
    }
  }
  let best: { value: JsonValue; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  return best;
}

function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function detectDelta(values: JsonValue[]): boolean {
  if (values.length < 3) return false;
  if (!values.every((v) => typeof v === "number" && Number.isInteger(v))) return false;
  const nums = values as number[];
  const deltas = nums.map((v, i) => (i === 0 ? v : v - nums[i - 1]));
  const absLen = nums.reduce((sum, v) => sum + String(v).length, 0);
  const deltaLen = deltas.reduce((sum, d) => sum + String(d).length, 0);
  return deltaLen < absLen * 0.7;
}

function detectInterned(values: JsonValue[]): string[] | null {
  if (values.length < 3) return null;
  if (!values.every((v) => typeof v === "string")) return null;
  const strs = values as string[];
  const distinct = [...new Set(strs)];
  if (distinct.length < 2) return null;
  if (distinct.length > Math.ceil(values.length / 3)) return null;
  const rawLen = strs.reduce((sum, s) => sum + s.length, 0);
  const poolLen = distinct.join(", ").length + 2;
  const indexLen = strs.reduce((sum, s) => sum + String(distinct.indexOf(s)).length, 0);
  if (indexLen + poolLen >= rawLen * 0.9) return null;
  return distinct;
}

function detectComputed(
  key: string,
  records: Record<string, JsonValue>[],
  candidateKeys: string[],
): { expr: string } | null {
  if (records.length < 2) return null;
  const values = records.map((r) => r[key]);
  if (!values.every((v) => typeof v === "number")) return null;

  for (const op of ["*", "+", "-"] as const) {
    for (const a of candidateKeys) {
      if (a === key) continue;
      const aVals = records.map((r) => r[a]);
      if (!aVals.every((v) => typeof v === "number")) continue;
      for (const b of candidateKeys) {
        if (b === key || b === a) continue;
        const bVals = records.map((r) => r[b]);
        if (!bVals.every((v) => typeof v === "number")) continue;

        let match = true;
        for (let i = 0; i < records.length; i++) {
          const expected = values[i] as number;
          const aVal = aVals[i] as number;
          const bVal = bVals[i] as number;
          let result: number;
          switch (op) {
            case "*": result = aVal * bVal; break;
            case "+": result = aVal + bVal; break;
            case "-": result = aVal - bVal; break;
          }
          if (Math.abs(result - expected) > 1e-9) { match = false; break; }
        }
        if (match) return { expr: `${a}${op}${b}` };
      }
    }
  }
  return null;
}

function encodeBundle(
  name: string,
  records: Record<string, JsonValue>[],
  indent: number,
): string {
  const prefix = " ".repeat(indent);

  if (records.length === 0) {
    return `${prefix}${name}{}:\n`;
  }

  const keys = Object.keys(records[0]);
  const orderedFields: FieldDecl[] = [];
  const arithmeticKeys = new Set<string>();
  const deltaKeys = new Set<string>();
  const defaultKeys = new Map<string, JsonValue>();
  const nestedKeys = new Set<string>();
  const variableKeys: string[] = [];
  const computedKeys = new Map<string, string>();
  const internedKeys = new Map<string, string[]>();

  // Phase 1: categorize nested and arithmetic
  const remainingKeys: string[] = [];
  for (const key of keys) {
    const values = records.map((r) => r[key]);

    // Check nested
    if (values.every((v) => Array.isArray(v))) {
      nestedKeys.add(key);
      continue;
    }

    // Check arithmetic
    const arith = detectArithmetic(values);
    if (arith) {
      arithmeticKeys.add(key);
      orderedFields.push({
        name: key,
        modifier: {
          type: "arithmetic",
          start: arith.start,
          step: arith.step === 1 ? undefined : arith.step,
        },
      });
      continue;
    }

    remainingKeys.push(key);
  }

  // Phase 2: detect computed fields among all remaining keys
  for (const key of [...remainingKeys]) {
    const computed = detectComputed(key, records, remainingKeys);
    if (computed) {
      computedKeys.set(key, computed.expr);
      remainingKeys.splice(remainingKeys.indexOf(key), 1);
    }
  }

  // Phase 3: categorize remaining keys as delta, interned, default, or variable
  for (const key of remainingKeys) {
    const values = records.map((r) => r[key]);

    // Check delta
    if (detectDelta(values)) {
      deltaKeys.add(key);
      continue;
    }

    // Check interned
    const pool = detectInterned(values);
    if (pool) {
      internedKeys.set(key, pool);
      continue;
    }

    // Check modal default
    const modal = findModalDefault(values);
    if (modal && modal.count > records.length / 2) {
      defaultKeys.set(key, modal.value);
      continue;
    }

    variableKeys.push(key);
  }

  // Ensure at least one field produces record body content
  if (variableKeys.length === 0 && deltaKeys.size === 0 && nestedKeys.size === 0
      && internedKeys.size === 0) {
    for (const key of keys) {
      if (arithmeticKeys.has(key)) {
        arithmeticKeys.delete(key);
        const idx = orderedFields.findIndex((f) => f.name === key);
        if (idx !== -1) orderedFields.splice(idx, 1);
        variableKeys.push(key);
        break;
      }
      if (defaultKeys.has(key)) {
        defaultKeys.delete(key);
        variableKeys.push(key);
        break;
      }
    }
  }

  // Computed fields
  for (const [key, expr] of computedKeys) {
    orderedFields.push({ name: key, modifier: { type: "computed", expr } });
  }

  // Delta fields
  for (const key of deltaKeys) {
    orderedFields.push({ name: key, modifier: { type: "delta" } });
  }

  // Interned fields
  for (const [key, pool] of internedKeys) {
    orderedFields.push({ name: key, modifier: { type: "interned", pool } });
  }

  // Variable fields
  for (const key of variableKeys) {
    orderedFields.push({ name: key });
  }

  // Default fields (sorted by frequency desc for trailing elision)
  const defaultEntries = [...defaultKeys.entries()].map(([key, val]) => {
    const count = records.filter((r) => jsonEqual(r[key], val)).length;
    return { key, val, count };
  });
  defaultEntries.sort((a, b) => b.count - a.count);
  for (const { key, val } of defaultEntries) {
    orderedFields.push({ name: key, modifier: { type: "default", defaultValue: val } });
  }

  // Nested fields
  for (const key of nestedKeys) {
    orderedFields.push({ name: key, modifier: { type: "nested" } });
  }

  // Check sparsity — use sparse mode when ≥8 fields and >75% null/empty
  const nonArithKeys = keys.filter((k) => !arithmeticKeys.has(k) && !nestedKeys.has(k));
  let useSparse = false;
  if (nonArithKeys.length >= 8) {
    let nullCount = 0;
    let totalCells = 0;
    for (const r of records) {
      for (const k of nonArithKeys) {
        totalCells++;
        const v = r[k];
        if (v === null || v === undefined || v === "") nullCount++;
      }
    }
    useSparse = nullCount > totalCells * 0.75;
  }

  // Emit header
  const sparsePrefix = useSparse ? "~" : "";
  let out = `${prefix}${sparsePrefix}${name}{`;
  out += orderedFields
    .map((fd) => {
      let s = fd.name;
      if (fd.modifier?.type === "arithmetic") {
        s += `@${valueTodhoom(fd.modifier.start!)}`;
        if (fd.modifier.step !== undefined) s += `+${fd.modifier.step}`;
      } else if (fd.modifier?.type === "default") {
        s += `|${valueTodhoom(fd.modifier.defaultValue!)}`;
      } else if (fd.modifier?.type === "nested") {
        s += ">";
      } else if (fd.modifier?.type === "delta") {
        s += "^";
      } else if (fd.modifier?.type === "morphism") {
        s += `->${fd.modifier.target}`;
      } else if (fd.modifier?.type === "interned") {
        s += "&";
      } else if (fd.modifier?.type === "computed") {
        s += `#${fd.modifier.expr}`;
      }
      return s;
    })
    .join(", ");
  out += "}:\n";

  // Emit pool lines for interned fields
  for (const fd of orderedFields) {
    if (fd.modifier?.type === "interned" && fd.modifier.pool) {
      out += `${prefix}&${fd.name}[${fd.modifier.pool.join(", ")}]\n`;
    }
  }

  // Emit records
  const recFields = orderedFields.filter((f) => f.modifier?.type !== "arithmetic" && f.modifier?.type !== "computed");

  if (useSparse) {
    // Sparse mode: emit field:value pairs for non-null values
    for (const record of records) {
      const pairs: string[] = [];
      for (const rf of recFields) {
        if (rf.modifier?.type === "nested") continue;
        const val = record[rf.name];
        if (val !== null && val !== undefined && val !== "") {
          if (rf.modifier?.type === "interned" && rf.modifier.pool) {
            const idx = rf.modifier.pool.indexOf(typeof val === "string" ? val : String(val));
            pairs.push(`${rf.name}:${idx >= 0 ? idx : 0}`);
          } else {
            pairs.push(`${rf.name}:${valueTodhoom(val)}`);
          }
        }
      }
      if (pairs.length === 0) {
        const firstField = recFields.find((f) => f.modifier?.type !== "nested");
        if (firstField) pairs.push(`${firstField.name}:null`);
      }
      out += `${prefix}${pairs.join(", ")}\n`;
    }
    return out;
  }

  let recordIdx = 0;
  const prevDelta = new Map<string, number>();

  for (const record of records) {
    const values: string[] = [];
    const nestedBundles: { name: string; records: Record<string, JsonValue>[] }[] = [];

    for (const rf of recFields) {
      if (rf.modifier?.type === "nested") {
        const v = record[rf.name];
        if (Array.isArray(v)) {
          nestedBundles.push({ name: "", records: v as Record<string, JsonValue>[] });
        }
        continue;
      }

      const val = record[rf.name];

      if (rf.modifier?.type === "delta") {
        const numVal = typeof val === "number" ? val : 0;
        if (recordIdx === 0) {
          prevDelta.set(rf.name, numVal);
          values.push(valueTodhoom(numVal));
        } else {
          const prev = prevDelta.get(rf.name) ?? 0;
          const delta = numVal - prev;
          prevDelta.set(rf.name, numVal);
          values.push(valueTodhoom(delta));
        }
      } else if (rf.modifier?.type === "default") {
        if (jsonEqual(val, rf.modifier.defaultValue!)) {
          values.push("");
        } else {
          values.push(`:${valueTodhoom(val)}`);
        }
      } else if (rf.modifier?.type === "interned" && rf.modifier.pool) {
        const idx = rf.modifier.pool.indexOf(typeof val === "string" ? val : String(val));
        values.push(String(idx >= 0 ? idx : 0));
      } else {
        values.push(valueTodhoom(val));
      }
    }

    // Trailing elision
    while (values.length > 0 && values[values.length - 1] === "") {
      values.pop();
    }

    out += `${prefix}${values.join(", ")}`;

    if (nestedBundles.length > 0) {
      out += ",\n";
      for (const nb of nestedBundles) {
        out += encodeBundle(nb.name, nb.records, indent + 2);
      }
    } else {
      out += "\n";
    }

    recordIdx++;
  }

  return out;
}

/** Encode a JSON value into DHOOM format. */
export function encode(value: JsonValue): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const arr = value[keys[0]];
      if (Array.isArray(arr)) {
        return encodeBundle(keys[0], arr as Record<string, JsonValue>[], 0);
      }
    }
    throw new DhoomError("Top-level object must have exactly one key (the bundle name)");
  }
  if (Array.isArray(value)) {
    return encodeBundle("data", value as Record<string, JsonValue>[], 0);
  }
  throw new DhoomError("Top-level value must be an object or array");
}

// ---------------------------------------------------------------------------
// Streaming API
// ---------------------------------------------------------------------------

/**
 * Build the fiber header and field metadata for a record set.
 * Shared by encode() and encodeLines().
 */
function buildFiberMeta(
  name: string,
  records: Record<string, JsonValue>[],
): {
  header: string;
  orderedFields: FieldDecl[];
  recFields: FieldDecl[];
} {
  if (records.length === 0) {
    return { header: `${name}{}:`, orderedFields: [], recFields: [] };
  }

  const keys = Object.keys(records[0]);
  const orderedFields: FieldDecl[] = [];
  const arithmeticKeys = new Set<string>();
  const defaultKeys = new Map<string, JsonValue>();
  const nestedKeys = new Set<string>();
  const variableKeys: string[] = [];
  const deltaKeys = new Set<string>();
  const computedKeys = new Map<string, string>();
  const internedKeys = new Map<string, string[]>();

  // Phase 1: categorize nested and arithmetic
  const remainingKeys: string[] = [];
  for (const key of keys) {
    const values = records.map((r) => r[key]);

    if (values.every((v) => Array.isArray(v))) {
      nestedKeys.add(key);
      continue;
    }

    const arith = detectArithmetic(values);
    if (arith) {
      arithmeticKeys.add(key);
      orderedFields.push({
        name: key,
        modifier: {
          type: "arithmetic",
          start: arith.start,
          step: arith.step === 1 ? undefined : arith.step,
        },
      });
      continue;
    }

    remainingKeys.push(key);
  }

  // Phase 2: detect computed fields among all remaining keys
  for (const key of [...remainingKeys]) {
    const computed = detectComputed(key, records, remainingKeys);
    if (computed) {
      computedKeys.set(key, computed.expr);
      remainingKeys.splice(remainingKeys.indexOf(key), 1);
    }
  }

  // Phase 3: categorize remaining keys as delta, interned, default, or variable
  for (const key of remainingKeys) {
    const values = records.map((r) => r[key]);

    if (detectDelta(values)) {
      deltaKeys.add(key);
      continue;
    }

    const pool = detectInterned(values);
    if (pool) {
      internedKeys.set(key, pool);
      continue;
    }

    const modal = findModalDefault(values);
    if (modal && modal.count > records.length / 2) {
      defaultKeys.set(key, modal.value);
      continue;
    }

    variableKeys.push(key);
  }

  // Ensure at least one field produces record body content
  if (variableKeys.length === 0 && deltaKeys.size === 0 && nestedKeys.size === 0
      && internedKeys.size === 0) {
    for (const key of keys) {
      if (arithmeticKeys.has(key)) {
        arithmeticKeys.delete(key);
        const idx = orderedFields.findIndex((f) => f.name === key);
        if (idx !== -1) orderedFields.splice(idx, 1);
        variableKeys.push(key);
        break;
      }
      if (defaultKeys.has(key)) {
        defaultKeys.delete(key);
        variableKeys.push(key);
        break;
      }
    }
  }

  // Computed fields
  for (const [key, expr] of computedKeys) {
    orderedFields.push({ name: key, modifier: { type: "computed", expr } });
  }

  for (const key of deltaKeys) {
    orderedFields.push({ name: key, modifier: { type: "delta" } });
  }

  // Interned fields
  for (const [key, pool] of internedKeys) {
    orderedFields.push({ name: key, modifier: { type: "interned", pool } });
  }

  for (const key of variableKeys) {
    orderedFields.push({ name: key });
  }

  const defaultEntries = [...defaultKeys.entries()].map(([key, val]) => {
    const count = records.filter((r) => jsonEqual(r[key], val)).length;
    return { key, val, count };
  });
  defaultEntries.sort((a, b) => b.count - a.count);
  for (const { key, val } of defaultEntries) {
    orderedFields.push({ name: key, modifier: { type: "default", defaultValue: val } });
  }

  for (const key of nestedKeys) {
    orderedFields.push({ name: key, modifier: { type: "nested" } });
  }

  let header = `${name}{`;
  header += orderedFields
    .map((fd) => {
      let s = fd.name;
      if (fd.modifier?.type === "arithmetic") {
        s += `@${valueTodhoom(fd.modifier.start!)}`;
        if (fd.modifier.step !== undefined) s += `+${fd.modifier.step}`;
      } else if (fd.modifier?.type === "default") {
        s += `|${valueTodhoom(fd.modifier.defaultValue!)}`;
      } else if (fd.modifier?.type === "nested") {
        s += ">";
      } else if (fd.modifier?.type === "delta") {
        s += "^";
      } else if (fd.modifier?.type === "morphism") {
        s += `->${fd.modifier.target}`;
      } else if (fd.modifier?.type === "interned") {
        s += "&";
      } else if (fd.modifier?.type === "computed") {
        s += `#${fd.modifier.expr}`;
      }
      return s;
    })
    .join(", ");
  header += "}:";

  // Prepend pool lines for interned fields
  let poolLines = "";
  for (const fd of orderedFields) {
    if (fd.modifier?.type === "interned" && fd.modifier.pool) {
      poolLines += `&${fd.name}[${fd.modifier.pool.join(", ")}]\n`;
    }
  }
  if (poolLines) header += "\n" + poolLines.trimEnd();

  const recFields = orderedFields.filter((f) => f.modifier?.type !== "arithmetic" && f.modifier?.type !== "computed");
  return { header, orderedFields, recFields };
}

/**
 * Encode a record into a single DHOOM record line using the given field metadata.
 */
function encodeRecordLine(
  record: Record<string, JsonValue>,
  recFields: FieldDecl[],
  recordIdx?: number,
  prevDelta?: Map<string, number>,
): string {
  const values: string[] = [];

  for (const rf of recFields) {
    if (rf.modifier?.type === "nested") continue;

    const val = record[rf.name];

    if (rf.modifier?.type === "delta" && prevDelta && typeof val === "number") {
      if ((recordIdx ?? 0) === 0) {
        prevDelta.set(rf.name, val);
        values.push(valueTodhoom(val));
      } else {
        const prev = prevDelta.get(rf.name) ?? 0;
        const delta = val - prev;
        prevDelta.set(rf.name, val);
        values.push(valueTodhoom(delta));
      }
    } else if (rf.modifier?.type === "default") {
      values.push(jsonEqual(val, rf.modifier.defaultValue!) ? "" : `:${valueTodhoom(val)}`);
    } else if (rf.modifier?.type === "interned" && rf.modifier.pool) {
      const idx = rf.modifier.pool.indexOf(typeof val === "string" ? val : String(val));
      values.push(String(idx >= 0 ? idx : 0));
    } else {
      values.push(valueTodhoom(val));
    }
  }

  while (values.length > 0 && values[values.length - 1] === "") {
    values.pop();
  }

  return values.join(", ");
}

/**
 * Yield DHOOM output line-by-line: first the fiber header, then one line per record.
 * Enables incremental writing to files or streams without buffering the entire output.
 *
 * Note: the full records array must be provided upfront so that arithmetic sequences
 * and modal defaults can be computed for the header. Each record line is then yielded
 * individually for incremental I/O.
 */
export function* encodeLines(value: JsonValue): Generator<string> {
  let name: string;
  let records: Record<string, JsonValue>[];

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1) {
      throw new DhoomError("Top-level object must have exactly one key (the bundle name)");
    }
    name = keys[0];
    const arr = value[name];
    if (!Array.isArray(arr)) {
      throw new DhoomError("Top-level object must have exactly one key (the bundle name)");
    }
    records = arr as Record<string, JsonValue>[];
  } else if (Array.isArray(value)) {
    name = "data";
    records = value as Record<string, JsonValue>[];
  } else {
    throw new DhoomError("Top-level value must be an object or array");
  }

  const { header, recFields } = buildFiberMeta(name, records);
  yield header;

  const hasDelta = recFields.some((f) => f.modifier?.type === "delta");
  const prevDelta = hasDelta ? new Map<string, number>() : undefined;

  for (let i = 0; i < records.length; i++) {
    yield encodeRecordLine(records[i], recFields, i, prevDelta);
  }
}

/**
 * Decode DHOOM from an async iterable of lines (e.g. readline interface, fetch body, etc).
 * Returns the decoded JSON value once all lines have been consumed.
 */
export async function decodeStream(
  lines: AsyncIterable<string>,
): Promise<JsonValue> {
  const collected: string[] = [];
  for await (const line of lines) {
    collected.push(line);
  }
  return decode(collected.join("\n"));
}
