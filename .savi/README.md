# savi-python-base Override Files

This directory contains native-format override files for tool configurations.
These files are merged ON TOP of any `[tool.savi-python-base.{plugin}.overrides]`
settings in pyproject.toml.

## Files

- `pyrightconfig.json5` - Pyright overrides (JSON5 format with comment support)
- `ruff.toml` - Ruff overrides (TOML format)
- `mypy.toml` - MyPy overrides (TOML format)

## JSON5 Format

For `.json5` files, JSON5 is a superset of JSON that supports:
- Single-line (`//`) and multi-line (`/* */`) comments
- Trailing commas in objects and arrays
- Unquoted object keys
- Single-quoted strings

Example:
```json5
{
  // Add extra include paths
  "include": ["src", "tests", "generated"],

  // Relax type checking for tests
  "reportUnknownMemberType": "warning",
}
```

## Merge Order

1. Base profile from savi-python-base (e.g., strict.toml)
2. `[tool.savi-python-base.{plugin}.overrides]` from pyproject.toml
3. Native override file from this directory (highest priority)

## Notes

- For mypy.toml, use quoted section names for per-module config: `["mypy-tests.*"]`
