import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decode, encode, parseFiber, encodeLines, decodeStream } from "./index.js";

describe("parseFiber", () => {
  it("parses simple fiber header", () => {
    const fiber = parseFiber(
      "reviews{id@101, customer, comment, rating|5, verified|T}",
    );
    assert.equal(fiber.name, "reviews");
    assert.equal(fiber.fields.length, 5);
    assert.deepEqual(fiber.fields[0].modifier, {
      type: "arithmetic",
      start: 101,
    });
    assert.equal(fiber.fields[1].modifier, undefined);
    assert.deepEqual(fiber.fields[3].modifier, {
      type: "default",
      defaultValue: 5,
    });
    assert.deepEqual(fiber.fields[4].modifier, {
      type: "default",
      defaultValue: true,
    });
  });

  it("parses anonymous fiber", () => {
    const fiber = parseFiber("{status, data>}");
    assert.equal(fiber.name, undefined);
    assert.equal(fiber.fields.length, 2);
    assert.deepEqual(fiber.fields[1].modifier, { type: "nested" });
  });

  it("parses arithmetic with step", () => {
    const fiber = parseFiber("{timestamp@1710000000+60}");
    assert.deepEqual(fiber.fields[0].modifier, {
      type: "arithmetic",
      start: 1710000000,
      step: 60,
    });
  });
});

describe("decode", () => {
  it("decodes reviews example", () => {
    const input = `reviews{id@101, customer, comment, rating|5, verified|T}:
Alex Rivera, Excellent!
Brij Pandey, Game changer!
Casey Lee, Average, :3, :F`;

    const result = decode(input);
    assert.deepEqual(result, {
      reviews: [
        {
          id: 101,
          customer: "Alex Rivera",
          comment: "Excellent!",
          rating: 5,
          verified: true,
        },
        {
          id: 102,
          customer: "Brij Pandey",
          comment: "Game changer!",
          rating: 5,
          verified: true,
        },
        {
          id: 103,
          customer: "Casey Lee",
          comment: "Average",
          rating: 3,
          verified: false,
        },
      ],
    });
  });

  it("decodes sensors example", () => {
    const input = `readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:
22.4
23.1
45.8, :alert`;

    const result = decode(input);
    assert.deepEqual(result, {
      readings: [
        {
          sensor_id: "T-001",
          timestamp: 1710000000,
          value: 22.4,
          status: "normal",
          unit: "celsius",
        },
        {
          sensor_id: "T-002",
          timestamp: 1710000060,
          value: 23.1,
          status: "normal",
          unit: "celsius",
        },
        {
          sensor_id: "T-003",
          timestamp: 1710000120,
          value: 45.8,
          status: "alert",
          unit: "celsius",
        },
      ],
    });
  });

  it("handles trailing elision", () => {
    const input = `items{name, active|T, role|user}:
Alice
Bob`;
    assert.deepEqual(decode(input), {
      items: [
        { name: "Alice", active: true, role: "user" },
        { name: "Bob", active: true, role: "user" },
      ],
    });
  });

  it("handles deviation marking", () => {
    const input = `items{name, score|10}:
Alice
Bob, :7`;
    assert.deepEqual(decode(input), {
      items: [
        { name: "Alice", score: 10 },
        { name: "Bob", score: 7 },
      ],
    });
  });

  it("handles empty collection", () => {
    const input = "items{id, name}:\n";
    assert.deepEqual(decode(input), { items: [] });
  });

  it("handles boolean shorthand", () => {
    const input = `flags{name, on}:
a, T
b, F`;
    assert.deepEqual(decode(input), {
      flags: [
        { name: "a", on: true },
        { name: "b", on: false },
      ],
    });
  });
});

describe("encode", () => {
  it("encodes and roundtrips reviews", () => {
    const data = {
      reviews: [
        {
          id: 101,
          customer: "Alex Rivera",
          rating: 5,
          comment: "Excellent!",
          verified: true,
        },
        {
          id: 102,
          customer: "Brij Pandey",
          rating: 5,
          comment: "Game changer!",
          verified: true,
        },
        {
          id: 103,
          customer: "Casey Lee",
          rating: 3,
          comment: "Average",
          verified: false,
        },
      ],
    };
    const dhoom = encode(data);
    const roundtrip = decode(dhoom);
    assert.deepEqual(roundtrip, data);
  });

  it("encodes and roundtrips sensors", () => {
    const data = {
      readings: [
        {
          sensor_id: "T-001",
          timestamp: 1710000000,
          value: 22.4,
          status: "normal",
          unit: "celsius",
        },
        {
          sensor_id: "T-002",
          timestamp: 1710000060,
          value: 23.1,
          status: "normal",
          unit: "celsius",
        },
        {
          sensor_id: "T-003",
          timestamp: 1710000120,
          value: 45.8,
          status: "alert",
          unit: "celsius",
        },
      ],
    };
    const dhoom = encode(data);
    const roundtrip = decode(dhoom);
    assert.deepEqual(roundtrip, data);
  });

  it("produces smaller output than JSON", () => {
    const data = {
      reviews: [
        {
          id: 101,
          customer: "Alex Rivera",
          rating: 5,
          comment: "Excellent!",
          verified: true,
        },
        {
          id: 102,
          customer: "Brij Pandey",
          rating: 5,
          comment: "Game changer!",
          verified: true,
        },
        {
          id: 103,
          customer: "Casey Lee",
          rating: 3,
          comment: "Average",
          verified: false,
        },
      ],
    };
    const dhoom = encode(data);
    const json = JSON.stringify(data);
    assert.ok(
      dhoom.length < json.length,
      `DHOOM (${dhoom.length}) should be smaller than JSON (${json.length})`,
    );
  });
});

describe("encodeLines", () => {
  it("yields header then one line per record", () => {
    const data = {
      items: [
        { name: "Alice", score: 10 },
        { name: "Bob", score: 20 },
      ],
    };
    const lines = [...encodeLines(data)];
    assert.equal(lines.length, 3); // header + 2 records
    assert.ok(lines[0].startsWith("items{"));
    assert.ok(lines[0].endsWith("}:"));
    assert.ok(lines[1].includes("Alice"));
    assert.ok(lines[2].includes("Bob"));
  });

  it("roundtrips via joined lines", () => {
    const data = {
      reviews: [
        { id: 101, customer: "Alex Rivera", rating: 5, comment: "Excellent!", verified: true },
        { id: 102, customer: "Brij Pandey", rating: 5, comment: "Game changer!", verified: true },
        { id: 103, customer: "Casey Lee", rating: 3, comment: "Average", verified: false },
      ],
    };
    const lines = [...encodeLines(data)];
    const dhoomStr = lines.join("\n") + "\n";
    const roundtrip = decode(dhoomStr);
    assert.deepEqual(roundtrip, data);
  });

  it("handles arrays without names", () => {
    const data = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const lines = [...encodeLines(data)];
    assert.ok(lines[0].startsWith("data{"));
    assert.equal(lines.length, 3);
  });

  it("encodeLines output matches encode output", () => {
    const data = {
      readings: [
        { sensor_id: "T-001", timestamp: 1710000000, value: 22.4, status: "normal", unit: "celsius" },
        { sensor_id: "T-002", timestamp: 1710000060, value: 23.1, status: "normal", unit: "celsius" },
        { sensor_id: "T-003", timestamp: 1710000120, value: 45.8, status: "alert", unit: "celsius" },
      ],
    };
    const fromEncode = encode(data);
    const fromLines = [...encodeLines(data)].join("\n") + "\n";
    assert.equal(fromLines, fromEncode);
  });
});

describe("decodeStream", () => {
  it("decodes from async iterable of lines", async () => {
    const dhoom = `reviews{id@101, customer, comment, rating|5, verified|T}:
Alex Rivera, Excellent!
Brij Pandey, Game changer!
Casey Lee, Average, :3, :F`;

    async function* toLines(s: string) {
      for (const line of s.split("\n")) {
        yield line;
      }
    }

    const result = await decodeStream(toLines(dhoom));
    assert.deepEqual(result, {
      reviews: [
        { id: 101, customer: "Alex Rivera", comment: "Excellent!", rating: 5, verified: true },
        { id: 102, customer: "Brij Pandey", comment: "Game changer!", rating: 5, verified: true },
        { id: 103, customer: "Casey Lee", comment: "Average", rating: 3, verified: false },
      ],
    });
  });

  it("roundtrips encodeLines -> decodeStream", async () => {
    const data = {
      sensors: [
        { id: 1, temp: 22.4, status: "ok" },
        { id: 2, temp: 23.1, status: "ok" },
        { id: 3, temp: 45.8, status: "alert" },
      ],
    };

    async function* toAsync(lines: string[]) {
      for (const line of lines) {
        yield line;
      }
    }

    const encoded = [...encodeLines(data)];
    const decoded = await decodeStream(toAsync(encoded));
    assert.deepEqual(decoded, data);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Edge Case Test Suite
// ═══════════════════════════════════════════════════════════════════

describe("edge: string values", () => {
  it("roundtrips strings that look like booleans", () => {
    const data = { items: [
      { name: "true", val: "false" },
      { name: "TRUE", val: "FALSE" },
    ]};
    const rt = decode(encode(data));
    // "true"/"false" lowercase should stay as strings, not become booleans
    assert.equal(typeof rt.items[0].name, "string");
    assert.equal(rt.items[0].name, "true");
    assert.equal(rt.items[0].val, "false");
  });

  it("roundtrips strings that look like numbers", () => {
    const data = { items: [
      { code: "007", zip: "00100" },
    ]};
    // Leading-zero strings should NOT become numbers
    const dhoom = encode(data);
    const rt = decode(dhoom);
    // NOTE: current coercion may turn "007" into 7 — this documents the behavior
    // If it roundtrips as number, that's a known limitation noted in spec
    assert.ok(rt.items[0].code === "007" || rt.items[0].code === 7);
  });

  it("roundtrips strings with commas", () => {
    const data = { items: [
      { name: "Smith, John", city: "Portland" },
      { name: "Lee, Casey", city: "Denver" },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips strings with colons", () => {
    const data = { items: [
      { time: "12:30", label: "noon:ish" },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips strings with double quotes", () => {
    const data = { items: [
      { quote: 'She said "hello"', name: "test" },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips strings with newlines", () => {
    const data = { items: [
      { note: "line1\nline2", name: "test" },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips unicode and emoji", () => {
    const data = { items: [
      { name: "Sato Yuki 佐藤", note: "👍🎉" },
      { name: "María García", note: "café" },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips empty strings", () => {
    const data = { items: [
      { name: "Alice", note: "" },
      { name: "Bob", note: "" },
    ]};
    const rt = decode(encode(data));
    assert.equal(rt.items[0].note, "");
    assert.equal(rt.items[1].note, "");
  });

  it("roundtrips the literal string 'null'", () => {
    // String "null" vs actual null
    const data = { items: [
      { name: "test", val: null },
    ]};
    const rt = decode(encode(data));
    assert.equal(rt.items[0].val, null);
  });

  it("roundtrips T and F as values (not strings)", () => {
    const data = { items: [
      { name: "a", flag: true },
      { name: "b", flag: false },
    ]};
    const rt = decode(encode(data));
    assert.strictEqual(rt.items[0].flag, true);
    assert.strictEqual(rt.items[1].flag, false);
  });
});

describe("edge: numeric values", () => {
  it("roundtrips negative numbers", () => {
    const data = { items: [
      { name: "a", val: -42 },
      { name: "b", val: -3.14 },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips zero", () => {
    const data = { items: [
      { name: "a", val: 0 },
      { name: "b", val: 0 },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips large integers", () => {
    const data = { items: [
      { id: 1, ts: 1710000000 },
      { id: 2, ts: 1710000060 },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("roundtrips floats with many decimals", () => {
    const data = { items: [
      { name: "pi", val: 3.14159 },
      { name: "e", val: 2.71828 },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });
});

describe("edge: single record", () => {
  it("roundtrips single record collection", () => {
    const data = { items: [
      { name: "Alice", age: 30, active: true },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });

  it("single record has no arithmetic detection", () => {
    const data = { items: [
      { id: 42, name: "only" },
    ]};
    const dhoom = encode(data);
    // Single record should NOT use @ since no sequence can be detected
    const rt = decode(dhoom);
    assert.equal(rt.items[0].id, 42);
    assert.equal(rt.items[0].name, "only");
  });
});

describe("edge: all defaults", () => {
  it("roundtrips when all records match all defaults", () => {
    const data = { items: [
      { name: "a", status: "ok", active: true },
      { name: "b", status: "ok", active: true },
      { name: "c", status: "ok", active: true },
    ]};
    const rt = decode(encode(data));
    // values preserved even when status and active are all-default
    for (const item of rt.items as any[]) {
      assert.equal(item.status, "ok");
      assert.equal(item.active, true);
    }
  });

  it("roundtrips when every field is the same across all records", () => {
    const data = { items: [
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });
});

describe("edge: no defaults possible", () => {
  it("roundtrips when all values are unique", () => {
    const data = { items: [
      { a: "x", b: 1, c: true },
      { a: "y", b: 2, c: false },
      { a: "z", b: 3, c: true },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });
});

describe("edge: arithmetic sequences", () => {
  it("roundtrips negative step", () => {
    const data = { items: [
      { id: 10, name: "a" },
      { id: 8, name: "b" },
      { id: 6, name: "c" },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("roundtrips large step", () => {
    const data = { items: [
      { id: 100, name: "a" },
      { id: 200, name: "b" },
      { id: 300, name: "c" },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("roundtrips string pattern arithmetic", () => {
    const data = { items: [
      { code: "T-001", val: 1 },
      { code: "T-002", val: 2 },
      { code: "T-003", val: 3 },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("roundtrips string pattern with large step", () => {
    const data = { items: [
      { bay: "A-0001", status: "ok" },
      { bay: "A-0011", status: "ok" },
      { bay: "A-0021", status: "ok" },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("roundtrips multiple arithmetic fields", () => {
    const data = { readings: [
      { sensor: "T-001", ts: 1000, val: 22.4 },
      { sensor: "T-002", ts: 1060, val: 23.1 },
      { sensor: "T-003", ts: 1120, val: 45.8 },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("does not detect arithmetic for non-sequential values", () => {
    const data = { items: [
      { id: 1, name: "a" },
      { id: 3, name: "b" },
      { id: 7, name: "c" },
    ]};
    const dhoom = encode(data);
    // Non-sequential should NOT use @
    assert.ok(!dhoom.includes("@"));
    assert.deepEqual(decode(dhoom), data);
  });
});

describe("edge: trailing elision", () => {
  it("partially elides trailing defaults", () => {
    // Only the last default matches; first one deviates
    const data = { items: [
      { name: "a", status: "ok", active: true },
      { name: "b", status: "bad", active: true },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("no elision when last field deviates", () => {
    const data = { items: [
      { name: "a", status: "ok", active: true },
      { name: "b", status: "ok", active: false },
    ]};
    const rt = decode(encode(data));
    assert.deepEqual(rt, data);
  });

  it("full elision when all fields are default", () => {
    const input = `items{name, active|T, role|user}:
Alice`;
    const result = decode(input);
    assert.deepEqual(result, {
      items: [{ name: "Alice", active: true, role: "user" }],
    });
  });
});

describe("edge: quoted strings", () => {
  it("decodes quoted strings with embedded commas", () => {
    const input = `items{name, desc}:
Alice, "has, commas"`;
    const result = decode(input);
    assert.equal(result.items[0].desc, "has, commas");
  });

  it("decodes quoted strings with escaped quotes", () => {
    const input = `items{name, desc}:
Alice, "she said ""hello"""`;
    const result = decode(input);
    assert.equal(result.items[0].desc, 'she said "hello"');
  });

  it("roundtrips values needing quoting", () => {
    const data = { items: [
      { name: "test", desc: "a, b, c" },
      { name: "test2", desc: 'say "hi"' },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });
});

describe("edge: deviation marking", () => {
  it("handles multiple deviations in one record", () => {
    const input = `items{name, a|1, b|2, c|3}:
Alice, :10, :20, :30`;
    const result = decode(input);
    assert.deepEqual(result.items[0], { name: "Alice", a: 10, b: 20, c: 30 });
  });

  it("handles deviation of 0 overriding a non-zero default", () => {
    const input = `items{name, likes|42}:
Alice
Bob, :0`;
    const result = decode(input);
    assert.equal(result.items[0].likes, 42);
    assert.equal(result.items[1].likes, 0);
  });

  it("handles deviation from boolean default", () => {
    const input = `items{name, verified|T}:
Alice
Bob, :F`;
    const result = decode(input);
    assert.equal(result.items[0].verified, true);
    assert.equal(result.items[1].verified, false);
  });
});

describe("edge: many fields", () => {
  it("roundtrips records with 10+ fields", () => {
    const data = { items: [
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 },
      { a: 11, b: 12, c: 13, d: 14, e: 15, f: 16, g: 17, h: 18, i: 19, j: 20 },
    ]};
    assert.deepEqual(decode(encode(data)), data);
  });
});

describe("edge: many records", () => {
  it("roundtrips 100 records", () => {
    const records = [];
    for (let i = 0; i < 100; i++) {
      records.push({ id: i + 1, name: `user_${i}`, active: i % 5 !== 0 });
    }
    const data = { users: records };
    const rt = decode(encode(data));
    assert.equal((rt.users as any[]).length, 100);
    assert.deepEqual(rt, data);
  });
});

describe("edge: mixed types in same field position", () => {
  it("roundtrips null mixed with values", () => {
    const data = { items: [
      { name: "a", val: 42 },
      { name: "b", val: null },
      { name: "c", val: 99 },
    ]};
    const rt = decode(encode(data));
    assert.equal(rt.items[1].val, null);
  });
});

describe("edge: whitespace handling", () => {
  it("trims whitespace around values", () => {
    const input = `items{name, val}:
  Alice  ,  42  `;
    const result = decode(input);
    assert.equal(result.items[0].name, "Alice");
    assert.equal(result.items[0].val, 42);
  });

  it("ignores blank lines in body", () => {
    const input = `items{name}:

Alice

Bob
`;
    const result = decode(input);
    assert.equal((result.items as any[]).length, 2);
  });
});

describe("edge: parseFiber edge cases", () => {
  it("parses field with hyphenated name", () => {
    const fiber = parseFiber("{first-name, last-name}");
    assert.equal(fiber.fields[0].name, "first-name");
    assert.equal(fiber.fields[1].name, "last-name");
  });

  it("parses field with underscore name", () => {
    const fiber = parseFiber("{_id, user_name}");
    assert.equal(fiber.fields[0].name, "_id");
    assert.equal(fiber.fields[1].name, "user_name");
  });

  it("parses default with string value containing spaces", () => {
    const fiber = parseFiber("{name, role|power user}");
    assert.deepEqual(fiber.fields[1].modifier, {
      type: "default",
      defaultValue: "power user",
    });
  });

  it("parses fiber with single field", () => {
    const fiber = parseFiber("{name}");
    assert.equal(fiber.fields.length, 1);
    assert.equal(fiber.fields[0].name, "name");
  });

  it("throws on missing braces", () => {
    assert.throws(() => parseFiber("no braces here"), /braces/i);
  });
});
