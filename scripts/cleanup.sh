#!/bin/bash

# Cleanup old subgraphs before deploying new versions

set -e

echo "🧹 Cleaning up old subgraphs..."
echo ""

# Delete Base Mainnet prod tag (points to 0.2.16)
echo "1. Deleting capsign-base/prod tag..."
goldsky subgraph tag delete capsign-base/0.2.16 --tag prod || echo "Tag already deleted or doesn't exist"

# Delete Base Mainnet 0.2.16
echo "2. Deleting capsign-base/0.2.16..."
goldsky subgraph delete capsign-base/0.2.16 || echo "Version already deleted or doesn't exist"

# Delete old Base Sepolia 0.2.16 (new 0.2.17 already deployed)
echo "3. Deleting old capsign-base-sepolia/0.2.16..."
goldsky subgraph delete capsign-base-sepolia/0.2.16 || echo "Version already deleted or doesn't exist"

echo ""
echo "✅ Cleanup complete! You can now deploy:"
echo "   cd /Users/matt/Desktop/capsign/subgraph"
echo "   ./scripts/deploy.sh base"

