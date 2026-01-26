# Subgraph Versioning Strategy

## Version Numbering

We use semantic versioning for subgraph deployments:

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Breaking schema changes or complete re-indexing required
- **MINOR**: New entities, new event handlers, or additive schema changes
- **PATCH**: Bug fixes, handler logic changes that don't affect schema

## Deployment Workflow

### 1. Making Changes

1. **Edit the chain-specific manifest** (not `subgraph.yaml`):
   - `subgraph.base-sepolia.yaml` for Base Sepolia
   - `subgraph.base.yaml` for Base mainnet

2. **The build process** copies the chain manifest to `subgraph.yaml` automatically

3. **Bump the version** in the manifest file's `specVersion` or in `package.json`

### 2. Deploy Without `prod` Tag First

Always deploy new versions without applying the `prod` tag until indexing completes:

```bash
# Deploy to Sepolia (creates version without prod tag)
pnpm run deploy:sepolia

# Monitor sync progress
goldsky subgraph list
```

### 3. Wait for Sync to Complete

Check sync status before tagging:

```bash
goldsky subgraph get capsign-base-sepolia/X.X.X
```

Look for `synced: true` or 100% block progress.

### 4. Apply `prod` Tag

Once fully synced, move the `prod` tag:

```bash
# Remove old prod tag
goldsky subgraph tag delete capsign-base-sepolia --tag prod

# Apply to new version
goldsky subgraph tag create capsign-base-sepolia/X.X.X --tag prod
```

## When to Re-Index from Start Block

**Always re-index** (no grafting) when:

- Adding new event handlers for events emitted in the past
- Changing how existing entities are populated
- Fixing bugs in handler logic that affected historical data
- Adding new entities that should capture historical data

**Grafting is safe** when:

- Adding new entities that only need future data
- Adding new event handlers for events that haven't been emitted yet
- Purely additive changes with no historical data requirements

## Grafting Configuration

Goldsky supports grafting to speed up deployments. Add to manifest:

```yaml
features:
  - grafting

graft:
  base: QmXXXXX  # Deployment ID of base subgraph
  block: 12345678  # Block to graft from
```

**Important**: Grafting copies data as-is. If you need to backfill historical data for new entities/handlers, you must re-index from the original `startBlock`.

## Start Blocks

Our canonical start blocks (first protocol deployment):

| Network      | Start Block |
|-------------|-------------|
| Base Sepolia | `35119881`  |
| Base Mainnet | `24916636`  |

These should **never change** unless we redeploy the entire protocol.

## Maintaining Parity

**Critical**: Base Sepolia and Base mainnet subgraphs must have feature parity.

When adding features:

1. Update `subgraph.base-sepolia.yaml` first
2. Test on Sepolia
3. Copy changes to `subgraph.base.yaml`
4. Deploy to mainnet

The only differences between manifests should be:

- Contract addresses
- Start blocks
- Network name

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.13.3 | 2026-01-26 | Full re-index, promissory notes handler, payment currency capture |
| 0.13.1 | 2026-01-25 | Added TokenNoteFacet ABI and NoteInitialized handler |
| 0.12.x | Earlier | Share class support, offering factory, compliance modules |

## Troubleshooting

### Data appears missing after deployment

1. Check if `startBlock` was accidentally changed
2. Verify the new version is synced to current block
3. Ensure `prod` tag points to correct version

### Sync takes too long

For major re-indexes, expect:

- Base Sepolia: ~2-4 hours (fewer blocks)
- Base Mainnet: ~6-12 hours (more blocks)

Consider deploying during off-hours and monitoring via:

```bash
watch -n 30 "goldsky subgraph get capsign-base-sepolia/X.X.X"
```

### Handler errors during indexing

Check Goldsky logs:

```bash
goldsky subgraph logs capsign-base-sepolia/X.X.X
```

Common issues:

- Missing ABI entries for bound contracts
- Null entity access (entity not created before update)
- Arithmetic overflow in BigInt operations
