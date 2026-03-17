import { useState, useEffect, useCallback } from "react";

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return mobile;
}

// ═══════════════════════════════════════
// ENCODER
// ═══════════════════════════════════════

function fmtD(v) {
  if (v === true) return "T";
  if (v === false) return "F";
  if (v === null) return "null";
  return String(v);
}

function fmtT(v) {
  if (v === null) return "null";
  return String(v);
}

function detectArith(vals) {
  if (vals.length < 2) return null;
  const n = vals.map(Number);
  if (n.some(isNaN)) return null;
  const s = n[1] - n[0];
  for (let i = 2; i < n.length; i++) {
    if (n[i] - n[i - 1] !== s) return null;
  }
  return { start: n[0], step: s };
}

function analyzeFields(items, keys) {
  const fields = {};
  const variable = [];
  const defaulted = [];
  const arithmetic = [];
  for (const k of keys) {
    const vals = items.map(it => it[k]);
    const ar = detectArith(vals);
    if (ar) {
      fields[k] = { type: "arith", start: ar.start, step: ar.step };
      arithmetic.push(k);
      continue;
    }
    const freq = {};
    vals.forEach(x => {
      const s = JSON.stringify(x);
      freq[s] = (freq[s] || 0) + 1;
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] > vals.length * 0.5) {
      const dv = vals.find(x => JSON.stringify(x) === sorted[0][0]);
      fields[k] = { type: "default", defaultVal: dv };
      defaulted.push(k);
    } else {
      fields[k] = { type: "variable" };
      variable.push(k);
    }
  }
  return { fields, ordered: [...arithmetic, ...variable, ...defaulted] };
}

function encodeDhoom(obj, depth) {
  const d = depth || 0;
  const pad = "  ".repeat(d);
  if (typeof obj !== "object" || obj === null) return fmtD(obj);
  if (Array.isArray(obj)) return null;
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && !Array.isArray(v[0])) {
      const keys = Object.keys(v[0]);
      const { fields, ordered } = analyzeFields(v, keys);
      const fp = ordered.map(key => {
        const f = fields[key];
        if (f.type === "arith") return f.step !== 1 ? key + "@" + f.start + "+" + f.step : key + "@" + f.start;
        if (f.type === "default") return key + "|" + fmtD(f.defaultVal);
        return key;
      });
      const rk = ordered.filter(key => fields[key].type !== "arith");
      lines.push(pad + k + "{" + fp.join(", ") + "}:");
      for (const item of v) {
        const vals = [];
        let trailing = true;
        const rev = [...rk].reverse();
        const skip = new Set();
        for (const r of rev) {
          if (trailing && fields[r].type === "default" && JSON.stringify(item[r]) === JSON.stringify(fields[r].defaultVal)) {
            skip.add(r);
          } else {
            trailing = false;
          }
        }
        for (const r of rk) {
          if (skip.has(r)) continue;
          const val = item[r];
          if (fields[r].type === "default" && JSON.stringify(val) !== JSON.stringify(fields[r].defaultVal)) {
            vals.push(":" + fmtD(val));
          } else {
            vals.push(fmtD(val));
          }
        }
        lines.push(pad + vals.join(", "));
      }
    } else if (Array.isArray(v)) {
      lines.push(pad + k + ": " + v.map(x => fmtD(x)).join(", "));
    } else if (typeof v === "object" && v !== null) {
      lines.push(pad + k + ":");
      const sub = encodeDhoom(v, d + 1);
      if (sub) lines.push(sub);
    } else {
      lines.push(pad + k + ": " + fmtD(v));
    }
  }
  return lines.join("\n");
}

function encodeToon(obj, depth) {
  const d = depth || 0;
  const pad = "  ".repeat(d);
  if (typeof obj !== "object" || obj === null) return fmtT(obj);
  if (Array.isArray(obj)) return null;
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && !Array.isArray(v[0])) {
      const keys = Object.keys(v[0]);
      lines.push(pad + k + "[" + v.length + "]{" + keys.join(",") + "}:");
      for (const item of v) {
        lines.push(pad + "  " + keys.map(kk => fmtT(item[kk])).join(","));
      }
    } else if (Array.isArray(v)) {
      lines.push(pad + k + "[" + v.length + "]: " + v.map(x => fmtT(x)).join(","));
    } else if (typeof v === "object" && v !== null) {
      lines.push(pad + k + ":");
      const sub = encodeToon(v, d + 1);
      if (sub) lines.push(sub);
    } else {
      lines.push(pad + k + ": " + fmtT(v));
    }
  }
  return lines.join("\n");
}

function approxTok(s) {
  return Math.ceil((s || "").length / 3.7);
}

// ═══════════════════════════════════════
// SAMPLES
// ═══════════════════════════════════════

const SAMPLES = {
  "Customer Reviews": '{"reviews":[{"id":101,"customer":"Alex Rivera","rating":5,"comment":"Excellent!","verified":true},{"id":102,"customer":"Brij Pandey","rating":5,"comment":"Game changer!","verified":true},{"id":103,"customer":"Casey Lee","rating":3,"comment":"Average","verified":false}]}',
  "Sensor Readings": '{"readings":[{"sensor_id":"T-001","timestamp":1710000000,"value":22.4,"unit":"celsius","status":"normal"},{"sensor_id":"T-002","timestamp":1710000060,"value":23.1,"unit":"celsius","status":"normal"},{"sensor_id":"T-003","timestamp":1710000120,"value":45.8,"unit":"celsius","status":"alert"}]}',
  "User Profiles": '{"users":[{"id":1,"name":"Sato Yuki","role":"admin","active":true,"email":"yuki@co.jp"},{"id":2,"name":"Maria Santos","role":"editor","active":true,"email":"maria@co.br"},{"id":3,"name":"Chen Wei","role":"viewer","active":false,"email":"wei@co.cn"}]}',
  "Hikes": '{"context":{"task":"Our favorite hikes","location":"Boulder"},"friends":["ana","luis","sam"],"hikes":[{"id":1,"name":"Blue Lake Trail","distanceKm":7.5,"elevationGain":320,"companion":"ana","wasSunny":true},{"id":2,"name":"Ridge Overlook","distanceKm":9.2,"elevationGain":540,"companion":"luis","wasSunny":false},{"id":3,"name":"Wildflower Loop","distanceKm":5.1,"elevationGain":180,"companion":"sam","wasSunny":true}]}',
};

// ═══════════════════════════════════════
// DOCS CONTENT (using regular strings to avoid backtick issues)
// ═══════════════════════════════════════

const C = "```"; // code fence shorthand

const DOCS = {
  "getting-started": {
    title: "Getting Started", cat: "Guide",
    content: [
      "## What is DHOOM?",
      "**Davis Human-readable Optimized Object Markup** is a compact, human-readable serialization format that applies fiber bundle geometry to structured data interchange.",
      "DHOOM encodes the same data model as JSON \u2014 objects, arrays, strings, numbers, booleans, null \u2014 but eliminates structural redundancy by treating every data collection as a **fiber bundle** and transmitting only the information that cannot be reconstructed from structure.",
      "Think of it as a translation layer: use JSON programmatically, and encode it as DHOOM for storage, transmission, or LLM input.",
      "### When to Use DHOOM",
      "- **LLM prompts** \u2014 fewer tokens, same data, same or better accuracy\n- **IoT / sensor data** \u2014 timestamps are arithmetic, units are constant\n- **API responses** \u2014 homogeneous arrays with shared schema\n- **Log shipping** \u2014 common fields, occasional deviations\n- **Anywhere JSON is too verbose** and you need a human to still read it",
      "### When Not to Use DHOOM",
      "- **Deeply nested, non-uniform data** \u2014 if every record has different fields, use JSON\n- **Binary payloads** \u2014 DHOOM is text-only; use Protobuf/MessagePack\n- **Ecosystem lock-in** \u2014 if your tooling requires JSON, convert at the boundary",
      "### Media Type & File Extension",
      "DHOOM files use the `.dhoom` extension and the provisional media type `text/dhoom`. Documents are always UTF-8 encoded.",
      "### Your First Example",
      C + "dhoom\nusers{id@1, name, role, email, active|T}:\nSato Yuki, admin, yuki@co.jp\nMaria Santos, editor, maria@co.br\nChen Wei, viewer, wei@co.cn, :F\n" + C,
      "This encodes three user records. `id` is sequential from 1 (derived from position, never listed). `active` defaults to `T` (true). Only Chen Wei deviates (`:F`), so only Chen Wei pays for that field. The other two records each transmit **three fields** instead of five.",
      "### What\u2019s New in v0.4",
      "v0.4 introduces three features from geometric fiber bundle theory:",
      "- **Delta fields (`^`)** \u2014 Store differences instead of absolute values. Parallel transport along the base space.\n- **Sparse bundles (`~`)** \u2014 Named `field:value` pairs for wide tables. Sub-bundle projection.\n- **Bundle morphisms (`->`)** \u2014 Declared foreign-key references between bundles. Structure-preserving maps.",
    ].join("\n\n"),
  },

  "format-overview": {
    title: "Format Overview", cat: "Guide",
    content: [
      "## Format Overview",
      "DHOOM syntax reference with concrete examples. See Getting Started for introduction.",
      "### Data Model",
      "DHOOM models data the same way as JSON:\n\n- **Primitives**: strings, numbers, booleans (`T`/`F`), and `null`\n- **Objects**: mappings from string keys to values\n- **Collections**: ordered sequences of records with a shared schema (the fiber)",
      "## Objects",
      "### Simple Objects",
      "Objects with primitive values use `key: value` syntax:",
      C + "dhoom\nid: 123\nname: Ada\nactive: T\n" + C,
      "One space follows the colon. Booleans use `T`/`F` shorthand.",
      "### Nested Objects",
      "Nested objects add one indentation level (2 spaces by convention):",
      C + "dhoom\nuser:\n  id: 123\n  name: Ada\n  settings:\n    theme: dark\n    lang: en\n" + C,
      "When a key ends with `:` and has no value on the same line, it opens a nested object.",
      "### Empty Objects",
      "An empty object at the root yields an empty document. A nested empty object is `key:` alone with no children.",
      "## Collections (Arrays of Objects)",
      "Collections are the heart of DHOOM. When an array contains objects with a shared schema, DHOOM uses the **fiber header** to declare the schema once and encode records positionally.",
      "### Fiber Header Syntax",
      C + "\nname{field1, field2@start, field3|default, field4>, field5^, field6->target}:\n" + C,
      "The header declares:\n\n- **Collection name**: `name`\n- **Field declarations**: inside `{}` \u2014 the fiber (schema)\n- **Modifiers**: `@` (arithmetic), `|` (default), `>` (nested), `^` (delta), `->` (morphism)\n- **Colon**: separates header from body\n- **Sparse prefix**: `~name{...}:` switches to named-pair records",
      "### Basic Collection",
      C + "dhoom\nitems{sku, name, qty, price}:\nA100, Widget, 2, 49.99\nA101, Gadget, 1, 50.01\n" + C,
      "Each row contains values in the same order as the field list. Position maps value to field.",
      "### Collection with Arithmetic",
      C + "dhoom\nitems{id@1, sku, name, qty, price}:\nA100, Widget, 2, 49.99\nA101, Gadget, 1, 50.01\n" + C,
      "`id@1` means the ID is sequential from 1. The id column **never appears** in the record rows \u2014 it is derived from position.",
      "### Collection with Defaults",
      C + "dhoom\nemployees{id@1, name, dept, salary, active|T}:\nAlice Chen, Engineering, 95000\nBob Park, Marketing, 72000\nCarol Wu, Engineering, 105000\nDave Kim, Sales, 68000, :F\n" + C,
      "`active|T` declares that most employees are active. Records 1\u20133 match \u2014 **silence** (not written). Dave deviates: `:F` means active=false.",
      "Because `active|T` is the **last** field, the three matching records benefit from **trailing elision** \u2014 they just stop.",
      "### Primitive Arrays",
      "Arrays of primitives use inline syntax:",
      C + "dhoom\ntags: admin, ops, dev\nscores: 98, 87, 92, 76\n" + C,
      "### No Record Count",
      "Unlike TOON\u2019s `[N]` syntax, DHOOM does not declare array length. The parser counts records from newlines. This saves ~3 characters per collection and follows the principle: **don\u2019t transmit what you can derive**.",
      "## Field Ordering",
      "### Why Order Matters",
      "Field ordering in the fiber header is a **compression decision**. It does not change the logical content of the data, but it changes how much you write.",
      "**Rule**: Place variable fields first, defaulted fields last.",
      C + "dhoom\n# GOOD \u2014 defaults at end, trailing elision works\nreviews{id@101, customer, comment, rating|5, verified|T}:\nAlex Rivera, Excellent!           \u2190 2 fields\nCasey Lee, Average, :3, :F        \u2190 4 fields\n" + C,
      "The encoder automatically optimizes field ordering. If you\u2019re hand-writing DHOOM, remember: **defaults go at the end**.",
      "## Quoting and Types",
      "### When Strings Need Quotes",
      "DHOOM quotes strings **only when necessary**. A string must be quoted if:\n\n- It\u2019s empty (`\"\"`)\n- It contains commas, colons, newlines, or curly braces\n- It equals `T`, `F`, or `null` (case-sensitive) and you mean the literal string\n- It looks like a number and you mean the string\n- It has leading or trailing whitespace",
      "Otherwise, strings are unquoted. Unicode, emoji, and internal spaces are safe:",
      C + "dhoom\nmessage: Hello \u4e16\u754c \ud83d\udc4b\nnote: This has inner spaces\n" + C,
      "### Type Detection",
      "| Pattern | Type | Examples |\n|---|---|---|\n| `T` | boolean true | |\n| `F` | boolean false | |\n| `null` | null | |\n| `-?[0-9]+(\\\\.[0-9]+)?` | number | `42`, `3.14`, `-7` |\n| Everything else | string | `hello`, `Alex Rivera` |",
      "### Escape Sequences",
      "In quoted strings, four escape sequences are valid:\n\n| Character | Escape |\n|---|---|\n| Backslash | `\\\\\\\\` |\n| Double quote | `\\\\\"` |\n| Newline | `\\\\n` |\n| Tab | `\\\\t` |",
      "### Boolean Shorthand",
      "DHOOM uses `T` for true and `F` for false. These are **case-sensitive** \u2014 only uppercase `T` and `F` are booleans. Lowercase `true` would be treated as the string \"true\".",
    ].join("\n\n"),
  },

  "arithmetic": {
    title: "Arithmetic Fields (@)", cat: "Guide",
    content: [
      "## Arithmetic Fields",
      "The `@` modifier declares a field whose values form an arithmetic sequence. The field is **completely omitted** from record rows \u2014 its value is derived from the record\u2019s ordinal position.",
      "### Basic Syntax",
      "`field@start` \u2192 start, start+1, start+2, ...\n`field@start+step` \u2192 start, start+step, start+2*step, ...",
      "### Numeric Arithmetic",
      C + "dhoom\nusers{id@1, name, email}:\nAlice, alice@co.com\nBob, bob@co.com\nCarol, carol@co.com\n" + C,
      "This produces:\n- Record 0: id=1, name=Alice, email=alice@co.com\n- Record 1: id=2, name=Bob, email=bob@co.com\n- Record 2: id=3, name=Carol, email=carol@co.com",
      "The id column saves **N field transmissions** for a collection of N records.",
      "### Custom Step",
      C + "dhoom\nreadings{ts@1710000000+60, value}:\n22.4\n23.1\n45.8\n" + C,
      "Timestamps: 1710000000, 1710000060, 1710000120 \u2014 evenly spaced at 60-second intervals.",
      "### Formula",
      "For record at ordinal index *i* (zero-based):\n\n`value(i) = start + (i \u00d7 step)`\n\nIf `step` is omitted, it defaults to **1**.",
      "### String-Pattern Arithmetic",
      "For start values matching the pattern `PREFIX-NNN` (a fixed string prefix followed by a zero-padded numeric suffix):\n\n1. The **prefix** (all characters up to and including the last non-digit character) is held fixed\n2. The numeric suffix is parsed as an integer and incremented by `step`\n3. The result is re-encoded with the **same zero-padding width**",
      C + "dhoom\nsensors{id@T-001, value}:\n22.4\n23.1\n45.8\n" + C,
      "Produces: T-001, T-002, T-003.",
      C + "dhoom\nbays{slot@A-0001+10, status}:\noccupied\nempty\noccupied\n" + C,
      "Produces: A-0001, A-0011, A-0021 (step of 10, 4-digit zero-padding preserved).",
      "### When to Use @",
      "Use `@` when:\n- IDs are sequential integers (`@1`, `@100`)\n- Timestamps are evenly spaced (`@1710000000+60`)\n- Sensor/device IDs follow a pattern (`@T-001`)\n- Any field where value is fully determined by position",
      "### When NOT to Use @",
      "Do not use `@` when:\n- IDs are UUIDs or non-sequential\n- Timestamps have irregular intervals\n- The sequence has gaps (e.g., 1, 2, 5, 6)\n- The pattern has exceptions",
      "### Multiple Arithmetic Fields",
      C + "dhoom\nreadings{sensor@T-001, ts@1710000000+60, value, status|normal}:\n22.4\n23.1\n45.8, :alert\n" + C,
      "Both `sensor` and `ts` are arithmetic. Records contain **only** the value field (and status deviations). Two arithmetic fields on three records saves **6 field transmissions**.",
      "### Compression Impact",
      "For A arithmetic fields across N records:\n\n**Fields saved = A \u00d7 N**\n\nThis is the single largest source of savings for time-series and indexed data.",
    ].join("\n\n"),
  },

  "defaults": {
    title: "Defaults & Elision", cat: "Guide",
    content: [
      "## Default Fields and Trailing Elision",
      "The `|` modifier and trailing elision are DHOOM\u2019s most distinctive features. Together, they let records transmit only what **deviates** from the expected pattern.",
      "### Declaring a Default",
      "`field|value` \u2014 The default is specified by the **document author** as the most common or expected value. It is a design decision, not a computed statistic.",
      C + "dhoom\nreviews{id@101, customer, comment, rating|5, verified|T}:\n" + C,
      "Here `rating|5` means \u201Cmost reviews have rating 5\u201D and `verified|T` means \u201Cmost reviews are verified.\u201D",
      "### Omission Rule",
      "When a record\u2019s value matches the declared default, the field **may be omitted**. When it deviates, prefix with `:`:",
      C + "dhoom\nreviews{id@101, customer, comment, rating|5, verified|T}:\nAlex Rivera, Excellent!              \u2190 rating=5 \u2713, verified=T \u2713 (both omitted)\nBrij Pandey, Game changer!           \u2190 same\nCasey Lee, Average, :3, :F           \u2190 rating=3 \u2717, verified=F \u2717 (both overridden)\n" + C,
      "### The Colon (:) Override",
      "The colon prefix is an explicit **deviation marker**. It says: \u201Cthis value is NOT the default.\u201D\n\n`:3` \u2192 rating is 3, overriding the default 5\n`:F` \u2192 verified is false, overriding the default T\n`:alert` \u2192 status is \u201Calert,\u201D overriding \u201Cnormal\u201D\n`:0` \u2192 likes is 0, overriding whatever the default was",
      "The colon makes deviations **visible and unambiguous**. A human scanning the data can immediately spot which records break the pattern.",
      "### Trailing Default Elision",
      "This is the key innovation. When the last *n* fields in a record all match their defaults, they are **simply not written**. The parser fills them in.",
      "**Critical rule**: Place defaulted fields at the **end** of the fiber.",
      C + "dhoom\nemployees{id@1, name, dept, salary, active|T, benefits|standard}:\nAlice, Engineering, 95000                    \u2190 3 fields (2 elided)\nBob, Marketing, 72000                         \u2190 3 fields\nCarol, Engineering, 105000, :F               \u2190 4 fields (benefits still elided)\nDave, Sales, 68000, :F, :premium             \u2190 5 fields (both deviate)\n" + C,
      "Alice and Bob transmit **3 fields** instead of 5. Carol transmits 4. Dave transmits all 5.",
      "### Choosing Defaults",
      "Choose the value that occurs **most frequently**:\n\n| Field | Values (100 records) | Best default |\n|---|---|---|\n| status | 85 \u00d7 \u201Cactive\u201D, 15 \u00d7 \u201Cinactive\u201D | `status\\|active` |\n| role | 40 \u00d7 \u201Cviewer\u201D, 35 \u00d7 \u201Ceditor\u201D, 25 \u00d7 \u201Cadmin\u201D | `role\\|viewer` |\n| verified | 92 \u00d7 true, 8 \u00d7 false | `verified\\|T` |\n| score | all different | *(no default)* |",
      "If no value dominates, don\u2019t use a default \u2014 it won\u2019t save anything.",
      "### Constant Fields",
      "When a field has the **same value in every record**, the default eliminates it entirely:",
      C + "dhoom\nreadings{sensor@T-001, ts@1710000000+60, value, unit|celsius, status|normal}:\n22.4\n23.1\n45.8, :alert\n" + C,
      "`unit|celsius` appears in zero records. Records 1\u20132 benefit from trailing elision on both. Record 3 overrides status but `unit` (trailing, matching) is still elided.",
      "### Compression Impact",
      "For D defaulted fields where M of N records match:\n\n**Fields saved = D \u00d7 M**\n\nFor 1000 sensor readings where unit is constant and status is 95% \u201Cnormal\u201D:\n- `unit|celsius` saves 1000 transmissions\n- `status|normal` saves 950 transmissions\n- Total: **1950 fields omitted**",
    ].join("\n\n"),
  },

  "nesting": {
    title: "Nested Bundles (>)", cat: "Guide",
    content: [
      "## Nested Bundles",
      "The `>` modifier declares that a field contains a child DHOOM bundle.",
      "### Declaration",
      C + "dhoom\norder{id, customer, total, items>, shipping>}:\n" + C,
      "`items>` and `shipping>` declare nested sub-bundles.",
      "### Implied Name",
      "The child bundle **inherits its name** from the parent\u2019s field declaration. The child header begins directly with `{fields}:` \u2014 the name is not repeated.",
      C + "dhoom\norder{id, customer, total, items>, shipping>}:\nORD-7891, Diana Prince, 149.99,\n  {sku, name, qty, price}:\n  A100, Widget, 2, 49.99\n  A101, Gadget, 1, 50.01,\n  {method, address}:\n  express, 1234 Elm St\n" + C,
      "Compare with TOON, which repeats the name:",
      C + "toon\nitems[2]{sku,name,qty,price}:\n  A100,Widget,2,49.99\n  A101,Gadget,1,50.01\nshipping{method,address}:\n  express,1234 Elm St\n" + C,
      "### Recursive Nesting",
      "All modifiers (`@`, `|`, `>`) work inside nested bundles:",
      C + "dhoom\ncompany{name, departments>}:\nAcme Corp,\n  {dept_id@1, name, headcount, budget|standard}:\n  Engineering, 42\n  Marketing, 18\n  Sales, 24, :premium\n" + C,
      "### Single vs Multi-Record Children",
      "A child with one record is a nested object. A child with multiple records is a nested collection.",
      "### Indentation",
      "Indentation is **conventional** (2 spaces) for readability but not structurally required. The `>` marker and matching `{fields}:` header handle scoping.",
    ].join("\n\n"),
  },

  "math": {
    title: "The Mathematics", cat: "Guide",
    content: [
      "## Fiber Bundle Theory for Serialization",
      "DHOOM isn\u2019t \u201Cjust smaller JSON.\u201D It\u2019s derived from **fiber bundle theory** in differential geometry.",
      "### What is a Fiber Bundle?",
      "A fiber bundle is a topological structure **(F, E, B, \u03c0)** consisting of:\n\n- **E** \u2014 the total space (all possible data)\n- **B** \u2014 the base space (the index set)\n- **F** \u2014 the fiber (the schema)\n- **\u03c0: E \u2192 B** \u2014 a projection mapping each point to its index",
      "The key property: locally, **E \u2245 B \u00d7 F**. Data bundles are always **trivial** \u2014 every record shares the same fiber, so this holds globally. There are no non-trivial transition functions or characteristic classes. The geometric insight is not topological but **coordinate-theoretic**: choosing a zero section and field ordering that minimize each section\u2019s expression.",
      "### Data Collections as Bundles",
      "| Concept | In geometry | In data |\n|---|---|---|\n| Base space B | Index manifold | Record IDs, timestamps |\n| Fiber F | Structure at each point | Schema: field names, types |\n| Total space E | The bundle | All concrete records |\n| Section \u03c3: B \u2192 E | Choice in each fiber | A specific record |\n| Zero section \u03c3\u2080 | Distinguished section | Default record |\n| Deviation | Distance from \u03c3\u2080 | Fields that override defaults |",
      "### What JSON Does Wrong (Geometrically)",
      "JSON transmits **E = B \u00d7 F** for every record:\n\n1. The **fiber** (field names) with every record \u2014 N \u00d7 K transmissions\n2. The **base** (indices) explicitly, even when sequential\n3. The **zero section** (defaults) even when every record agrees",
      "This is like specifying the full coordinate chart at every single point on a manifold.",
      "### DHOOM\u2019s Four Quotient Operations",
      "**1. Trivialization (the header):** Declare the fiber F once. Records transmit sections, not the chart. Eliminates N \u00d7 K \u2192 K field name transmissions.",
      "**2. Base compression (@):** When B has arithmetic structure, encode by generator: `id@101` means B = {101, 102, ...} = 101 + \u2124\u22650. One declaration replaces N index values.",
      "**3. Zero section (| defaults):** Define \u03c3\u2080 via `|`. Records encode only deviation from \u03c3\u2080. When \u03c3(x) = \u03c3\u2080(x) \u2192 silence. When \u03c3(x) \u2260 \u03c3\u2080(x) \u2192 transmit :value.",
      "**4. Trailing elision (coordinate choice):** Order the fiber so defaulted fields are trailing. This chooses coordinates where most sections have short representations.",
      "### v0.4: Three New Geometric Operations",
      "**5. Parallel transport (^ delta):** A discrete **connection** on the bundle. Each section value is defined relative to its predecessor, encoding only the covariant derivative (the difference). This transforms absolute coordinates into connection-based representation.",
      "**6. Sub-bundle projection (~ sparse):** When most fiber components are trivial, project to the **non-trivial sub-bundle**. Named pairs encode only the non-zero components, modelling the essential support of each section.",
      "**7. Bundle morphisms (->):** Structure-preserving maps *(f, g): (E\u2081, B\u2081) \u2192 (E\u2082, B\u2082)* between fiber bundles. Declared relationships connect separate bundles, making the category structure of the data explicit.",
      "### The Compression Formula",
      "For N records with K fields, A arithmetic, D defaulted matching M records, \u0394 delta fields saving S% characters, and W sparse bundles with P% null cells:\n\n**Fields omitted \u2265 (A \u00d7 N) + (D \u00d7 M) + \u0394-savings + sparse-savings**",
      "For highly uniform data, this eliminates 70\u201385% of field transmissions.",
      "### The Sudoku Principle",
      "DHOOM follows the **Sudoku Principle**: *local constraints propagate to determine global structure.*\n\nIn Sudoku, the rules + a few given digits determine the grid. The information content is in the constraints and the exceptions, not in the 81 cells.\n\nSimilarly: the header constrains fields and defaults, generators constrain indices, records transmit only the \u201Cgiven digits\u201D \u2014 the irreducible signal.",
      "### Connection to the Davis Field Equations",
      "The Davis Geometric framework (an original theoretical contribution, not standard differential geometry) proposes the heuristic **C = \u03c4/K**:\n\n- **\u03c4 (tension)** \u2014 the information content, the signal\n- **K (curvature)** \u2014 the structural regularity (used metaphorically, not in the Riemannian sense)\n- **C (capacity)** \u2014 the compression achievable",
      "High regularity (low K) \u2192 high capacity. This is a design heuristic derived from the geometric analogy, not a theorem of differential geometry. It predicts that DHOOM\u2019s savings scale with structural regularity \u2014 a prediction borne out by benchmarks.",
      "### Why This Matters",
      "The mathematical foundation:\n\n1. **Guarantees** every optimization is lossless (trivialization preserves content)\n2. **Predicts** compression ratios from data structure before encoding\n3. **Proves** trailing elision and field ordering don\u2019t affect content (coordinate invariance)\n4. **Unifies** all seven features under one geometric framework\n5. **Extends** from trivial bundles to connections (delta), sub-bundles (sparse), and morphisms (cross-bundle references)\n6. **Acknowledges scope** \u2014 these are trivial bundles; the power is in coordinate choice, not topology",
      "For the full framework: Davis, B. R. (2024). *The Geometry of Sameness*. Amazon KDP. Davis, B. R. (2026). *The Double Cover Principle*. Zenodo.",
    ].join("\n\n"),
  },

  "delta-fields": {
    title: "Delta Fields (^)", cat: "Guide",
    content: [
      "## Delta Fields",
      "The `^` modifier declares a field as **delta-encoded**. The first record contains the absolute value. Each subsequent record stores the *difference* from the previous record.",
      "### Why Delta?",
      "When numeric values have large absolute magnitudes but small changes between records, encoding differences saves significant characters:",
      C + "dhoom\nevents{name, ts^}:\nAlice, 1000000\nBob, 50\nCarol, 70\n" + C,
      "Decodes to ts = 1000000, 1000050, 1000120. The deltas `50` and `70` are much shorter than `1000050` and `1000120`.",
      "### The Geometry",
      "Delta encoding models **parallel transport along the base space**. In a fiber bundle with a *connection*, moving along a path in the base space transports fiber values via infinitesimal increments. Delta encoding is the discrete version: each section value is defined relative to its predecessor.",
      "This transforms the encoding from absolute coordinates to a **connection-based representation** \u2014 the connection 1-form captures the rate of change.",
      "### When to Use ^",
      "Use `^` when:\n- Values are large integers with small changes (timestamps, counters, monotonic IDs)\n- The total character count of deltas is at least **30% shorter** than absolute values\n- All values are numeric (integer or float)\n- There are at least 3 records",
      "### Combining with @",
      "Delta and arithmetic are mutually exclusive on the same field. Use `@` when the sequence is perfectly regular (constant step). Use `^` when the changes are small but irregular.",
      C + "dhoom\nmetrics{ts@1000+60, temp^, pressure^}:\n22.4, 1013\n1, -2\n-3, 1\n" + C,
      "Here `ts` uses arithmetic (perfectly regular), while `temp` and `pressure` use delta (irregular but small changes).",
      "### Encoder Detection",
      "The encoder automatically detects delta-encodable fields by:\n1. Checking all values are numeric\n2. Computing deltas\n3. Comparing total character length of deltas vs absolutes\n4. Emitting `^` only when delta representation saves \u226530%",
    ].join("\n\n"),
  },

  "sparse-bundles": {
    title: "Sparse Bundles (~)", cat: "Guide",
    content: [
      "## Sparse Bundles",
      "The `~` prefix declares a bundle in **sparse mode**. Records use `name:value` pairs instead of positional encoding, and null/empty fields are simply omitted.",
      "### Why Sparse?",
      "When a bundle has many fields but most values are null or empty, positional encoding wastes space transmitting emptiness:",
      C + "dhoom\n# Without sparse: lots of nulls\nconfig{host, port, timeout, retries, debug, verbose, log_level, max_conn}:\nserver-a, 8080, null, null, null, null, null, null\nserver-b, 9090, null, null, T, null, null, null\n" + C,
      C + "dhoom\n# With sparse: just the non-null fields\n~config{host, port, timeout, retries, debug, verbose, log_level, max_conn}:\nhost:server-a, port:8080\nhost:server-b, port:9090, debug:T\n" + C,
      "### The Geometry",
      "Sparse encoding models **sub-bundle projection**. When most fiber components are trivial (null), projecting to the non-trivial sub-bundle captures the essential information. Each record specifies only the components that deviate from the zero section.",
      "### Record Format",
      "In sparse mode, each record line contains comma-separated `fieldname:value` pairs. The colon separates field name from value (distinct from the `:value` deviation marker in positional mode).",
      "### Missing Fields",
      "Fields not listed in a sparse record receive:\n- Their declared **default** value, if the field has a `|` modifier\n- **`null`** otherwise",
      "Arithmetic fields (`@`) still derive their values from position, regardless of sparse mode.",
      "### Encoder Detection",
      "The encoder automatically considers sparse mode when:\n- The bundle has **\u22658 non-arithmetic, non-nested fields**\n- More than **75%** of values across all records are null or empty string",
    ].join("\n\n"),
  },

  "morphisms": {
    title: "Bundle Morphisms (->)", cat: "Guide",
    content: [
      "## Bundle Morphisms",
      "The `->` modifier declares that a field\u2019s values reference records in another named bundle. This is a **schema annotation** \u2014 it documents the relationship without changing encoding or decoding.",
      "### Example",
      C + "dhoom\nusers{id@1, name}:\nAlice\nBob\nCarol\n\nposts{id@1, author->users, title, likes}:\n2, First Post, 42\n1, Hello World, 108\n3, DHOOM Guide, 256\n" + C,
      "`author->users` declares that the `author` field\u2019s values (2, 1, 3) are foreign keys referencing records in the `users` bundle.",
      "### The Geometry",
      "Morphisms model **bundle morphisms** *(f, g): (E\u2081, B\u2081) \u2192 (E\u2082, B\u2082)* \u2014 structure-preserving maps between fiber bundles. The morphism arrow connects two separate bundles through a declared relationship.",
      "In relational database terms, this is a foreign key. In category theory, it\u2019s a morphism in the category of bundles. DHOOM makes this structure **explicit in the schema**.",
      "### Semantics",
      "- The `->target` modifier is **purely declarative**\n- A conforming decoder treats the field value the same as a plain variable field\n- The target bundle name is metadata for tooling, documentation, and query planning\n- A field may have at most one modifier; `->` is mutually exclusive with `@`, `|`, `>`, and `^`",
      "### Use Cases",
      "- **Relational data**: Express foreign keys between DHOOM bundles\n- **Graph structures**: Declare edges by referencing node bundles\n- **API documentation**: Make field relationships self-documenting\n- **Query planning**: Tools can use morphisms to join bundles automatically",
    ].join("\n\n"),
  },

  "using-with-llms": {
    title: "Using with LLMs", cat: "Guide",
    content: [
      "## DHOOM for LLM Prompts",
      "### Why DHOOM for LLMs?",
      "LLMs charge by the token. JSON is full of tokens that carry zero information: repeated field names, braces, quotes, explicit sequential indices, repeated constant values. DHOOM removes all of this.",
      "### Token Savings",
      "| Data Pattern | vs JSON | vs TOON |\n|---|---|---|\n| Uniform arrays, some defaults | 55\u201365% | 25\u201335% |\n| High-uniformity (IoT) | 70\u201385% | 45\u201360% |\n| Mixed nested + tabular | 40\u201355% | 15\u201325% |\n| Pure nested objects | 10\u201320% | ~0% |",
      "### Prompt Engineering",
      "Declare the format in your system prompt:",
      C + "\nThe data below is in DHOOM format:\n- {fields}: declares the schema\n- @ = sequential from start (derived from position)\n- | = default value (omitted values match it)\n- : prefix = this value overrides the default\n- ^ = delta-encoded (first absolute, rest are differences)\n- ~ prefix = sparse bundle (name:value pairs, missing = null)\n- -> = foreign key reference to another bundle\n- T/F = true/false\n" + C,
      "### Integration Pattern",
      C + "javascript\nconst data = await fetchFromAPI();  // JSON\nconst dhoomStr = dhoom.encode(data);\nconst prompt = \"Data:\\n\" + dhoomStr + \"\\n\\nQuestion: ...\";\n" + C,
      "JSON stays in your APIs. DHOOM enters only at the LLM boundary.",
      "### Signal Density",
      "The key insight: fewer tokens of **pure signal** outperform more tokens diluted with structural noise. By removing redundancy, every remaining DHOOM token carries real information.",
    ].join("\n\n"),
  },

  "benchmarks": {
    title: "Benchmarks", cat: "Guide",
    content: [
      "## Benchmark Results",
      "### Character Count",
      "| Example | JSON (min) | TOON | DHOOM | vs JSON | vs TOON |\n|---|---|---|---|---|---|\n| Customer Reviews (3\u00d75) | 412 | ~210 | ~137 | **-67%** | **-35%** |\n| Sensor Readings (3\u00d75) | 380 | ~220 | ~95 | **-75%** | **-57%** |\n| User Profiles (3\u00d75) | 310 | ~185 | ~130 | **-58%** | **-30%** |\n| Nested Order (1+2+1) | 295 | ~230 | ~195 | **-34%** | **-15%** |\n| API Response (nested) | 340 | ~215 | ~155 | **-54%** | **-28%** |",
      "### Where DHOOM Wins Big",
      "DHOOM\u2019s advantage scales with **structural regularity**:\n- Arithmetic indices \u2192 each `@` saves N values\n- Constant fields \u2192 each `|` saves N values\n- Modal defaults \u2192 each `|` saves M values\n- Trailing elision \u2192 compounds with field ordering",
      "### Encode/Decode Performance",
      "Roundtrip correctness: **18/18** \u2014 all dataset sizes (3 to 1,000 records) encode \u2192 decode losslessly.",
      "#### Compression (DHOOM vs JSON)\n\n| Dataset | 3 records | 100 records | 1,000 records |\n|---|---|---|---|\n| Reviews | -50% | -68% | **-69%** |\n| Sensors | -65% | **-93%** | -86% |\n| Users | -43% | -60% | -60% |",
      "Sensors hit **-94% at 500 records** thanks to arithmetic fields eliminating all IDs and timestamps.",
      "#### Throughput (Node.js v24)\n\n| Dataset | N | Encode ops/s | Decode ops/s | JSON.stringify | JSON.parse |\n|---|---|---|---|---|---|\n| Reviews | 3 | 127,240 | 346,518 | 1,718,798 | 1,091,680 |\n| Reviews | 100 | 8,727 | 18,854 | 74,938 | 40,491 |\n| Reviews | 1,000 | 724 | 1,534 | 6,557 | 3,877 |\n| Sensors | 3 | 138,560 | 293,753 | 1,405,762 | 794,259 |\n| Sensors | 100 | 8,338 | 19,728 | 56,124 | 29,579 |\n| Sensors | 1,000 | 744 | 2,460 | 5,634 | 3,268 |",
      "DHOOM decode runs within **2\u20133x** of native `JSON.parse`. Encode is slower (~10\u201315x) due to arithmetic detection, modal analysis, and field reordering \u2014 a deliberate trade-off for compression.",
      "### Methodology",
      "Following TOON\u2019s approach: format conversion \u2192 character count \u2192 token count (o200k_base) \u2192 LLM retrieval accuracy. Performance benchmarks use 1s timed runs with 100ms warmup. All benchmarks reproducible in `benchmarks/`.",
    ].join("\n\n"),
  },

  "syntax": {
    title: "Syntax Cheatsheet", cat: "Reference",
    content: [
      "## Quick Reference",
      "### Header Syntax",
      "| Pattern | Meaning |\n|---|---|\n| `name{fields}:` | Collection with schema |\n| `{fields}:` | Anonymous object |\n| `field` | Variable field |\n| `field@start` | Sequential from start |\n| `field@start+step` | Arithmetic with step |\n| `field\\|default` | Default value |\n| `field>` | Nested sub-bundle |\n| `field^` | Delta-encoded (differences) |\n| `field->target` | Morphism (foreign key) |\n| `~name{fields}:` | Sparse bundle (named pairs) |",
      "### Record Syntax",
      "| Pattern | Meaning |\n|---|---|\n| `value, value` | Positional values |\n| `:value` | Default override |\n| `name:value` | Sparse field (in `~` bundles) |\n| `T` / `F` | Boolean true/false |\n| `null` | Null value |\n| *(trailing omission)* | Defaults elided |\n| newline | Record boundary |",
      "### Rules",
      "1. `@` fields never appear in records \u2014 derived from position\n2. `|` fields omitted when matching \u2014 silence = agreement\n3. Trailing defaults elided \u2014 just stop writing\n4. `:` marks deviation \u2014 \u201CI disagree with the default\u201D\n5. `>` children inherit name \u2014 no repetition\n6. `^` fields store deltas \u2014 first record absolute, rest are differences\n7. `~` bundles use `name:value` pairs \u2014 missing fields are null\n8. `->target` declares relationships \u2014 metadata only\n9. Field ordering = compression strategy \u2014 defaults at end\n10. No record count \u2014 parser counts newlines\n11. `T`/`F` are case-sensitive \u2014 only uppercase",
      "### Grammar (EBNF)",
      C + "ebnf\ndocument  = bundle\nbundle    = \"~\"? name? \"{\" fiber \"}\" \":\" body\nfiber     = field ( \",\" field )*\nfield     = identifier modifier?\nmodifier  = \"@\" start ( \"+\" step )?\n          | \"|\" default_value\n          | \">\"\n          | \"^\"\n          | \"->\" identifier\nbody      = record ( NEWLINE record )*\nrecord    = entry ( \",\" entry )*\nentry     = value | \":\" value | name \":\" value | bundle\nboolean   = \"T\" | \"F\"\nidentifier= [A-Za-z_][A-Za-z0-9_-]*\n" + C,
    ].join("\n\n"),
  },

  "specification": {
    title: "Full Specification", cat: "Reference",
    content: [
      "## DHOOM Specification v0.4",
      "The full normative specification is maintained on GitHub.",
      "### Sections",
      "1. Introduction \u2014 design principles, geometric interpretation\n2. File Format \u2014 encoding (UTF-8), extension (.dhoom), media type (text/dhoom)\n3. Fiber (Schema Header) \u2014 identifiers, modifiers\n4. Arithmetic Fields (@) \u2014 numeric and string-pattern rules\n5. Default Fields (|) \u2014 declaration, omission, override syntax, trailing elision\n6. Nested Bundles (>) \u2014 declaration, implied names, recursion\n7. Records (Body) \u2014 delimiters, separation, positional mapping, types\n8. Type Coercion \u2014 detection rules\n9. Formal Grammar (EBNF) \u2014 complete grammar\n10. Conversion Rules \u2014 JSON \u2194 DHOOM\n11. Compression Model \u2014 formal analysis\n12. Delta Fields (^) \u2014 temporal compression via parallel transport\n13. Sparse Bundles (~) \u2014 sub-bundle encoding for wide tables\n14. Bundle Morphisms (->) \u2014 structure-preserving cross-bundle references\n15. Prior Art Comparison \u2014 feature matrix\n16. References",
      "### Versioning",
      "Semantic versioning. Current: **v0.4** (draft).",
    ].join("\n\n"),
  },

  "comparison": {
    title: "JSON vs TOON vs DHOOM", cat: "Ecosystem",
    content: [
      "## Format Comparison",
      "A comprehensive feature-by-feature comparison of JSON, TOON, and DHOOM.",
      "### At a Glance",
      "| | JSON | TOON | DHOOM |\n|---|---|---|---|\n| **Year** | 2001 | 2023 | 2025 |\n| **Human-readable** | \u2713 | \u2713 | \u2713 |\n| **Schema in data** | \u2717 | Header | Fiber header |\n| **Compression** | None | Structural | Geometric |\n| **Math foundation** | \u2014 | \u2014 | Fiber bundle geometry |\n| **LLM accuracy** | 100% | ~98% | 100% |\n| **Token efficiency** | Baseline | ~40% fewer | ~60% fewer |\n| **SDKs** | Universal | 1 (JS) | 6 (TS, Rust, Py, Go, C#, Java) |",
      "### Data Representation",
      "Take a simple 3-record dataset and see how each format handles it:",
      "#### JSON (412 chars)",
      C + "json\n{\"reviews\":[\n  {\"id\":101,\"customer\":\"Alex Rivera\",\n   \"rating\":5,\"comment\":\"Excellent!\",\n   \"verified\":true},\n  {\"id\":102,\"customer\":\"Brij Pandey\",\n   \"rating\":5,\"comment\":\"Game changer!\",\n   \"verified\":true},\n  {\"id\":103,\"customer\":\"Casey Lee\",\n   \"rating\":3,\"comment\":\"Average\",\n   \"verified\":false}\n]}\n" + C,
      "Every key repeated 3x. Every brace, bracket, colon, and quote is structural overhead.",
      "#### TOON (~210 chars)",
      C + "\nreviews[3]{id,customer,rating,comment,verified}:\n  101,Alex Rivera,5,Excellent!,true\n  102,Brij Pandey,5,Game changer!,true\n  103,Casey Lee,3,Average,false\n" + C,
      "Header declares fields once \u2014 records are positional. But every value is still explicit, even when patterns exist.",
      "#### DHOOM (~137 chars)",
      C + "\nreviews{id@101, customer, comment, rating|5, verified|T}:\nAlex Rivera, Excellent!\nBrij Pandey, Game changer!\nCasey Lee, Average, :3, :F\n" + C,
      "`id@101` eliminates all IDs. `rating|5` and `verified|T` declare defaults \u2014 only deviations (`:3`, `:F`) appear. Matching defaults are elided entirely.",
      "### Feature Matrix",
      "| Feature | JSON | TOON | DHOOM |\n|---|---|---|---|\n| Key repetition | Every record | Header once | Header once |\n| Structural punctuation | `{}[]:,\"` everywhere | Minimal | Minimal |\n| Record count | Implicit | `[N]` required | Not needed |\n| Arithmetic sequences | All values explicit | All values explicit | `@start+step` \u2014 zero record cost |\n| Default values | All values explicit | All values explicit | `field\\|default` \u2014 silence = agreement |\n| Deviation marking | N/A | N/A | `:value` signals disagreement |\n| Trailing elision | N/A | N/A | Stop writing when defaults remain |\n| Boolean encoding | `true`/`false` (4-5 chars) | `true`/`false` | `T`/`F` (1 char) |\n| Nested structures | Inline objects | Named sub-bundles | `>` implied naming |\n| Delta encoding | N/A | N/A | `field^` \u2014 store differences |\n| Sparse tables | All fields every record | All fields every record | `~` named pairs, nulls omitted |\n| Foreign keys | No semantic meaning | No semantic meaning | `->target` declared relationships |\n| Schema evolution | Add fields freely | Fixed header | Modifiers extend header |",
      "### Compression Breakdown",
      "Where does DHOOM's compression actually come from? Each feature contributes independently.",
      "| Technique | What it removes | Savings per record |\n|---|---|---|\n| Header-once | Key repetition | ~50% of JSON overhead |\n| `@` Arithmetic | Predictable sequences | 100% (field vanishes) |\n| `\\|` Defaults | Repeated common values | ~80% for modal fields |\n| Trailing elision | Unnecessary commas | Variable \u2014 compounds with ordering |\n| `:` Deviation | Only marks exceptions | Inverse of default frequency |\n| `T`/`F` | Boolean verbosity | 60\u201380% per boolean |\n| `^` Delta | Slowly-changing values | 40\u201390% for temporal data |\n| `~` Sparse | Wide, mostly-null tables | 70\u201395% for config-style data |",
      "### Real-World Benchmarks",
      "Measured on representative datasets at various scales:",
      "| Dataset | Records | JSON | DHOOM | Savings |\n|---|---|---|---|---|\n| Reviews | 3 | 412 chars | ~137 chars | **-67%** |\n| Sensors | 3 | 380 chars | ~95 chars | **-75%** |\n| Reviews | 100 | ~13,700 | ~4,380 | **-68%** |\n| Sensors | 100 | ~12,800 | ~900 | **-93%** |\n| Sensors | 500 | ~64,000 | ~3,800 | **-94%** |\n| Users | 1,000 | ~110,000 | ~44,000 | **-60%** |",
      "### LLM Performance",
      "Tested with Claude Sonnet (temperature=0), 209 structured-data questions:",
      "| Metric | JSON | DHOOM |\n|---|---|---|\n| Accuracy | 100% (209/209) | 100% (209/209) |\n| Avg tokens per payload | ~110 | ~45 |\n| Token savings | Baseline | **-59%** |\n| Roundtrip fidelity | N/A | 18/18 perfect |",
      "DHOOM preserves perfect LLM comprehension while cutting input tokens by ~60%. Every token saved is cost saved.",
      "### When to Use What",
      "**Choose JSON when:**\n- Broad ecosystem compatibility is critical\n- Data is deeply nested with few repeated structures\n- You're already token-budget-comfortable\n- External APIs require JSON",
      "**Choose TOON when:**\n- You want a quick win over JSON\n- Header-only deduplication is enough\n- Single-language (JS) is fine",
      "**Choose DHOOM when:**\n- Token cost matters (LLM pipelines, API billing)\n- Data has structural regularity (tables, logs, time-series)\n- You need multi-language support (6 SDKs)\n- Compression needs to scale (arithmetic, defaults, delta)\n- You want a formal mathematical foundation",
      "### Migration Path",
      "JSON \u2192 DHOOM is a one-line call in any SDK:\n\n`encode(json_value) \u2192 dhoom_string`\n`decode(dhoom_string) \u2192 json_value`\n\nNo schema files, no code generation, no configuration. The encoder automatically detects arithmetic sequences, computes defaults, identifies deltas, and orders fields for maximum compression.",
    ].join("\n\n"),
  },

  "migration": {
    title: "Switching from TOON", cat: "Ecosystem",
    content: [
      "## TOON \u2192 DHOOM Migration",
      "Everything you know from TOON carries over. DHOOM adds new capabilities.",
      "### What Stays the Same",
      "- Positional encoding via header \u2713\n- Header declares fields once \u2713\n- Comma-separated values \u2713\n- Human-readable text \u2713\n- Lossless JSON round-trip \u2713\n- Nesting support \u2713",
      "### What DHOOM Adds",
      "| Feature | TOON | DHOOM |\n|---|---|---|\n| Arithmetic fields | \u2717 | `@start+step` |\n| Modal defaults | \u2717 | `field\\|value` |\n| Deviation marking | \u2717 | `:override` |\n| Trailing elision | \u2717 | Defaults at end \u2192 records stop |\n| Implied nesting | \u2717 | `>` child inherits name |\n| Boolean shorthand | \u2717 | `T`/`F` |\n| Delta encoding | \u2717 | `field^` \u2014 differences from previous |\n| Sparse bundles | \u2717 | `~name{}` \u2014 named pairs, nulls omitted |\n| Bundle morphisms | \u2717 | `field->target` \u2014 foreign keys |\n| No record count | `[N]` required | Parser counts |\n| Field ordering | Not meaningful | Compression decision |",
      "### Step-by-Step",
      "1. **Drop `[N]`** \u2014 `reviews[3]{...}` \u2192 `reviews{...}`\n2. **Add `@`** to sequential fields \u2014 remove from records\n3. **Add `|`** for common values \u2014 reorder to end\n4. **Replace booleans** \u2014 `true`\u2192`T`, `false`\u2192`F`\n5. **Mark overrides** \u2014 prefix deviations with `:`\n6. **Elide trailing defaults** \u2014 stop writing when the rest match\n7. **Nested names** \u2014 children use `{fields}:` not `name{fields}:`",
    ].join("\n\n"),
  },

  "implementations": {
    title: "Implementations", cat: "Ecosystem",
    content: [
      "## Language Implementations",
      "### Official SDKs",
      "| Language | Package | Status |\n|---|---|---|\n| **TypeScript** | `@dhoom-format/dhoom` | \u2705 v0.4.0 \u2014 71/71 tests |\n| **Rust** | `dhoom` | \u2705 v0.4.0 \u2014 27/27 tests |\n| **Python** | `dhoom` | \u2705 v0.4.0 \u2014 51/51 tests |\n| **Go** | `dhoom-go` | \u2705 v0.4.0 |\n| **.NET (C#)** | `Dhoom` | \u2705 v0.4.0 \u2014 39/39 tests |\n| **Java** | `dev.dhoom` | \u2705 v0.4.0 |\n| **CLI** | `@dhoom-format/cli` | \u2705 v0.4.0 |",
      "### API",
      "All implementations expose:\n\n`encode(json_value) \u2192 dhoom_string`\n`decode(dhoom_string) \u2192 json_value`",
      "The encoder detects arithmetic sequences, computes modal defaults, detects delta-encodable fields, identifies sparse bundles, orders fields for trailing elision, and emits records with deviation marking.",
      "### Contributing",
      "Priority: multi-model LLM benchmarks, additional edge case test suites.",
    ].join("\n\n"),
  },
};

const SIDEBAR = [
  { heading: "Guide", items: [
    { id: "getting-started", label: "Getting Started" },
    { id: "format-overview", label: "Format Overview" },
    { id: "arithmetic", label: "Arithmetic Fields (@)" },
    { id: "defaults", label: "Defaults & Elision" },
    { id: "nesting", label: "Nested Bundles (>)" },
    { id: "delta-fields", label: "Delta Fields (^)" },
    { id: "sparse-bundles", label: "Sparse Bundles (~)" },
    { id: "morphisms", label: "Morphisms (->)" },
    { id: "math", label: "The Mathematics" },
    { id: "using-with-llms", label: "Using with LLMs" },
    { id: "benchmarks", label: "Benchmarks" },
  ]},
  { heading: "Reference", items: [
    { id: "syntax", label: "Syntax Cheatsheet" },
    { id: "specification", label: "Full Specification" },
  ]},
  { heading: "Ecosystem", items: [
    { id: "comparison", label: "JSON vs TOON vs DHOOM" },
    { id: "migration", label: "Switching from TOON" },
    { id: "implementations", label: "Implementations" },
  ]},
];

// ═══════════════════════════════════════
// MARKDOWN RENDERER
// ═══════════════════════════════════════
function Md({ text }) {
  if (!text) return null;
  const blocks = text.split("\n\n").filter(Boolean);
  return blocks.map((block, bi) => {
    const t = block.trim();
    if (t.startsWith("### ")) return <h3 key={bi} style={{ fontSize: 16, fontWeight: 700, color: "#B0B0C8", margin: "24px 0 8px" }}>{t.slice(4)}</h3>;
    if (t.startsWith("## ")) return <h2 key={bi} style={{ fontSize: 22, fontWeight: 800, color: "#D0D0E0", margin: "32px 0 12px" }}>{t.slice(3)}</h2>;
    if (t.startsWith("```")) {
      const lines = t.split("\n");
      const code = lines.slice(1, lines.length - 1).join("\n");
      return <pre key={bi} style={{ background: "#0A0A14", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: "14px 16px", fontSize: 12.5, lineHeight: 1.6, color: "#9898B0", fontFamily: "'Fira Code',monospace", overflowX: "auto", margin: "8px 0 12px", whiteSpace: "pre-wrap" }}>{code}</pre>;
    }
    if (t.startsWith("|")) {
      const rows = t.split("\n").filter(r => r.trim().startsWith("|"));
      if (rows.length < 2) return null;
      const pr = r => r.split("|").slice(1, -1).map(c => c.trim());
      const h = pr(rows[0]);
      const d = rows.slice(2).map(pr);
      return <div key={bi} style={{ overflowX: "auto", margin: "8px 0 16px" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}><thead><tr>{h.map((c, i) => <th key={i} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "#9090A8", fontWeight: 600, fontSize: 11 }}>{c}</th>)}</tr></thead><tbody>{d.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.02)", color: "#787890" }}>{renderInline(c)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (t.startsWith("> ")) return <div key={bi} style={{ borderLeft: "3px solid #FF603030", padding: "8px 16px", margin: "8px 0 12px", background: "#FF603006", borderRadius: "0 6px 6px 0" }}><p style={{ margin: 0, fontSize: 13, color: "#909098", lineHeight: 1.65 }}>{renderInline(t.slice(2))}</p></div>;
    if (t.startsWith("- ") || t.includes("\n- ")) {
      const items = t.split("\n").filter(l => l.trim().startsWith("- "));
      return <ul key={bi} style={{ margin: "8px 0 12px", paddingLeft: 24, color: "#808098", fontSize: 14, lineHeight: 1.7 }}>{items.map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{renderInline(it.replace(/^-\s/, "").trim())}</li>)}</ul>;
    }
    if (t.match(/^\d+\.\s/)) {
      const items = t.split("\n").filter(l => l.match(/^\d+\.\s/));
      return <ol key={bi} style={{ margin: "8px 0 12px", paddingLeft: 24, color: "#808098", fontSize: 14, lineHeight: 1.7 }}>{items.map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{renderInline(it.replace(/^\d+\.\s/, ""))}</li>)}</ol>;
    }
    return <p key={bi} style={{ margin: "0 0 12px", fontSize: 14, color: "#808098", lineHeight: 1.75 }}>{renderInline(t)}</p>;
  });
}

function renderInline(text) {
  if (!text) return "";
  const parts = [];
  let rem = String(text);
  let k = 0;
  while (rem.length > 0) {
    const bm = rem.match(/\*\*(.+?)\*\*/);
    const cm = rem.match(/`([^`]+)`/);
    let nm = null;
    let tp = null;
    if (bm && (!cm || bm.index < cm.index)) { nm = bm; tp = "b"; }
    else if (cm) { nm = cm; tp = "c"; }
    if (!nm) { parts.push(rem); break; }
    if (nm.index > 0) parts.push(rem.slice(0, nm.index));
    if (tp === "b") parts.push(<strong key={k++} style={{ color: "#C0C0D8" }}>{nm[1]}</strong>);
    else parts.push(<code key={k++} style={{ background: "#12101A", padding: "1px 5px", borderRadius: 3, fontSize: "0.9em", color: "#FF6030", fontFamily: "'Fira Code',monospace" }}>{nm[1]}</code>);
    rem = rem.slice(nm.index + nm[0].length);
  }
  return parts;
}

// ═══════════════════════════════════════
// PAGE COMPONENTS
// ═══════════════════════════════════════

function NavBar({ page, setPage }) {
  const mob = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    { id: "playground", l: "Playground" },
    { id: "getting-started", l: "Guide" },
    { id: "syntax", l: "Reference" },
    { id: "comparison", l: "Compare" },
  ];
  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,6,14,0.94)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.04)", padding: "0 16px" }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: mob ? 0 : 24 }}>
          <span onClick={() => { setPage("home"); setMenuOpen(false); }} style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.04em", cursor: "pointer", background: "linear-gradient(135deg,#FF6030,#FF3818)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>DHOOM</span>
          {!mob && navItems.map(n => {
            const active = page === n.id || (DOCS[page] && DOCS[page].cat === "Guide" && n.id === "getting-started") || (DOCS[page] && DOCS[page].cat === "Reference" && n.id === "syntax") || (DOCS[page] && DOCS[page].cat === "Ecosystem" && n.id === "migration");
            return <button key={n.id} onClick={() => setPage(n.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 10px", color: active ? "#FF6030" : "#606078", fontSize: 13, fontWeight: 500 }}>{n.l}</button>;
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!mob && <span style={{ fontSize: 11, color: "#383850", fontFamily: "monospace" }}>v0.4</span>}
          <a href="https://github.com/nurdymuny/dhoom" target="_blank" rel="noopener noreferrer" style={{ color: "#505068", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>{!mob && "GitHub"}</a>
          {mob && <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#606078", fontSize: 20, lineHeight: 1 }}>{menuOpen ? "\u2715" : "\u2630"}</button>}
        </div>
      </div>
      {mob && menuOpen && (
        <div style={{ paddingBottom: 12, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {navItems.map(n => {
            const active = page === n.id || (DOCS[page] && DOCS[page].cat === "Guide" && n.id === "getting-started") || (DOCS[page] && DOCS[page].cat === "Reference" && n.id === "syntax") || (DOCS[page] && DOCS[page].cat === "Ecosystem" && n.id === "migration");
            return <button key={n.id} onClick={() => { setPage(n.id); setMenuOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "10px 8px", color: active ? "#FF6030" : "#808098", fontSize: 14, fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{n.l}</button>;
          })}
        </div>
      )}
    </nav>
  );
}

function SidebarNav({ page, setPage }) {
  return (
    <div style={{ width: 210, flexShrink: 0, padding: "24px 0 24px 24px", position: "sticky", top: 52, height: "calc(100vh - 52px)", overflowY: "auto" }}>
      {SIDEBAR.map((s, si) => (
        <div key={si} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#484860", textTransform: "uppercase", marginBottom: 8 }}>{s.heading}</div>
          {s.items.map(it => (
            <button key={it.id} onClick={() => setPage(it.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer", marginBottom: 2, background: page === it.id ? "#FF603012" : "transparent", color: page === it.id ? "#FF6030" : "#606078", fontSize: 13, fontWeight: page === it.id ? 600 : 400 }}>{it.label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

function DocsPage({ page, setPage }) {
  const doc = DOCS[page];
  const mob = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (!doc) return null;
  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 52px)", position: "relative" }}>
      {mob && (
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ position: "fixed", bottom: 16, right: 16, zIndex: 50, width: 44, height: 44, borderRadius: 22, background: "linear-gradient(135deg,#FF6030,#E83018)", border: "none", cursor: "pointer", color: "#fff", fontSize: 18, fontWeight: 700, boxShadow: "0 2px 12px rgba(255,96,48,0.3)" }}>{sidebarOpen ? "\u2715" : "\u2630"}</button>
      )}
      {mob && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.6)" }} />
      )}
      {(!mob || sidebarOpen) && (
        <div style={mob ? { position: "fixed", top: 52, left: 0, bottom: 0, width: 240, zIndex: 45, background: "#0A0A14", borderRight: "1px solid rgba(255,255,255,0.06)", padding: "24px 16px", overflowY: "auto" } : { width: 210, flexShrink: 0, padding: "24px 0 24px 24px", position: "sticky", top: 52, height: "calc(100vh - 52px)", overflowY: "auto" }}>
          {SIDEBAR.map((s, si) => (
            <div key={si} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#484860", textTransform: "uppercase", marginBottom: 8 }}>{s.heading}</div>
              {s.items.map(it => (
                <button key={it.id} onClick={() => { setPage(it.id); setSidebarOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer", marginBottom: 2, background: page === it.id ? "#FF603012" : "transparent", color: page === it.id ? "#FF6030" : "#606078", fontSize: 13, fontWeight: page === it.id ? 600 : 400 }}>{it.label}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, padding: mob ? "24px 16px 60px" : "32px 40px 60px", maxWidth: 760, overflowY: "auto" }}>
        <h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, color: "#D0D0E0", margin: "0 0 24px" }}>{doc.title}</h1>
        <Md text={doc.content} />
      </div>
    </div>
  );
}

function ThreeWay() {
  const mob = useIsMobile();
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 16px 40px" }}>
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
        {[
          { l: "JSON", code: '{"reviews":[\n  {"id":101,"customer":"Alex Rivera",\n   "rating":5,"comment":"Excellent!",\n   "verified":true},\n  ...2 more records ]}', c: "#5580D8", ch: "412" },
          { l: "TOON", code: 'reviews[3]{id,customer,rating,\n  comment,verified}:\n  101,Alex Rivera,5,Excellent!,true\n  102,Brij Pandey,5,Game changer!,true\n  103,Casey Lee,3,Average,false', c: "#D4A840", ch: "~210" },
          { l: "DHOOM", code: 'reviews{id@101, customer,\n  comment, rating|5, verified|T}:\nAlex Rivera, Excellent!\nBrij Pandey, Game changer!\nCasey Lee, Average, :3, :F', c: "#FF6030", ch: "~137" },
        ].map((b, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: b.c, letterSpacing: "0.08em" }}>{b.l}</span>
              <span style={{ fontSize: 11, color: "#505068", fontFamily: "monospace" }}>{b.ch}</span>
            </div>
            <pre style={{ background: "#0A0A12", border: "1px solid " + b.c + "12", borderRadius: 8, padding: "12px", fontSize: 11, lineHeight: 1.55, color: "#9898B0", fontFamily: "'Fira Code',monospace", margin: 0, minHeight: 140, whiteSpace: "pre-wrap" }}>{b.code}</pre>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, fontFamily: "monospace" }}>
        <span style={{ color: "#FF6030", fontWeight: 700 }}>67%</span>
        <span style={{ color: "#505068" }}> vs JSON · </span>
        <span style={{ color: "#FF6030", fontWeight: 700 }}>35%</span>
        <span style={{ color: "#505068" }}> vs TOON</span>
      </div>
    </div>
  );
}

function Hero({ setPage }) {
  const mob = useIsMobile();
  return (
    <div style={{ padding: mob ? "48px 16px 40px" : "72px 24px 56px", textAlign: "center", background: "linear-gradient(180deg,#120A1C,#08060E)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 500, height: 500, background: "radial-gradient(circle,rgba(255,80,40,0.07),transparent 60%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", maxWidth: 680, margin: "0 auto" }}>
        <h1 style={{ fontSize: mob ? 48 : 68, fontWeight: 900, margin: 0, lineHeight: 1, background: "linear-gradient(135deg,#FF6832,#FF3020 50%,#CC1808)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.05em" }}>DHOOM</h1>
        <p style={{ fontSize: mob ? 9 : 13, color: "#FF603055", fontWeight: 600, letterSpacing: "0.12em", margin: "8px 0 0", fontFamily: "'Fira Code',monospace" }}>DAVIS HUMAN-READABLE OPTIMIZED OBJECT MARKUP</p>
        <p style={{ fontSize: mob ? 15 : 18, color: "#8888A0", margin: "20px auto 0", maxWidth: 560, lineHeight: 1.6 }}>A geometric serialization format that achieves <strong style={{ color: "#C0C0D0" }}>100% LLM accuracy</strong> with <strong style={{ color: "#FF6030" }}>40\u201362% fewer tokens</strong> than JSON.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
          <button onClick={() => setPage("getting-started")} style={{ padding: "11px 24px", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#FF6030,#E83018)", color: "#fff", fontSize: 14, fontWeight: 700 }}>What is DHOOM?</button>
          <button onClick={() => setPage("playground")} style={{ padding: "11px 24px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "#888898", fontSize: 14, fontWeight: 600 }}>Playground</button>
          <button onClick={() => setPage("syntax")} style={{ padding: "11px 24px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "#888898", fontSize: 14, fontWeight: 600 }}>Spec</button>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
          {["TypeScript", "Rust", "Python", "Go", "C#", "Java"].map(lang => (
            <span key={lang} onClick={() => setPage("implementations")} style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: "'Fira Code',monospace", color: "#9090A8", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", transition: "border-color 0.2s" }}>{lang}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BenchmarkBanner() {
  const mob = useIsMobile();
  const stats = [
    { value: "100%", label: "LLM Accuracy", sub: "209/209 questions" },
    { value: "40–62%", label: "Fewer Tokens", sub: "vs JSON" },
    { value: "18/18", label: "Roundtrip Perfect", sub: "encode \u2192 decode" },
    { value: "\u221294%", label: "Peak Compression", sub: "sensors @ 500 records" },
  ];
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 16px 16px" }}>
      <div style={{ background: "linear-gradient(135deg, rgba(255,96,48,0.06), rgba(255,48,24,0.03))", border: "1px solid rgba(255,96,48,0.12)", borderRadius: 12, padding: mob ? "20px 16px" : "28px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: mob ? 12 : 20 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#FF6030", textTransform: "uppercase" }}>Benchmark Results</span>
          {!mob && <span style={{ fontSize: 11, color: "#484860", marginLeft: 8 }}>209 questions · Claude Sonnet · temperature=0</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: mob ? 20 : 16, textAlign: "center" }}>
          {stats.map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: mob ? 28 : 36, fontWeight: 900, letterSpacing: "-0.03em", background: i === 0 ? "linear-gradient(135deg,#FF6832,#FF3020)" : "none", WebkitBackgroundClip: i === 0 ? "text" : undefined, WebkitTextFillColor: i === 0 ? "transparent" : undefined, color: i === 0 ? undefined : "#D0D0E0" }}>{s.value}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#9090A8", marginTop: 4 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "#505068", marginTop: 2, fontFamily: "'Fira Code',monospace" }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#606078", lineHeight: 1.6 }}>
          Same data. Same questions. DHOOM matches JSON accuracy while transmitting <strong style={{ color: "#B0B0C8" }}>half the tokens</strong>.
        </div>
      </div>
    </div>
  );
}

function FeatureCards() {
  const feats = [
    { i: "@", t: "Arithmetic Compression", d: "Sequential IDs, timestamps \u2014 derived from position." },
    { i: "|", t: "Modal Defaults", d: "Most common value declared once. Silence means agreement." },
    { i: ":", t: "Deviation Marking", d: "Colon says \u201CI disagree.\u201D Explicit and unambiguous." },
    { i: "\u2026", t: "Trailing Elision", d: "Defaults at end \u2192 records stop early." },
    { i: ">", t: "Recursive Nesting", d: "Child bundles inherit parent name." },
    { i: "^", t: "Delta Encoding", d: "Store differences, not absolutes. Parallel transport." },
    { i: "~", t: "Sparse Bundles", d: "Named pairs for wide tables. Nulls vanish." },
    { i: "\u2192", t: "Bundle Morphisms", d: "Declared foreign-key relationships between bundles." },
    { i: "{ }", t: "Self-Describing", d: "Schema is inline. No registry needed." },
  ];
  const mob = useIsMobile();
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: mob ? "24px 16px" : "40px 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(3,1fr)", gap: 10 }}>
        {feats.map((f, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.035)", borderRadius: 10, padding: "18px 16px" }}>
            <span style={{ fontSize: 18, color: i >= 5 && i <= 7 ? "#E84020" : "#FF6030", fontFamily: "'Fira Code',monospace", fontWeight: 700 }}>{f.i}</span>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#B0B0C8", margin: "8px 0 4px" }}>{f.t}{i >= 5 && i <= 7 && <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 5px", borderRadius: 3, background: "#FF603018", color: "#FF6030", fontWeight: 700, fontFamily: "'Fira Code',monospace", verticalAlign: "middle" }}>v0.4</span>}</div>
            <div style={{ fontSize: 12, color: "#606078", lineHeight: 1.55 }}>{f.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaygroundPage() {
  const [jsonIn, setJsonIn] = useState(JSON.stringify(JSON.parse(SAMPLES["Customer Reviews"]), null, 2));
  const [sample, setSample] = useState("Customer Reviews");
  const [toon, setToon] = useState("");
  const [dhoom, setDhoom] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    try {
      const p = JSON.parse(jsonIn);
      setToon(encodeToon(p) || "");
      setDhoom(encodeDhoom(p) || "");
      setErr(null);
    } catch (e) {
      setErr(e.message);
      setToon("");
      setDhoom("");
    }
  }, [jsonIn]);

  const jm = jsonIn.replace(/\s/g, "").length;
  const tl = toon.length;
  const dl = dhoom.length;
  const vj = jm > 0 ? ((1 - dl / jm) * 100).toFixed(0) : "0";
  const vt = tl > 0 ? ((1 - dl / tl) * 100).toFixed(0) : "0";

  const mob = useIsMobile();
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: mob ? "20px 12px 60px" : "28px 24px 60px" }}>
      <h1 style={{ fontSize: mob ? 20 : 24, fontWeight: 800, color: "#D0D0E0", margin: "0 0 4px" }}>Playground</h1>
      <p style={{ fontSize: 13, color: "#606078", margin: "0 0 16px" }}>Paste JSON. See TOON and DHOOM side by side.</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {Object.keys(SAMPLES).map(n => (
          <button key={n} onClick={() => { setJsonIn(JSON.stringify(JSON.parse(SAMPLES[n]), null, 2)); setSample(n); }} style={{ padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", border: sample === n ? "1px solid #FF603040" : "1px solid rgba(255,255,255,0.04)", background: sample === n ? "#FF603010" : "transparent", color: sample === n ? "#FF6030" : "#505068" }}>{n}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        {[
          { l: "JSON", v: jm, c: "#5580D8", s: jsonIn },
          { l: "TOON", v: tl, c: "#D4A840", s: toon },
          { l: "DHOOM", v: dl, c: "#FF6030", s: dhoom },
        ].map((s, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.012)", border: "1px solid " + s.c + "15", borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: s.c }}>{s.l}</span>
            <span style={{ fontSize: 11, color: "#606078", fontFamily: "monospace" }}>{s.v} chars · ~{approxTok(s.s)} tok</span>
          </div>
        ))}
      </div>
      {dl > 0 && <div style={{ textAlign: "right", marginBottom: 10, fontSize: 12, fontFamily: "monospace" }}><span style={{ color: "#FF6030", fontWeight: 700 }}>{vj}%</span><span style={{ color: "#484860" }}> vs JSON · </span><span style={{ color: "#FF6030", fontWeight: 700 }}>{vt}%</span><span style={{ color: "#484860" }}> vs TOON</span></div>}
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#5580D8", marginBottom: 4 }}>JSON INPUT</div>
          <textarea value={jsonIn} onChange={e => { setJsonIn(e.target.value); setSample(""); }} spellCheck={false} style={{ width: "100%", minHeight: mob ? 200 : 360, background: "#0A0A12", border: "1px solid #5580D810", borderRadius: 8, padding: "10px", fontSize: 11, lineHeight: 1.5, color: "#9898B0", fontFamily: "'Fira Code',monospace", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
          {err && <div style={{ color: "#E04040", fontSize: 11, marginTop: 4 }}>{err}</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#D4A840", marginBottom: 4 }}>TOON OUTPUT</div>
          <pre style={{ width: "100%", minHeight: mob ? 200 : 360, background: "#0A0A12", border: "1px solid #D4A84010", borderRadius: 8, padding: "10px", fontSize: 11, lineHeight: 1.5, color: "#9898B0", fontFamily: "'Fira Code',monospace", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "auto", boxSizing: "border-box" }}>{toon}</pre>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#FF6030" }}>DHOOM OUTPUT</span>
            {dl > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: "#FF6030", background: "#FF603015", padding: "1px 6px", borderRadius: 3 }}>-{vj}%</span>}
          </div>
          <pre style={{ width: "100%", minHeight: mob ? 200 : 360, background: "#0A0A12", border: "1px solid #FF603018", borderRadius: 8, padding: "10px", fontSize: 11, lineHeight: 1.5, color: "#C0C0D8", fontFamily: "'Fira Code',monospace", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "auto", boxSizing: "border-box" }}>{dhoom}</pre>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// APP (defined last, after all components)
// ═══════════════════════════════════════
export default function DhoomDev() {
  const getPageFromHash = () => {
    const hash = window.location.hash.slice(1);
    return hash && (hash === "home" || hash === "playground" || DOCS[hash]) ? hash : "home";
  };
  const [page, setPageState] = useState(getPageFromHash);

  const setPage = (id) => {
    setPageState(id);
    window.location.hash = id === "home" ? "" : id;
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onHash = () => setPageState(getPageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#08060E", color: "#D0D0E0", fontFamily: "'Outfit',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Fira+Code:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <NavBar page={page} setPage={setPage} />

      {page === "home" && (
        <>
          <Hero setPage={setPage} />
          <ThreeWay />
          <BenchmarkBanner />
          <FeatureCards />
          <div style={{ padding: "32px 24px 60px", textAlign: "center" }}>
            <button onClick={() => setPage("playground")} style={{ padding: "12px 28px", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#FF6030,#E83018)", color: "#fff", fontSize: 14, fontWeight: 700 }}>Open Playground</button>
          </div>
          <div style={{ padding: "20px", textAlign: "center", fontSize: 11, color: "#242438", fontFamily: "'Fira Code',monospace", borderTop: "1px solid rgba(255,255,255,0.02)" }}>DHOOM · Davis Geometric · 2026 · <a href="https://github.com/nurdymuny/dhoom" target="_blank" rel="noopener noreferrer" style={{ color: "#383850", textDecoration: "none" }}>GitHub</a></div>
        </>
      )}

      {page === "playground" && <PlaygroundPage />}

      {DOCS[page] && <DocsPage page={page} setPage={setPage} />}
    </div>
  );
}
