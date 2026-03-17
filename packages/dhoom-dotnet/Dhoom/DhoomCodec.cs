// DHOOM — Davis Human-readable Optimized Object Markup
// A compact, human-readable serialization format built on fiber bundle geometry.

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Dhoom;

public class DhoomException : Exception
{
    public int? Line { get; }
    public DhoomException(string message, int? line = null)
        : base(line.HasValue ? $"Line {line}: {message}" : message)
    {
        Line = line;
    }
}

public enum ModifierType { Arithmetic, Default, Nested }

public record Modifier(ModifierType Type, JsonNode? Start = null, int? Step = null, JsonNode? DefaultValue = null);

public record FieldDecl(string Name, Modifier? Mod = null);

public record Fiber(string? Name, List<FieldDecl> Fields);

public static partial class DhoomCodec
{
    // -----------------------------------------------------------------------
    // Value coercion
    // -----------------------------------------------------------------------

    private static JsonNode? Coerce(string s)
    {
        if (s == "T") return JsonValue.Create(true);
        if (s == "F") return JsonValue.Create(false);
        if (s == "null") return null;
        if (s == "") return JsonValue.Create("");
        if (Regex.IsMatch(s, @"^-?\d+$") && long.TryParse(s, out var n))
            return JsonValue.Create(n);
        if (Regex.IsMatch(s, @"^-?\d+\.\d+$") && double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
            return JsonValue.Create(d);
        return JsonValue.Create(s);
    }

    private static string ValueToDhoom(JsonNode? v)
    {
        if (v is null) return "null";
        if (v is JsonValue jv)
        {
            if (jv.TryGetValue<bool>(out var b)) return b ? "T" : "F";
            if (jv.TryGetValue<long>(out var l)) return l.ToString();
            if (jv.TryGetValue<double>(out var dd)) return dd.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (jv.TryGetValue<string>(out var str))
            {
                if (str!.Contains(',') || str.Contains(':') || str.Contains('\n') || str.Contains('"'))
                    return "\"" + str.Replace("\"", "\"\"") + "\"";
                return str;
            }
        }
        return "";
    }

    // -----------------------------------------------------------------------
    // Arithmetic helpers
    // -----------------------------------------------------------------------

    private static readonly Regex StringPatternRx = new(@"^(.*\D)(\d+)$", RegexOptions.Compiled);

    private static (string prefix, int num, int width)? ParseStringPattern(string s)
    {
        var m = StringPatternRx.Match(s);
        if (!m.Success) return null;
        return (m.Groups[1].Value, int.Parse(m.Groups[2].Value), m.Groups[2].Value.Length);
    }

    private static JsonNode? ArithmeticValue(JsonNode? start, int step, int i)
    {
        if (start is JsonValue sv)
        {
            if (sv.TryGetValue<long>(out var l))
                return JsonValue.Create(l + step * i);
            if (sv.TryGetValue<double>(out var d))
                return JsonValue.Create(d + step * i);
            if (sv.TryGetValue<string>(out var s))
            {
                var pat = ParseStringPattern(s!);
                if (pat.HasValue)
                {
                    var val = pat.Value.num + step * i;
                    return JsonValue.Create(pat.Value.prefix + val.ToString().PadLeft(pat.Value.width, '0'));
                }
                return JsonValue.Create(s);
            }
        }
        return start?.DeepClone();
    }

    // -----------------------------------------------------------------------
    // Fiber parser
    // -----------------------------------------------------------------------

    private static FieldDecl ParseFieldDecl(string token)
    {
        token = token.Trim();

        if (token.EndsWith('>'))
            return new(token[..^1], new Modifier(ModifierType.Nested));

        var atIdx = token.IndexOf('@');
        if (atIdx != -1)
        {
            var name = token[..atIdx];
            var rest = token[(atIdx + 1)..];
            var plusIdx = rest.IndexOf('+');
            if (plusIdx != -1)
            {
                var start = Coerce(rest[..plusIdx]);
                var step = int.Parse(rest[(plusIdx + 1)..]);
                return new(name, new Modifier(ModifierType.Arithmetic, Start: start, Step: step));
            }
            return new(name, new Modifier(ModifierType.Arithmetic, Start: Coerce(rest)));
        }

        var pipeIdx = token.IndexOf('|');
        if (pipeIdx != -1)
        {
            var name = token[..pipeIdx];
            var defaultValue = Coerce(token[(pipeIdx + 1)..]);
            return new(name, new Modifier(ModifierType.Default, DefaultValue: defaultValue));
        }

        return new(token);
    }

    public static Fiber ParseFiber(string input)
    {
        input = input.Trim();
        var braceStart = input.IndexOf('{');
        var braceEnd = input.LastIndexOf('}');
        if (braceStart == -1 || braceEnd == -1)
            throw new DhoomException("Missing braces in fiber header");

        var name = braceStart > 0 ? input[..braceStart].Trim() : null;
        var fieldsStr = input[(braceStart + 1)..braceEnd];
        var fields = fieldsStr.Split(',')
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .Select(ParseFieldDecl)
            .ToList();

        return new(string.IsNullOrEmpty(name) ? null : name, fields);
    }

    // -----------------------------------------------------------------------
    // Record field splitter (respects quotes)
    // -----------------------------------------------------------------------

    private static List<string> SplitRecordFields(string line)
    {
        var fields = new List<string>();
        var current = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else inQuotes = false;
                }
                else current.Append(c);
            }
            else if (c == '"') inQuotes = true;
            else if (c == ',')
            {
                fields.Add(current.ToString().Trim());
                current.Clear();
            }
            else current.Append(c);
        }
        fields.Add(current.ToString().Trim());
        return fields;
    }

    // -----------------------------------------------------------------------
    // Decoder
    // -----------------------------------------------------------------------

    private static List<FieldDecl> RecordFields(Fiber fiber) =>
        fiber.Fields.Where(f => f.Mod?.Type != ModifierType.Arithmetic).ToList();

    private static int FindHeaderEnd(string input)
    {
        var brace = input.IndexOf('}');
        if (brace == -1) return -1;
        var colon = input.IndexOf(':', brace + 1);
        if (colon == -1) return -1;
        return colon + 1;
    }

    private static int GetStep(Modifier m) => m.Step ?? 1;

    private static bool JsonEqual(JsonNode? a, JsonNode? b)
    {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;
        return a.ToJsonString() == b.ToJsonString();
    }

    private static List<JsonNode?> DecodeFlatRecords(string body, Fiber fiber)
    {
        var recFields = RecordFields(fiber);
        var records = new List<JsonNode?>();
        int ordinal = 0;

        foreach (var line in body.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;

            var raw = SplitRecordFields(trimmed);
            var obj = new JsonObject();

            foreach (var fd in fiber.Fields)
            {
                if (fd.Mod?.Type == ModifierType.Arithmetic)
                    obj[fd.Name] = ArithmeticValue(fd.Mod.Start, GetStep(fd.Mod), ordinal);
            }

            for (int j = 0; j < recFields.Count; j++)
            {
                var rf = recFields[j];
                if (j < raw.Count)
                {
                    var val = raw[j];
                    if (val == "")
                        obj[rf.Name] = rf.Mod?.Type == ModifierType.Default ? rf.Mod.DefaultValue?.DeepClone() : JsonValue.Create("");
                    else if (val.StartsWith(':'))
                        obj[rf.Name] = Coerce(val[1..]);
                    else
                        obj[rf.Name] = Coerce(val);
                }
                else if (rf.Mod?.Type == ModifierType.Default)
                    obj[rf.Name] = rf.Mod.DefaultValue?.DeepClone();
            }

            records.Add(obj);
            ordinal++;
        }

        return records;
    }

    private static List<JsonNode?> DecodeNestedRecords(string body, Fiber fiber)
    {
        var recFields = RecordFields(fiber);
        var records = new List<JsonNode?>();
        var lines = body.Split('\n');
        int lineIdx = 0, ordinal = 0;

        while (lineIdx < lines.Length)
        {
            var trimmed = lines[lineIdx].Trim();
            if (trimmed.Length == 0) { lineIdx++; continue; }

            var obj = new JsonObject();

            foreach (var fd in fiber.Fields)
            {
                if (fd.Mod?.Type == ModifierType.Arithmetic)
                    obj[fd.Name] = ArithmeticValue(fd.Mod.Start, GetStep(fd.Mod), ordinal);
            }

            var raw = SplitRecordFields(trimmed);
            var nestedFields = new List<FieldDecl>();
            int rfIdx = 0;

            foreach (var rf in recFields)
            {
                if (rf.Mod?.Type == ModifierType.Nested)
                {
                    nestedFields.Add(rf);
                }
                else
                {
                    if (rfIdx < raw.Count)
                    {
                        var val = raw[rfIdx];
                        if (val == "")
                            obj[rf.Name] = rf.Mod?.Type == ModifierType.Default ? rf.Mod.DefaultValue?.DeepClone() : JsonValue.Create("");
                        else if (val.StartsWith(':'))
                            obj[rf.Name] = Coerce(val[1..]);
                        else
                            obj[rf.Name] = Coerce(val);
                    }
                    else if (rf.Mod?.Type == ModifierType.Default)
                        obj[rf.Name] = rf.Mod.DefaultValue?.DeepClone();
                    rfIdx++;
                }
            }

            lineIdx++;

            foreach (var nf in nestedFields)
            {
                var nestedText = new StringBuilder();
                while (lineIdx < lines.Length)
                {
                    var l = lines[lineIdx];
                    if (l != "" && !l.StartsWith(' ') && !l.StartsWith('\t') && nestedText.Length > 0) break;
                    if (l.Trim().Length == 0 && nestedText.Length == 0) { lineIdx++; continue; }
                    if (nestedText.ToString().Contains("}:\n") && l.Trim().StartsWith('{')) break;
                    nestedText.AppendLine(l.Trim());
                    lineIdx++;
                }

                var nt = nestedText.ToString().Trim();
                if (nt.Length > 0)
                {
                    var (_, value) = DecodeBundle(nt);
                    obj[nf.Name] = value is JsonArray arr ? arr : new JsonArray();
                }
            }

            records.Add(obj);
            ordinal++;
        }

        return records;
    }

    private static (string? name, JsonNode? value) DecodeBundle(string input)
    {
        var headerEnd = FindHeaderEnd(input);
        if (headerEnd == -1)
            throw new DhoomException("Missing '}:' header terminator");

        var header = input[..(headerEnd - 1)].Trim();
        var body = input[headerEnd..];
        var fiber = ParseFiber(header);

        var recFields = RecordFields(fiber);
        var hasNested = recFields.Any(f => f.Mod?.Type == ModifierType.Nested);

        var records = hasNested
            ? DecodeNestedRecords(body, fiber)
            : DecodeFlatRecords(body, fiber);

        var arr = new JsonArray();
        foreach (var r in records) arr.Add(r);

        return (fiber.Name, arr);
    }

    /// <summary>Decode a DHOOM string into a JsonNode.</summary>
    public static JsonNode? Decode(string input)
    {
        input = input.Trim();
        if (input.Length == 0) return null;

        var (name, value) = DecodeBundle(input);
        if (name != null)
        {
            var obj = new JsonObject { [name] = value };
            return obj;
        }
        return value;
    }

    // -----------------------------------------------------------------------
    // Encoder
    // -----------------------------------------------------------------------

    private static (JsonNode? start, int step, bool ok) DetectArithmetic(List<JsonNode?> values)
    {
        if (values.Count < 2) return (null, 0, false);

        // Numeric (exclude booleans)
        bool allNum = true;
        var nums = new List<double>();
        foreach (var v in values)
        {
            if (v is JsonValue jv)
            {
                if (jv.TryGetValue<bool>(out _)) { allNum = false; break; }
                if (jv.TryGetValue<long>(out var l)) { nums.Add(l); continue; }
                if (jv.TryGetValue<double>(out var d)) { nums.Add(d); continue; }
            }
            allNum = false;
            break;
        }
        if (allNum && nums.Count == values.Count)
        {
            var step = nums[1] - nums[0];
            bool allMatch = true;
            for (int i = 1; i < nums.Count; i++)
            {
                if (nums[i] - nums[i - 1] != step) { allMatch = false; break; }
            }
            if (allMatch) return (values[0], (int)step, true);
        }

        // String pattern
        bool allStr = values.All(v => v is JsonValue sv && sv.TryGetValue<string>(out _));
        if (allStr)
        {
            var patterns = values.Select(v =>
            {
                var s = v!.GetValue<string>();
                return ParseStringPattern(s);
            }).ToList();

            if (patterns.All(p => p.HasValue))
            {
                var ps = patterns.Select(p => p!.Value).ToList();
                if (ps.All(p => p.prefix == ps[0].prefix && p.width == ps[0].width))
                {
                    var step = ps[1].num - ps[0].num;
                    bool allMatch = true;
                    for (int i = 1; i < ps.Count; i++)
                    {
                        if (ps[i].num - ps[i - 1].num != step) { allMatch = false; break; }
                    }
                    if (allMatch) return (values[0], step, true);
                }
            }
        }

        return (null, 0, false);
    }

    private static (JsonNode? value, int count) FindModalDefault(List<JsonNode?> values)
    {
        if (values.Count == 0) return (null, 0);
        var counts = new Dictionary<string, (JsonNode? value, int count)>();
        foreach (var v in values)
        {
            var key = v?.ToJsonString() ?? "null";
            if (counts.TryGetValue(key, out var entry))
                counts[key] = (entry.value, entry.count + 1);
            else
                counts[key] = (v, 1);
        }
        var best = counts.Values.OrderByDescending(x => x.count).First();
        return best;
    }

    private static string EncodeBundle(string name, List<JsonObject> records, int indent)
    {
        var prefix = new string(' ', indent);
        if (records.Count == 0) return $"{prefix}{name}{{}}:\n";

        var keys = records[0].Select(kv => kv.Key).ToList();
        var orderedFields = new List<FieldDecl>();
        var arithmeticKeys = new HashSet<string>();
        var defaultKeys = new Dictionary<string, JsonNode?>();
        var nestedKeys = new HashSet<string>();
        var variableKeys = new List<string>();

        foreach (var key in keys)
        {
            var values = records.Select(r => r[key]).ToList();

            // Nested
            if (values.All(v => v is JsonArray))
            {
                nestedKeys.Add(key);
                continue;
            }

            // Arithmetic
            var (start, step, ok) = DetectArithmetic(values!);
            if (ok)
            {
                arithmeticKeys.Add(key);
                orderedFields.Add(new(key, new Modifier(ModifierType.Arithmetic, Start: start?.DeepClone(), Step: step != 1 ? step : null)));
                continue;
            }

            // Modal default
            var (modalVal, modalCount) = FindModalDefault(values!);
            if (modalCount > records.Count / 2)
            {
                defaultKeys[key] = modalVal;
                continue;
            }

            variableKeys.Add(key);
        }

        foreach (var key in variableKeys)
            orderedFields.Add(new(key));

        // Defaults sorted by frequency desc
        var defaultEntries = defaultKeys.Select(kv =>
        {
            var count = records.Count(r => JsonEqual(r[kv.Key], kv.Value));
            return (key: kv.Key, val: kv.Value, count);
        }).OrderByDescending(x => x.count).ToList();

        foreach (var (key, val, _) in defaultEntries)
            orderedFields.Add(new(key, new Modifier(ModifierType.Default, DefaultValue: val?.DeepClone())));

        foreach (var key in keys.Where(k => nestedKeys.Contains(k)))
            orderedFields.Add(new(key, new Modifier(ModifierType.Nested)));

        // Header
        var headerParts = orderedFields.Select(fd =>
        {
            var s = fd.Name;
            if (fd.Mod != null)
            {
                switch (fd.Mod.Type)
                {
                    case ModifierType.Arithmetic:
                        s += "@" + ValueToDhoom(fd.Mod.Start);
                        if (fd.Mod.Step.HasValue) s += "+" + fd.Mod.Step;
                        break;
                    case ModifierType.Default:
                        s += "|" + ValueToDhoom(fd.Mod.DefaultValue);
                        break;
                    case ModifierType.Nested:
                        s += ">";
                        break;
                }
            }
            return s;
        });

        var sb = new StringBuilder();
        sb.Append($"{prefix}{name}{{{string.Join(", ", headerParts)}}}:\n");

        var recFields = orderedFields.Where(f => f.Mod?.Type != ModifierType.Arithmetic).ToList();

        foreach (var record in records)
        {
            var values = new List<string>();
            var nestedBundles = new List<(string name, List<JsonObject> records)>();

            foreach (var rf in recFields)
            {
                if (rf.Mod?.Type == ModifierType.Nested)
                {
                    if (record[rf.Name] is JsonArray arr)
                    {
                        var recs = arr.Select(item => item!.AsObject()).ToList();
                        nestedBundles.Add(("", recs));
                    }
                    continue;
                }

                var val = record[rf.Name];
                if (rf.Mod?.Type == ModifierType.Default)
                {
                    if (JsonEqual(val, rf.Mod.DefaultValue))
                        values.Add("");
                    else
                        values.Add(":" + ValueToDhoom(val));
                }
                else
                    values.Add(ValueToDhoom(val));
            }

            // Trailing elision
            while (values.Count > 0 && values[^1] == "")
                values.RemoveAt(values.Count - 1);

            sb.Append(prefix + string.Join(", ", values));

            if (nestedBundles.Count > 0)
            {
                sb.Append(",\n");
                foreach (var (nbName, nbRecords) in nestedBundles)
                    sb.Append(EncodeBundle(nbName, nbRecords, indent + 2));
            }
            else
                sb.Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>Encode a JsonNode into DHOOM format.</summary>
    public static string Encode(JsonNode? value)
    {
        if (value is JsonObject obj)
        {
            var keys = obj.Select(kv => kv.Key).ToList();
            if (keys.Count == 1 && obj[keys[0]] is JsonArray arr)
            {
                var records = arr.Select(item => item!.AsObject()).ToList();
                return EncodeBundle(keys[0], records, 0);
            }
            throw new DhoomException("Top-level object must have exactly one key (the bundle name)");
        }
        if (value is JsonArray array)
        {
            var records = array.Select(item => item!.AsObject()).ToList();
            return EncodeBundle("data", records, 0);
        }
        throw new DhoomException("Top-level value must be an object or array");
    }
}
