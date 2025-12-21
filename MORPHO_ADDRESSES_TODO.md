# Morpho Vault Addresses - TODO

## Base Mainnet

To find Morpho vault addresses on Base mainnet:

1. Visit https://app.morpho.org
2. Connect wallet and switch to Base network
3. Browse available vaults (usually USDC, WETH vaults)
4. Click on a vault to see its address
5. Or check Morpho docs: https://docs.morpho.org/deployments

**Common Morpho vaults on Base (verify these):**
- Morpho USDC Vault: `0x...` (TBD)
- Morpho WETH Vault: `0x...` (TBD)

## Base Sepolia

For testing on Base Sepolia:

1. Check if Morpho has test deployments on Base Sepolia
2. If not, we can:
   - Deploy our own test ERC-4626 vault
   - Or use Sepolia mainnet and bridge to Base Sepolia
   - Or just test on Base mainnet with small amounts

## How to Update Subgraph

Once you have the addresses:

1. **Update `subgraph.base.yaml`:**
   ```yaml
   source:
     address: "0x<ACTUAL_VAULT_ADDRESS>"
     startBlock: <DEPLOYMENT_BLOCK>
   ```

2. **Update `subgraph.base-sepolia.yaml`:**
   ```yaml
   source:
     address: "0x<TESTNET_VAULT_ADDRESS>"
     startBlock: <DEPLOYMENT_BLOCK>
   ```

3. **Find deployment block:**
   - Go to Basescan: https://basescan.org/address/<vault_address>
   - Look for "Contract Creation" transaction
   - Note the block number

4. **Deploy subgraph:**
   ```bash
   pnpm run deploy:base
   # or
   pnpm run deploy:sepolia
   ```

## Alternative: Use Morpho's Subgraph

Morpho may have their own subgraph that we can query directly without indexing ourselves.

Check: https://thegraph.com/explorer/subgraphs?search=morpho&order=name

If they have a subgraph on Base, we can:
- Query it directly from our frontend
- Combine data with our CapSign subgraph
- No need to index Morpho events ourselves

This would be simpler but requires checking Morpho's infrastructure.

