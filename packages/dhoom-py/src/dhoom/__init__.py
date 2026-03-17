"""DHOOM — Davis Human-readable Optimized Object Markup.

A compact, human-readable serialization format built on fiber bundle geometry.
"""

from dhoom.codec import encode, decode, parse_fiber, DhoomError

__all__ = ["encode", "decode", "parse_fiber", "DhoomError"]
__version__ = "0.3.0"
