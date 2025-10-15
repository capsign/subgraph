#!/bin/bash

# Deploy Subgraph to Goldsky
# Usage: ./scripts/deploy.sh [base-sepolia|base]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the subgraph directory
if [ ! -f "subgraph.base-sepolia.yaml" ]; then
    print_error "This script must be run from the subgraph directory"
    exit 1
fi

# Get network parameter
NETWORK=${1}

if [ -z "$NETWORK" ]; then
    print_error "Network argument required"
    echo "Usage: ./scripts/deploy.sh [base-sepolia|base]"
    exit 1
fi

# Set subgraph name based on network
case $NETWORK in
    "base-sepolia")
        SUBGRAPH_NAME="capsign-base-sepolia"
        YARN_SUFFIX="sepolia"
        ;;
    "base")
        SUBGRAPH_NAME="capsign-base"
        YARN_SUFFIX="mainnet"
        ;;
    *)
        print_error "Unsupported network: $NETWORK"
        print_status "Supported networks: base-sepolia, base"
        exit 1
        ;;
esac

VERSION=$(node -p "require('./package.json').version")
SUBGRAPH_FULL_NAME="${SUBGRAPH_NAME}/${VERSION}"

print_status "Deploying CapSign subgraph to $NETWORK using Goldsky..."
print_status "Subgraph: $SUBGRAPH_FULL_NAME"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found, installing dependencies..."
    pnpm install
fi

# Check if goldsky CLI is available
if ! command -v goldsky &> /dev/null; then
    print_error "Goldsky CLI not found! Please install it first:"
    echo "  npm install -g @goldsky/cli"
    exit 1
fi

print_status "Step 1/6: Running codegen..."
if pnpm run codegen:$YARN_SUFFIX; then
    print_success "Codegen completed"
else
    print_error "Codegen failed"
    exit 1
fi

print_status "Step 2/6: Building subgraph..."
if pnpm run build:$YARN_SUFFIX; then
    print_success "Build completed"
else
    print_error "Build failed"
    exit 1
fi

print_status "Step 3/6: Deleting existing prod tag..."
print_warning "You will be prompted to confirm deletion of the 'prod' tag"
if goldsky subgraph tag delete $SUBGRAPH_FULL_NAME --tag prod; then
    print_success "Prod tag deleted"
else
    print_warning "Prod tag deletion failed (might not exist yet)"
fi

print_status "Step 4/6: Deleting existing subgraph version..."
if goldsky subgraph delete $SUBGRAPH_FULL_NAME; then
    print_success "Subgraph version deleted"
else
    print_warning "Subgraph deletion failed (might not exist yet)"
fi

print_status "Step 5/6: Deploying new subgraph version..."
if goldsky subgraph deploy $SUBGRAPH_FULL_NAME --path .; then
    print_success "Subgraph deployed successfully"
else
    print_error "Subgraph deployment failed"
    exit 1
fi

print_status "Step 6/6: Creating prod tag..."
if goldsky subgraph tag create $SUBGRAPH_FULL_NAME --tag prod; then
    print_success "Prod tag created"
else
    print_error "Failed to create prod tag"
    exit 1
fi

print_success "🎉 Subgraph deployment complete!"
echo ""
print_status "Deployment Summary:"
echo "  📊 Subgraph: $SUBGRAPH_FULL_NAME"
echo "  🏷️  Tag: prod"
echo "  🌐 Network: $NETWORK"
echo ""
print_status "Next steps:"
echo "  1. Wait for subgraph to sync (check Goldsky dashboard)"
echo "  2. Test factory operations to verify subgraph indexing"
echo "  3. Check that new implementations appear in subgraph queries"
echo ""
print_status "Useful commands:"
echo "  goldsky subgraph list                    # List all subgraphs"
echo "  goldsky subgraph logs $SUBGRAPH_FULL_NAME  # View deployment logs"
echo "  goldsky subgraph status $SUBGRAPH_FULL_NAME # Check sync status"
