package dhoom

import (
	"encoding/json"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func parseJSON(s string) interface{} {
	var v interface{}
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		panic("invalid test JSON: " + err.Error())
	}
	return v
}

func toJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func roundtrip(t *testing.T, jsonStr string) {
	t.Helper()
	data := parseJSON(jsonStr)
	dhoom, err := Encode(data)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}
	result, err := Decode(dhoom)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	expected := toJSON(data)
	actual := toJSON(result)
	if expected != actual {
		t.Errorf("roundtrip mismatch:\n  want: %s\n  got:  %s\n  dhoom: %q", expected, actual, dhoom)
	}
}

// ---------------------------------------------------------------------------
// Coercion tests
// ---------------------------------------------------------------------------

func TestCoercionStrings(t *testing.T) {
	roundtrip(t, `{"items":[{"name":"Alice"},{"name":"Bob"},{"name":"Charlie"}]}`)
}

func TestCoercionIntegers(t *testing.T) {
	roundtrip(t, `{"items":[{"x":1,"y":2,"label":"a"},{"x":3,"y":4,"label":"b"},{"x":5,"y":6,"label":"c"}]}`)
}

func TestCoercionFloats(t *testing.T) {
	roundtrip(t, `{"items":[{"temp":22.4},{"temp":23.1},{"temp":45.8}]}`)
}

func TestCoercionBooleans(t *testing.T) {
	roundtrip(t, `{"items":[{"name":"A","a":true,"b":false},{"name":"B","a":false,"b":true},{"name":"C","a":true,"b":true}]}`)
}

func TestCoercionNull(t *testing.T) {
	roundtrip(t, `{"items":[{"x":null,"y":1,"label":"a"},{"x":null,"y":2,"label":"b"},{"x":null,"y":3,"label":"c"}]}`)
}

// ---------------------------------------------------------------------------
// Arithmetic tests
// ---------------------------------------------------------------------------

func TestArithmeticSequential(t *testing.T) {
	data := `{"items":[{"id":1,"v":"a"},{"id":2,"v":"b"},{"id":3,"v":"c"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "@1") {
		t.Errorf("expected @1 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestArithmeticCustomStart(t *testing.T) {
	data := `{"items":[{"id":101,"v":"x"},{"id":102,"v":"y"},{"id":103,"v":"z"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "@101") {
		t.Errorf("expected @101 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestArithmeticCustomStep(t *testing.T) {
	data := `{"items":[{"id":0,"v":"a"},{"id":10,"v":"b"},{"id":20,"v":"c"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "@0+10") {
		t.Errorf("expected @0+10 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestArithmeticString(t *testing.T) {
	data := `{"items":[{"sku":"A-001","name":"Widget"},{"sku":"A-002","name":"Gadget"},{"sku":"A-003","name":"Sprocket"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "@A-001") {
		t.Errorf("expected @A-001 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestArithmeticNonSequential(t *testing.T) {
	data := `{"items":[{"id":1,"v":"a"},{"id":5,"v":"b"},{"id":2,"v":"c"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if strings.Contains(dhoom, "@") {
		t.Errorf("should not contain @ for non-sequential: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestArithmeticTimestamps(t *testing.T) {
	data := `{"readings":[{"ts":1710000000,"val":22.4},{"ts":1710000060,"val":23.1},{"ts":1710000120,"val":45.8}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "@1710000000+60") {
		t.Errorf("expected @1710000000+60 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

// ---------------------------------------------------------------------------
// Default tests
// ---------------------------------------------------------------------------

func TestDefaultBoolean(t *testing.T) {
	data := `{"items":[{"name":"A","active":true},{"name":"B","active":true},{"name":"C","active":false}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "|T") {
		t.Errorf("expected |T in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestDefaultString(t *testing.T) {
	data := `{"items":[{"name":"A","status":"ok"},{"name":"B","status":"ok"},{"name":"C","status":"err"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "|ok") {
		t.Errorf("expected |ok in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestDefaultNumber(t *testing.T) {
	data := `{"items":[{"name":"A","rating":5},{"name":"B","rating":5},{"name":"C","rating":3}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "|5") {
		t.Errorf("expected |5 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestDeviationMarker(t *testing.T) {
	data := `{"items":[{"name":"A","status":"ok"},{"name":"B","status":"err"},{"name":"C","status":"ok"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, ":err") {
		t.Errorf("expected :err in output: %q", dhoom)
	}
	roundtrip(t, data)
}

// ---------------------------------------------------------------------------
// Nesting tests
// ---------------------------------------------------------------------------

func TestNestedSingle(t *testing.T) {
	data := `{"orders":[{"customer":"Alice","items":[{"name":"Widget","qty":2},{"name":"Gadget","qty":1}]}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, ">") {
		t.Errorf("expected > in output: %q", dhoom)
	}
	roundtrip(t, data)
}

// ---------------------------------------------------------------------------
// Example file tests
// ---------------------------------------------------------------------------

func TestDecodeReviews(t *testing.T) {
	dhoom := "reviews{id@101, customer, comment, rating|5, verified|T}:\nAlex Rivera, Excellent!\nBrij Pandey, Game changer!\nCasey Lee, Average, :3, :F\n"
	result, err := Decode(dhoom)
	if err != nil {
		t.Fatal(err)
	}

	expected := parseJSON(`{"reviews":[
		{"id":101,"customer":"Alex Rivera","comment":"Excellent!","rating":5,"verified":true},
		{"id":102,"customer":"Brij Pandey","comment":"Game changer!","rating":5,"verified":true},
		{"id":103,"customer":"Casey Lee","comment":"Average","rating":3,"verified":false}
	]}`)

	if toJSON(result) != toJSON(expected) {
		t.Errorf("reviews mismatch:\n  want: %s\n  got:  %s", toJSON(expected), toJSON(result))
	}
}

func TestDecodeSensors(t *testing.T) {
	dhoom := "readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:\n22.4\n23.1\n45.8, :alert\n"
	result, err := Decode(dhoom)
	if err != nil {
		t.Fatal(err)
	}

	expected := parseJSON(`{"readings":[
		{"sensor_id":"T-001","timestamp":1710000000,"value":22.4,"status":"normal","unit":"celsius"},
		{"sensor_id":"T-002","timestamp":1710000060,"value":23.1,"status":"normal","unit":"celsius"},
		{"sensor_id":"T-003","timestamp":1710000120,"value":45.8,"status":"alert","unit":"celsius"}
	]}`)

	if toJSON(result) != toJSON(expected) {
		t.Errorf("sensors mismatch:\n  want: %s\n  got:  %s", toJSON(expected), toJSON(result))
	}
}

func TestReviewsRoundtrip(t *testing.T) {
	roundtrip(t, `{"reviews":[
		{"id":101,"customer":"Alex Rivera","comment":"Excellent!","rating":5,"verified":true},
		{"id":102,"customer":"Brij Pandey","comment":"Game changer!","rating":5,"verified":true},
		{"id":103,"customer":"Casey Lee","comment":"Average","rating":3,"verified":false}
	]}`)
}

// ---------------------------------------------------------------------------
// Fiber parser tests
// ---------------------------------------------------------------------------

func TestFiberSimple(t *testing.T) {
	fiber, _ := ParseFiber("items{name, age}")
	if fiber.Name != "items" {
		t.Errorf("expected name 'items', got %q", fiber.Name)
	}
	if len(fiber.Fields) != 2 {
		t.Errorf("expected 2 fields, got %d", len(fiber.Fields))
	}
}

func TestFiberArithmetic(t *testing.T) {
	fiber, _ := ParseFiber("items{id@100}")
	if fiber.Fields[0].Modifier == nil || fiber.Fields[0].Modifier.Type != "arithmetic" {
		t.Error("expected arithmetic modifier")
	}
}

func TestFiberArithmeticStep(t *testing.T) {
	fiber, _ := ParseFiber("items{id@100+5}")
	if fiber.Fields[0].Modifier.Step == nil || *fiber.Fields[0].Modifier.Step != 5 {
		t.Error("expected step 5")
	}
}

func TestFiberDefault(t *testing.T) {
	fiber, _ := ParseFiber("items{name, status|active}")
	if fiber.Fields[1].Modifier == nil || fiber.Fields[1].Modifier.Type != "default" {
		t.Error("expected default modifier")
	}
}

func TestFiberNested(t *testing.T) {
	fiber, _ := ParseFiber("orders{customer, items>}")
	if fiber.Fields[1].Modifier == nil || fiber.Fields[1].Modifier.Type != "nested" {
		t.Error("expected nested modifier")
	}
}

func TestFiberNoName(t *testing.T) {
	fiber, _ := ParseFiber("{x, y}")
	if fiber.Name != "" {
		t.Errorf("expected empty name, got %q", fiber.Name)
	}
}

func TestFiberMissingBraces(t *testing.T) {
	_, err := ParseFiber("no braces")
	if err == nil {
		t.Error("expected error for missing braces")
	}
}

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

func TestEmptyInput(t *testing.T) {
	result, err := Decode("")
	if err != nil {
		t.Fatal(err)
	}
	if result != nil {
		t.Errorf("expected nil, got %v", result)
	}
}

func TestManyRecords(t *testing.T) {
	items := make([]interface{}, 100)
	for i := 0; i < 100; i++ {
		items[i] = map[string]interface{}{"id": float64(i), "name": "item_" + strings.Repeat("x", i%5)}
	}
	data := map[string]interface{}{"items": items}
	dhoom, err := Encode(data)
	if err != nil {
		t.Fatal(err)
	}
	result, err := Decode(dhoom)
	if err != nil {
		t.Fatal(err)
	}
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestNegativeNumbers(t *testing.T) {
	data := `{"items":[{"x":-10,"y":"a"},{"x":-9,"y":"b"},{"x":-8,"y":"c"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	if !strings.Contains(dhoom, "@-10") {
		t.Errorf("expected @-10 in output: %q", dhoom)
	}
	roundtrip(t, data)
}

func TestEncodeNonObjectError(t *testing.T) {
	_, err := Encode("just a string")
	if err == nil {
		t.Error("expected error for non-object")
	}
}

func TestEncodeMultiKeyError(t *testing.T) {
	data := parseJSON(`{"a":[{"x":1}],"b":[{"y":2}]}`)
	_, err := Encode(data)
	if err == nil {
		t.Error("expected error for multi-key object")
	}
}

// ---------------------------------------------------------------------------
// Compression test
// ---------------------------------------------------------------------------

func TestCompression(t *testing.T) {
	data := parseJSON(`{"reviews":[
		{"id":101,"customer":"Alex Rivera","comment":"Excellent!","rating":5,"verified":true},
		{"id":102,"customer":"Brij Pandey","comment":"Game changer!","rating":5,"verified":true},
		{"id":103,"customer":"Casey Lee","comment":"Average","rating":3,"verified":false}
	]}`)
	dhoom, _ := Encode(data)
	jsonStr := toJSON(data)
	if len(dhoom) >= len(jsonStr) {
		t.Errorf("DHOOM (%d) should be smaller than JSON (%d)", len(dhoom), len(jsonStr))
	}
}

func TestTrailingElision(t *testing.T) {
	data := `{"items":[{"name":"A","role":"admin","status":"ok"},{"name":"B","role":"admin","status":"ok"},{"name":"C","role":"admin","status":"err"}]}`
	d := parseJSON(data)
	dhoom, _ := Encode(d)
	// First two records should be just the name (all defaults elided)
	lines := strings.Split(strings.TrimSpace(dhoom), "\n")
	var bodyLines []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasSuffix(l, ":") {
			bodyLines = append(bodyLines, l)
		}
	}
	if len(bodyLines) >= 2 && bodyLines[0] != "A" {
		t.Errorf("expected first record to be elided to 'A', got %q", bodyLines[0])
	}
	roundtrip(t, data)
}
