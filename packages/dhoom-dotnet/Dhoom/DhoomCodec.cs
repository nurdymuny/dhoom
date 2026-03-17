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

public enum ModifierType { Arithmetic, Default, Nested, Delta, Morphism, Interned, Computed, Constraint }

public record Modifier(ModifierType Type, JsonNode? Start = null, int? Step = null, JsonNode? DefaultValue = null, string? Target = null, List<string>? Pool = null, string? Expr = null, string? Constraint = null);

public record FieldDecl(string Name, Modifier? Mod = null);

public record Fiber(string? Name, List<FieldDecl> Fields, bool Sparse = false);

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

        // Morphism: field->target (must check before nested '>')
        var arrowIdx = token.IndexOf("->");
        if (arrowIdx != -1)
            return new(token[..arrowIdx], new Modifier(ModifierType.Morphism, Target: token[(arrowIdx + 2)..]));

        // Computed: field#expr
        var hashIdx = token.IndexOf('#');
        if (hashIdx != -1)
            return new(token[..hashIdx], new Modifier(ModifierType.Computed, Expr: token[(hashIdx + 1)..]));

        // Constraint: field!constraint
        var bangIdx = token.IndexOf('!');
        if (bangIdx != -1)
            return new(token[..bangIdx], new Modifier(ModifierType.Constraint, Constraint: token[(bangIdx + 1)..]));

        // Interned: field&
        if (token.EndsWith('&'))
            return new(token[..^1], new Modifier(ModifierType.Interned));

        // Delta: field^
        if (token.EndsWith('^'))
            return new(token[..^1], new Modifier(ModifierType.Delta));

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
        var sparse = false;
        if (name != null && name.StartsWith('~'))
        {
            sparse = true;
            name = name[1..];
            if (string.IsNullOrEmpty(name)) name = null;
        }
        var fieldsStr = input[(braceStart + 1)..braceEnd];
        var fields = fieldsStr.Split(',')
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .Select(ParseFieldDecl)
            .ToList();

        return new(string.IsNullOrEmpty(name) ? null : name, fields, sparse);
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
        fiber.Fields.Where(f => f.Mod?.Type != ModifierType.Arithmetic && f.Mod?.Type != ModifierType.Computed).ToList();

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
        var deltaAccum = new Dictionary<string, double>();

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

                // Delta accumulation
                if (rf.Mod?.Type == ModifierType.Delta && obj[rf.Name] is JsonValue dv)
                {
                    double numVal = 0;
                    if (dv.TryGetValue<long>(out var dl)) numVal = dl;
                    else if (dv.TryGetValue<double>(out var dd)) numVal = dd;

                    if (ordinal == 0)
                    {
                        deltaAccum[rf.Name] = numVal;
                    }
                    else
                    {
                        var accumulated = deltaAccum.GetValueOrDefault(rf.Name, 0) + numVal;
                        deltaAccum[rf.Name] = accumulated;
                        if (accumulated == Math.Truncate(accumulated))
                            obj[rf.Name] = JsonValue.Create((long)accumulated);
                        else
                            obj[rf.Name] = JsonValue.Create(accumulated);
                    }
                }
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

    private static List<JsonNode?> DecodeSparseRecords(string body, Fiber fiber)
    {
        var recFields = RecordFields(fiber);
        var records = new List<JsonNode?>();
        int ordinal = 0;

        foreach (var line in body.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;

            var obj = new JsonObject();

            // Arithmetic fields
            foreach (var fd in fiber.Fields)
            {
                if (fd.Mod?.Type == ModifierType.Arithmetic)
                    obj[fd.Name] = ArithmeticValue(fd.Mod.Start, GetStep(fd.Mod), ordinal);
            }

            // Defaults for missing fields
            foreach (var rf in recFields)
            {
                if (rf.Mod?.Type == ModifierType.Default)
                    obj[rf.Name] = rf.Mod.DefaultValue?.DeepClone();
                else
                    obj[rf.Name] = null;
            }

            // Parse name:value pairs
            var pairs = SplitRecordFields(trimmed);
            foreach (var pair in pairs)
            {
                var colonIdx = pair.IndexOf(':');
                if (colonIdx == -1) continue;
                var fieldName = pair[..colonIdx].Trim();
                var fieldVal = pair[(colonIdx + 1)..].Trim();
                obj[fieldName] = Coerce(fieldVal);
            }

            records.Add(obj);
            ordinal++;
        }

        return records;
    }

    private static readonly Regex PoolRx = new(@"^&(\w[\w-]*)?\[(.+)\]$", RegexOptions.Compiled);

    private static (string? name, JsonNode? value) DecodeBundle(string input)
    {
        var headerEnd = FindHeaderEnd(input);
        if (headerEnd == -1)
            throw new DhoomException("Missing '}:' header terminator");

        var header = input[..(headerEnd - 1)].Trim();
        var body = input[headerEnd..];
        var fiber = ParseFiber(header);

        // Parse pool lines
        var bodyLines = body.Split('\n');
        var remaining = new List<string>();
        foreach (var line in bodyLines)
        {
            var trimmed = line.Trim();
            var pm = PoolRx.Match(trimmed);
            if (pm.Success)
            {
                var poolField = pm.Groups[1].Value;
                var poolValues = pm.Groups[2].Value.Split(',').Select(v => v.Trim()).ToList();
                var fd = fiber.Fields.FirstOrDefault(f => f.Name == poolField && f.Mod?.Type == ModifierType.Interned);
                if (fd != null)
                {
                    var idx = fiber.Fields.IndexOf(fd);
                    fiber.Fields[idx] = fd with { Mod = fd.Mod! with { Pool = poolValues } };
                }
            }
            else
            {
                remaining.Add(line);
            }
        }
        body = string.Join("\n", remaining);

        var recFields = RecordFields(fiber);
        var hasNested = recFields.Any(f => f.Mod?.Type == ModifierType.Nested);

        List<JsonNode?> records;
        if (fiber.Sparse)
            records = DecodeSparseRecords(body, fiber);
        else if (hasNested)
            records = DecodeNestedRecords(body, fiber);
        else
            records = DecodeFlatRecords(body, fiber);

        // Post-decode: resolve interned fields
        foreach (var fd in fiber.Fields)
        {
            if (fd.Mod?.Type == ModifierType.Interned && fd.Mod.Pool != null)
            {
                var pool = fd.Mod.Pool;
                foreach (var rec in records)
                {
                    if (rec is JsonObject obj && obj.ContainsKey(fd.Name))
                    {
                        var val = obj[fd.Name];
                        if (val is JsonValue jv && jv.TryGetValue<long>(out var idx) && idx >= 0 && idx < pool.Count)
                            obj[fd.Name] = JsonValue.Create(pool[(int)idx]);
                    }
                }
            }
        }

        // Post-decode: evaluate computed fields
        var computedExprRx = new Regex(@"^(\w[\w-]*)\s*([+\-*])\s*(\w[\w-]*)$");
        foreach (var fd in fiber.Fields)
        {
            if (fd.Mod?.Type == ModifierType.Computed && fd.Mod.Expr != null)
            {
                var cm = computedExprRx.Match(fd.Mod.Expr);
                if (cm.Success)
                {
                    var leftName = cm.Groups[1].Value;
                    var op = cm.Groups[2].Value;
                    var rightName = cm.Groups[3].Value;
                    foreach (var rec in records)
                    {
                        if (rec is JsonObject obj)
                        {
                            double? leftVal = null, rightVal = null;
                            if (obj[leftName] is JsonValue lv)
                            {
                                if (lv.TryGetValue<long>(out var ll)) leftVal = ll;
                                else if (lv.TryGetValue<double>(out var ld)) leftVal = ld;
                            }
                            if (obj[rightName] is JsonValue rv)
                            {
                                if (rv.TryGetValue<long>(out var rl)) rightVal = rl;
                                else if (rv.TryGetValue<double>(out var rd)) rightVal = rd;
                            }
                            if (leftVal.HasValue && rightVal.HasValue)
                            {
                                double result2 = op switch
                                {
                                    "+" => leftVal.Value + rightVal.Value,
                                    "-" => leftVal.Value - rightVal.Value,
                                    "*" => leftVal.Value * rightVal.Value,
                                    _ => 0
                                };
                                if (result2 == Math.Truncate(result2))
                                    obj[fd.Name] = JsonValue.Create((long)result2);
                                else
                                    obj[fd.Name] = JsonValue.Create(result2);
                            }
                        }
                    }
                }
            }
        }

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

    private static bool DetectDelta(List<JsonNode?> values)
    {
        if (values.Count < 3) return false;
        var nums = new List<long>();
        foreach (var v in values)
        {
            if (v is JsonValue jv)
            {
                if (jv.TryGetValue<bool>(out _)) return false;
                if (jv.TryGetValue<long>(out var l)) { nums.Add(l); continue; }
                if (jv.TryGetValue<double>(out var d) && d == Math.Truncate(d)) { nums.Add((long)d); continue; }
            }
            return false;
        }
        var deltas = new long[nums.Count];
        deltas[0] = nums[0];
        for (int i = 1; i < nums.Count; i++) deltas[i] = nums[i] - nums[i - 1];
        var absLen = nums.Sum(n => n.ToString().Length);
        var deltaLen = deltas.Sum(d => d.ToString().Length);
        return deltaLen < absLen * 0.7;
    }

    private static List<string>? DetectInterned(List<JsonNode?> values)
    {
        if (values.Count < 3) return null;
        foreach (var v in values)
        {
            if (v is not JsonValue jv || !jv.TryGetValue<string>(out _)) return null;
        }
        var strs = values.Select(v => v!.GetValue<string>()).ToList();
        var distinct = new List<string>();
        var seen = new HashSet<string>();
        foreach (var s in strs)
        {
            if (seen.Add(s)) distinct.Add(s);
        }
        var maxDistinct = (int)Math.Ceiling(values.Count / 3.0);
        if (distinct.Count < 2 || distinct.Count > maxDistinct) return null;
        var rawLen = strs.Sum(s => s.Length);
        var poolLen = distinct.Sum(s => s.Length) + distinct.Count - 1;
        var indexLen = values.Count;
        if (poolLen + indexLen >= rawLen * 0.9) return null;
        return distinct;
    }

    private static string? DetectComputed(string key, List<JsonNode?> values, List<string> allKeys, List<JsonObject> records)
    {
        if (values.Count == 0) return null;
        foreach (var v in values)
        {
            if (v is not JsonValue jv) return null;
            if (jv.TryGetValue<bool>(out _)) return null;
            if (!jv.TryGetValue<long>(out _) && !jv.TryGetValue<double>(out _)) return null;
        }
        var ops = new[] { "+", "-", "*" };
        foreach (var op in ops)
        {
            foreach (var a in allKeys)
            {
                if (a == key) continue;
                foreach (var b in allKeys)
                {
                    if (b == key) continue;
                    bool match = true;
                    foreach (var r in records)
                    {
                        double? av = null, bv = null, kv = null;
                        if (r[a] is JsonValue ajv) { if (ajv.TryGetValue<long>(out var al)) av = al; else if (ajv.TryGetValue<double>(out var ad)) av = ad; }
                        if (r[b] is JsonValue bjv) { if (bjv.TryGetValue<long>(out var bl)) bv = bl; else if (bjv.TryGetValue<double>(out var bd)) bv = bd; }
                        if (r[key] is JsonValue kjv) { if (kjv.TryGetValue<long>(out var kl)) kv = kl; else if (kjv.TryGetValue<double>(out var kd)) kv = kd; }
                        if (!av.HasValue || !bv.HasValue || !kv.HasValue) { match = false; break; }
                        double expected = op switch { "+" => av.Value + bv.Value, "-" => av.Value - bv.Value, "*" => av.Value * bv.Value, _ => 0 };
                        if (kv.Value != expected) { match = false; break; }
                    }
                    if (match) return $"{a}{op}{b}";
                }
            }
        }
        return null;
    }

    private static string EncodeBundle(string name, List<JsonObject> records, int indent)
    {
        var prefix = new string(' ', indent);
        if (records.Count == 0) return $"{prefix}{name}{{}}:\n";

        var keys = records[0].Select(kv => kv.Key).ToList();
        var orderedFields = new List<FieldDecl>();
        var arithmeticKeys = new HashSet<string>();
        var deltaKeys = new HashSet<string>();
        var defaultKeys = new Dictionary<string, JsonNode?>();
        var nestedKeys = new HashSet<string>();
        var variableKeys = new List<string>();
        var internedKeys = new Dictionary<string, List<string>>();
        var computedKeys = new Dictionary<string, string>();

        // Phase 1: categorize nested + arithmetic
        var remainingKeys = new List<string>();
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

            remainingKeys.Add(key);
        }

        // Phase 2: detect computed fields among ALL remaining keys
        var computedToRemove = new List<string>();
        foreach (var key in remainingKeys)
        {
            var values = records.Select(r => r[key]).ToList();
            var expr = DetectComputed(key, values!, remainingKeys, records);
            if (expr != null)
            {
                computedKeys[key] = expr;
                computedToRemove.Add(key);
            }
        }
        foreach (var key in computedToRemove)
            remainingKeys.Remove(key);

        // Phase 3: categorize remaining as delta, interned, default, or variable
        foreach (var key in remainingKeys)
        {
            var values = records.Select(r => r[key]).ToList();

            // Delta
            if (DetectDelta(values!))
            {
                deltaKeys.Add(key);
                continue;
            }

            // Interned
            var pool = DetectInterned(values!);
            if (pool != null)
            {
                internedKeys[key] = pool;
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

        // Ensure at least one field produces record body content
        if (variableKeys.Count == 0 && deltaKeys.Count == 0 && nestedKeys.Count == 0 && internedKeys.Count == 0)
        {
            foreach (var key in keys)
            {
                if (arithmeticKeys.Contains(key))
                {
                    arithmeticKeys.Remove(key);
                    orderedFields.RemoveAll(f => f.Name == key);
                    variableKeys.Add(key);
                    break;
                }
                if (defaultKeys.ContainsKey(key))
                {
                    defaultKeys.Remove(key);
                    variableKeys.Add(key);
                    break;
                }
                if (computedKeys.ContainsKey(key))
                {
                    computedKeys.Remove(key);
                    variableKeys.Add(key);
                    break;
                }
            }
        }

        // Computed fields
        foreach (var key in keys.Where(k => computedKeys.ContainsKey(k)))
            orderedFields.Add(new(key, new Modifier(ModifierType.Computed, Expr: computedKeys[key])));

        // Delta fields
        foreach (var key in keys.Where(k => deltaKeys.Contains(k)))
            orderedFields.Add(new(key, new Modifier(ModifierType.Delta)));

        // Interned fields
        foreach (var key in keys.Where(k => internedKeys.ContainsKey(k)))
            orderedFields.Add(new(key, new Modifier(ModifierType.Interned, Pool: internedKeys[key])));

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

        // Check sparsity
        var nonArithKeys = keys.Where(k => !arithmeticKeys.Contains(k) && !nestedKeys.Contains(k) && !computedKeys.ContainsKey(k)).ToList();
        var useSparse = false;
        if (nonArithKeys.Count >= 8)
        {
            int nullCount = 0, totalCells = 0;
            foreach (var r in records)
            {
                foreach (var k in nonArithKeys)
                {
                    totalCells++;
                    var v = r[k];
                    if (v is null) nullCount++;
                    else if (v is JsonValue jv && jv.TryGetValue<string>(out var s) && s == "") nullCount++;
                }
            }
            useSparse = nullCount > totalCells * 0.75;
        }

        // Header
        var sparsePrefix = useSparse ? "~" : "";
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
                    case ModifierType.Delta:
                        s += "^";
                        break;
                    case ModifierType.Morphism:
                        s += "->" + fd.Mod.Target;
                        break;
                    case ModifierType.Interned:
                        s += "&";
                        break;
                    case ModifierType.Computed:
                        s += "#" + fd.Mod.Expr;
                        break;
                    case ModifierType.Constraint:
                        s += "!" + fd.Mod.Constraint;
                        break;
                }
            }
            return s;
        });

        var sb = new StringBuilder();
        sb.Append($"{prefix}{sparsePrefix}{name}{{{string.Join(", ", headerParts)}}}:\n");

        // Emit pool lines
        foreach (var key in keys.Where(k => internedKeys.ContainsKey(k)))
            sb.Append($"{prefix}&{key}[{string.Join(", ", internedKeys[key])}]\n");

        var recFields = orderedFields.Where(f => f.Mod?.Type != ModifierType.Arithmetic && f.Mod?.Type != ModifierType.Computed).ToList();

        if (useSparse)
        {
            foreach (var record in records)
            {
                var pairs = new List<string>();
                foreach (var rf in recFields)
                {
                    if (rf.Mod?.Type == ModifierType.Nested) continue;
                    var val = record[rf.Name];
                    if (rf.Mod?.Type == ModifierType.Interned && rf.Mod.Pool != null && val is JsonValue ijv && ijv.TryGetValue<string>(out var isv))
                    {
                        var idx = rf.Mod.Pool.IndexOf(isv);
                        if (idx >= 0) { pairs.Add($"{rf.Name}:{idx}"); continue; }
                    }
                    if (val is not null)
                    {
                        if (val is JsonValue jv && jv.TryGetValue<string>(out var sv) && sv == "") continue;
                        pairs.Add($"{rf.Name}:{ValueToDhoom(val)}");
                    }
                }
                if (pairs.Count == 0)
                {
                    var first = recFields.FirstOrDefault(f => f.Mod?.Type != ModifierType.Nested);
                    if (first != null) pairs.Add($"{first.Name}:null");
                }
                sb.Append(prefix + string.Join(", ", pairs) + "\n");
            }
            return sb.ToString();
        }

        int recordIdx = 0;
        var prevDelta = new Dictionary<string, double>();

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

                if (rf.Mod?.Type == ModifierType.Delta)
                {
                    double numVal = 0;
                    if (val is JsonValue dv)
                    {
                        if (dv.TryGetValue<long>(out var dl)) numVal = dl;
                        else if (dv.TryGetValue<double>(out var dd)) numVal = dd;
                    }
                    if (recordIdx == 0)
                    {
                        prevDelta[rf.Name] = numVal;
                        values.Add(ValueToDhoom(val));
                    }
                    else
                    {
                        var prev = prevDelta.GetValueOrDefault(rf.Name, 0);
                        var delta = numVal - prev;
                        prevDelta[rf.Name] = numVal;
                        if (delta == Math.Truncate(delta))
                            values.Add(((long)delta).ToString());
                        else
                            values.Add(delta.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    }
                }
                else if (rf.Mod?.Type == ModifierType.Interned && rf.Mod.Pool != null)
                {
                    if (val is JsonValue ijv && ijv.TryGetValue<string>(out var isv))
                    {
                        var idx = rf.Mod.Pool.IndexOf(isv);
                        if (idx >= 0)
                            values.Add(idx.ToString());
                        else
                            values.Add(ValueToDhoom(val));
                    }
                    else
                        values.Add(ValueToDhoom(val));
                }
                else if (rf.Mod?.Type == ModifierType.Default)
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

            recordIdx++;
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
