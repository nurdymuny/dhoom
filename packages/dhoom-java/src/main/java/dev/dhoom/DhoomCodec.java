// DHOOM — Davis Human-readable Optimized Object Markup
// A compact, human-readable serialization format built on fiber bundle geometry.

package dev.dhoom;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class DhoomCodec {

    private DhoomCodec() {}

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    public enum ModifierType { ARITHMETIC, DEFAULT, NESTED, DELTA, MORPHISM, INTERNED, COMPUTED, CONSTRAINT }

    public record Modifier(ModifierType type, JsonValue start, Integer step, JsonValue defaultValue, String target,
                           List<String> pool, String expr, String constraint) {
        public Modifier(ModifierType type) { this(type, null, null, null, null, null, null, null); }
        public Modifier(ModifierType type, JsonValue start, Integer step, JsonValue defaultValue) { this(type, start, step, defaultValue, null, null, null, null); }
        public Modifier(ModifierType type, JsonValue start, Integer step, JsonValue defaultValue, String target) { this(type, start, step, defaultValue, target, null, null, null); }
    }

    public record FieldDecl(String name, Modifier modifier) {
        public FieldDecl(String name) { this(name, null); }
    }

    public record Fiber(String name, List<FieldDecl> fields, boolean sparse) {
        public Fiber(String name, List<FieldDecl> fields) { this(name, fields, false); }
    }

    // -----------------------------------------------------------------------
    // Value coercion
    // -----------------------------------------------------------------------

    private static JsonValue coerce(String s) {
        if (s.equals("T")) return JsonValue.of(true);
        if (s.equals("F")) return JsonValue.of(false);
        if (s.equals("null")) return JsonValue.ofNull();
        if (s.isEmpty()) return JsonValue.of("");
        if (s.matches("^-?\\d+$")) {
            try { return JsonValue.of(Long.parseLong(s)); }
            catch (NumberFormatException e) { return JsonValue.of(s); }
        }
        if (s.matches("^-?\\d+\\.\\d+$")) {
            try { return JsonValue.of(Double.parseDouble(s)); }
            catch (NumberFormatException e) { return JsonValue.of(s); }
        }
        return JsonValue.of(s);
    }

    private static String valueToDhoom(JsonValue v) {
        if (v == null || v.isNull()) return "null";
        if (v.isBoolean()) return v.asBoolean() ? "T" : "F";
        if (v.isLong()) return String.valueOf(v.asLong());
        if (v.isDouble()) return String.valueOf(v.asDouble());
        if (v.isString()) {
            String s = v.asString();
            if (s.contains(",") || s.contains(":") || s.contains("\n") || s.contains("\"")) {
                return "\"" + s.replace("\"", "\"\"") + "\"";
            }
            return s;
        }
        return "";
    }

    // -----------------------------------------------------------------------
    // Arithmetic helpers
    // -----------------------------------------------------------------------

    private static final Pattern STRING_PATTERN = Pattern.compile("^(.*\\D)(\\d+)$");

    private record StringPat(String prefix, int num, int width) {}

    private static StringPat parseStringPattern(String s) {
        Matcher m = STRING_PATTERN.matcher(s);
        if (!m.matches()) return null;
        return new StringPat(m.group(1), Integer.parseInt(m.group(2)), m.group(2).length());
    }

    private static JsonValue arithmeticValue(JsonValue start, int step, int i) {
        if (start.isLong()) return JsonValue.of(start.asLong() + (long) step * i);
        if (start.isDouble()) return JsonValue.of(start.asDouble() + step * i);
        if (start.isString()) {
            StringPat pat = parseStringPattern(start.asString());
            if (pat != null) {
                int val = pat.num + step * i;
                return JsonValue.of(pat.prefix + String.format("%0" + pat.width + "d", val));
            }
            return start;
        }
        return start;
    }

    // -----------------------------------------------------------------------
    // Fiber parser
    // -----------------------------------------------------------------------

    private static FieldDecl parseFieldDecl(String token) {
        // Morphism: field->target (must check before nested '>')
        int arrowIdx = token.indexOf("->");
        if (arrowIdx != -1) {
            return new FieldDecl(token.substring(0, arrowIdx),
                    new Modifier(ModifierType.MORPHISM, null, null, null, token.substring(arrowIdx + 2)));
        }

        // Computed: field#expr
        int hashIdx = token.indexOf('#');
        if (hashIdx != -1) {
            return new FieldDecl(token.substring(0, hashIdx),
                    new Modifier(ModifierType.COMPUTED, null, null, null, null, null, token.substring(hashIdx + 1), null));
        }

        // Constraint: field!constraint
        int bangIdx = token.indexOf('!');
        if (bangIdx != -1) {
            return new FieldDecl(token.substring(0, bangIdx),
                    new Modifier(ModifierType.CONSTRAINT, null, null, null, null, null, null, token.substring(bangIdx + 1)));
        }

        // Interned: field&
        if (token.endsWith("&")) {
            return new FieldDecl(token.substring(0, token.length() - 1),
                    new Modifier(ModifierType.INTERNED));
        }

        // Delta: field^
        if (token.endsWith("^")) {
            return new FieldDecl(token.substring(0, token.length() - 1),
                    new Modifier(ModifierType.DELTA));
        }

        // Nested: field>
        if (token.endsWith(">")) {
            return new FieldDecl(token.substring(0, token.length() - 1),
                    new Modifier(ModifierType.NESTED));
        }

        // Arithmetic: field@start or field@start+step
        int atIdx = token.indexOf('@');
        if (atIdx != -1) {
            String name = token.substring(0, atIdx);
            String rest = token.substring(atIdx + 1);
            int plusIdx = rest.indexOf('+');
            if (plusIdx != -1) {
                JsonValue start = coerce(rest.substring(0, plusIdx));
                int step = Integer.parseInt(rest.substring(plusIdx + 1));
                return new FieldDecl(name,
                        new Modifier(ModifierType.ARITHMETIC, start, step, null));
            }
            return new FieldDecl(name,
                    new Modifier(ModifierType.ARITHMETIC, coerce(rest), null, null));
        }

        // Default: field|value
        int pipeIdx = token.indexOf('|');
        if (pipeIdx != -1) {
            String name = token.substring(0, pipeIdx);
            JsonValue defaultValue = coerce(token.substring(pipeIdx + 1));
            return new FieldDecl(name,
                    new Modifier(ModifierType.DEFAULT, null, null, defaultValue));
        }

        return new FieldDecl(token);
    }

    public static Fiber parseFiber(String input) {
        input = input.trim();
        int braceStart = input.indexOf('{');
        int braceEnd = input.lastIndexOf('}');
        if (braceStart == -1 || braceEnd == -1) {
            throw new DhoomException("Missing braces in fiber header");
        }

        String name = braceStart > 0 ? input.substring(0, braceStart).trim() : null;
        if (name != null && name.isEmpty()) name = null;
        boolean sparse = false;
        if (name != null && name.startsWith("~")) {
            sparse = true;
            name = name.substring(1);
            if (name.isEmpty()) name = null;
        }
        String fieldsStr = input.substring(braceStart + 1, braceEnd);
        List<FieldDecl> fields = new ArrayList<>();
        for (String part : fieldsStr.split(",")) {
            String t = part.trim();
            if (!t.isEmpty()) fields.add(parseFieldDecl(t));
        }

        return new Fiber(name, fields, sparse);
    }

    // -----------------------------------------------------------------------
    // Record field splitter (respects quotes)
    // -----------------------------------------------------------------------

    private static List<String> splitRecordFields(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        current.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current.append(c);
                }
            } else if (c == '"') {
                inQuotes = true;
            } else if (c == ',') {
                fields.add(current.toString().trim());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString().trim());
        return fields;
    }

    // -----------------------------------------------------------------------
    // Decoder
    // -----------------------------------------------------------------------

    private static int findHeaderEnd(String input) {
        int brace = input.indexOf('}');
        if (brace == -1) return -1;
        int colon = input.indexOf(':', brace + 1);
        if (colon == -1) return -1;
        return colon + 1;
    }

    private static List<FieldDecl> recordFields(Fiber fiber) {
        return fiber.fields().stream()
                .filter(f -> f.modifier() == null ||
                        (f.modifier().type() != ModifierType.ARITHMETIC && f.modifier().type() != ModifierType.COMPUTED))
                .toList();
    }

    private static List<JsonValue> decodeFlatRecords(String body, Fiber fiber) {
        List<FieldDecl> recFields = recordFields(fiber);
        List<JsonValue> records = new ArrayList<>();
        int ordinal = 0;
        Map<String, Double> deltaAccum = new HashMap<>();

        for (String line : body.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;

            List<String> raw = splitRecordFields(trimmed);
            var obj = JsonValue.emptyObject();

            // Arithmetic fields
            for (FieldDecl fd : fiber.fields()) {
                if (fd.modifier() != null && fd.modifier().type() == ModifierType.ARITHMETIC) {
                    obj.put(fd.name(), arithmeticValue(fd.modifier().start(),
                            fd.modifier().step() != null ? fd.modifier().step() : 1, ordinal));
                }
            }

            // Positional values
            for (int j = 0; j < recFields.size(); j++) {
                FieldDecl rf = recFields.get(j);
                if (j < raw.size()) {
                    String val = raw.get(j);
                    if (val.isEmpty()) {
                        if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT)
                            obj.put(rf.name(), rf.modifier().defaultValue());
                        else
                            obj.put(rf.name(), JsonValue.of(""));
                    } else if (val.startsWith(":")) {
                        obj.put(rf.name(), coerce(val.substring(1)));
                    } else {
                        obj.put(rf.name(), coerce(val));
                    }
                } else {
                    // Trailing elision
                    if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT)
                        obj.put(rf.name(), rf.modifier().defaultValue());
                }

                // Delta accumulation
                if (rf.modifier() != null && rf.modifier().type() == ModifierType.DELTA) {
                    JsonValue resolved = obj.get(rf.name());
                    if (resolved != null && resolved.isNumber()) {
                        double numVal = resolved.asDouble();
                        if (ordinal == 0) {
                            deltaAccum.put(rf.name(), numVal);
                        } else {
                            double accumulated = deltaAccum.getOrDefault(rf.name(), 0.0) + numVal;
                            deltaAccum.put(rf.name(), accumulated);
                            if (accumulated == Math.floor(accumulated)) {
                                obj.put(rf.name(), JsonValue.of((long) accumulated));
                            } else {
                                obj.put(rf.name(), JsonValue.of(accumulated));
                            }
                        }
                    }
                }
            }

            records.add(obj);
            ordinal++;
        }
        return records;
    }

    private static JsonValue decodeNestedRecords(String body, Fiber fiber) {
        List<FieldDecl> recFields = recordFields(fiber);
        List<JsonValue> records = new ArrayList<>();
        String[] lines = body.split("\n");
        int lineIdx = 0;
        int ordinal = 0;

        while (lineIdx < lines.length) {
            String trimmed = lines[lineIdx].trim();
            if (trimmed.isEmpty()) { lineIdx++; continue; }

            var obj = JsonValue.emptyObject();

            // Arithmetic fields
            for (FieldDecl fd : fiber.fields()) {
                if (fd.modifier() != null && fd.modifier().type() == ModifierType.ARITHMETIC) {
                    obj.put(fd.name(), arithmeticValue(fd.modifier().start(),
                            fd.modifier().step() != null ? fd.modifier().step() : 1, ordinal));
                }
            }

            // Parse parent record line
            List<String> raw = splitRecordFields(trimmed);
            List<FieldDecl> nestedFields = new ArrayList<>();
            int rfIdx = 0;

            for (FieldDecl rf : recFields) {
                if (rf.modifier() != null && rf.modifier().type() == ModifierType.NESTED) {
                    nestedFields.add(rf);
                } else {
                    if (rfIdx < raw.size()) {
                        String val = raw.get(rfIdx);
                        if (val.isEmpty()) {
                            if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT)
                                obj.put(rf.name(), rf.modifier().defaultValue());
                            else
                                obj.put(rf.name(), JsonValue.of(""));
                        } else if (val.startsWith(":")) {
                            obj.put(rf.name(), coerce(val.substring(1)));
                        } else {
                            obj.put(rf.name(), coerce(val));
                        }
                    } else if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT) {
                        obj.put(rf.name(), rf.modifier().defaultValue());
                    }
                    rfIdx++;
                }
            }

            lineIdx++;

            // Parse nested bundles
            for (FieldDecl nf : nestedFields) {
                StringBuilder nestedText = new StringBuilder();
                while (lineIdx < lines.length) {
                    String l = lines[lineIdx];
                    if (!l.isEmpty() && !l.startsWith(" ") && !l.startsWith("\t") && !nestedText.isEmpty()) break;
                    if (l.trim().isEmpty() && nestedText.isEmpty()) { lineIdx++; continue; }
                    if (nestedText.toString().contains("}:\n") && l.trim().startsWith("{")) break;
                    nestedText.append(l.trim()).append("\n");
                    lineIdx++;
                }

                String nt = nestedText.toString().trim();
                if (!nt.isEmpty()) {
                    DecodeResult dr = decodeBundle(nt);
                    obj.put(nf.name(), dr.value);
                }
            }

            records.add(obj);
            ordinal++;
        }
        return JsonValue.ofArray(records);
    }

    private static List<JsonValue> decodeSparseRecords(String body, Fiber fiber) {
        List<FieldDecl> recFields = recordFields(fiber);
        List<JsonValue> records = new ArrayList<>();
        int ordinal = 0;

        for (String line : body.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;

            var obj = JsonValue.emptyObject();

            // Arithmetic fields
            for (FieldDecl fd : fiber.fields()) {
                if (fd.modifier() != null && fd.modifier().type() == ModifierType.ARITHMETIC) {
                    obj.put(fd.name(), arithmeticValue(fd.modifier().start(),
                            fd.modifier().step() != null ? fd.modifier().step() : 1, ordinal));
                }
            }

            // Defaults for missing fields
            for (FieldDecl rf : recFields) {
                if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT)
                    obj.put(rf.name(), rf.modifier().defaultValue());
                else
                    obj.put(rf.name(), JsonValue.ofNull());
            }

            // Parse name:value pairs
            List<String> pairs = splitRecordFields(trimmed);
            for (String pair : pairs) {
                int colonIdx = pair.indexOf(':');
                if (colonIdx == -1) continue;
                String fieldName = pair.substring(0, colonIdx).trim();
                String fieldVal = pair.substring(colonIdx + 1).trim();
                obj.put(fieldName, coerce(fieldVal));
            }

            records.add(obj);
            ordinal++;
        }
        return records;
    }

    private record DecodeResult(String name, JsonValue value) {}

    private static final Pattern POOL_RX = Pattern.compile("^&(\\w[\\w-]*)\\[(.+)]$");
    private static final Pattern COMPUTED_EXPR_RX = Pattern.compile("^(\\w[\\w-]*)\\s*([+\\-*])\\s*(\\w[\\w-]*)$");

    private static DecodeResult decodeBundle(String input) {
        int headerEnd = findHeaderEnd(input);
        if (headerEnd == -1) throw new DhoomException("Missing '}:' header terminator");

        String header = input.substring(0, headerEnd - 1).trim();
        String body = input.substring(headerEnd);
        Fiber fiber = parseFiber(header);

        // Parse pool lines
        String[] bodyLines = body.split("\n");
        List<String> remaining = new ArrayList<>();
        List<FieldDecl> mutableFields = new ArrayList<>(fiber.fields());
        for (String line : bodyLines) {
            String trimmed = line.trim();
            Matcher pm = POOL_RX.matcher(trimmed);
            if (pm.matches()) {
                String poolField = pm.group(1);
                String[] poolVals = pm.group(2).split(",");
                List<String> pool = new ArrayList<>();
                for (String pv : poolVals) pool.add(pv.trim());
                for (int i = 0; i < mutableFields.size(); i++) {
                    FieldDecl fd = mutableFields.get(i);
                    if (fd.name().equals(poolField) && fd.modifier() != null && fd.modifier().type() == ModifierType.INTERNED) {
                        mutableFields.set(i, new FieldDecl(fd.name(),
                                new Modifier(ModifierType.INTERNED, null, null, null, null, pool, null, null)));
                    }
                }
            } else {
                remaining.add(line);
            }
        }
        fiber = new Fiber(fiber.name(), mutableFields, fiber.sparse());
        body = String.join("\n", remaining);

        List<FieldDecl> recFields = recordFields(fiber);
        boolean hasNested = recFields.stream()
                .anyMatch(f -> f.modifier() != null && f.modifier().type() == ModifierType.NESTED);

        List<JsonValue> records;
        if (fiber.sparse()) {
            records = decodeSparseRecords(body, fiber);
        } else if (hasNested) {
            JsonValue nested = decodeNestedRecords(body, fiber);
            records = nested.asArray();
        } else {
            records = decodeFlatRecords(body, fiber);
        }

        // Post-decode: resolve interned fields
        for (FieldDecl fd : fiber.fields()) {
            if (fd.modifier() != null && fd.modifier().type() == ModifierType.INTERNED && fd.modifier().pool() != null) {
                List<String> pool = fd.modifier().pool();
                for (JsonValue rec : records) {
                    JsonValue val = rec.get(fd.name());
                    if (val != null && val.isNumber()) {
                        long idx = val.asLong();
                        if (idx >= 0 && idx < pool.size()) {
                            rec.put(fd.name(), JsonValue.of(pool.get((int) idx)));
                        }
                    }
                }
            }
        }

        // Post-decode: evaluate computed fields
        for (FieldDecl fd : fiber.fields()) {
            if (fd.modifier() != null && fd.modifier().type() == ModifierType.COMPUTED && fd.modifier().expr() != null) {
                Matcher cm = COMPUTED_EXPR_RX.matcher(fd.modifier().expr());
                if (cm.matches()) {
                    String leftName = cm.group(1);
                    String op = cm.group(2);
                    String rightName = cm.group(3);
                    for (JsonValue rec : records) {
                        JsonValue leftVal = rec.get(leftName);
                        JsonValue rightVal = rec.get(rightName);
                        if (leftVal != null && leftVal.isNumber() && rightVal != null && rightVal.isNumber()) {
                            double a = leftVal.asDouble();
                            double b = rightVal.asDouble();
                            double result = switch (op) {
                                case "+" -> a + b;
                                case "-" -> a - b;
                                case "*" -> a * b;
                                default -> 0;
                            };
                            if (result == Math.floor(result)) {
                                rec.put(fd.name(), JsonValue.of((long) result));
                            } else {
                                rec.put(fd.name(), JsonValue.of(result));
                            }
                        }
                    }
                }
            }
        }

        JsonValue value = JsonValue.ofArray(records);
        return new DecodeResult(fiber.name(), value);
    }

    /** Decode a DHOOM string into a JsonValue. */
    public static JsonValue decode(String input) {
        if (input == null) return null;
        input = input.trim();
        if (input.isEmpty()) return null;

        DecodeResult dr = decodeBundle(input);
        if (dr.name != null) {
            var obj = JsonValue.emptyObject();
            obj.put(dr.name, dr.value);
            return obj;
        }
        return dr.value;
    }

    // -----------------------------------------------------------------------
    // Encoder
    // -----------------------------------------------------------------------

    private static record ArithResult(JsonValue start, int step) {}

    private static ArithResult detectArithmetic(List<JsonValue> values) {
        if (values.size() < 2) return null;

        // Numeric
        if (values.stream().allMatch(v -> v.isNumber() && !v.isBoolean())) {
            double[] nums = values.stream().mapToDouble(JsonValue::asDouble).toArray();
            double step = nums[1] - nums[0];
            boolean allMatch = true;
            for (int i = 1; i < nums.length; i++) {
                if (Math.abs(nums[i] - nums[i - 1] - step) > 1e-9) { allMatch = false; break; }
            }
            if (allMatch) {
                int stepInt = (int) step;
                return new ArithResult(values.get(0), stepInt);
            }
        }

        // String pattern
        if (values.stream().allMatch(JsonValue::isString)) {
            List<StringPat> pats = values.stream()
                    .map(v -> parseStringPattern(v.asString()))
                    .toList();
            if (pats.stream().allMatch(Objects::nonNull)) {
                StringPat first = pats.get(0);
                boolean samePrefix = pats.stream().allMatch(p -> p.prefix.equals(first.prefix) && p.width == first.width);
                if (samePrefix) {
                    int step = pats.get(1).num - pats.get(0).num;
                    boolean allMatch = true;
                    for (int i = 1; i < pats.size(); i++) {
                        if (pats.get(i).num - pats.get(i - 1).num != step) { allMatch = false; break; }
                    }
                    if (allMatch) return new ArithResult(values.get(0), step);
                }
            }
        }

        return null;
    }

    private record ModalResult(JsonValue value, int count) {}

    private static ModalResult findModalDefault(List<JsonValue> values) {
        if (values.isEmpty()) return null;
        Map<String, ModalResult> counts = new LinkedHashMap<>();
        for (JsonValue v : values) {
            String key = v.toJson();
            var existing = counts.get(key);
            if (existing != null) {
                counts.put(key, new ModalResult(v, existing.count + 1));
            } else {
                counts.put(key, new ModalResult(v, 1));
            }
        }
        ModalResult best = null;
        for (var entry : counts.values()) {
            if (best == null || entry.count > best.count) best = entry;
        }
        return best;
    }

    private static boolean jsonEqual(JsonValue a, JsonValue b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return a.toJson().equals(b.toJson());
    }

    private static boolean detectDelta(List<JsonValue> values) {
        if (values.size() < 3) return false;
        long[] nums = new long[values.size()];
        for (int i = 0; i < values.size(); i++) {
            JsonValue v = values.get(i);
            if (v.isBoolean() || !v.isNumber()) return false;
            double d = v.asDouble();
            if (d != Math.floor(d)) return false;
            nums[i] = (long) d;
        }
        long[] deltas = new long[nums.length];
        deltas[0] = nums[0];
        for (int i = 1; i < nums.length; i++) deltas[i] = nums[i] - nums[i - 1];
        int absLen = 0;
        for (long n : nums) absLen += String.valueOf(n).length();
        int deltaLen = 0;
        for (long d : deltas) deltaLen += String.valueOf(d).length();
        return deltaLen < absLen * 0.7;
    }

    private static List<String> detectInterned(List<JsonValue> values) {
        if (values.size() < 3) return null;
        for (JsonValue v : values) {
            if (v == null || !v.isString()) return null;
        }
        List<String> strs = values.stream().map(JsonValue::asString).toList();
        List<String> distinct = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String s : strs) {
            if (seen.add(s)) distinct.add(s);
        }
        int maxDistinct = (int) Math.ceil(values.size() / 3.0);
        if (distinct.size() < 2 || distinct.size() > maxDistinct) return null;
        int rawLen = strs.stream().mapToInt(String::length).sum();
        int poolLen = distinct.stream().mapToInt(String::length).sum() + distinct.size() - 1;
        int indexLen = values.size();
        if (poolLen + indexLen >= rawLen * 0.9) return null;
        return distinct;
    }

    private static String detectComputed(String key, List<JsonValue> values, List<String> allKeys, List<JsonValue> records) {
        if (values.isEmpty()) return null;
        for (JsonValue v : values) {
            if (v == null || v.isBoolean() || !v.isNumber()) return null;
        }
        String[] ops = {"+", "-", "*"};
        for (String op : ops) {
            for (String a : allKeys) {
                if (a.equals(key)) continue;
                for (String b : allKeys) {
                    if (b.equals(key)) continue;
                    boolean match = true;
                    for (JsonValue r : records) {
                        JsonValue av = r.get(a), bv = r.get(b), kv = r.get(key);
                        if (av == null || !av.isNumber() || bv == null || !bv.isNumber() || kv == null || !kv.isNumber()) {
                            match = false;
                            break;
                        }
                        double expected = switch (op) {
                            case "+" -> av.asDouble() + bv.asDouble();
                            case "-" -> av.asDouble() - bv.asDouble();
                            case "*" -> av.asDouble() * bv.asDouble();
                            default -> 0;
                        };
                        if (kv.asDouble() != expected) { match = false; break; }
                    }
                    if (match) return a + op + b;
                }
            }
        }
        return null;
    }

    private static String encodeBundle(String name, List<JsonValue> records, int indent) {
        String prefix = " ".repeat(indent);
        if (records.isEmpty()) return prefix + name + "{}:\n";

        JsonValue first = records.get(0);
        List<String> keys = new ArrayList<>(first.keys());
        List<FieldDecl> orderedFields = new ArrayList<>();
        Set<String> arithmeticKeys = new HashSet<>();
        Set<String> deltaKeys = new LinkedHashSet<>();
        Map<String, JsonValue> defaultKeys = new LinkedHashMap<>();
        Set<String> nestedKeys = new LinkedHashSet<>();
        Map<String, List<String>> internedKeys = new LinkedHashMap<>();
        Map<String, String> computedKeys = new LinkedHashMap<>();
        List<String> variableKeys = new ArrayList<>();

        // Phase 1: categorize nested + arithmetic
        List<String> remainingKeys = new ArrayList<>();
        for (String key : keys) {
            List<JsonValue> values = records.stream().map(r -> r.get(key)).toList();

            // Nested
            if (values.stream().allMatch(v -> v != null && v.isArray())) {
                nestedKeys.add(key);
                continue;
            }

            // Arithmetic
            ArithResult arith = detectArithmetic(values);
            if (arith != null) {
                arithmeticKeys.add(key);
                orderedFields.add(new FieldDecl(key,
                        new Modifier(ModifierType.ARITHMETIC, arith.start, arith.step != 1 ? arith.step : null, null)));
                continue;
            }

            remainingKeys.add(key);
        }

        // Phase 2: detect computed fields among ALL remaining keys
        List<String> computedToRemove = new ArrayList<>();
        for (String key : remainingKeys) {
            List<JsonValue> values = records.stream().map(r -> r.get(key)).toList();
            String expr = detectComputed(key, values, remainingKeys, records);
            if (expr != null) {
                computedKeys.put(key, expr);
                computedToRemove.add(key);
            }
        }
        remainingKeys.removeAll(computedToRemove);

        // Phase 3: categorize remaining as delta, interned, default, or variable
        for (String key : remainingKeys) {
            List<JsonValue> values = records.stream().map(r -> r.get(key)).toList();

            // Delta
            if (detectDelta(values)) {
                deltaKeys.add(key);
                continue;
            }

            // Interned
            List<String> pool = detectInterned(values);
            if (pool != null) {
                internedKeys.put(key, pool);
                continue;
            }

            // Modal default
            ModalResult modal = findModalDefault(values);
            if (modal != null && modal.count > records.size() / 2) {
                defaultKeys.put(key, modal.value);
                continue;
            }

            variableKeys.add(key);
        }

        // Ensure at least one field produces record body content
        if (variableKeys.isEmpty() && deltaKeys.isEmpty() && nestedKeys.isEmpty() && internedKeys.isEmpty()) {
            for (String key : keys) {
                if (arithmeticKeys.contains(key)) {
                    arithmeticKeys.remove(key);
                    orderedFields.removeIf(f -> f.name().equals(key));
                    variableKeys.add(key);
                    break;
                }
                if (computedKeys.containsKey(key)) {
                    computedKeys.remove(key);
                    variableKeys.add(key);
                    break;
                }
                if (defaultKeys.containsKey(key)) {
                    defaultKeys.remove(key);
                    variableKeys.add(key);
                    break;
                }
            }
        }

        // Computed fields
        for (String key : keys) {
            if (computedKeys.containsKey(key)) {
                orderedFields.add(new FieldDecl(key,
                        new Modifier(ModifierType.COMPUTED, null, null, null, null, null, computedKeys.get(key), null)));
            }
        }

        // Delta fields
        for (String key : keys) {
            if (deltaKeys.contains(key)) {
                orderedFields.add(new FieldDecl(key, new Modifier(ModifierType.DELTA)));
            }
        }

        // Interned fields
        for (String key : keys) {
            if (internedKeys.containsKey(key)) {
                orderedFields.add(new FieldDecl(key,
                        new Modifier(ModifierType.INTERNED, null, null, null, null, internedKeys.get(key), null, null)));
            }
        }

        // Variable fields
        for (String key : variableKeys) {
            orderedFields.add(new FieldDecl(key));
        }

        // Default fields sorted by frequency desc
        List<Map.Entry<String, JsonValue>> defaultEntries = new ArrayList<>(defaultKeys.entrySet());
        defaultEntries.sort((a, b) -> {
            long ca = records.stream().filter(r -> jsonEqual(r.get(a.getKey()), a.getValue())).count();
            long cb = records.stream().filter(r -> jsonEqual(r.get(b.getKey()), b.getValue())).count();
            return Long.compare(cb, ca);
        });

        for (var entry : defaultEntries) {
            orderedFields.add(new FieldDecl(entry.getKey(),
                    new Modifier(ModifierType.DEFAULT, null, null, entry.getValue())));
        }

        // Nested fields
        for (String key : keys) {
            if (nestedKeys.contains(key)) {
                orderedFields.add(new FieldDecl(key, new Modifier(ModifierType.NESTED)));
            }
        }

        // Check sparsity
        List<String> nonArithKeys = keys.stream()
                .filter(k -> !arithmeticKeys.contains(k) && !nestedKeys.contains(k) && !computedKeys.containsKey(k))
                .toList();
        boolean useSparse = false;
        if (nonArithKeys.size() >= 8) {
            int nullCount = 0, totalCells = 0;
            for (JsonValue r : records) {
                for (String k : nonArithKeys) {
                    totalCells++;
                    JsonValue v = r.get(k);
                    if (v == null || v.isNull() || (v.isString() && v.asString().isEmpty())) nullCount++;
                }
            }
            useSparse = nullCount > totalCells * 0.75;
        }

        // Build header
        String sparsePrefix = useSparse ? "~" : "";
        var sb = new StringBuilder();
        sb.append(prefix).append(sparsePrefix).append(name).append("{");
        List<String> headerParts = new ArrayList<>();
        for (FieldDecl fd : orderedFields) {
            String s = fd.name();
            if (fd.modifier() != null) {
                switch (fd.modifier().type()) {
                    case ARITHMETIC -> {
                        s += "@" + valueToDhoom(fd.modifier().start());
                        if (fd.modifier().step() != null) s += "+" + fd.modifier().step();
                    }
                    case DEFAULT -> s += "|" + valueToDhoom(fd.modifier().defaultValue());
                    case NESTED -> s += ">";
                    case DELTA -> s += "^";
                    case MORPHISM -> s += "->" + fd.modifier().target();
                    case INTERNED -> s += "&";
                    case COMPUTED -> s += "#" + fd.modifier().expr();
                    case CONSTRAINT -> s += "!" + fd.modifier().constraint();
                }
            }
            headerParts.add(s);
        }
        sb.append(String.join(", ", headerParts)).append("}:\n");

        // Emit pool lines
        for (String key : keys) {
            if (internedKeys.containsKey(key)) {
                sb.append(prefix).append("&").append(key).append("[").append(String.join(", ", internedKeys.get(key))).append("]\n");
            }
        }

        // Emit records
        List<FieldDecl> recFieldsList = orderedFields.stream()
                .filter(f -> f.modifier() == null ||
                        (f.modifier().type() != ModifierType.ARITHMETIC && f.modifier().type() != ModifierType.COMPUTED))
                .toList();

        if (useSparse) {
            for (JsonValue record : records) {
                List<String> pairs = new ArrayList<>();
                for (FieldDecl rf : recFieldsList) {
                    if (rf.modifier() != null && rf.modifier().type() == ModifierType.NESTED) continue;
                    JsonValue val = record.get(rf.name());
                    if (val != null && !val.isNull() && !(val.isString() && val.asString().isEmpty())) {
                        pairs.add(rf.name() + ":" + valueToDhoom(val));
                    }
                }
                if (pairs.isEmpty()) {
                    FieldDecl firstField = recFieldsList.stream()
                            .filter(f -> f.modifier() == null || f.modifier().type() != ModifierType.NESTED)
                            .findFirst().orElse(null);
                    if (firstField != null) pairs.add(firstField.name() + ":null");
                }
                sb.append(prefix).append(String.join(", ", pairs)).append("\n");
            }
            return sb.toString();
        }

        int recordIdx = 0;
        Map<String, Double> prevDelta = new HashMap<>();

        for (JsonValue record : records) {
            List<String> values = new ArrayList<>();
            List<JsonValue> nestedBundles = new ArrayList<>();
            List<String> nestedBundleNames = new ArrayList<>();

            for (FieldDecl rf : recFieldsList) {
                if (rf.modifier() != null && rf.modifier().type() == ModifierType.NESTED) {
                    JsonValue v = record.get(rf.name());
                    if (v != null && v.isArray()) {
                        nestedBundles.add(v);
                        nestedBundleNames.add("");
                    }
                    continue;
                }

                JsonValue val = record.get(rf.name());

                if (rf.modifier() != null && rf.modifier().type() == ModifierType.DELTA) {
                    double numVal = (val != null && val.isNumber()) ? val.asDouble() : 0;
                    if (recordIdx == 0) {
                        prevDelta.put(rf.name(), numVal);
                        values.add(valueToDhoom(val));
                    } else {
                        double prev = prevDelta.getOrDefault(rf.name(), 0.0);
                        double delta = numVal - prev;
                        prevDelta.put(rf.name(), numVal);
                        if (delta == Math.floor(delta)) {
                            values.add(String.valueOf((long) delta));
                        } else {
                            values.add(String.valueOf(delta));
                        }
                    }
                } else if (rf.modifier() != null && rf.modifier().type() == ModifierType.INTERNED && rf.modifier().pool() != null) {
                    if (val != null && val.isString()) {
                        int idx = rf.modifier().pool().indexOf(val.asString());
                        if (idx >= 0) {
                            values.add(String.valueOf(idx));
                        } else {
                            values.add(valueToDhoom(val));
                        }
                    } else {
                        values.add(valueToDhoom(val));
                    }
                } else if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT) {
                    if (jsonEqual(val, rf.modifier().defaultValue())) {
                        values.add("");
                    } else {
                        values.add(":" + valueToDhoom(val));
                    }
                } else {
                    values.add(valueToDhoom(val));
                }
            }

            // Trailing elision
            while (!values.isEmpty() && values.get(values.size() - 1).isEmpty()) {
                values.remove(values.size() - 1);
            }

            sb.append(prefix).append(String.join(", ", values));

            if (!nestedBundles.isEmpty()) {
                sb.append(",\n");
                for (int i = 0; i < nestedBundles.size(); i++) {
                    JsonValue nbArr = nestedBundles.get(i);
                    List<JsonValue> nbRecords = nbArr.asArray();
                    sb.append(encodeBundle(nestedBundleNames.get(i), nbRecords, indent + 2));
                }
            } else {
                sb.append("\n");
            }

            recordIdx++;
        }

        return sb.toString();
    }

    /** Encode a JsonValue into DHOOM format. */
    public static String encode(JsonValue value) {
        if (value != null && value.isObject()) {
            List<String> keys = new ArrayList<>(value.keys());
            if (keys.size() == 1 && value.get(keys.get(0)).isArray()) {
                return encodeBundle(keys.get(0), value.get(keys.get(0)).asArray(), 0);
            }
            throw new DhoomException("Top-level object must have exactly one key (the bundle name)");
        }
        if (value != null && value.isArray()) {
            return encodeBundle("data", value.asArray(), 0);
        }
        throw new DhoomException("Top-level value must be an object or array");
    }
}
