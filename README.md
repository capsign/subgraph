# CapSign Subgraph - Multi-Chain Deployment

## Overview
The CapSign subgraph indexes data from **Base Sepolia** (testnet) and **Base Mainnet** using Goldsky.

Since all infrastructure contracts use **CREATE2 deployment**, they have the **same addresses** on both networks - only the start blocks differ.

## Multi-Chain Setup

We use The Graph's standard multi-network approach:
- **`networks.json`**: Defines network-specific configuration (addresses + start blocks)
- **`subgraph.yaml`**: Single config file that references `networks.json`
- **Build with `--network` flag**: Generates network-specific artifacts
- **Deploy to Goldsky**: Separate subgraph instances per network

## Deployment

### Deploy to Base Sepolia (Testnet)
```bash
cd subgraph
pnpm run deploy:sepolia
```

This will:
1. Backup `subgraph.yaml`
2. Update network fields to `base-sepolia`
3. Run `pnpm codegen` to generate types
4. Run `graph build` to build artifacts
5. Deploy to Goldsky as `capsign-base-sepolia/0.2.16`
6. Tag as `prod`
7. Restore original `subgraph.yaml`

### Deploy to Base Mainnet
```bash
cd subgraph
pnpm run deploy:mainnet
```

This will:
1. Backup `subgraph.yaml`
2. Update network fields to `base`
3. Run `pnpm codegen` to generate types
4. Run `graph build` to build artifacts
5. Deploy to Goldsky as `capsign-base/0.2.16`
6. Tag as `prod`
7. Restore original `subgraph.yaml`

## Network Configuration

### Base Sepolia (testnet)
- **Chain ID**: 84532
- **Start Block**: 32,367,301 (WalletFactory deployment)
- **Goldsky Instance**: `capsign-base-sepolia`

### Base Mainnet
- **Chain ID**: 8453
- **Start Block**: 36,593,031 (infrastructure deployment)
- **Goldsky Instance**: `capsign-base`

## Contract Addresses (Same on Both Networks - CREATE2)

### Infrastructure
- **DiamondFactory**: `0x036478441d6673FE1215c62df08e68a8255974cA`
- **EAS**: `0x4200000000000000000000000000000000000021`

### Factories
- **WalletFactory**: `0x9D65c0fF2fa20252f4E9Db24f9601b38658987bD`
- **OfferingFactory**: `0xd3a61dC2a539cabb335a1de30cc84bb3239c792b`
- **TokenFactory**: `0x24Fa5Dbf02e2E15F6d10f6DDC96a9EA74380Ad41`

### Compliance Modules
- **DocumentComplianceModule**: `0x802ee5ca1030F0F9bF0c6c8756E969750BfE40D1`
- **EligibilityComplianceModule**: `0x5ea4931C63A05F329601e72e526f150F5c2e07e1`
- **WhitelistComplianceModule**: `0x1753bC2Bc7044cc4209028d091838fCA278DC81D`
- **AccreditationConditionModule**: `0xFF1bf26fB3c24d16f709B4a530Fb27fa1Bd4F1D7`
- **LockupConditionModule**: `0x3b38D865D489236D13149f92436cEB4df2f2772e`
- **VestingConditionModule**: `0x6a4D1fCC8e64e5503D03F5367dE7B91BB91C879C`

## GraphQL Endpoints

After deployment, your subgraphs will be available at:
- **Sepolia**: `https://api.goldsky.com/api/public/project_<id>/subgraphs/capsign-base-sepolia/prod/gn`
- **Mainnet**: `https://api.goldsky.com/api/public/project_<id>/subgraphs/capsign-base/prod/gn`

## Schema Updates

When you update `schema.graphql`:
1. Run `pnpm codegen` to regenerate TypeScript types
2. Update mapping files if needed
3. Bump version in `package.json`
4. Deploy to both networks

## Notes

- **Separate Instances**: Each network has its own subgraph instance in Goldsky
- **Independent Versioning**: Each instance can be versioned separately
- **No Cross-Chain Queries**: Queries are per-network (standard pattern)
- **Same Codebase**: Both networks use the same schema/mappings, just different start blocks
