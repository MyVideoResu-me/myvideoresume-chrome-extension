#!/bin/bash
# Chrome Extension Build Script (Bash)
# Usage: ./scripts/build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔧 Building Chrome Extension..."

cd "$EXTENSION_DIR"

# Read version from manifest
VERSION=$(jq -r '.version' manifest.json)
echo "📋 Version: $VERSION"

ZIP_NAME="myvideoresume-chrome-extension-$VERSION.zip"

# Clean if --clean flag passed
if [ "$1" == "--clean" ]; then
    echo "🧹 Cleaning old builds..."
    rm -f *.zip
fi

# Remove old specific build if exists
rm -f "$ZIP_NAME"

# Create zip with extension files
echo "📦 Creating $ZIP_NAME..."
zip -r "$ZIP_NAME" \
    manifest.json \
    *.js \
    *.html \
    *.css \
    icons/ \
    imgs/ \
    libs/ \
    -x "*.zip" \
    -x ".git*" \
    -x "*.md" \
    -x "node_modules/*" \
    -x "scripts/*"

# Show result
SIZE=$(du -h "$ZIP_NAME" | cut -f1)
echo ""
echo "✅ Build complete!"
echo "   File: $ZIP_NAME"
echo "   Size: $SIZE"
echo ""
echo "📤 Upload to Chrome Web Store:"
echo "   https://chrome.google.com/webstore/devconsole"

