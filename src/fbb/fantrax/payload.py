"""Typed accessors for Fantrax's loosely-typed JSON payloads.

Fantrax returns deeply nested, sparsely-documented JSON whose shape varies by view.
Rather than model every response, the collector reaches into it through these helpers,
which keep untyped values from leaking into the rest of the codebase.
"""

# Anything `json.loads` can produce. Declaring it recursively lets the narrowing
# helpers below bind real element types instead of `Unknown`.
type JsonValue = (
    str | int | float | bool | None | list['JsonValue'] | dict[str, 'JsonValue']
)
type Json = dict[str, JsonValue]


def obj(source: Json, key: str) -> Json:
    """Nested object at `key`, or an empty dict when absent or the wrong type."""
    value = source.get(key)
    return value if isinstance(value, dict) else {}


def rows(source: Json, key: str) -> list[Json]:
    """List of objects at `key`, dropping any non-object entries."""
    value = source.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def text(source: Json, key: str) -> str | None:
    value = source.get(key)
    return None if value is None else str(value)


def number(source: Json, key: str) -> float | None:
    value = source.get(key)
    return float(value) if isinstance(value, (int, float)) else None


def strings(source: Json, key: str) -> list[str]:
    value = source.get(key)
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]
