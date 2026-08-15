#!/usr/bin/env bash
# Publish web/dist to the deploy repo's gh-pages branch.
#
# The branch is generated output, so each deploy replaces it wholesale rather
# than accumulating history. Runs in a scratch clone to keep web/dist from
# becoming a git repo of its own.
set -euo pipefail

REPO="${DEPLOY_REPO:-git@github.com:michaelknopf/fantasy-baseball.git}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/web/dist"

if [[ ! -f "$DIST/index.html" ]]; then
    echo "No build found at $DIST — run 'just build-web' first." >&2
    exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git init --quiet --initial-branch=gh-pages "$WORK"
cp -R "$DIST"/. "$WORK/"

# Without this Pages runs the output through Jekyll, which drops _-prefixed paths.
touch "$WORK/.nojekyll"

git -C "$WORK" add --all
git -C "$WORK" commit --quiet -m "Publish $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C "$WORK" push --force --quiet "$REPO" gh-pages

echo "Published $(git -C "$WORK" rev-parse --short HEAD) to $REPO"
