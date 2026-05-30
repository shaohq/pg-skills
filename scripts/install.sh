#!/bin/bash
# pg-skills installer
# Usage: curl -fsSL https://raw.githubusercontent.com/shaohq/pg-skills/master/scripts/install.sh | bash
set -e

REPO="https://github.com/shaohq/pg-skills.git"
TMP=$(mktemp -d)

echo "[pg-skills] Downloading..."
git clone --depth=1 "$REPO" "$TMP" 2>/dev/null

# agents
mkdir -p .opencode/agents
cp -r "$TMP/agents/"* .opencode/agents/
echo "  ✓ agents installed"

# commands
mkdir -p .opencode/commands
cp "$TMP/commands/"*.md .opencode/commands/
echo "  ✓ commands installed"

# skills
mkdir -p .opencode/skills
cp -r "$TMP/skills/"* .opencode/skills/
echo "  ✓ skills installed"

# scripts
mkdir -p .opencode/scripts
cp "$TMP/scripts/"*.py .opencode/scripts/ 2>/dev/null || true
echo "  ✓ scripts installed"

# pg-spec/config.yaml
if [ ! -f pg-spec/config.yaml ]; then
    mkdir -p pg-spec
    cp "$TMP/scripts/config.default.yaml" pg-spec/config.yaml
    echo "  ✓ pg-spec/config.yaml created"
fi

rm -rf "$TMP"
echo ""
echo "✓ pg-skills installed. Start opencode and try /3-pg-apply"
