# Goldsky Cleanup Commands

## Step 1: List existing subgraphs and tags

```bash
# List all subgraphs
goldsky subgraph list

# Check tags for Sepolia subgraph
goldsky subgraph tag list capsign-base-sepolia

# Check tags for Mainnet subgraph  
goldsky subgraph tag list capsign-base
```

## Step 2: Delete tags (MUST be done before deleting subgraphs)

```bash
# Delete Sepolia prod tag
goldsky subgraph tag delete capsign-base-sepolia --tag prod

# Delete Mainnet prod tag (if exists)
goldsky subgraph tag delete capsign-base --tag prod
```

## Step 3: Delete old subgraph versions

```bash
# List all versions to see what needs deletion
goldsky subgraph list capsign-base-sepolia
goldsky subgraph list capsign-base

# Delete specific versions (replace VERSION with actual version numbers)
goldsky subgraph delete capsign-base-sepolia/VERSION
goldsky subgraph delete capsign-base/VERSION

# Or delete all versions (use with caution!)
# goldsky subgraph delete capsign-base-sepolia --all
# goldsky subgraph delete capsign-base --all
```

## Step 4: Deploy new subgraphs

```bash
cd /Users/matt/Desktop/capsign/subgraph

# Deploy to Sepolia
pnpm run deploy:sepolia

# Deploy to Mainnet
pnpm run deploy:mainnet
```

## Quick Cleanup Script (if you want to delete everything)

```bash
# WARNING: This deletes all versions!
goldsky subgraph tag delete capsign-base-sepolia --tag prod || true
goldsky subgraph delete capsign-base-sepolia --all || true

goldsky subgraph tag delete capsign-base --tag prod || true
goldsky subgraph delete capsign-base --all || true
```

