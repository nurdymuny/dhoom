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

    public enum ModifierType { ARITHMETIC, DEFAULT, NESTED }

    public record Modifier(ModifierType type, JsonValue start, Integer step, JsonValue defaultValue) {
        public Modifier(ModifierType type) { this(type, null, null, null); }
    }

    public record FieldDecl(String name, Modifier modifier) {
        public FieldDecl(String name) { this(name, null); }
    }

    public record Fiber(String name, List<FieldDecl> fields) {}

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
        String fieldsStr = input.substring(braceStart + 1, braceEnd);
        List<FieldDecl> fields = new ArrayList<>();
        for (String part : fieldsStr.split(",")) {
            String t = part.trim();
            if (!t.isEmpty()) fields.add(parseFieldDecl(t));
        }

        return new Fiber(name, fields);
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
                .filter(f -> f.modifier() == null || f.modifier().type() != ModifierType.ARITHMETIC)
                .toList();
    }

    private static List<JsonValue> decodeFlatRecords(String body, Fiber fiber) {
        List<FieldDecl> recFields = recordFields(fiber);
        List<JsonValue> records = new ArrayList<>();
        int ordinal = 0;

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

    private record DecodeResult(String name, JsonValue value) {}

    private static DecodeResult decodeBundle(String input) {
        int headerEnd = findHeaderEnd(input);
        if (headerEnd == -1) throw new DhoomException("Missing '}:' header terminator");

        String header = input.substring(0, headerEnd - 1).trim();
        String body = input.substring(headerEnd);
        Fiber fiber = parseFiber(header);

        List<FieldDecl> recFields = recordFields(fiber);
        boolean hasNested = recFields.stream()
                .anyMatch(f -> f.modifier() != null && f.modifier().type() == ModifierType.NESTED);

        JsonValue records;
        if (hasNested) {
            records = decodeNestedRecords(body, fiber);
        } else {
            records = JsonValue.ofArray(decodeFlatRecords(body, fiber));
        }

        return new DecodeResult(fiber.name(), records);
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

    private static String encodeBundle(String name, List<JsonValue> records, int indent) {
        String prefix = " ".repeat(indent);
        if (records.isEmpty()) return prefix + name + "{}:\n";

        JsonValue first = records.get(0);
        List<String> keys = new ArrayList<>(first.keys());
        List<FieldDecl> orderedFields = new ArrayList<>();
        Set<String> arithmeticKeys = new HashSet<>();
        Map<String, JsonValue> defaultKeys = new LinkedHashMap<>();
        Set<String> nestedKeys = new LinkedHashSet<>();
        List<String> variableKeys = new ArrayList<>();

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

            // Modal default
            ModalResult modal = findModalDefault(values);
            if (modal != null && modal.count > records.size() / 2) {
                defaultKeys.put(key, modal.value);
                continue;
            }

            variableKeys.add(key);
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

        // Build header
        var sb = new StringBuilder();
        sb.append(prefix).append(name).append("{");
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
                }
            }
            headerParts.add(s);
        }
        sb.append(String.join(", ", headerParts)).append("}:\n");

        // Emit records
        List<FieldDecl> recFieldsList = orderedFields.stream()
                .filter(f -> f.modifier() == null || f.modifier().type() != ModifierType.ARITHMETIC)
                .toList();

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
                if (rf.modifier() != null && rf.modifier().type() == ModifierType.DEFAULT) {
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
