// DHOOM — Davis Human-readable Optimized Object Markup
// A compact, human-readable serialization format built on fiber bundle geometry.

package dev.dhoom;

public class DhoomException extends RuntimeException {
    private final Integer line;

    public DhoomException(String message) {
        super(message);
        this.line = null;
    }

    public DhoomException(String message, int line) {
        super("Line " + line + ": " + message);
        this.line = line;
    }

    public Integer getLine() { return line; }
}
