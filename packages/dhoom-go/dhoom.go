// Package dhoom implements the DHOOM (Davis Human-readable Optimized Object Markup)
// encoder and decoder — a compact, human-readable serialization format built on
// fiber bundle geometry.
package dhoom

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Modifier struct {
	Type         string      // "arithmetic", "default", "nested", "delta", "morphism", "interned", "computed", "constraint"
	Start        interface{} // arithmetic start value
	Step         *int        // arithmetic step (nil = 1)
	DefaultValue interface{} // default value
	Target       string      // morphism target bundle name
	Pool         []string    // interned pool values
	Expr         string      // computed expression
	Constraint   string      // inline constraint
}

type FieldDecl struct {
	Name     string
	Modifier *Modifier
}

type Fiber struct {
	Name   string
	Fields []FieldDecl
	Sparse bool
}

// DhoomError represents an error during DHOOM encoding/decoding.
type DhoomError struct {
	Message string
	Line    int
}

func (e *DhoomError) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("Line %d: %s", e.Line, e.Message)
	}
	return e.Message
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

func coerce(s string) interface{} {
	if s == "T" {
		return true
	}
	if s == "F" {
		return false
	}
	if s == "null" {
		return nil
	}
	if s == "" {
		return ""
	}
	if matched, _ := regexp.MatchString(`^-?\d+$`, s); matched {
		n, _ := strconv.ParseFloat(s, 64)
		return n
	}
	if matched, _ := regexp.MatchString(`^-?\d+\.\d+$`, s); matched {
		n, _ := strconv.ParseFloat(s, 64)
		return n
	}
	return s
}

func valueToDhoom(v interface{}) string {
	switch val := v.(type) {
	case bool:
		if val {
			return "T"
		}
		return "F"
	case nil:
		return "null"
	case float64:
		if val == math.Trunc(val) && !math.IsInf(val, 0) {
			return strconv.FormatInt(int64(val), 10)
		}
		return strconv.FormatFloat(val, 'f', -1, 64)
	case string:
		if strings.ContainsAny(val, ",:\n\"") {
			return `"` + strings.ReplaceAll(val, `"`, `""`) + `"`
		}
		return val
	}
	return ""
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

var stringPatternRegex = regexp.MustCompile(`^(.*\D)(\d+)$`)

func parseStringPattern(s string) (prefix string, num int, width int, ok bool) {
	m := stringPatternRegex.FindStringSubmatch(s)
	if m == nil {
		return "", 0, 0, false
	}
	n, _ := strconv.Atoi(m[2])
	return m[1], n, len(m[2]), true
}

func arithmeticValue(start interface{}, step int, i int) interface{} {
	switch s := start.(type) {
	case float64:
		return s + float64(step*i)
	case string:
		prefix, num, width, ok := parseStringPattern(s)
		if ok {
			val := num + step*i
			numStr := strconv.Itoa(val)
			for len(numStr) < width {
				numStr = "0" + numStr
			}
			return prefix + numStr
		}
		return s
	}
	return start
}

// ---------------------------------------------------------------------------
// Fiber parser
// ---------------------------------------------------------------------------

func parseFieldDecl(token string) FieldDecl {
	token = strings.TrimSpace(token)

	// Morphism: field->target (must check before nested '>')
	if arrowIdx := strings.Index(token, "->"); arrowIdx != -1 {
		return FieldDecl{Name: token[:arrowIdx], Modifier: &Modifier{Type: "morphism", Target: token[arrowIdx+2:]}}
	}

	// Computed: field#expr
	if hashIdx := strings.Index(token, "#"); hashIdx != -1 {
		return FieldDecl{Name: token[:hashIdx], Modifier: &Modifier{Type: "computed", Expr: token[hashIdx+1:]}}
	}

	// Constraint: field!constraint
	if bangIdx := strings.Index(token, "!"); bangIdx != -1 {
		return FieldDecl{Name: token[:bangIdx], Modifier: &Modifier{Type: "constraint", Constraint: token[bangIdx+1:]}}
	}

	// Interned: field&
	if strings.HasSuffix(token, "&") {
		return FieldDecl{Name: token[:len(token)-1], Modifier: &Modifier{Type: "interned"}}
	}

	// Delta: field^
	if strings.HasSuffix(token, "^") {
		return FieldDecl{Name: token[:len(token)-1], Modifier: &Modifier{Type: "delta"}}
	}

	// Nested: field>
	if strings.HasSuffix(token, ">") {
		return FieldDecl{Name: token[:len(token)-1], Modifier: &Modifier{Type: "nested"}}
	}

	// Arithmetic: field@start or field@start+step
	if atIdx := strings.Index(token, "@"); atIdx != -1 {
		name := token[:atIdx]
		rest := token[atIdx+1:]
		if plusIdx := strings.Index(rest, "+"); plusIdx != -1 {
			start := coerce(rest[:plusIdx])
			step, _ := strconv.Atoi(rest[plusIdx+1:])
			return FieldDecl{Name: name, Modifier: &Modifier{Type: "arithmetic", Start: start, Step: &step}}
		}
		return FieldDecl{Name: name, Modifier: &Modifier{Type: "arithmetic", Start: coerce(rest)}}
	}

	// Default: field|value
	if pipeIdx := strings.Index(token, "|"); pipeIdx != -1 {
		name := token[:pipeIdx]
		defaultValue := coerce(token[pipeIdx+1:])
		return FieldDecl{Name: name, Modifier: &Modifier{Type: "default", DefaultValue: defaultValue}}
	}

	return FieldDecl{Name: token}
}

// ParseFiber parses a DHOOM fiber header string.
func ParseFiber(input string) (Fiber, error) {
	s := strings.TrimSpace(input)
	braceStart := strings.Index(s, "{")
	braceEnd := strings.LastIndex(s, "}")
	if braceStart == -1 || braceEnd == -1 {
		return Fiber{}, &DhoomError{Message: "Missing braces in fiber header"}
	}

	name := ""
	if braceStart > 0 {
		name = strings.TrimSpace(s[:braceStart])
	}

	sparse := false
	if strings.HasPrefix(name, "~") {
		sparse = true
		name = name[1:]
	}

	fieldsStr := s[braceStart+1 : braceEnd]
	parts := strings.Split(fieldsStr, ",")
	var fields []FieldDecl
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			fields = append(fields, parseFieldDecl(p))
		}
	}

	return Fiber{Name: name, Fields: fields, Sparse: sparse}, nil
}

// ---------------------------------------------------------------------------
// Record field splitter (respects quotes)
// ---------------------------------------------------------------------------

func splitRecordFields(line string) []string {
	var fields []string
	var current strings.Builder
	inQuotes := false

	for i := 0; i < len(line); i++ {
		c := line[i]
		if inQuotes {
			if c == '"' {
				if i+1 < len(line) && line[i+1] == '"' {
					current.WriteByte('"')
					i++
				} else {
					inQuotes = false
				}
			} else {
				current.WriteByte(c)
			}
		} else if c == '"' {
			inQuotes = true
		} else if c == ',' {
			fields = append(fields, strings.TrimSpace(current.String()))
			current.Reset()
		} else {
			current.WriteByte(c)
		}
	}
	fields = append(fields, strings.TrimSpace(current.String()))
	return fields
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

func recordFields(fiber Fiber) []FieldDecl {
	var result []FieldDecl
	for _, f := range fiber.Fields {
		if f.Modifier == nil || (f.Modifier.Type != "arithmetic" && f.Modifier.Type != "computed") {
			result = append(result, f)
		}
	}
	return result
}

func getStep(m *Modifier) int {
	if m.Step != nil {
		return *m.Step
	}
	return 1
}

func decodeFlatRecords(body string, fiber Fiber) []interface{} {
	recFields := recordFields(fiber)
	var records []interface{}
	ordinal := 0
	deltaAccum := make(map[string]float64)

	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		raw := splitRecordFields(trimmed)
		obj := make(map[string]interface{})

		// Arithmetic fields
		for _, fd := range fiber.Fields {
			if fd.Modifier != nil && fd.Modifier.Type == "arithmetic" {
				obj[fd.Name] = arithmeticValue(fd.Modifier.Start, getStep(fd.Modifier), ordinal)
			}
		}

		// Positional values
		for j, rf := range recFields {
			if j < len(raw) {
				val := raw[j]
				if val == "" {
					if rf.Modifier != nil && rf.Modifier.Type == "default" {
						obj[rf.Name] = rf.Modifier.DefaultValue
					} else {
						obj[rf.Name] = ""
					}
				} else if strings.HasPrefix(val, ":") {
					obj[rf.Name] = coerce(val[1:])
				} else {
					obj[rf.Name] = coerce(val)
				}
			} else {
				// Trailing elision
				if rf.Modifier != nil && rf.Modifier.Type == "default" {
					obj[rf.Name] = rf.Modifier.DefaultValue
				}
			}

			// Delta accumulation
			if rf.Modifier != nil && rf.Modifier.Type == "delta" {
				if resolved, ok := obj[rf.Name]; ok {
					if num, isNum := resolved.(float64); isNum {
						if ordinal == 0 {
							deltaAccum[rf.Name] = num
						} else {
							accumulated := deltaAccum[rf.Name] + num
							deltaAccum[rf.Name] = accumulated
							if accumulated == math.Trunc(accumulated) {
								obj[rf.Name] = accumulated
							} else {
								obj[rf.Name] = accumulated
							}
						}
					}
				}
			}
		}

		records = append(records, obj)
		ordinal++
	}

	return records
}

func decodeSparseRecords(body string, fiber Fiber) []interface{} {
	recFields := recordFields(fiber)
	var records []interface{}
	ordinal := 0

	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		obj := make(map[string]interface{})

		// Arithmetic fields
		for _, fd := range fiber.Fields {
			if fd.Modifier != nil && fd.Modifier.Type == "arithmetic" {
				obj[fd.Name] = arithmeticValue(fd.Modifier.Start, getStep(fd.Modifier), ordinal)
			}
		}

		// Defaults for missing fields
		for _, rf := range recFields {
			if rf.Modifier != nil && rf.Modifier.Type == "default" {
				obj[rf.Name] = rf.Modifier.DefaultValue
			} else {
				obj[rf.Name] = nil
			}
		}

		// Parse name:value pairs
		pairs := splitRecordFields(trimmed)
		for _, pair := range pairs {
			colonIdx := strings.Index(pair, ":")
			if colonIdx == -1 {
				continue
			}
			fieldName := strings.TrimSpace(pair[:colonIdx])
			fieldVal := strings.TrimSpace(pair[colonIdx+1:])
			obj[fieldName] = coerce(fieldVal)
		}

		records = append(records, obj)
		ordinal++
	}

	return records
}

func decodeNestedRecords(body string, fiber Fiber) []interface{} {
	recFields := recordFields(fiber)
	var records []interface{}
	lines := strings.Split(body, "\n")
	lineIdx := 0
	ordinal := 0

	for lineIdx < len(lines) {
		trimmed := strings.TrimSpace(lines[lineIdx])
		if trimmed == "" {
			lineIdx++
			continue
		}

		obj := make(map[string]interface{})

		// Arithmetic fields
		for _, fd := range fiber.Fields {
			if fd.Modifier != nil && fd.Modifier.Type == "arithmetic" {
				obj[fd.Name] = arithmeticValue(fd.Modifier.Start, getStep(fd.Modifier), ordinal)
			}
		}

		raw := splitRecordFields(trimmed)
		var nestedFields []FieldDecl
		rfIdx := 0

		for _, rf := range recFields {
			if rf.Modifier != nil && rf.Modifier.Type == "nested" {
				nestedFields = append(nestedFields, rf)
			} else {
				if rfIdx < len(raw) {
					val := raw[rfIdx]
					if val == "" {
						if rf.Modifier != nil && rf.Modifier.Type == "default" {
							obj[rf.Name] = rf.Modifier.DefaultValue
						} else {
							obj[rf.Name] = ""
						}
					} else if strings.HasPrefix(val, ":") {
						obj[rf.Name] = coerce(val[1:])
					} else {
						obj[rf.Name] = coerce(val)
					}
				} else if rf.Modifier != nil && rf.Modifier.Type == "default" {
					obj[rf.Name] = rf.Modifier.DefaultValue
				}
				rfIdx++
			}
		}

		lineIdx++

		// Parse nested bundles
		for _, nf := range nestedFields {
			nestedText := ""
			for lineIdx < len(lines) {
				l := lines[lineIdx]
				if l != "" && !strings.HasPrefix(l, " ") && !strings.HasPrefix(l, "\t") && nestedText != "" {
					break
				}
				if strings.TrimSpace(l) == "" && nestedText == "" {
					lineIdx++
					continue
				}
				if strings.Contains(nestedText, "}:\n") && strings.HasPrefix(strings.TrimSpace(l), "{") {
					break
				}
				nestedText += strings.TrimSpace(l) + "\n"
				lineIdx++
			}

			if strings.TrimSpace(nestedText) != "" {
				name, value, err := decodeBundle(strings.TrimSpace(nestedText))
				if err == nil {
					_ = name
					obj[nf.Name] = value
				}
			}
		}

		records = append(records, obj)
		ordinal++
	}

	return records
}

func findHeaderEnd(input string) int {
	brace := strings.Index(input, "}")
	if brace == -1 {
		return -1
	}
	colon := strings.Index(input[brace+1:], ":")
	if colon == -1 {
		return -1
	}
	return brace + 1 + colon + 1
}

var poolRegex = regexp.MustCompile(`^&(\w[\w-]*)?\[(.+)\]$`)

func decodeBundle(input string) (string, interface{}, error) {
	headerEnd := findHeaderEnd(input)
	if headerEnd == -1 {
		return "", nil, &DhoomError{Message: "Missing '}:' header terminator"}
	}

	header := strings.TrimSpace(input[:headerEnd-1])
	body := input[headerEnd:]
	fiber, err := ParseFiber(header)
	if err != nil {
		return "", nil, err
	}

	// Parse pool lines
	bodyLines := strings.Split(body, "\n")
	var remaining []string
	for _, line := range bodyLines {
		trimmed := strings.TrimSpace(line)
		m := poolRegex.FindStringSubmatch(trimmed)
		if m != nil {
			poolField := m[1]
			poolValues := strings.Split(m[2], ",")
			for i := range poolValues {
				poolValues[i] = strings.TrimSpace(poolValues[i])
			}
			for i := range fiber.Fields {
				if fiber.Fields[i].Name == poolField && fiber.Fields[i].Modifier != nil && fiber.Fields[i].Modifier.Type == "interned" {
					fiber.Fields[i].Modifier.Pool = poolValues
				}
			}
		} else {
			remaining = append(remaining, line)
		}
	}
	body = strings.Join(remaining, "\n")

	recFields := recordFields(fiber)
	hasNested := false
	for _, f := range recFields {
		if f.Modifier != nil && f.Modifier.Type == "nested" {
			hasNested = true
			break
		}
	}

	var records []interface{}
	if fiber.Sparse {
		records = decodeSparseRecords(body, fiber)
	} else if hasNested {
		records = decodeNestedRecords(body, fiber)
	} else {
		records = decodeFlatRecords(body, fiber)
	}

	if records == nil {
		records = []interface{}{}
	}

	// Post-decode: resolve interned fields
	for _, fd := range fiber.Fields {
		if fd.Modifier != nil && fd.Modifier.Type == "interned" && len(fd.Modifier.Pool) > 0 {
			pool := fd.Modifier.Pool
			for _, rec := range records {
				if obj, ok := rec.(map[string]interface{}); ok {
					if val, exists := obj[fd.Name]; exists {
						if num, isNum := val.(float64); isNum {
							idx := int(num)
							if idx >= 0 && idx < len(pool) {
								obj[fd.Name] = pool[idx]
							}
						}
					}
				}
			}
		}
	}

	// Post-decode: evaluate computed fields
	computedExprRegex := regexp.MustCompile(`^(\w[\w-]*)\s*([+\-*])\s*(\w[\w-]*)$`)
	for _, fd := range fiber.Fields {
		if fd.Modifier != nil && fd.Modifier.Type == "computed" && fd.Modifier.Expr != "" {
			m := computedExprRegex.FindStringSubmatch(fd.Modifier.Expr)
			if m != nil {
				leftName, op, rightName := m[1], m[2], m[3]
				for _, rec := range records {
					if obj, ok := rec.(map[string]interface{}); ok {
						leftVal, lok := obj[leftName]
						rightVal, rok := obj[rightName]
						if lok && rok {
							lnum, lisNum := leftVal.(float64)
							rnum, risNum := rightVal.(float64)
							if lisNum && risNum {
								switch op {
								case "+":
									obj[fd.Name] = lnum + rnum
								case "-":
									obj[fd.Name] = lnum - rnum
								case "*":
									obj[fd.Name] = lnum * rnum
								}
							}
						}
					}
				}
			}
		}
	}

	return fiber.Name, records, nil
}

// Decode decodes a DHOOM string into a Go value (map or slice).
func Decode(input string) (interface{}, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return nil, nil
	}

	name, value, err := decodeBundle(s)
	if err != nil {
		return nil, err
	}

	if name != "" {
		return map[string]interface{}{name: value}, nil
	}
	return value, nil
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

func detectArithmetic(values []interface{}) (start interface{}, step int, ok bool) {
	if len(values) < 2 {
		return nil, 0, false
	}

	// Numeric (exclude booleans)
	allNum := true
	for _, v := range values {
		if _, isBool := v.(bool); isBool {
			allNum = false
			break
		}
		if _, isNum := v.(float64); !isNum {
			allNum = false
			break
		}
	}
	if allNum {
		nums := make([]float64, len(values))
		for i, v := range values {
			nums[i] = v.(float64)
		}
		s := nums[1] - nums[0]
		allMatch := true
		for i := 1; i < len(nums); i++ {
			if nums[i]-nums[i-1] != s {
				allMatch = false
				break
			}
		}
		if allMatch {
			return values[0], int(s), true
		}
	}

	// String pattern
	allStr := true
	for _, v := range values {
		if _, isStr := v.(string); !isStr {
			allStr = false
			break
		}
	}
	if allStr {
		type pat struct {
			prefix string
			num    int
			width  int
		}
		patterns := make([]pat, len(values))
		for i, v := range values {
			p, n, w, pok := parseStringPattern(v.(string))
			if !pok {
				return nil, 0, false
			}
			patterns[i] = pat{p, n, w}
		}
		if len(patterns) > 0 {
			ref := patterns[0]
			allSame := true
			for _, p := range patterns {
				if p.prefix != ref.prefix || p.width != ref.width {
					allSame = false
					break
				}
			}
			if allSame {
				s := patterns[1].num - patterns[0].num
				allMatch := true
				for i := 1; i < len(patterns); i++ {
					if patterns[i].num-patterns[i-1].num != s {
						allMatch = false
						break
					}
				}
				if allMatch {
					return values[0], s, true
				}
			}
		}
	}

	return nil, 0, false
}

func jsonEqual(a, b interface{}) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

func findModalDefault(values []interface{}) (interface{}, int) {
	if len(values) == 0 {
		return nil, 0
	}
	counts := make(map[string]struct {
		value interface{}
		count int
	})
	for _, v := range values {
		key, _ := json.Marshal(v)
		k := string(key)
		entry, exists := counts[k]
		if exists {
			entry.count++
			counts[k] = entry
		} else {
			counts[k] = struct {
				value interface{}
				count int
			}{v, 1}
		}
	}
	var bestVal interface{}
	bestCount := 0
	for _, entry := range counts {
		if entry.count > bestCount {
			bestVal = entry.value
			bestCount = entry.count
		}
	}
	return bestVal, bestCount
}

func detectDelta(values []interface{}) bool {
	if len(values) < 3 {
		return false
	}
	nums := make([]int64, len(values))
	for i, v := range values {
		if _, isBool := v.(bool); isBool {
			return false
		}
		f, ok := v.(float64)
		if !ok || f != math.Trunc(f) {
			return false
		}
		nums[i] = int64(f)
	}
	deltas := make([]int64, len(nums))
	deltas[0] = nums[0]
	for i := 1; i < len(nums); i++ {
		deltas[i] = nums[i] - nums[i-1]
	}
	absLen := 0
	for _, n := range nums {
		absLen += len(strconv.FormatInt(n, 10))
	}
	deltaLen := 0
	for _, d := range deltas {
		deltaLen += len(strconv.FormatInt(d, 10))
	}
	return deltaLen < int(float64(absLen)*0.7)
}

func detectInterned(values []interface{}) []string {
	if len(values) < 3 {
		return nil
	}
	for _, v := range values {
		if _, ok := v.(string); !ok {
			return nil
		}
	}
	// Build distinct list preserving order
	seen := make(map[string]bool)
	var distinct []string
	for _, v := range values {
		s := v.(string)
		if !seen[s] {
			seen[s] = true
			distinct = append(distinct, s)
		}
	}
	maxDistinct := int(math.Ceil(float64(len(values)) / 3.0))
	if len(distinct) < 2 || len(distinct) > maxDistinct {
		return nil
	}
	rawLen := 0
	for _, v := range values {
		rawLen += len(v.(string))
	}
	poolLen := len(distinct) - 1
	for _, d := range distinct {
		poolLen += len(d)
	}
	indexLen := len(values)
	if poolLen+indexLen >= int(float64(rawLen)*0.9) {
		return nil
	}
	return distinct
}

func detectComputed(key string, values []interface{}, allKeys []string, records []map[string]interface{}) string {
	if len(values) == 0 {
		return ""
	}
	for _, v := range values {
		if _, isBool := v.(bool); isBool {
			return ""
		}
		if _, isNum := v.(float64); !isNum {
			return ""
		}
	}
	ops := []string{"+", "-", "*"}
	for _, op := range ops {
		for _, a := range allKeys {
			if a == key {
				continue
			}
			for _, b := range allKeys {
				if b == key {
					continue
				}
				match := true
				for _, r := range records {
					av, aok := r[a].(float64)
					bv, bok := r[b].(float64)
					kv, kok := r[key].(float64)
					if !aok || !bok || !kok {
						match = false
						break
					}
					var expected float64
					switch op {
					case "+":
						expected = av + bv
					case "-":
						expected = av - bv
					case "*":
						expected = av * bv
					}
					if kv != expected {
						match = false
						break
					}
				}
				if match {
					return a + op + b
				}
			}
		}
	}
	return ""
}

func encodeBundle(name string, records []map[string]interface{}, indent int) string {
	prefix := strings.Repeat(" ", indent)

	if len(records) == 0 {
		return fmt.Sprintf("%s%s{}:\n", prefix, name)
	}

	// Get ordered keys from first record
	keys := orderedKeys(records[0])

	var orderedFields []FieldDecl
	arithmeticKeys := make(map[string]bool)
	deltaKeys := make(map[string]bool)
	defaultKeys := make(map[string]interface{})
	nestedKeys := make(map[string]bool)
	var variableKeys []string
	internedKeys := make(map[string][]string)
	computedKeys := make(map[string]string)

	// Phase 1: categorize nested + arithmetic
	var remainingKeys []string
	for _, key := range keys {
		values := make([]interface{}, len(records))
		for i, r := range records {
			values[i] = r[key]
		}

		// Check nested
		allArrays := true
		for _, v := range values {
			if _, ok := v.([]interface{}); !ok {
				allArrays = false
				break
			}
		}
		if allArrays {
			nestedKeys[key] = true
			continue
		}

		// Check arithmetic
		if start, step, ok := detectArithmetic(values); ok {
			arithmeticKeys[key] = true
			stepVal := step
			mod := &Modifier{Type: "arithmetic", Start: start}
			if step != 1 {
				mod.Step = &stepVal
			}
			orderedFields = append(orderedFields, FieldDecl{Name: key, Modifier: mod})
			continue
		}

		remainingKeys = append(remainingKeys, key)
	}

	// Phase 2: detect computed fields among ALL remaining keys (before delta/default)
	var computedToRemove []string
	for _, key := range remainingKeys {
		values := make([]interface{}, len(records))
		for i, r := range records {
			values[i] = r[key]
		}
		expr := detectComputed(key, values, remainingKeys, records)
		if expr != "" {
			computedKeys[key] = expr
			computedToRemove = append(computedToRemove, key)
		}
	}
	for _, key := range computedToRemove {
		var filtered []string
		for _, k := range remainingKeys {
			if k != key {
				filtered = append(filtered, k)
			}
		}
		remainingKeys = filtered
	}

	// Phase 3: categorize remaining as delta, interned, default, or variable
	for _, key := range remainingKeys {
		values := make([]interface{}, len(records))
		for i, r := range records {
			values[i] = r[key]
		}

		// Check delta
		if detectDelta(values) {
			deltaKeys[key] = true
			continue
		}

		// Check interned
		if pool := detectInterned(values); pool != nil {
			internedKeys[key] = pool
			continue
		}

		// Check modal default
		modalVal, modalCount := findModalDefault(values)
		if modalCount > len(records)/2 {
			defaultKeys[key] = modalVal
			continue
		}

		variableKeys = append(variableKeys, key)
	}

	// Ensure at least one field produces record body content
	if len(variableKeys) == 0 && len(deltaKeys) == 0 && len(nestedKeys) == 0 && len(internedKeys) == 0 {
		for _, key := range keys {
			if arithmeticKeys[key] {
				delete(arithmeticKeys, key)
				var newFields []FieldDecl
				for _, f := range orderedFields {
					if f.Name != key {
						newFields = append(newFields, f)
					}
				}
				orderedFields = newFields
				variableKeys = append(variableKeys, key)
				break
			}
			if _, ok := defaultKeys[key]; ok {
				delete(defaultKeys, key)
				variableKeys = append(variableKeys, key)
				break
			}
			if _, ok := computedKeys[key]; ok {
				delete(computedKeys, key)
				variableKeys = append(variableKeys, key)
				break
			}
		}
	}

	// Computed fields
	for _, key := range keys {
		if expr, ok := computedKeys[key]; ok {
			orderedFields = append(orderedFields, FieldDecl{Name: key, Modifier: &Modifier{Type: "computed", Expr: expr}})
		}
	}

	// Delta fields
	for _, key := range keys {
		if deltaKeys[key] {
			orderedFields = append(orderedFields, FieldDecl{Name: key, Modifier: &Modifier{Type: "delta"}})
		}
	}

	// Interned fields
	for _, key := range keys {
		if pool, ok := internedKeys[key]; ok {
			orderedFields = append(orderedFields, FieldDecl{Name: key, Modifier: &Modifier{Type: "interned", Pool: pool}})
		}
	}

	// Variable fields
	for _, key := range variableKeys {
		orderedFields = append(orderedFields, FieldDecl{Name: key})
	}

	// Default fields (sorted by frequency desc for trailing elision)
	type defaultEntry struct {
		key   string
		val   interface{}
		count int
	}
	var defaults []defaultEntry
	for key, val := range defaultKeys {
		count := 0
		for _, r := range records {
			if jsonEqual(r[key], val) {
				count++
			}
		}
		defaults = append(defaults, defaultEntry{key, val, count})
	}
	// Sort by count desc
	for i := 0; i < len(defaults); i++ {
		for j := i + 1; j < len(defaults); j++ {
			if defaults[j].count > defaults[i].count {
				defaults[i], defaults[j] = defaults[j], defaults[i]
			}
		}
	}
	for _, d := range defaults {
		orderedFields = append(orderedFields, FieldDecl{Name: d.key, Modifier: &Modifier{Type: "default", DefaultValue: d.val}})
	}

	// Nested fields
	for _, key := range keys {
		if nestedKeys[key] {
			orderedFields = append(orderedFields, FieldDecl{Name: key, Modifier: &Modifier{Type: "nested"}})
		}
	}

	// Check sparsity - use sparse mode when ≥8 non-arithmetic fields and >75% null/empty
	var nonArithKeys []string
	for _, k := range keys {
		if !arithmeticKeys[k] && !nestedKeys[k] {
			if _, isComputed := computedKeys[k]; !isComputed {
				nonArithKeys = append(nonArithKeys, k)
			}
		}
	}
	useSparse := false
	if len(nonArithKeys) >= 8 {
		nullCount := 0
		totalCells := 0
		for _, r := range records {
			for _, k := range nonArithKeys {
				totalCells++
				v := r[k]
				if v == nil || v == "" {
					nullCount++
				}
			}
		}
		useSparse = nullCount > int(float64(totalCells)*0.75)
	}

	// Emit header
	sparsePrefix := ""
	if useSparse {
		sparsePrefix = "~"
	}
	var headerParts []string
	for _, fd := range orderedFields {
		s := fd.Name
		if fd.Modifier != nil {
			switch fd.Modifier.Type {
			case "arithmetic":
				s += "@" + valueToDhoom(fd.Modifier.Start)
				if fd.Modifier.Step != nil {
					s += "+" + strconv.Itoa(*fd.Modifier.Step)
				}
			case "default":
				s += "|" + valueToDhoom(fd.Modifier.DefaultValue)
			case "nested":
				s += ">"
			case "delta":
				s += "^"
			case "morphism":
				s += "->" + fd.Modifier.Target
			case "interned":
				s += "&"
			case "computed":
				s += "#" + fd.Modifier.Expr
			case "constraint":
				s += "!" + fd.Modifier.Constraint
			}
		}
		headerParts = append(headerParts, s)
	}

	out := fmt.Sprintf("%s%s%s{%s}:\n", prefix, sparsePrefix, name, strings.Join(headerParts, ", "))

	// Emit pool lines
	for _, key := range keys {
		if pool, ok := internedKeys[key]; ok {
			out += prefix + "&" + key + "[" + strings.Join(pool, ", ") + "]\n"
		}
	}

	// Emit records
	var recFields []FieldDecl
	for _, f := range orderedFields {
		if f.Modifier == nil || (f.Modifier.Type != "arithmetic" && f.Modifier.Type != "computed") {
			recFields = append(recFields, f)
		}
	}

	if useSparse {
		for _, record := range records {
			var pairs []string
			for _, rf := range recFields {
				if rf.Modifier != nil && rf.Modifier.Type == "nested" {
					continue
				}
				val := record[rf.Name]
				if rf.Modifier != nil && rf.Modifier.Type == "interned" {
					if s, ok := val.(string); ok && rf.Modifier.Pool != nil {
						for idx, pv := range rf.Modifier.Pool {
							if pv == s {
								pairs = append(pairs, rf.Name+":"+strconv.Itoa(idx))
								break
							}
						}
						continue
					}
				}
				if val != nil && val != "" {
					pairs = append(pairs, rf.Name+":"+valueToDhoom(val))
				}
			}
			if len(pairs) == 0 {
				for _, rf := range recFields {
					if rf.Modifier == nil || rf.Modifier.Type != "nested" {
						pairs = append(pairs, rf.Name+":null")
						break
					}
				}
			}
			out += prefix + strings.Join(pairs, ", ") + "\n"
		}
		return out
	}

	recordIdx := 0
	prevDelta := make(map[string]float64)

	for _, record := range records {
		var values []string
		var nestedBundles []struct {
			name    string
			records []map[string]interface{}
		}

		for _, rf := range recFields {
			if rf.Modifier != nil && rf.Modifier.Type == "nested" {
				if arr, ok := record[rf.Name].([]interface{}); ok {
					recs := make([]map[string]interface{}, len(arr))
					for i, item := range arr {
						if m, ok := item.(map[string]interface{}); ok {
							recs[i] = m
						}
					}
					nestedBundles = append(nestedBundles, struct {
						name    string
						records []map[string]interface{}
					}{"", recs})
				}
				continue
			}

			val := record[rf.Name]

			if rf.Modifier != nil && rf.Modifier.Type == "delta" {
				numVal := float64(0)
				if f, ok := val.(float64); ok {
					numVal = f
				}
				if recordIdx == 0 {
					prevDelta[rf.Name] = numVal
					values = append(values, valueToDhoom(numVal))
				} else {
					prev := prevDelta[rf.Name]
					delta := numVal - prev
					prevDelta[rf.Name] = numVal
					values = append(values, valueToDhoom(delta))
				}
			} else if rf.Modifier != nil && rf.Modifier.Type == "interned" {
				if s, ok := val.(string); ok && rf.Modifier.Pool != nil {
					for idx, pv := range rf.Modifier.Pool {
						if pv == s {
							values = append(values, strconv.Itoa(idx))
							break
						}
					}
				} else {
					values = append(values, valueToDhoom(val))
				}
			} else if rf.Modifier != nil && rf.Modifier.Type == "default" {
				if jsonEqual(val, rf.Modifier.DefaultValue) {
					values = append(values, "")
				} else {
					values = append(values, ":"+valueToDhoom(val))
				}
			} else {
				values = append(values, valueToDhoom(val))
			}
		}

		// Trailing elision
		for len(values) > 0 && values[len(values)-1] == "" {
			values = values[:len(values)-1]
		}

		out += prefix + strings.Join(values, ", ")

		if len(nestedBundles) > 0 {
			out += ",\n"
			for _, nb := range nestedBundles {
				out += encodeBundle(nb.name, nb.records, indent+2)
			}
		} else {
			out += "\n"
		}

		recordIdx++
	}

	return out
}
// Since Go maps are unordered, we use json.Marshal/Unmarshal to preserve
// the natural ordering from the original JSON.
func orderedKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// Sort alphabetically for deterministic output
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	return keys
}

// Encode encodes a Go value into DHOOM format.
// The value should be either a map[string]interface{} with a single key
// whose value is a []interface{} of maps, or a []interface{} of maps.
func Encode(value interface{}) (string, error) {
	switch v := value.(type) {
	case map[string]interface{}:
		keys := orderedKeys(v)
		if len(keys) == 1 {
			if arr, ok := v[keys[0]].([]interface{}); ok {
				records := make([]map[string]interface{}, len(arr))
				for i, item := range arr {
					if m, ok := item.(map[string]interface{}); ok {
						records[i] = m
					}
				}
				return encodeBundle(keys[0], records, 0), nil
			}
		}
		return "", &DhoomError{Message: "Top-level object must have exactly one key (the bundle name)"}
	case []interface{}:
		records := make([]map[string]interface{}, len(v))
		for i, item := range v {
			if m, ok := item.(map[string]interface{}); ok {
				records[i] = m
			}
		}
		return encodeBundle("data", records, 0), nil
	}
	return "", &DhoomError{Message: "Top-level value must be an object or array"}
}
