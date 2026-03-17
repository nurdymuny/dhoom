using System.Text.Json.Nodes;
using Dhoom;

namespace Dhoom.Tests;

internal static class JsonAssert
{
    internal static bool DeepEquals(JsonNode? a, JsonNode? b)
    {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;
        if (a is JsonObject ao && b is JsonObject bo)
        {
            if (ao.Count != bo.Count) return false;
            foreach (var kv in ao)
            {
                if (!bo.TryGetPropertyValue(kv.Key, out var bv)) return false;
                if (!DeepEquals(kv.Value, bv)) return false;
            }
            return true;
        }
        if (a is JsonArray aa && b is JsonArray ba)
        {
            if (aa.Count != ba.Count) return false;
            for (int i = 0; i < aa.Count; i++)
                if (!DeepEquals(aa[i], ba[i])) return false;
            return true;
        }
        return a.ToJsonString() == b.ToJsonString();
    }

    internal static void Equal(JsonNode? expected, JsonNode? actual)
    {
        Assert.True(DeepEquals(expected, actual),
            $"JSON mismatch.\nExpected: {expected?.ToJsonString() ?? "null"}\nActual:   {actual?.ToJsonString() ?? "null"}");
    }
}

public class CoercionTests
{
    static JsonNode? Parse(string json) => JsonNode.Parse(json);

    void Roundtrip(string json)
    {
        var data = Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        var result = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, result);
    }

    [Fact] public void StringValues() =>
        Roundtrip("""{"items":[{"name":"Alice"},{"name":"Bob"},{"name":"Charlie"}]}""");

    [Fact] public void IntegerValues() =>
        Roundtrip("""{"items":[{"x":1,"y":2,"label":"a"},{"x":3,"y":4,"label":"b"},{"x":5,"y":6,"label":"c"}]}""");

    [Fact] public void FloatValues() =>
        Roundtrip("""{"items":[{"temp":22.4},{"temp":23.1},{"temp":45.8}]}""");

    [Fact] public void BooleanValues() =>
        Roundtrip("""{"items":[{"name":"A","a":true,"b":false},{"name":"B","a":false,"b":true},{"name":"C","a":true,"b":true}]}""");

    [Fact] public void NullValues() =>
        Roundtrip("""{"items":[{"x":null,"y":1,"label":"a"},{"x":null,"y":2,"label":"b"},{"x":null,"y":3,"label":"c"}]}""");
}

public class ArithmeticTests
{
    static JsonNode? Parse(string json) => JsonNode.Parse(json);

    void Roundtrip(string json)
    {
        var data = Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        var result = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, result);
    }

    [Fact]
    public void SequentialIntegers()
    {
        var json = """{"items":[{"id":1,"v":"a"},{"id":2,"v":"b"},{"id":3,"v":"c"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("@1", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void CustomStart()
    {
        var json = """{"items":[{"id":101,"v":"x"},{"id":102,"v":"y"},{"id":103,"v":"z"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("@101", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void CustomStep()
    {
        var json = """{"items":[{"id":0,"v":"a"},{"id":10,"v":"b"},{"id":20,"v":"c"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("@0+10", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void StringArithmetic()
    {
        var json = """{"items":[{"sku":"A-001","name":"Widget"},{"sku":"A-002","name":"Gadget"},{"sku":"A-003","name":"Sprocket"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("@A-001", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void NonSequentialNoArithmetic()
    {
        var json = """{"items":[{"id":1,"v":"a"},{"id":5,"v":"b"},{"id":2,"v":"c"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.DoesNotContain("@", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void Timestamps()
    {
        var json = """{"readings":[{"ts":1710000000,"val":22.4},{"ts":1710000060,"val":23.1},{"ts":1710000120,"val":45.8}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("@1710000000+60", dhoom);
        Roundtrip(json);
    }
}

public class DefaultTests
{
    static JsonNode? Parse(string json) => JsonNode.Parse(json);

    void Roundtrip(string json)
    {
        var data = Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        var result = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, result);
    }

    [Fact]
    public void DefaultBoolean()
    {
        var json = """{"items":[{"name":"A","active":true},{"name":"B","active":true},{"name":"C","active":false}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("|T", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void DefaultString()
    {
        var json = """{"items":[{"name":"A","status":"ok"},{"name":"B","status":"ok"},{"name":"C","status":"err"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("|ok", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void DefaultNumber()
    {
        var json = """{"items":[{"name":"A","rating":5},{"name":"B","rating":5},{"name":"C","rating":3}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains("|5", dhoom);
        Roundtrip(json);
    }

    [Fact]
    public void DeviationMarker()
    {
        var json = """{"items":[{"name":"A","status":"ok"},{"name":"B","status":"err"},{"name":"C","status":"ok"}]}""";
        var dhoom = DhoomCodec.Encode(Parse(json));
        Assert.Contains(":err", dhoom);
        Roundtrip(json);
    }
}

public class NestingTests
{
    static JsonNode? Parse(string json) => JsonNode.Parse(json);

    [Fact]
    public void SingleNestedBundle()
    {
        var json = """{"orders":[{"customer":"Alice","items":[{"name":"Widget","qty":2},{"name":"Gadget","qty":1}]}]}""";
        var data = Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        Assert.Contains(">", dhoom);
        var result = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, result);
    }
}

public class ExampleFileTests
{
    [Fact]
    public void DecodeReviews()
    {
        var dhoom = "reviews{id@101, customer, comment, rating|5, verified|T}:\nAlex Rivera, Excellent!\nBrij Pandey, Game changer!\nCasey Lee, Average, :3, :F\n";
        var result = DhoomCodec.Decode(dhoom);
        var expected = JsonNode.Parse("{\"reviews\":[{\"id\":101,\"customer\":\"Alex Rivera\",\"comment\":\"Excellent!\",\"rating\":5,\"verified\":true},{\"id\":102,\"customer\":\"Brij Pandey\",\"comment\":\"Game changer!\",\"rating\":5,\"verified\":true},{\"id\":103,\"customer\":\"Casey Lee\",\"comment\":\"Average\",\"rating\":3,\"verified\":false}]}");
        JsonAssert.Equal(expected, result);
    }

    [Fact]
    public void DecodeSensors()
    {
        var dhoom = "readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:\n22.4\n23.1\n45.8, :alert\n";
        var result = DhoomCodec.Decode(dhoom);
        var expected = JsonNode.Parse("{\"readings\":[{\"sensor_id\":\"T-001\",\"timestamp\":1710000000,\"value\":22.4,\"status\":\"normal\",\"unit\":\"celsius\"},{\"sensor_id\":\"T-002\",\"timestamp\":1710000060,\"value\":23.1,\"status\":\"normal\",\"unit\":\"celsius\"},{\"sensor_id\":\"T-003\",\"timestamp\":1710000120,\"value\":45.8,\"status\":\"alert\",\"unit\":\"celsius\"}]}");
        JsonAssert.Equal(expected, result);
    }

    [Fact]
    public void ReviewsRoundtrip()
    {
        var json = "{\"reviews\":[{\"id\":101,\"customer\":\"Alex Rivera\",\"comment\":\"Excellent!\",\"rating\":5,\"verified\":true},{\"id\":102,\"customer\":\"Brij Pandey\",\"comment\":\"Game changer!\",\"rating\":5,\"verified\":true},{\"id\":103,\"customer\":\"Casey Lee\",\"comment\":\"Average\",\"rating\":3,\"verified\":false}]}";
        var data = JsonNode.Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        var result = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, result);
    }
}

public class FiberParserTests
{
    [Fact]
    public void SimpleFields()
    {
        var fiber = DhoomCodec.ParseFiber("items{name, age}");
        Assert.Equal("items", fiber.Name);
        Assert.Equal(2, fiber.Fields.Count);
    }

    [Fact]
    public void ArithmeticField()
    {
        var fiber = DhoomCodec.ParseFiber("items{id@100}");
        Assert.Equal(ModifierType.Arithmetic, fiber.Fields[0].Mod!.Type);
    }

    [Fact]
    public void ArithmeticWithStep()
    {
        var fiber = DhoomCodec.ParseFiber("items{id@100+5}");
        Assert.Equal(5, fiber.Fields[0].Mod!.Step);
    }

    [Fact]
    public void DefaultField()
    {
        var fiber = DhoomCodec.ParseFiber("items{name, status|active}");
        Assert.Equal(ModifierType.Default, fiber.Fields[1].Mod!.Type);
    }

    [Fact]
    public void NestedField()
    {
        var fiber = DhoomCodec.ParseFiber("orders{customer, items>}");
        Assert.Equal(ModifierType.Nested, fiber.Fields[1].Mod!.Type);
    }

    [Fact]
    public void NoName()
    {
        var fiber = DhoomCodec.ParseFiber("{x, y}");
        Assert.Null(fiber.Name);
    }

    [Fact]
    public void MissingBraces()
    {
        Assert.Throws<DhoomException>(() => DhoomCodec.ParseFiber("no braces"));
    }
}

public class EdgeCaseTests
{
    [Fact]
    public void EmptyInput()
    {
        Assert.Null(DhoomCodec.Decode(""));
        Assert.Null(DhoomCodec.Decode("   "));
    }

    [Fact]
    public void NegativeNumbers()
    {
        var json = """{"items":[{"x":-10,"y":"a"},{"x":-9,"y":"b"},{"x":-8,"y":"c"}]}""";
        var data = JsonNode.Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        Assert.Contains("@-10", dhoom);
        var result = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, result);
    }

    [Fact]
    public void EncodeMultiKeyError()
    {
        var data = JsonNode.Parse("""{"a":[{"x":1}],"b":[{"y":2}]}""");
        Assert.Throws<DhoomException>(() => DhoomCodec.Encode(data));
    }
}

public class CompressionTests
{
    [Fact]
    public void ReviewsCompression()
    {
        var json = "{\"reviews\":[{\"id\":101,\"customer\":\"Alex Rivera\",\"comment\":\"Excellent!\",\"rating\":5,\"verified\":true},{\"id\":102,\"customer\":\"Brij Pandey\",\"comment\":\"Game changer!\",\"rating\":5,\"verified\":true},{\"id\":103,\"customer\":\"Casey Lee\",\"comment\":\"Average\",\"rating\":3,\"verified\":false}]}";
        var data = JsonNode.Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        var jsonStr = data!.ToJsonString();
        Assert.True(dhoom.Length < jsonStr.Length, $"DHOOM ({dhoom.Length}) should be smaller than JSON ({jsonStr.Length})");
    }
}

// ---------------------------------------------------------------------------
// Delta fields
// ---------------------------------------------------------------------------

public class DeltaTests
{
    [Fact]
    public void ParseDeltaModifier()
    {
        var fiber = DhoomCodec.ParseFiber("events{ts^, name}");
        Assert.Equal(ModifierType.Delta, fiber.Fields[0].Mod?.Type);
    }

    [Fact]
    public void DecodeDeltaValues()
    {
        var input = "events{name, ts^}:\nA, 1000000\nB, 50\nC, 70\n";
        var result = DhoomCodec.Decode(input);
        Assert.Equal(1000000, result!["events"]![0]!["ts"]!.GetValue<long>());
        Assert.Equal(1000050, result!["events"]![1]!["ts"]!.GetValue<long>());
        Assert.Equal(1000120, result!["events"]![2]!["ts"]!.GetValue<long>());
    }

    [Fact]
    public void EncodeDeltaWhenBeneficial()
    {
        var json = """{"events":[{"name":"A","ts":1000000},{"name":"B","ts":1000050},{"name":"C","ts":1000120},{"name":"D","ts":1000200},{"name":"E","ts":1000310}]}""";
        var data = JsonNode.Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        Assert.Contains("ts^", dhoom);
    }

    [Fact]
    public void RoundtripDelta()
    {
        var json = """{"events":[{"name":"s0","ts":1000000},{"name":"s1","ts":1000050},{"name":"s2","ts":1000120},{"name":"s3","ts":1000200},{"name":"s4","ts":1000310}]}""";
        var data = JsonNode.Parse(json);
        var dhoom = DhoomCodec.Encode(data);
        var roundtrip = DhoomCodec.Decode(dhoom);
        JsonAssert.Equal(data, roundtrip);
    }
}

// ---------------------------------------------------------------------------
// Sparse bundles
// ---------------------------------------------------------------------------

public class SparseTests
{
    [Fact]
    public void ParseSparsePrefix()
    {
        var fiber = DhoomCodec.ParseFiber("~profiles{a, b, c, d, e, f, g, h}");
        Assert.Equal("profiles", fiber.Name);
        Assert.True(fiber.Sparse);
        Assert.Equal(8, fiber.Fields.Count);
    }

    [Fact]
    public void DecodeSparseRecords()
    {
        var input = "~items{a, b, c, d, e, f, g, h}:\na:1, c:3\nb:2\n";
        var result = DhoomCodec.Decode(input);
        var arr = result!["items"]!.AsArray();
        Assert.Equal(1L, arr[0]!["a"]!.GetValue<long>());
        Assert.Equal(3L, arr[0]!["c"]!.GetValue<long>());
        var bVal = arr[0]!["b"];
        Assert.True(bVal is null || bVal.ToJsonString() == "null");
        Assert.Equal(2L, arr[1]!["b"]!.GetValue<long>());
    }

    [Fact]
    public void EncodeSparseWhenMostlyNull()
    {
        var fields = new[] { "a","b","c","d","e","f","g","h","i","j" };
        var arr = new JsonArray();
        for (int i = 0; i < 5; i++)
        {
            var obj = new JsonObject();
            foreach (var f in fields) obj[f] = null;
            obj[fields[i % fields.Length]] = i + 1;
            arr.Add(obj);
        }
        var data = new JsonObject { ["sparse_data"] = arr };
        var dhoom = DhoomCodec.Encode(data);
        Assert.Contains("~sparse_data", dhoom);
    }
}

// ---------------------------------------------------------------------------
// Morphism fields
// ---------------------------------------------------------------------------

public class MorphismTests
{
    [Fact]
    public void ParseMorphismModifier()
    {
        var fiber = DhoomCodec.ParseFiber("orders{id@1, user_id->users}");
        Assert.Equal(ModifierType.Morphism, fiber.Fields[1].Mod?.Type);
        Assert.Equal("users", fiber.Fields[1].Mod?.Target);
    }

    [Fact]
    public void DecodeMorphismAsRegularValues()
    {
        var input = "orders{id@1, user_id->users}:\nAlice\nBob\n";
        var result = DhoomCodec.Decode(input);
        Assert.Equal("Alice", result!["orders"]![0]!["user_id"]!.GetValue<string>());
        Assert.Equal("Bob", result!["orders"]![1]!["user_id"]!.GetValue<string>());
    }
}
