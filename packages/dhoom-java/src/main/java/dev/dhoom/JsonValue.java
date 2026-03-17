// Minimal JSON value model for DHOOM — zero external dependencies.

package dev.dhoom;

import java.util.*;

/**
 * A lightweight JSON value representation.
 * Values can be: null, boolean, number (long or double), string,
 * array (List), or object (LinkedHashMap preserving insertion order).
 */
public final class JsonValue {
    private final Object value; // null | Boolean | Long | Double | String | List<JsonValue> | LinkedHashMap<String,JsonValue>

    private JsonValue(Object v) { this.value = v; }

    // --- Factories ---

    public static JsonValue ofNull() { return new JsonValue(null); }
    public static JsonValue of(boolean b) { return new JsonValue(b); }
    public static JsonValue of(long n) { return new JsonValue(n); }
    public static JsonValue of(double n) { return new JsonValue(n); }
    public static JsonValue of(String s) { return new JsonValue(Objects.requireNonNull(s)); }
    public static JsonValue ofArray(List<JsonValue> items) { return new JsonValue(new ArrayList<>(items)); }
    public static JsonValue ofObject(LinkedHashMap<String, JsonValue> map) { return new JsonValue(new LinkedHashMap<>(map)); }

    public static JsonValue emptyArray() { return new JsonValue(new ArrayList<>()); }
    public static JsonValue emptyObject() { return new JsonValue(new LinkedHashMap<>()); }

    // --- Type checks ---

    public boolean isNull()    { return value == null; }
    public boolean isBoolean() { return value instanceof Boolean; }
    public boolean isLong()    { return value instanceof Long; }
    public boolean isDouble()  { return value instanceof Double; }
    public boolean isNumber()  { return value instanceof Long || value instanceof Double; }
    public boolean isString()  { return value instanceof String; }
    public boolean isArray()   { return value instanceof List; }
    public boolean isObject()  { return value instanceof LinkedHashMap; }

    // --- Getters ---

    public boolean asBoolean() { return (Boolean) value; }
    public long asLong() {
        if (value instanceof Long l) return l;
        return ((Double) value).longValue();
    }
    public double asDouble() {
        if (value instanceof Double d) return d;
        return ((Long) value).doubleValue();
    }
    public Number asNumber() { return (Number) value; }
    public String asString() { return (String) value; }

    @SuppressWarnings("unchecked")
    public List<JsonValue> asArray() { return (List<JsonValue>) value; }

    @SuppressWarnings("unchecked")
    public LinkedHashMap<String, JsonValue> asObject() { return (LinkedHashMap<String, JsonValue>) value; }

    // --- Object helpers ---

    public JsonValue get(String key) {
        return asObject().get(key);
    }

    public void put(String key, JsonValue v) {
        asObject().put(key, v);
    }

    public Set<String> keys() {
        return asObject().keySet();
    }

    public int size() {
        if (isArray()) return asArray().size();
        if (isObject()) return asObject().size();
        throw new UnsupportedOperationException("size() on non-container");
    }

    // --- Array helpers ---

    public JsonValue get(int index) {
        return asArray().get(index);
    }

    public void add(JsonValue v) {
        asArray().add(v);
    }

    // --- Serialization ---

    public String toJson() {
        if (value == null) return "null";
        if (value instanceof Boolean b) return b.toString();
        if (value instanceof Long l) return l.toString();
        if (value instanceof Double d) {
            if (d == Math.floor(d) && !Double.isInfinite(d) && d >= Long.MIN_VALUE && d <= Long.MAX_VALUE) {
                // Check if it was originally stored as double — keep decimal
                long lv = d.longValue();
                if (Math.abs(d - lv) < 1e-15 && d != lv) return String.valueOf(d);
                // If it looks like it has a fractional part in string form, preserve it
                String s = String.valueOf(d);
                if (s.contains(".")) return s;
                return s;
            }
            return String.valueOf(d);
        }
        if (value instanceof String s) return escapeJsonString(s);
        if (value instanceof List) {
            var sb = new StringBuilder("[");
            var arr = asArray();
            for (int i = 0; i < arr.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(arr.get(i).toJson());
            }
            sb.append("]");
            return sb.toString();
        }
        if (value instanceof LinkedHashMap) {
            var sb = new StringBuilder("{");
            var map = asObject();
            boolean first = true;
            for (var entry : map.entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append(escapeJsonString(entry.getKey()));
                sb.append(":");
                sb.append(entry.getValue().toJson());
            }
            sb.append("}");
            return sb.toString();
        }
        throw new IllegalStateException("Unknown value type");
    }

    private static String escapeJsonString(String s) {
        var sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }

    // --- Parser ---

    public static JsonValue parse(String json) {
        var parser = new JsonParser(json.trim());
        return parser.parseValue();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof JsonValue other)) return false;
        if (value == null) return other.value == null;
        // Numeric comparison: treat equal numeric values as equal regardless of Long/Double
        if (isNumber() && other.isNumber()) {
            return asDouble() == other.asDouble();
        }
        return value.equals(other.value);
    }

    @Override
    public int hashCode() {
        if (value == null) return 0;
        if (isNumber()) return Double.hashCode(asDouble());
        return value.hashCode();
    }

    @Override
    public String toString() { return toJson(); }

    // --- Minimal JSON parser ---

    private static class JsonParser {
        private final String input;
        private int pos;

        JsonParser(String input) {
            this.input = input;
            this.pos = 0;
        }

        JsonValue parseValue() {
            skipWhitespace();
            if (pos >= input.length()) throw new DhoomException("Unexpected end of JSON");
            char c = input.charAt(pos);
            return switch (c) {
                case '"' -> parseString();
                case '{' -> parseObject();
                case '[' -> parseArray();
                case 't', 'f' -> parseBoolean();
                case 'n' -> parseNull();
                default -> parseNumber();
            };
        }

        private JsonValue parseString() {
            pos++; // skip opening quote
            var sb = new StringBuilder();
            while (pos < input.length()) {
                char c = input.charAt(pos);
                if (c == '"') { pos++; return JsonValue.of(sb.toString()); }
                if (c == '\\') {
                    pos++;
                    char esc = input.charAt(pos);
                    switch (esc) {
                        case '"' -> sb.append('"');
                        case '\\' -> sb.append('\\');
                        case '/' -> sb.append('/');
                        case 'n' -> sb.append('\n');
                        case 'r' -> sb.append('\r');
                        case 't' -> sb.append('\t');
                        case 'u' -> {
                            String hex = input.substring(pos + 1, pos + 5);
                            sb.append((char) Integer.parseInt(hex, 16));
                            pos += 4;
                        }
                        default -> sb.append(esc);
                    }
                } else {
                    sb.append(c);
                }
                pos++;
            }
            throw new DhoomException("Unterminated JSON string");
        }

        private JsonValue parseObject() {
            pos++; // skip {
            var map = new LinkedHashMap<String, JsonValue>();
            skipWhitespace();
            if (pos < input.length() && input.charAt(pos) == '}') { pos++; return JsonValue.ofObject(map); }
            while (true) {
                skipWhitespace();
                if (input.charAt(pos) != '"') throw new DhoomException("Expected string key in JSON object at pos " + pos);
                String key = parseString().asString();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                map.put(key, parseValue());
                skipWhitespace();
                if (pos < input.length() && input.charAt(pos) == ',') { pos++; continue; }
                if (pos < input.length() && input.charAt(pos) == '}') { pos++; return JsonValue.ofObject(map); }
                throw new DhoomException("Expected ',' or '}' at pos " + pos);
            }
        }

        private JsonValue parseArray() {
            pos++; // skip [
            var list = new ArrayList<JsonValue>();
            skipWhitespace();
            if (pos < input.length() && input.charAt(pos) == ']') { pos++; return JsonValue.ofArray(list); }
            while (true) {
                skipWhitespace();
                list.add(parseValue());
                skipWhitespace();
                if (pos < input.length() && input.charAt(pos) == ',') { pos++; continue; }
                if (pos < input.length() && input.charAt(pos) == ']') { pos++; return JsonValue.ofArray(list); }
                throw new DhoomException("Expected ',' or ']' at pos " + pos);
            }
        }

        private JsonValue parseBoolean() {
            if (input.startsWith("true", pos)) { pos += 4; return JsonValue.of(true); }
            if (input.startsWith("false", pos)) { pos += 5; return JsonValue.of(false); }
            throw new DhoomException("Invalid boolean at pos " + pos);
        }

        private JsonValue parseNull() {
            if (input.startsWith("null", pos)) { pos += 4; return JsonValue.ofNull(); }
            throw new DhoomException("Invalid null at pos " + pos);
        }

        private JsonValue parseNumber() {
            int start = pos;
            if (pos < input.length() && input.charAt(pos) == '-') pos++;
            while (pos < input.length() && Character.isDigit(input.charAt(pos))) pos++;
            boolean isFloat = false;
            if (pos < input.length() && input.charAt(pos) == '.') {
                isFloat = true;
                pos++;
                while (pos < input.length() && Character.isDigit(input.charAt(pos))) pos++;
            }
            if (pos < input.length() && (input.charAt(pos) == 'e' || input.charAt(pos) == 'E')) {
                isFloat = true;
                pos++;
                if (pos < input.length() && (input.charAt(pos) == '+' || input.charAt(pos) == '-')) pos++;
                while (pos < input.length() && Character.isDigit(input.charAt(pos))) pos++;
            }
            String numStr = input.substring(start, pos);
            if (isFloat) return JsonValue.of(Double.parseDouble(numStr));
            return JsonValue.of(Long.parseLong(numStr));
        }

        private void skipWhitespace() {
            while (pos < input.length() && Character.isWhitespace(input.charAt(pos))) pos++;
        }

        private void expect(char c) {
            if (pos >= input.length() || input.charAt(pos) != c) throw new DhoomException("Expected '" + c + "' at pos " + pos);
            pos++;
        }
    }
}
