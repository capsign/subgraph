#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the network from command line argument
NETWORK=$1

if [ -z "$NETWORK" ]; then
    echo -e "${RED}Error: Network argument required${NC}"
    echo "Usage: ./scripts/deploy.sh [sepolia|mainnet]"
    exit 1
fi

# Validate network
if [ "$NETWORK" != "sepolia" ] && [ "$NETWORK" != "mainnet" ]; then
    echo -e "${RED}Error: Invalid network '$NETWORK'${NC}"
    echo "Valid options: sepolia, mainnet"
    exit 1
fi

# Set network name and start blocks for subgraph.yaml
if [ "$NETWORK" = "sepolia" ]; then
    GRAPH_NETWORK="base-sepolia"
    GOLDSKY_NAME="capsign-base-sepolia"
    START_BLOCK_INFRA="31965997"
    START_BLOCK_FACTORY="32367301"
else
    GRAPH_NETWORK="base"
    GOLDSKY_NAME="capsign-base"
    START_BLOCK_INFRA="36593031"
    START_BLOCK_FACTORY="36593031"
fi

echo -e "${GREEN}🚀 Deploying CapSign Subgraph to $NETWORK${NC}"
echo "   Network: $GRAPH_NETWORK"
echo "   Goldsky: $GOLDSKY_NAME"
echo ""

# Get current version from package.json
VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}📦 Version: $VERSION${NC}"
echo ""

# Backup original subgraph.yaml
echo -e "${YELLOW}📋 Backing up subgraph.yaml...${NC}"
cp subgraph.yaml subgraph.yaml.backup

# Replace network and start blocks in subgraph.yaml
echo -e "${YELLOW}🔄 Updating subgraph.yaml for $GRAPH_NETWORK...${NC}"
if [ "$(uname)" = "Darwin" ]; then
    # macOS - Replace both possible values with the target network
    sed -i '' "s/network: base$/network: $GRAPH_NETWORK/g" subgraph.yaml
    sed -i '' "s/network: base-sepolia$/network: $GRAPH_NETWORK/g" subgraph.yaml
    # Update start blocks for infrastructure (DiamondFactory, EAS)
    sed -i '' "s/startBlock: 31965997/startBlock: $START_BLOCK_INFRA/g" subgraph.yaml
    sed -i '' "s/startBlock: 36593031/startBlock: $START_BLOCK_INFRA/g" subgraph.yaml
    # Update start blocks for factories
    sed -i '' "s/startBlock: 32367301/startBlock: $START_BLOCK_FACTORY/g" subgraph.yaml
else
    # Linux - Replace both possible values with the target network
    sed -i "s/network: base$/network: $GRAPH_NETWORK/g" subgraph.yaml
    sed -i "s/network: base-sepolia$/network: $GRAPH_NETWORK/g" subgraph.yaml
    # Update start blocks for infrastructure
    sed -i "s/startBlock: 31965997/startBlock: $START_BLOCK_INFRA/g" subgraph.yaml
    sed -i "s/startBlock: 36593031/startBlock: $START_BLOCK_INFRA/g" subgraph.yaml
    # Update start blocks for factories
    sed -i "s/startBlock: 32367301/startBlock: $START_BLOCK_FACTORY/g" subgraph.yaml
fi

# Trap to restore on error or exit
cleanup() {
    echo -e "${YELLOW}🔙 Restoring original subgraph.yaml...${NC}"
    mv subgraph.yaml.backup subgraph.yaml
}
trap cleanup EXIT

# Generate code
echo -e "${YELLOW}🔨 Generating TypeScript types...${NC}"
pnpm run codegen

# Build
echo -e "${YELLOW}🏗️  Building subgraph for $GRAPH_NETWORK...${NC}"
graph build

# Deploy to Goldsky
echo -e "${YELLOW}🚢 Deploying to Goldsky...${NC}"
goldsky subgraph deploy $GOLDSKY_NAME/$VERSION --path .

# Tag as prod
echo -e "${YELLOW}🏷️  Tagging as prod...${NC}"
goldsky subgraph tag create $GOLDSKY_NAME/$VERSION --tag prod

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "   Subgraph: ${GREEN}$GOLDSKY_NAME/$VERSION${NC}"
echo -e "   Tag: ${GREEN}prod${NC}"

