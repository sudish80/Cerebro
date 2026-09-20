#!/usr/bin/env bash
# Generate SVG diagrams from Mermaid files
# Requires: npm i -g @mermaid-js/mermaid-cli

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Generating SVG diagrams..."

for mmd in "$DIR"/*.mmd; do
    name=$(basename "$mmd" .mmd)
    echo "  $name.mmd → $name.svg"
    mmdc -i "$mmd" -o "$DIR/$name.svg" \
      --backgroundColor transparent \
      --theme default \
      --width 1200
done

echo "Done! SVGs in $DIR/"
ls -la "$DIR"/*.svg