"""
DHOOM Benchmark — Character Count & Token Count Comparison

Compares JSON, TOON, and DHOOM across five datasets.
Uses tiktoken o200k_base (GPT-4o tokenizer).
"""

import json
import tiktoken

enc = tiktoken.get_encoding("o200k_base")


def token_count(s: str) -> int:
    return len(enc.encode(s))


# ---------------------------------------------------------------------------
# Datasets (JSON source of truth)
# ---------------------------------------------------------------------------

DATASETS = {
    "Customer Reviews": {
        "reviews": [
            {"id": 101, "customer": "Alex Rivera", "rating": 5, "comment": "Excellent!", "verified": True},
            {"id": 102, "customer": "Brij Pandey", "rating": 5, "comment": "Game changer!", "verified": True},
            {"id": 103, "customer": "Casey Lee", "rating": 3, "comment": "Average", "verified": False},
        ]
    },
    "Sensor Readings": {
        "readings": [
            {"sensor_id": "T-001", "timestamp": 1710000000, "value": 22.4, "status": "normal", "unit": "celsius"},
            {"sensor_id": "T-002", "timestamp": 1710000060, "value": 23.1, "status": "normal", "unit": "celsius"},
            {"sensor_id": "T-003", "timestamp": 1710000120, "value": 45.8, "status": "alert", "unit": "celsius"},
        ]
    },
    "User Profiles": {
        "users": [
            {"id": 201, "name": "Dana Kim", "email": "dana@example.com", "role": "admin", "active": True},
            {"id": 202, "name": "Eli Rosenberg", "email": "eli@example.com", "role": "editor", "active": True},
            {"id": 203, "name": "Farah Nassar", "email": "farah@example.com", "role": "viewer", "active": True},
        ]
    },
    "Nested Order": {
        "order": [
            {
                "id": "ORD-7891",
                "customer": "Diana Prince",
                "total": 149.99,
                "items": [
                    {"sku": "A100", "name": "Widget", "qty": 2, "price": 49.99},
                    {"sku": "A101", "name": "Gadget", "qty": 1, "price": 50.01},
                ],
                "shipping": [
                    {"method": "express", "address": "1234 Elm St"},
                ],
            }
        ]
    },
    "API Response": {
        "posts": [
            {"id": 1, "author": "jpark", "title": "Intro to DHOOM", "likes": 42, "published": True},
            {"id": 2, "author": "beedavis", "title": "Fiber Bundles for Data", "likes": 108, "published": True},
            {"id": 3, "author": "jpark", "title": "Draft: Part 3", "likes": 0, "published": False},
        ]
    },
}

# ---------------------------------------------------------------------------
# TOON representations (hand-written per TOON spec)
# ---------------------------------------------------------------------------

TOON = {
    "Customer Reviews": """\
reviews[3]{id, customer, rating, comment, verified}:
  101, Alex Rivera, 5, Excellent!, true
  102, Brij Pandey, 5, Game changer!, true
  103, Casey Lee, 3, Average, false""",

    "Sensor Readings": """\
readings[3]{sensor_id, timestamp, value, status, unit}:
  T-001, 1710000000, 22.4, normal, celsius
  T-002, 1710000060, 23.1, normal, celsius
  T-003, 1710000120, 45.8, alert, celsius""",

    "User Profiles": """\
users[3]{id, name, email, role, active}:
  201, Dana Kim, dana@example.com, admin, true
  202, Eli Rosenberg, eli@example.com, editor, true
  203, Farah Nassar, farah@example.com, viewer, true""",

    "Nested Order": """\
order[1]{id, customer, total, items, shipping}:
  ORD-7891, Diana Prince, 149.99, [{sku, name, qty, price}: A100, Widget, 2, 49.99; A101, Gadget, 1, 50.01], [{method, address}: express, 1234 Elm St]""",

    "API Response": """\
posts[3]{id, author, title, likes, published}:
  1, jpark, Intro to DHOOM, 42, true
  2, beedavis, Fiber Bundles for Data, 108, true
  3, jpark, Draft: Part 3, 0, false""",
}

# ---------------------------------------------------------------------------
# DHOOM representations (hand-written per spec, matching example files)
# ---------------------------------------------------------------------------

DHOOM = {
    "Customer Reviews": """\
reviews{id@101, customer, comment, rating|5, verified|T}:
Alex Rivera, Excellent!
Brij Pandey, Game changer!
Casey Lee, Average, :3, :F""",

    "Sensor Readings": """\
readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:
22.4
23.1
45.8, :alert""",

    "User Profiles": """\
users{id@201, name, email, role, active|T}:
Dana Kim, dana@example.com, admin
Eli Rosenberg, eli@example.com, editor
Farah Nassar, farah@example.com, viewer""",

    "Nested Order": """\
order{id, customer, total, items>, shipping>}:
ORD-7891, Diana Prince, 149.99,
  {sku@A100, name, qty, price}:
  Widget, 2, 49.99
  Gadget, 1, 50.01,
  {method, address}:
  express, 1234 Elm St""",

    "API Response": """\
posts{id@1, author, title, likes, published|T}:
jpark, Intro to DHOOM, 42
beedavis, Fiber Bundles for Data, 108
jpark, Draft: Part 3, :0, :F""",
}


def main():
    print("=" * 90)
    print("DHOOM BENCHMARK — Character & Token Count Comparison")
    print("Tokenizer: o200k_base (GPT-4o)")
    print("=" * 90)

    # Character count table
    print("\n### Character Count\n")
    print(f"{'Dataset':<22} {'JSON':>6} {'TOON':>6} {'DHOOM':>6} {'vs JSON':>9} {'vs TOON':>9}")
    print("-" * 62)

    char_results = []
    for name in DATASETS:
        json_str = json.dumps(DATASETS[name], separators=(",", ":"))
        toon_str = TOON[name]
        dhoom_str = DHOOM[name]

        json_chars = len(json_str)
        toon_chars = len(toon_str)
        dhoom_chars = len(dhoom_str)

        vs_json = f"-{100 - (dhoom_chars / json_chars * 100):.0f}%"
        vs_toon = f"-{100 - (dhoom_chars / toon_chars * 100):.0f}%"

        print(f"{name:<22} {json_chars:>6} {toon_chars:>6} {dhoom_chars:>6} {vs_json:>9} {vs_toon:>9}")
        char_results.append((name, json_chars, toon_chars, dhoom_chars))

    # Token count table
    print("\n### Token Count (o200k_base)\n")
    print(f"{'Dataset':<22} {'JSON':>6} {'TOON':>6} {'DHOOM':>6} {'vs JSON':>9} {'vs TOON':>9}")
    print("-" * 62)

    for name in DATASETS:
        json_str = json.dumps(DATASETS[name], separators=(",", ":"))
        toon_str = TOON[name]
        dhoom_str = DHOOM[name]

        json_tok = token_count(json_str)
        toon_tok = token_count(toon_str)
        dhoom_tok = token_count(dhoom_str)

        vs_json = f"-{100 - (dhoom_tok / json_tok * 100):.0f}%"
        vs_toon = f"-{100 - (dhoom_tok / toon_tok * 100):.0f}%"

        print(f"{name:<22} {json_tok:>6} {toon_tok:>6} {dhoom_tok:>6} {vs_json:>9} {vs_toon:>9}")

    # Markdown output for README
    print("\n\n### Markdown Tables (for README)\n")

    print("#### Character Count\n")
    print("| Example | JSON | TOON | DHOOM | vs JSON | vs TOON |")
    print("|---|---|---|---|---|---|")
    for name, jc, tc, dc in char_results:
        vs_j = f"**-{100 - (dc / jc * 100):.0f}%**"
        vs_t = f"**-{100 - (dc / tc * 100):.0f}%**"
        print(f"| {name} | {jc} | {tc} | {dc} | {vs_j} | {vs_t} |")

    print("\n#### Token Count (o200k_base)\n")
    print("| Example | JSON tokens | TOON tokens | DHOOM tokens | vs JSON | vs TOON |")
    print("|---|---|---|---|---|---|")
    for name in DATASETS:
        json_str = json.dumps(DATASETS[name], separators=(",", ":"))
        toon_str = TOON[name]
        dhoom_str = DHOOM[name]
        jt = token_count(json_str)
        tt = token_count(toon_str)
        dt = token_count(dhoom_str)
        vs_j = f"**-{100 - (dt / jt * 100):.0f}%**"
        vs_t = f"**-{100 - (dt / tt * 100):.0f}%**"
        print(f"| {name} | {jt} | {tt} | {dt} | {vs_j} | {vs_t} |")


if __name__ == "__main__":
    main()
