# >>> savi-python-base managed import - DO NOT REMOVE <<<
import '.venv/lib/python3.13/site-packages/savi_python_base/justfiles/python.just'

# Override the unit test path
unit_tests_path := "tests/fbb_test/unit"

# Install source & dependency packages into venv
[group('setup')]
install:
    uv sync

# Install the browser Playwright drives for the login step
[group('setup')]
install-browser:
    uv run playwright install chromium

# Install the web app's dependencies
[group('setup')]
install-web:
    cd web && pnpm install

# Log in to Fantrax; opens a browser and saves cookies for about a year
[group('collect')]
login:
    uv run fbb fantrax login

# Collect a snapshot from Fantrax into snapshots/
[group('collect')]
collect *args:
    uv run fbb fantrax collect {{ args }}

# Derive web/src/data/board.json from snapshots/latest
[group('collect')]
board *args:
    uv run fbb board build {{ args }}

# Collect a fresh snapshot and rebuild the board from it
[group('collect')]
refresh: collect board

# Serve the web app at http://localhost:3000
[group('web')]
dev:
    cd web && pnpm dev
