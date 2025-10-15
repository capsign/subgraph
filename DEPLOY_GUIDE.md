# CapSign Subgraph Deployment Guide

## Prerequisites

1. **Login to Goldsky**:
```bash
goldsky login
```

## Complete Deployment Process

### Step 1: Check what exists

```bash
cd /Users/matt/Desktop/capsign/subgraph

# List all subgraphs
goldsky subgraph list

# Check Sepolia tags
goldsky subgraph tag list capsign-base-sepolia

# Check Mainnet tags
goldsky subgraph tag list capsign-base
```

### Step 2: Delete existing tags

```bash
# Delete Sepolia prod tag (ignore errors if doesn't exist)
goldsky subgraph tag delete capsign-base-sepolia --tag prod

# Delete Mainnet prod tag (ignore errors if doesn't exist)
goldsky subgraph tag delete capsign-base --tag prod
```

### Step 3: Delete old subgraph versions (optional but recommended)

```bash
# Delete all Sepolia versions
goldsky subgraph delete capsign-base-sepolia --all

# Delete all Mainnet versions  
goldsky subgraph delete capsign-base --all
```

### Step 4: Deploy new subgraphs

```bash
# Deploy to Sepolia (with updated schema and factory support)
pnpm run deploy:sepolia

# Deploy to Mainnet (with updated schema and factory support)
pnpm run deploy:mainnet
```

## One-Liner Cleanup + Deploy

```bash
cd /Users/matt/Desktop/capsign/subgraph && \
goldsky subgraph tag delete capsign-base-sepolia --tag prod 2>/dev/null || true && \
goldsky subgraph delete capsign-base-sepolia --all 2>/dev/null || true && \
goldsky subgraph tag delete capsign-base --tag prod 2>/dev/null || true && \
goldsky subgraph delete capsign-base --all 2>/dev/null || true && \
echo "✅ Cleanup complete! Now deploying..." && \
pnpm run deploy:sepolia && \
pnpm run deploy:mainnet
```

## Verify Deployment

After deployment, check:

```bash
# List subgraphs
goldsky subgraph list

# Check Sepolia
goldsky subgraph tag list capsign-base-sepolia

# Check Mainnet
goldsky subgraph tag list capsign-base

# Get endpoint URLs
goldsky subgraph get capsign-base-sepolia
goldsky subgraph get capsign-base
```

## Troubleshooting

### If deployment fails with "subgraph already exists":
```bash
# Delete the specific version that exists
goldsky subgraph delete capsign-base-sepolia/0.2.16
goldsky subgraph delete capsign-base/0.2.16

# Then redeploy
pnpm run deploy:sepolia
pnpm run deploy:mainnet
```

### If tag creation fails:
```bash
# Delete the tag first
goldsky subgraph tag delete capsign-base-sepolia --tag prod
goldsky subgraph tag delete capsign-base --tag prod

# Then create manually
goldsky subgraph tag create capsign-base-sepolia/0.2.16 --tag prod
goldsky subgraph tag create capsign-base/0.2.16 --tag prod
```

## What Changed in This Deployment

- ✅ Updated schema with factory support
- ✅ Multi-owner wallet support via `Owner` entity
- ✅ Cleaner field names (`type` instead of `walletType`, removed duplicate `address` fields)
- ✅ WalletFactory, OfferingFactory, TokenFactory event handlers
- ✅ Compliance module tracking
- ✅ Network-specific start blocks (Sepolia vs Mainnet)

