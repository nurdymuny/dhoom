package dev.dhoom;

import java.util.*;

/**
 * Standalone test runner for DHOOM Java SDK — no JUnit dependency required.
 */
public class DhoomTests {
    private static int passed = 0;
    private static int failed = 0;

    private static void test(String name, Runnable body) {
        try {
            body.run();
            passed++;
            System.out.println("  PASS  " + name);
        } catch (Throwable t) {
            failed++;
            System.out.println("  FAIL  " + name + " — " + t.getMessage());
        }
    }

    private static void assertEqual(Object expected, Object actual) {
        if (!Objects.equals(expected, actual)) {
            throw new AssertionError("Expected: " + expected + "\n  Actual: " + actual);
        }
    }

    private static void assertTrue(boolean cond, String msg) {
        if (!cond) throw new AssertionError(msg);
    }

    private static void assertContains(String haystack, String needle) {
        if (!haystack.contains(needle)) {
            throw new AssertionError("Expected to contain '" + needle + "' in:\n" + haystack);
        }
    }

    private static void assertNotContains(String haystack, String needle) {
        if (haystack.contains(needle)) {
            throw new AssertionError("Expected NOT to contain '" + needle + "' in:\n" + haystack);
        }
    }

    private static void assertThrows(Class<? extends Throwable> expected, Runnable body) {
        try {
            body.run();
            throw new AssertionError("Expected " + expected.getSimpleName() + " but no exception was thrown");
        } catch (Throwable t) {
            if (!expected.isInstance(t)) {
                throw new AssertionError("Expected " + expected.getSimpleName() + " but got " + t.getClass().getSimpleName() + ": " + t.getMessage());
            }
        }
    }

    /** Deep-equals JsonValues ignoring object key order. */
    private static boolean jsonDeepEquals(JsonValue a, JsonValue b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        if (a.isNull() && b.isNull()) return true;
        if (a.isNull() || b.isNull()) return false;
        if (a.isBoolean() && b.isBoolean()) return a.asBoolean() == b.asBoolean();
        if (a.isNumber() && b.isNumber()) return a.asDouble() == b.asDouble();
        if (a.isString() && b.isString()) return a.asString().equals(b.asString());
        if (a.isArray() && b.isArray()) {
            if (a.size() != b.size()) return false;
            for (int i = 0; i < a.size(); i++) {
                if (!jsonDeepEquals(a.get(i), b.get(i))) return false;
            }
            return true;
        }
        if (a.isObject() && b.isObject()) {
            if (a.size() != b.size()) return false;
            for (String key : a.keys()) {
                if (b.get(key) == null && !b.keys().contains(key)) return false;
                if (!jsonDeepEquals(a.get(key), b.get(key))) return false;
            }
            return true;
        }
        return false;
    }

    private static void assertJsonEquals(JsonValue expected, JsonValue actual) {
        if (!jsonDeepEquals(expected, actual)) {
            throw new AssertionError("JSON mismatch.\n  Expected: " + (expected != null ? expected.toJson() : "null") +
                    "\n  Actual:   " + (actual != null ? actual.toJson() : "null"));
        }
    }

    private static void roundtrip(String json) {
        var data = JsonValue.parse(json);
        var dhoom = DhoomCodec.encode(data);
        var result = DhoomCodec.decode(dhoom);
        assertJsonEquals(data, result);
    }

    // -----------------------------------------------------------------------

    public static void main(String[] args) {
        System.out.println("\n=== DHOOM Java SDK Tests ===\n");

        // --- Coercion Tests ---
        System.out.println("Coercion Tests:");

        test("String values", () ->
            roundtrip("{\"items\":[{\"name\":\"Alice\"},{\"name\":\"Bob\"},{\"name\":\"Charlie\"}]}"));

        test("Integer values", () ->
            roundtrip("{\"items\":[{\"x\":1,\"y\":2,\"label\":\"a\"},{\"x\":3,\"y\":4,\"label\":\"b\"},{\"x\":5,\"y\":6,\"label\":\"c\"}]}"));

        test("Float values", () ->
            roundtrip("{\"items\":[{\"temp\":22.4},{\"temp\":23.1},{\"temp\":45.8}]}"));

        test("Boolean values", () ->
            roundtrip("{\"items\":[{\"name\":\"A\",\"a\":true,\"b\":false},{\"name\":\"B\",\"a\":false,\"b\":true},{\"name\":\"C\",\"a\":true,\"b\":true}]}"));

        test("Null values", () ->
            roundtrip("{\"items\":[{\"x\":null,\"y\":1,\"label\":\"a\"},{\"x\":null,\"y\":2,\"label\":\"b\"},{\"x\":null,\"y\":3,\"label\":\"c\"}]}"));

        // --- Arithmetic Tests ---
        System.out.println("\nArithmetic Tests:");

        test("Sequential integers", () -> {
            var json = "{\"items\":[{\"id\":1,\"v\":\"a\"},{\"id\":2,\"v\":\"b\"},{\"id\":3,\"v\":\"c\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "@1");
            roundtrip(json);
        });

        test("Custom start", () -> {
            var json = "{\"items\":[{\"id\":101,\"v\":\"x\"},{\"id\":102,\"v\":\"y\"},{\"id\":103,\"v\":\"z\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "@101");
            roundtrip(json);
        });

        test("Custom step", () -> {
            var json = "{\"items\":[{\"id\":0,\"v\":\"a\"},{\"id\":10,\"v\":\"b\"},{\"id\":20,\"v\":\"c\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "@0+10");
            roundtrip(json);
        });

        test("String arithmetic", () -> {
            var json = "{\"items\":[{\"sku\":\"A-001\",\"name\":\"Widget\"},{\"sku\":\"A-002\",\"name\":\"Gadget\"},{\"sku\":\"A-003\",\"name\":\"Sprocket\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "@A-001");
            roundtrip(json);
        });

        test("Non-sequential no arithmetic", () -> {
            var json = "{\"items\":[{\"id\":1,\"v\":\"a\"},{\"id\":5,\"v\":\"b\"},{\"id\":2,\"v\":\"c\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertNotContains(dhoom, "@");
            roundtrip(json);
        });

        test("Timestamps", () -> {
            var json = "{\"readings\":[{\"ts\":1710000000,\"val\":22.4},{\"ts\":1710000060,\"val\":23.1},{\"ts\":1710000120,\"val\":45.8}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "@1710000000+60");
            roundtrip(json);
        });

        // --- Default Tests ---
        System.out.println("\nDefault Tests:");

        test("Default boolean", () -> {
            var json = "{\"items\":[{\"name\":\"A\",\"active\":true},{\"name\":\"B\",\"active\":true},{\"name\":\"C\",\"active\":false}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "|T");
            roundtrip(json);
        });

        test("Default string", () -> {
            var json = "{\"items\":[{\"name\":\"A\",\"status\":\"ok\"},{\"name\":\"B\",\"status\":\"ok\"},{\"name\":\"C\",\"status\":\"err\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "|ok");
            roundtrip(json);
        });

        test("Default number", () -> {
            var json = "{\"items\":[{\"name\":\"A\",\"rating\":5},{\"name\":\"B\",\"rating\":5},{\"name\":\"C\",\"rating\":3}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "|5");
            roundtrip(json);
        });

        test("Deviation marker", () -> {
            var json = "{\"items\":[{\"name\":\"A\",\"status\":\"ok\"},{\"name\":\"B\",\"status\":\"err\"},{\"name\":\"C\",\"status\":\"ok\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, ":err");
            roundtrip(json);
        });

        // --- Nesting Tests ---
        System.out.println("\nNesting Tests:");

        test("Single nested bundle", () -> {
            var json = "{\"orders\":[{\"customer\":\"Alice\",\"items\":[{\"name\":\"Widget\",\"qty\":2},{\"name\":\"Gadget\",\"qty\":1}]}]}";
            var data = JsonValue.parse(json);
            var dhoom = DhoomCodec.encode(data);
            assertContains(dhoom, ">");
            var result = DhoomCodec.decode(dhoom);
            assertJsonEquals(data, result);
        });

        // --- Example File Tests ---
        System.out.println("\nExample File Tests:");

        test("Decode reviews", () -> {
            var dhoom = "reviews{id@101, customer, comment, rating|5, verified|T}:\n" +
                    "Alex Rivera, Excellent!\n" +
                    "Brij Pandey, Game changer!\n" +
                    "Casey Lee, Average, :3, :F\n";
            var result = DhoomCodec.decode(dhoom);
            var expected = JsonValue.parse("{\"reviews\":[{\"id\":101,\"customer\":\"Alex Rivera\",\"comment\":\"Excellent!\",\"rating\":5,\"verified\":true},{\"id\":102,\"customer\":\"Brij Pandey\",\"comment\":\"Game changer!\",\"rating\":5,\"verified\":true},{\"id\":103,\"customer\":\"Casey Lee\",\"comment\":\"Average\",\"rating\":3,\"verified\":false}]}");
            assertJsonEquals(expected, result);
        });

        test("Decode sensors", () -> {
            var dhoom = "readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:\n" +
                    "22.4\n" +
                    "23.1\n" +
                    "45.8, :alert\n";
            var result = DhoomCodec.decode(dhoom);
            var expected = JsonValue.parse("{\"readings\":[{\"sensor_id\":\"T-001\",\"timestamp\":1710000000,\"value\":22.4,\"status\":\"normal\",\"unit\":\"celsius\"},{\"sensor_id\":\"T-002\",\"timestamp\":1710000060,\"value\":23.1,\"status\":\"normal\",\"unit\":\"celsius\"},{\"sensor_id\":\"T-003\",\"timestamp\":1710000120,\"value\":45.8,\"status\":\"alert\",\"unit\":\"celsius\"}]}");
            assertJsonEquals(expected, result);
        });

        test("Reviews roundtrip", () -> {
            var json = "{\"reviews\":[{\"id\":101,\"customer\":\"Alex Rivera\",\"comment\":\"Excellent!\",\"rating\":5,\"verified\":true},{\"id\":102,\"customer\":\"Brij Pandey\",\"comment\":\"Game changer!\",\"rating\":5,\"verified\":true},{\"id\":103,\"customer\":\"Casey Lee\",\"comment\":\"Average\",\"rating\":3,\"verified\":false}]}";
            roundtrip(json);
        });

        // --- Fiber Parser Tests ---
        System.out.println("\nFiber Parser Tests:");

        test("Simple fields", () -> {
            var fiber = DhoomCodec.parseFiber("items{name, age}");
            assertEqual("items", fiber.name());
            assertEqual(2, fiber.fields().size());
        });

        test("Arithmetic field", () -> {
            var fiber = DhoomCodec.parseFiber("items{id@100}");
            assertEqual(DhoomCodec.ModifierType.ARITHMETIC, fiber.fields().get(0).modifier().type());
        });

        test("Arithmetic with step", () -> {
            var fiber = DhoomCodec.parseFiber("items{id@100+5}");
            assertEqual(5, fiber.fields().get(0).modifier().step());
        });

        test("Default field", () -> {
            var fiber = DhoomCodec.parseFiber("items{name, status|active}");
            assertEqual(DhoomCodec.ModifierType.DEFAULT, fiber.fields().get(1).modifier().type());
        });

        test("Nested field", () -> {
            var fiber = DhoomCodec.parseFiber("orders{customer, items>}");
            assertEqual(DhoomCodec.ModifierType.NESTED, fiber.fields().get(1).modifier().type());
        });

        test("No name", () -> {
            var fiber = DhoomCodec.parseFiber("{x, y}");
            assertEqual(null, fiber.name());
        });

        test("Missing braces", () ->
            assertThrows(DhoomException.class, () -> DhoomCodec.parseFiber("no braces")));

        // --- Edge Case Tests ---
        System.out.println("\nEdge Case Tests:");

        test("Empty input", () -> {
            assertEqual(null, DhoomCodec.decode(""));
            assertEqual(null, DhoomCodec.decode("   "));
        });

        test("Negative numbers", () -> {
            var json = "{\"items\":[{\"x\":-10,\"y\":\"a\"},{\"x\":-9,\"y\":\"b\"},{\"x\":-8,\"y\":\"c\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "@-10");
            roundtrip(json);
        });

        test("Encode multi-key error", () ->
            assertThrows(DhoomException.class, () ->
                DhoomCodec.encode(JsonValue.parse("{\"a\":[{\"x\":1}],\"b\":[{\"y\":2}]}"))));

        // --- Compression Test ---
        System.out.println("\nCompression Tests:");

        test("Reviews compression", () -> {
            var json = "{\"reviews\":[{\"id\":101,\"customer\":\"Alex Rivera\",\"comment\":\"Excellent!\",\"rating\":5,\"verified\":true},{\"id\":102,\"customer\":\"Brij Pandey\",\"comment\":\"Game changer!\",\"rating\":5,\"verified\":true},{\"id\":103,\"customer\":\"Casey Lee\",\"comment\":\"Average\",\"rating\":3,\"verified\":false}]}";
            var data = JsonValue.parse(json);
            var dhoom = DhoomCodec.encode(data);
            var jsonStr = data.toJson();
            assertTrue(dhoom.length() < jsonStr.length(),
                    "DHOOM (" + dhoom.length() + ") should be smaller than JSON (" + jsonStr.length() + ")");
        });

        // --- Trailing Elision Tests ---
        System.out.println("\nTrailing Elision Tests:");

        test("Trailing defaults elided", () -> {
            var json = "{\"items\":[{\"name\":\"A\",\"x\":1,\"status\":\"ok\"},{\"name\":\"B\",\"x\":2,\"status\":\"ok\"},{\"name\":\"C\",\"x\":3,\"status\":\"ok\"}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            // All records have default status, so trailing defaults should be elided
            for (String line : dhoom.split("\n")) {
                String trimmed = line.trim();
                if (!trimmed.isEmpty() && !trimmed.contains("{")) {
                    // Body lines should NOT end with empty fields
                    assertTrue(!trimmed.endsWith(","), "Should not end with comma: " + trimmed);
                }
            }
            roundtrip(json);
        });

        // --- Delta Field Tests ---
        System.out.println("\nDelta Field Tests:");

        test("Parse delta modifier", () -> {
            var fiber = DhoomCodec.parseFiber("events{ts^, name}");
            assertEqual("delta", fiber.fields().get(0).modifier().type());
        });

        test("Decode delta values", () -> {
            var input = "events{name, ts^}:\nA, 1000000\nB, 50\nC, 70\n";
            var result = DhoomCodec.decode(input);
            var arr = result.asObject().get("events").asArray();
            assertEqual(1000000L, arr.get(0).asObject().get("ts").asLong());
            assertEqual(1000050L, arr.get(1).asObject().get("ts").asLong());
            assertEqual(1000120L, arr.get(2).asObject().get("ts").asLong());
        });

        test("Encode delta when beneficial", () -> {
            var json = "{\"events\":[{\"name\":\"A\",\"ts\":1000000},{\"name\":\"B\",\"ts\":1000050},{\"name\":\"C\",\"ts\":1000120},{\"name\":\"D\",\"ts\":1000200},{\"name\":\"E\",\"ts\":1000310}]}";
            var dhoom = DhoomCodec.encode(JsonValue.parse(json));
            assertContains(dhoom, "ts^");
        });

        test("Roundtrip delta", () -> {
            roundtrip("{\"events\":[{\"name\":\"s0\",\"ts\":1000000},{\"name\":\"s1\",\"ts\":1000050},{\"name\":\"s2\",\"ts\":1000120},{\"name\":\"s3\",\"ts\":1000200},{\"name\":\"s4\",\"ts\":1000310}]}");
        });

        // --- Sparse Bundle Tests ---
        System.out.println("\nSparse Bundle Tests:");

        test("Parse sparse prefix", () -> {
            var fiber = DhoomCodec.parseFiber("~profiles{a, b, c, d, e, f, g, h}");
            assertEqual("profiles", fiber.name());
            assertTrue(fiber.sparse(), "Expected sparse to be true");
            assertEqual(8, fiber.fields().size());
        });

        test("Decode sparse records", () -> {
            var input = "~items{a, b, c, d, e, f, g, h}:\na:1, c:3\nb:2\n";
            var result = DhoomCodec.decode(input);
            var arr = result.asObject().get("items").asArray();
            assertEqual(1L, arr.get(0).asObject().get("a").asLong());
            assertEqual(3L, arr.get(0).asObject().get("c").asLong());
            assertTrue(arr.get(0).asObject().get("b").isNull(), "Expected b to be null");
            assertEqual(2L, arr.get(1).asObject().get("b").asLong());
        });

        test("Encode sparse when mostly null", () -> {
            var fields = new String[]{"a","b","c","d","e","f","g","h","i","j"};
            var records = new ArrayList<JsonValue>();
            for (int i = 0; i < 5; i++) {
                var obj = new LinkedHashMap<String, JsonValue>();
                for (var f : fields) obj.put(f, JsonValue.ofNull());
                obj.put(fields[i % fields.length], JsonValue.of((long)(i + 1)));
                records.add(JsonValue.ofObject(obj));
            }
            var wrapper = new LinkedHashMap<String, JsonValue>();
            wrapper.put("sparse_data", JsonValue.ofArray(records));
            var data = JsonValue.ofObject(wrapper);
            var dhoom = DhoomCodec.encode(data);
            assertContains(dhoom, "~sparse_data");
        });

        // --- Morphism Field Tests ---
        System.out.println("\nMorphism Field Tests:");

        test("Parse morphism modifier", () -> {
            var fiber = DhoomCodec.parseFiber("orders{id@1, user_id->users}");
            assertEqual("morphism", fiber.fields().get(1).modifier().type());
            assertEqual("users", fiber.fields().get(1).modifier().target());
        });

        test("Decode morphism as regular values", () -> {
            var input = "orders{id@1, user_id->users}:\nAlice\nBob\n";
            var result = DhoomCodec.decode(input);
            var arr = result.asObject().get("orders").asArray();
            assertEqual("Alice", arr.get(0).asObject().get("user_id").asString());
            assertEqual("Bob", arr.get(1).asObject().get("user_id").asString());
        });

        // --- Summary ---
        System.out.println("\n=== Results: " + passed + " passed, " + failed + " failed, " + (passed + failed) + " total ===\n");
        if (failed > 0) System.exit(1);
    }
}
