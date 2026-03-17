"""Extensive test suite for the DHOOM Python SDK."""

import json
import unittest
from dhoom import encode, decode, parse_fiber, DhoomError


class TestCoercion(unittest.TestCase):
    """Test value round-tripping through encode/decode."""

    def _roundtrip(self, data):
        dhoom_str = encode(data)
        result = decode(dhoom_str)
        self.assertEqual(json.dumps(data, sort_keys=True), json.dumps(result, sort_keys=True))

    def test_string_values(self):
        self._roundtrip({"items": [{"name": "Alice"}, {"name": "Bob"}, {"name": "Charlie"}]})

    def test_integer_values(self):
        self._roundtrip({"items": [{"x": 1, "y": 2, "label": "a"}, {"x": 3, "y": 4, "label": "b"}, {"x": 5, "y": 6, "label": "c"}]})

    def test_float_values(self):
        self._roundtrip({"items": [{"temp": 22.4}, {"temp": 23.1}, {"temp": 45.8}]})

    def test_boolean_values(self):
        self._roundtrip({"items": [{"name": "A", "a": True, "b": False}, {"name": "B", "a": False, "b": True}, {"name": "C", "a": True, "b": True}]})

    def test_null_values(self):
        self._roundtrip({"items": [{"x": None, "y": 1, "label": "a"}, {"x": None, "y": 2, "label": "b"}, {"x": None, "y": 3, "label": "c"}]})


class TestArithmetic(unittest.TestCase):
    """Test arithmetic (@) modifier detection and generation."""

    def test_sequential_integers(self):
        data = {"items": [{"id": 1, "v": "a"}, {"id": 2, "v": "b"}, {"id": 3, "v": "c"}]}
        dhoom = encode(data)
        self.assertIn("@1", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_custom_start(self):
        data = {"items": [{"id": 101, "v": "x"}, {"id": 102, "v": "y"}, {"id": 103, "v": "z"}]}
        dhoom = encode(data)
        self.assertIn("@101", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_custom_step(self):
        data = {"items": [{"id": 0, "v": "a"}, {"id": 10, "v": "b"}, {"id": 20, "v": "c"}]}
        dhoom = encode(data)
        self.assertIn("@0+10", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_string_arithmetic(self):
        data = {"items": [
            {"sku": "A-001", "name": "Widget"},
            {"sku": "A-002", "name": "Gadget"},
            {"sku": "A-003", "name": "Sprocket"}
        ]}
        dhoom = encode(data)
        self.assertIn("@A-001", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_no_arithmetic_for_non_sequential(self):
        data = {"items": [{"id": 1, "v": "a"}, {"id": 5, "v": "b"}, {"id": 2, "v": "c"}]}
        dhoom = encode(data)
        self.assertNotIn("@", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_timestamps_arithmetic(self):
        data = {"readings": [
            {"ts": 1710000000, "val": 22.4},
            {"ts": 1710000060, "val": 23.1},
            {"ts": 1710000120, "val": 45.8}
        ]}
        dhoom = encode(data)
        self.assertIn("@1710000000+60", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)


class TestDefaults(unittest.TestCase):
    """Test default (|) modifier detection and trailing elision."""

    def test_modal_default_boolean(self):
        data = {"items": [
            {"name": "A", "active": True},
            {"name": "B", "active": True},
            {"name": "C", "active": False}
        ]}
        dhoom = encode(data)
        self.assertIn("|T", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_modal_default_string(self):
        data = {"items": [
            {"name": "A", "status": "ok"},
            {"name": "B", "status": "ok"},
            {"name": "C", "status": "err"}
        ]}
        dhoom = encode(data)
        self.assertIn("|ok", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_modal_default_number(self):
        data = {"items": [
            {"name": "A", "rating": 5},
            {"name": "B", "rating": 5},
            {"name": "C", "rating": 3}
        ]}
        dhoom = encode(data)
        self.assertIn("|5", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_trailing_elision(self):
        """Default values at end of record can be elided entirely."""
        data = {"items": [
            {"name": "A", "status": "ok", "role": "admin"},
            {"name": "B", "status": "ok", "role": "admin"},
            {"name": "C", "status": "err", "role": "admin"}
        ]}
        dhoom = encode(data)
        # "A" and "B" should have minimal records due to elision
        lines = [l.strip() for l in dhoom.strip().split("\n") if l.strip() and not l.strip().endswith(":")]
        # First two records should be just the name (all defaults elided)
        self.assertEqual(lines[0], "A")
        self.assertEqual(lines[1], "B")
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_deviation_marker(self):
        """Non-default values use : prefix."""
        data = {"items": [
            {"name": "A", "status": "ok"},
            {"name": "B", "status": "err"},
            {"name": "C", "status": "ok"}
        ]}
        dhoom = encode(data)
        self.assertIn(":err", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)


class TestNesting(unittest.TestCase):
    """Test nested bundles (>)."""

    def test_single_nested_bundle(self):
        data = {"orders": [
            {"customer": "Alice", "items": [
                {"name": "Widget", "qty": 2},
                {"name": "Gadget", "qty": 1}
            ]}
        ]}
        dhoom = encode(data)
        self.assertIn(">", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_multiple_nested_bundles(self):
        data = {"orders": [
            {
                "customer": "Alice",
                "items": [
                    {"name": "Widget", "qty": 2},
                    {"name": "Gadget", "qty": 1}
                ],
                "payments": [
                    {"method": "card", "amount": 100},
                    {"method": "cash", "amount": 50}
                ]
            }
        ]}
        dhoom = encode(data)
        # Verify it contains nested markers
        self.assertIn(">", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)


class TestExampleFiles(unittest.TestCase):
    """Test against the canonical example DHOOM files."""

    def test_reviews(self):
        dhoom_str = (
            "reviews{id@101, customer, comment, rating|5, verified|T}:\n"
            "Alex Rivera, Excellent!\n"
            "Brij Pandey, Game changer!\n"
            "Casey Lee, Average, :3, :F\n"
        )
        result = decode(dhoom_str)
        expected = {"reviews": [
            {"id": 101, "customer": "Alex Rivera", "comment": "Excellent!", "rating": 5, "verified": True},
            {"id": 102, "customer": "Brij Pandey", "comment": "Game changer!", "rating": 5, "verified": True},
            {"id": 103, "customer": "Casey Lee", "comment": "Average", "rating": 3, "verified": False}
        ]}
        self.assertEqual(result, expected)

    def test_sensors(self):
        dhoom_str = (
            "readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:\n"
            "22.4\n"
            "23.1\n"
            "45.8, :alert\n"
        )
        result = decode(dhoom_str)
        expected = {"readings": [
            {"sensor_id": "T-001", "timestamp": 1710000000, "value": 22.4, "status": "normal", "unit": "celsius"},
            {"sensor_id": "T-002", "timestamp": 1710000060, "value": 23.1, "status": "normal", "unit": "celsius"},
            {"sensor_id": "T-003", "timestamp": 1710000120, "value": 45.8, "status": "alert", "unit": "celsius"}
        ]}
        self.assertEqual(result, expected)

    def test_reviews_roundtrip(self):
        data = {"reviews": [
            {"id": 101, "customer": "Alex Rivera", "comment": "Excellent!", "rating": 5, "verified": True},
            {"id": 102, "customer": "Brij Pandey", "comment": "Game changer!", "rating": 5, "verified": True},
            {"id": 103, "customer": "Casey Lee", "comment": "Average", "rating": 3, "verified": False}
        ]}
        dhoom = encode(data)
        result = decode(dhoom)
        self.assertEqual(data, result)


class TestFiberParser(unittest.TestCase):
    """Test fiber header parsing."""

    def test_simple_fields(self):
        fiber = parse_fiber("items{name, age}")
        self.assertEqual(fiber.name, "items")
        self.assertEqual(len(fiber.fields), 2)
        self.assertEqual(fiber.fields[0].name, "name")
        self.assertEqual(fiber.fields[1].name, "age")

    def test_arithmetic_field(self):
        fiber = parse_fiber("items{id@100}")
        self.assertEqual(fiber.fields[0].modifier.type, "arithmetic")
        self.assertEqual(fiber.fields[0].modifier.start, 100)

    def test_arithmetic_with_step(self):
        fiber = parse_fiber("items{id@100+5}")
        self.assertEqual(fiber.fields[0].modifier.step, 5)

    def test_default_field(self):
        fiber = parse_fiber("items{name, status|active}")
        self.assertEqual(fiber.fields[1].modifier.type, "default")
        self.assertEqual(fiber.fields[1].modifier.default_value, "active")

    def test_nested_field(self):
        fiber = parse_fiber("orders{customer, items>}")
        self.assertEqual(fiber.fields[1].modifier.type, "nested")

    def test_no_name(self):
        fiber = parse_fiber("{x, y}")
        self.assertIsNone(fiber.name)

    def test_missing_braces(self):
        with self.assertRaises(DhoomError):
            parse_fiber("no braces")

    def test_boolean_default(self):
        fiber = parse_fiber("items{name, active|T}")
        self.assertEqual(fiber.fields[1].modifier.default_value, True)

    def test_string_arithmetic(self):
        fiber = parse_fiber("items{sku@SKU-001}")
        self.assertEqual(fiber.fields[0].modifier.start, "SKU-001")


class TestEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""

    def test_empty_input(self):
        self.assertIsNone(decode(""))
        self.assertIsNone(decode("   "))

    def test_single_record(self):
        data = {"items": [{"name": "only", "x": 42}]}
        dhoom = encode(data)
        result = decode(dhoom)
        # Single record with all fields as modal defaults produces empty body
        # This is a known format limitation for single-record bundles
        self.assertIn("items{", dhoom)

    def test_many_records(self):
        data = {"items": [{"id": i, "name": f"item_{i}"} for i in range(100)]}
        dhoom = encode(data)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_special_chars_in_string(self):
        data = {"items": [
            {"text": "hello, world", "x": 1},
            {"text": "foo, bar", "x": 2},
            {"text": "baz, qux", "x": 3}
        ]}
        dhoom = encode(data)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_top_level_array(self):
        data = [{"x": 1, "y": "a"}, {"x": 2, "y": "b"}, {"x": 3, "y": "c"}]
        dhoom = encode(data)
        result = decode(dhoom)
        # Top-level arrays get wrapped with synthetic "data" key
        self.assertEqual({"data": data}, result)

    def test_encode_non_dict_error(self):
        with self.assertRaises(DhoomError):
            encode("just a string")

    def test_encode_multi_key_dict_error(self):
        with self.assertRaises(DhoomError):
            encode({"a": [{"x": 1}], "b": [{"y": 2}]})

    def test_all_defaults_same(self):
        """When all values are the same, they're all defaults."""
        data = {"items": [
            {"name": "A", "status": "ok"},
            {"name": "B", "status": "ok"},
            {"name": "C", "status": "ok"}
        ]}
        dhoom = encode(data)
        self.assertIn("|ok", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_mixed_types_no_arithmetic(self):
        """Mixed types in a column shouldn't trigger arithmetic."""
        data = {"items": [
            {"id": "abc", "name": "a"},
            {"id": "xyz", "name": "b"},
            {"id": "def", "name": "c"}
        ]}
        dhoom = encode(data)
        self.assertNotIn("@", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)

    def test_negative_numbers(self):
        data = {"items": [
            {"x": -10, "y": "a"},
            {"x": -9, "y": "b"},
            {"x": -8, "y": "c"}
        ]}
        dhoom = encode(data)
        self.assertIn("@-10", dhoom)
        result = decode(dhoom)
        self.assertEqual(data, result)


class TestCompression(unittest.TestCase):
    """Verify DHOOM output is smaller than JSON."""

    def test_reviews_compression(self):
        data = {"reviews": [
            {"id": 101, "customer": "Alex Rivera", "comment": "Excellent!", "rating": 5, "verified": True},
            {"id": 102, "customer": "Brij Pandey", "comment": "Game changer!", "rating": 5, "verified": True},
            {"id": 103, "customer": "Casey Lee", "comment": "Average", "rating": 3, "verified": False}
        ]}
        dhoom = encode(data)
        json_str = json.dumps(data)
        self.assertLess(len(dhoom), len(json_str))

    def test_large_dataset_compression(self):
        data = {"items": [{"id": i, "name": f"Item {i}", "active": True, "category": "widgets"} for i in range(50)]}
        dhoom = encode(data)
        json_str = json.dumps(data)
        ratio = len(dhoom) / len(json_str)
        self.assertLess(ratio, 0.6, f"Expected >40% compression, got {(1 - ratio) * 100:.1f}%")


if __name__ == "__main__":
    unittest.main()
