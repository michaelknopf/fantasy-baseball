# >>> savi-python-base managed import - DO NOT REMOVE <<<
import '.venv/lib/python3.13/site-packages/savi_python_base/justfiles/python.just'

# Override the unit test path
unit_tests_path := "tests/fbb_test/unit"

# Install source & dependency packages into venv
[group('setup')]
install:
    uv sync
