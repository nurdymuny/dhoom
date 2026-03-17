/**
 * DHOOM Encode/Decode Benchmark
 *
 * Measures:
 *   1. Roundtrip correctness — encode → decode produces identical JSON
 *   2. Encode speed — operations/second across dataset sizes
 *   3. Decode speed — operations/second across dataset sizes
 *   4. Compression ratio — DHOOM bytes vs JSON bytes
 *
 * Run:  node benchmarks/encode-decode.js
 */

import { encode, decode } from "../packages/dhoom-ts/dist/index.js";

// ---------------------------------------------------------------------------
// Test datasets (small → large, with various DHOOM features)
// ---------------------------------------------------------------------------

function generateReviews(n) {
  const names = ["Alex Rivera", "Brij Pandey", "Casey Lee", "Dana Kim", "Eli Rosenberg",
    "Farah Nassar", "Grace Hopper", "Hugo Vega", "Iris Chang", "Jake Moreno"];
  const comments = ["Excellent!", "Game changer!", "Average", "Good value", "Not bad",
    "Could be better", "Loved it", "Decent", "Amazing product", "Solid choice"];
  const records = [];
  for (let i = 0; i < n; i++) {
    records.push({
      id: 101 + i,
      customer: names[i % names.length],
      rating: i % 3 === 0 ? 3 : 5,
      comment: comments[i % comments.length],
      verified: i % 4 !== 0,
    });
  }
  return { reviews: records };
}

function generateSensors(n) {
  const records = [];
  for (let i = 0; i < n; i++) {
    records.push({
      sensor_id: `T-${String(i + 1).padStart(3, "0")}`,
      timestamp: 1710000000 + i * 60,
      value: Math.round((20 + Math.sin(i) * 10) * 10) / 10,
      status: i % 10 === 9 ? "alert" : "normal",
      unit: "celsius",
    });
  }
  return { readings: records };
}

function generateUsers(n) {
  const names = ["Dana Kim", "Eli Rosenberg", "Farah Nassar", "Grace Hopper", "Hugo Vega"];
  const roles = ["admin", "editor", "viewer", "viewer", "viewer"];
  const records = [];
  for (let i = 0; i < n; i++) {
    records.push({
      id: 201 + i,
      name: names[i % names.length],
      email: `user${i}@example.com`,
      role: roles[i % roles.length],
      active: true,
    });
  }
  return { users: records };
}

const SIZES = [3, 10, 50, 100, 500, 1000];

const GENERATORS = {
  "Reviews":  generateReviews,
  "Sensors":  generateSensors,
  "Users":    generateUsers,
};

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------

function bench(fn, warmupMs = 100, runMs = 1000) {
  // Warmup
  const warmEnd = performance.now() + warmupMs;
  while (performance.now() < warmEnd) fn();

  // Timed run
  let ops = 0;
  const start = performance.now();
  const deadline = start + runMs;
  while (performance.now() < deadline) {
    fn();
    ops++;
  }
  const elapsed = performance.now() - start;
  return { ops, elapsed, opsPerSec: Math.round(ops / (elapsed / 1000)) };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("=".repeat(90));
console.log("DHOOM ENCODE/DECODE BENCHMARK");
console.log("Engine: " + (typeof process !== "undefined" ? `Node.js ${process.version}` : "unknown"));
console.log("=".repeat(90));

// ---- Roundtrip correctness ----
console.log("\n## Roundtrip Correctness\n");
let correctTotal = 0;
let correctPass = 0;

for (const [name, gen] of Object.entries(GENERATORS)) {
  for (const size of SIZES) {
    const data = gen(size);
    const dhoom = encode(data);
    const back = decode(dhoom);
    const ok = deepEqual(data, back);
    correctTotal++;
    if (ok) correctPass++;
    const mark = ok ? "✓" : "✗ FAIL";
    if (!ok) {
      console.log(`  ${mark}  ${name} × ${size}`);
    }
  }
}
console.log(`  ${correctPass}/${correctTotal} roundtrips passed`);
if (correctPass < correctTotal) {
  console.log("  ⚠ Some roundtrips FAILED — results below may be unreliable");
}

// ---- Compression ratio ----
console.log("\n## Compression Ratio\n");
console.log(`${"Dataset".padEnd(14)} ${"N".padStart(5)} ${"JSON bytes".padStart(11)} ${"DHOOM bytes".padStart(12)} ${"Ratio".padStart(7)} ${"Savings".padStart(8)}`);
console.log("-".repeat(62));

for (const [name, gen] of Object.entries(GENERATORS)) {
  for (const size of SIZES) {
    const data = gen(size);
    const jsonBytes = Buffer.byteLength(JSON.stringify(data));
    const dhoomBytes = Buffer.byteLength(encode(data));
    const ratio = (dhoomBytes / jsonBytes).toFixed(2);
    const savings = `-${(100 - (dhoomBytes / jsonBytes) * 100).toFixed(0)}%`;
    console.log(`${name.padEnd(14)} ${String(size).padStart(5)} ${String(jsonBytes).padStart(11)} ${String(dhoomBytes).padStart(12)} ${ratio.padStart(7)} ${savings.padStart(8)}`);
  }
}

// ---- Encode speed ----
console.log("\n## Encode Speed (ops/sec, 1s per cell)\n");
console.log(`${"Dataset".padEnd(14)} ${SIZES.map(s => String(s).padStart(9)).join(" ")}`);
console.log("-".repeat(14 + SIZES.length * 10));

for (const [name, gen] of Object.entries(GENERATORS)) {
  const cells = [];
  for (const size of SIZES) {
    const data = gen(size);
    const { opsPerSec } = bench(() => encode(data));
    cells.push(String(opsPerSec).padStart(9));
  }
  console.log(`${name.padEnd(14)} ${cells.join(" ")}`);
}

// ---- Decode speed ----
console.log("\n## Decode Speed (ops/sec, 1s per cell)\n");
console.log(`${"Dataset".padEnd(14)} ${SIZES.map(s => String(s).padStart(9)).join(" ")}`);
console.log("-".repeat(14 + SIZES.length * 10));

for (const [name, gen] of Object.entries(GENERATORS)) {
  const cells = [];
  for (const size of SIZES) {
    const data = gen(size);
    const dhoom = encode(data);
    const { opsPerSec } = bench(() => decode(dhoom));
    cells.push(String(opsPerSec).padStart(9));
  }
  console.log(`${name.padEnd(14)} ${cells.join(" ")}`);
}

// ---- JSON parse/stringify reference ----
console.log("\n## JSON Baseline (ops/sec, for comparison)\n");
console.log(`${"Dataset".padEnd(14)} ${"N".padStart(5)} ${"stringify".padStart(12)} ${"parse".padStart(12)} ${"dhoom enc".padStart(12)} ${"dhoom dec".padStart(12)}`);
console.log("-".repeat(69));

for (const [name, gen] of Object.entries(GENERATORS)) {
  for (const size of [3, 100, 1000]) {
    const data = gen(size);
    const jsonStr = JSON.stringify(data);
    const dhoomStr = encode(data);

    const { opsPerSec: sfy } = bench(() => JSON.stringify(data));
    const { opsPerSec: prs } = bench(() => JSON.parse(jsonStr));
    const { opsPerSec: enc } = bench(() => encode(data));
    const { opsPerSec: dec } = bench(() => decode(dhoomStr));

    console.log(`${name.padEnd(14)} ${String(size).padStart(5)} ${String(sfy).padStart(12)} ${String(prs).padStart(12)} ${String(enc).padStart(12)} ${String(dec).padStart(12)}`);
  }
}

console.log("\n" + "=".repeat(90));
console.log("Done.");
