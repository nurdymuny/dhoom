# @dhoom-format/dhoom

DHOOM (Davis Human-readable Optimized Object Markup) — a geometric serialization format that achieves **100% LLM accuracy** with **40–62% fewer tokens** than JSON.

## Install

```bash
npm install @dhoom-format/dhoom
```

## Usage

```ts
import { encode, decode, encodeLines, decodeStream } from "@dhoom-format/dhoom";

// Encode JSON → DHOOM
const dhoom = encode({
  reviews: [
    { id: 101, customer: "Alex Rivera", rating: 5, comment: "Excellent!", verified: true },
    { id: 102, customer: "Brij Pandey", rating: 5, comment: "Game changer!", verified: true },
    { id: 103, customer: "Casey Lee", rating: 3, comment: "Average", verified: false },
  ],
});
// reviews{id@101, customer, comment, rating|5, verified|T}:
// Alex Rivera, Excellent!
// Brij Pandey, Game changer!
// Casey Lee, Average, :3, :F

// Decode DHOOM → JSON
const json = decode(dhoom);
```

### Streaming API

```ts
import { encodeLines, decodeStream } from "@dhoom-format/dhoom";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// encodeLines — yields one line at a time (header, then each record)
for (const line of encodeLines(data)) {
  process.stdout.write(line + "\n");
}

// decodeStream — consumes an async iterable of lines
const rl = createInterface({ input: createReadStream("data.dhoom") });
const result = await decodeStream(rl);
```

## API

| Function | Description |
|---|---|
| `encode(value)` | Encode a JSON value to a DHOOM string |
| `decode(input)` | Decode a DHOOM string to a JSON value |
| `encodeLines(value)` | Generator yielding DHOOM output line-by-line |
| `decodeStream(lines)` | Decode from an async iterable of lines |
| `parseFiber(input)` | Parse a fiber header string |

## Format Features

- **Arithmetic fields** (`@`) — sequential IDs, timestamps derived from position
- **Modal defaults** (`|`) — most common value declared once
- **Deviation marking** (`:`) — explicit override prefix
- **Trailing elision** — defaults at end of record omitted
- **Nested bundles** (`>`) — recursive child structures

## License

MIT
