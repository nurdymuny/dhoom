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

// ---------------------------------------------------------------------------
// Delta fields
// ---------------------------------------------------------------------------

func TestParseDeltaModifier(t *testing.T) {
	fiber, err := ParseFiber("events{ts^, name}")
	if err != nil {
		t.Fatalf("ParseFiber failed: %v", err)
	}
	if fiber.Fields[0].Modifier.Type != "delta" {
		t.Errorf("expected delta modifier, got %q", fiber.Fields[0].Modifier.Type)
	}
}

func TestDecodeDeltaValues(t *testing.T) {
	input := "events{name, ts^}:\nA, 1000000\nB, 50\nC, 70\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["events"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	r1 := arr[1].(map[string]interface{})
	r2 := arr[2].(map[string]interface{})
	if r0["ts"] != float64(1000000) {
		t.Errorf("expected 1000000, got %v", r0["ts"])
	}
	if r1["ts"] != float64(1000050) {
		t.Errorf("expected 1000050, got %v", r1["ts"])
	}
	if r2["ts"] != float64(1000120) {
		t.Errorf("expected 1000120, got %v", r2["ts"])
	}
}

func TestEncodeDeltaWhenBeneficial(t *testing.T) {
	data := parseJSON(`{"events":[{"name":"A","ts":1000000},{"name":"B","ts":1000050},{"name":"C","ts":1000120},{"name":"D","ts":1000200},{"name":"E","ts":1000310}]}`)
	dhoom, err := Encode(data)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}
	if !strings.Contains(dhoom, "ts^") {
		t.Error("expected delta modifier ts^ in encoded output")
	}
}

func TestRoundtripDelta(t *testing.T) {
	roundtrip(t, `{"events":[{"name":"s0","ts":1000000},{"name":"s1","ts":1000050},{"name":"s2","ts":1000120},{"name":"s3","ts":1000200},{"name":"s4","ts":1000310}]}`)
}

// ---------------------------------------------------------------------------
// Sparse bundles
// ---------------------------------------------------------------------------

func TestParseSparsePrefix(t *testing.T) {
	fiber, err := ParseFiber("~profiles{a, b, c, d, e, f, g, h}")
	if err != nil {
		t.Fatalf("ParseFiber failed: %v", err)
	}
	if fiber.Name != "profiles" {
		t.Errorf("expected name 'profiles', got %q", fiber.Name)
	}
	if !fiber.Sparse {
		t.Error("expected Sparse to be true")
	}
	if len(fiber.Fields) != 8 {
		t.Errorf("expected 8 fields, got %d", len(fiber.Fields))
	}
}

func TestDecodeSparseRecords(t *testing.T) {
	input := "~items{a, b, c, d, e, f, g, h}:\na:1, c:3\nb:2\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["items"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	r1 := arr[1].(map[string]interface{})
	if r0["a"] != float64(1) {
		t.Errorf("expected a=1, got %v", r0["a"])
	}
	if r0["c"] != float64(3) {
		t.Errorf("expected c=3, got %v", r0["c"])
	}
	if r0["b"] != nil {
		t.Errorf("expected b=nil, got %v", r0["b"])
	}
	if r1["b"] != float64(2) {
		t.Errorf("expected b=2, got %v", r1["b"])
	}
}

func TestEncodeSparseWhenMostlyNull(t *testing.T) {
	fields := []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}
	var records []interface{}
	for i := 0; i < 5; i++ {
		obj := map[string]interface{}{}
		for _, f := range fields {
			obj[f] = nil
		}
		obj[fields[i%len(fields)]] = float64(i + 1)
		records = append(records, obj)
	}
	data := map[string]interface{}{"sparse_data": records}
	dhoom, err := Encode(data)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}
	if !strings.Contains(dhoom, "~sparse_data") {
		t.Error("expected sparse prefix ~sparse_data in encoded output")
	}
}

// ---------------------------------------------------------------------------
// Morphism fields
// ---------------------------------------------------------------------------

func TestParseMorphismModifier(t *testing.T) {
	fiber, err := ParseFiber("orders{id@1, user_id->users}")
	if err != nil {
		t.Fatalf("ParseFiber failed: %v", err)
	}
	if fiber.Fields[1].Modifier.Type != "morphism" {
		t.Errorf("expected morphism modifier, got %q", fiber.Fields[1].Modifier.Type)
	}
	if fiber.Fields[1].Modifier.Target != "users" {
		t.Errorf("expected target 'users', got %q", fiber.Fields[1].Modifier.Target)
	}
}

func TestDecodeMorphismAsRegularValues(t *testing.T) {
	input := "orders{id@1, user_id->users}:\nAlice\nBob\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["orders"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	r1 := arr[1].(map[string]interface{})
	if r0["user_id"] != "Alice" {
		t.Errorf("expected 'Alice', got %v", r0["user_id"])
	}
	if r1["user_id"] != "Bob" {
		t.Errorf("expected 'Bob', got %v", r1["user_id"])
	}
}

// ---------------------------------------------------------------------------
// String Interning tests
// ---------------------------------------------------------------------------

func TestParseInternedModifier(t *testing.T) {
	fiber, _ := ParseFiber("data{name, status&}")
	if fiber.Fields[1].Modifier == nil || fiber.Fields[1].Modifier.Type != "interned" {
		t.Error("expected interned modifier")
	}
}

func TestDecodeInterned(t *testing.T) {
	input := "orders{id, status&}:\n&status[completed, pending, failed]\n1, 0\n2, 1\n3, 2\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["orders"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	r1 := arr[1].(map[string]interface{})
	r2 := arr[2].(map[string]interface{})
	if r0["status"] != "completed" {
		t.Errorf("expected 'completed', got %v", r0["status"])
	}
	if r1["status"] != "pending" {
		t.Errorf("expected 'pending', got %v", r1["status"])
	}
	if r2["status"] != "failed" {
		t.Errorf("expected 'failed', got %v", r2["status"])
	}
}

func TestRoundtripInterned(t *testing.T) {
	data := parseJSON(`{"tasks":[
		{"id":1,"status":"completed"},
		{"id":2,"status":"pending"},
		{"id":3,"status":"completed"},
		{"id":4,"status":"failed"},
		{"id":5,"status":"completed"},
		{"id":6,"status":"pending"},
		{"id":7,"status":"completed"},
		{"id":8,"status":"failed"},
		{"id":9,"status":"completed"}
	]}`)
	dhoom, err := Encode(data)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}
	if !strings.Contains(dhoom, "&") {
		t.Errorf("expected & in output: %q", dhoom)
	}
	result, err := Decode(dhoom)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	if toJSON(result) != toJSON(data) {
		t.Errorf("roundtrip mismatch:\n  want: %s\n  got:  %s", toJSON(data), toJSON(result))
	}
}

// ---------------------------------------------------------------------------
// Computed Fields tests
// ---------------------------------------------------------------------------

func TestParseComputedModifier(t *testing.T) {
	fiber, _ := ParseFiber("data{price, qty, total#price*qty}")
	if fiber.Fields[2].Modifier == nil || fiber.Fields[2].Modifier.Type != "computed" {
		t.Error("expected computed modifier")
	}
	if fiber.Fields[2].Modifier.Expr != "price*qty" {
		t.Errorf("expected expr 'price*qty', got %q", fiber.Fields[2].Modifier.Expr)
	}
}

func TestDecodeComputedMultiply(t *testing.T) {
	input := "data{price, qty, total#price*qty}:\n10, 3\n20, 5\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["data"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	r1 := arr[1].(map[string]interface{})
	if r0["total"] != float64(30) {
		t.Errorf("expected 30, got %v", r0["total"])
	}
	if r1["total"] != float64(100) {
		t.Errorf("expected 100, got %v", r1["total"])
	}
}

func TestDecodeComputedAdd(t *testing.T) {
	input := "data{a, b, sum#a+b}:\n1, 2\n3, 4\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["data"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	r1 := arr[1].(map[string]interface{})
	if r0["sum"] != float64(3) {
		t.Errorf("expected 3, got %v", r0["sum"])
	}
	if r1["sum"] != float64(7) {
		t.Errorf("expected 7, got %v", r1["sum"])
	}
}

func TestRoundtripComputed(t *testing.T) {
	data := parseJSON(`{"items":[
		{"price":10,"qty":3,"total":30},
		{"price":20,"qty":5,"total":100},
		{"price":15,"qty":2,"total":30}
	]}`)
	dhoom, err := Encode(data)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}
	if !strings.Contains(dhoom, "#") {
		t.Errorf("expected # in output: %q", dhoom)
	}
	result, err := Decode(dhoom)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	if toJSON(result) != toJSON(data) {
		t.Errorf("roundtrip mismatch:\n  want: %s\n  got:  %s", toJSON(data), toJSON(result))
	}
}

// ---------------------------------------------------------------------------
// Inline Constraints tests
// ---------------------------------------------------------------------------

func TestParseConstraintModifier(t *testing.T) {
	fiber, _ := ParseFiber("data{name!str, age!int}")
	if fiber.Fields[0].Modifier == nil || fiber.Fields[0].Modifier.Type != "constraint" {
		t.Error("expected constraint modifier for name")
	}
	if fiber.Fields[0].Modifier.Constraint != "str" {
		t.Errorf("expected constraint 'str', got %q", fiber.Fields[0].Modifier.Constraint)
	}
	if fiber.Fields[1].Modifier.Constraint != "int" {
		t.Errorf("expected constraint 'int', got %q", fiber.Fields[1].Modifier.Constraint)
	}
}

func TestDecodeConstraintAsRegular(t *testing.T) {
	input := "data{name!str, age!int}:\nAlice, 30\nBob, 25\n"
	result, err := Decode(input)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	m := result.(map[string]interface{})
	arr := m["data"].([]interface{})
	r0 := arr[0].(map[string]interface{})
	if r0["name"] != "Alice" {
		t.Errorf("expected 'Alice', got %v", r0["name"])
	}
	if r0["age"] != float64(30) {
		t.Errorf("expected 30, got %v", r0["age"])
	}
}
