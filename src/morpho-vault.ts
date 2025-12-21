import { Address, BigInt, log } from "@graphprotocol/graph-ts"
import { Transfer, Deposit, Withdraw } from "../generated/MorphoVaultUSDC/ERC4626"
import { ERC4626 } from "../generated/MorphoVaultUSDC/ERC4626"
import { ERC20 } from "../generated/MorphoVaultUSDC/ERC20"
import { MorphoVault, MorphoPosition, MorphoDeposit, MorphoWithdrawal } from "../generated/schema"

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * Ensure vault entity exists
 */
function ensureVault(vaultAddress: Address, timestamp: BigInt, txHash: string): MorphoVault {
  let vault = MorphoVault.load(vaultAddress.toHexString())
  
  if (!vault) {
    vault = new MorphoVault(vaultAddress.toHexString())
    
    // Bind to vault contract
    let vaultContract = ERC4626.bind(vaultAddress)
    
    // Get vault metadata
    vault.name = vaultContract.name()
    vault.symbol = vaultContract.symbol()
    vault.decimals = vaultContract.decimals()
    
    // Get underlying asset
    let assetAddress = vaultContract.asset()
    vault.asset = assetAddress
    
    // Get asset metadata
    let assetContract = ERC20.bind(assetAddress)
    vault.assetSymbol = assetContract.symbol()
    vault.assetDecimals = assetContract.decimals()
    
    // Initialize metrics
    vault.totalAssets = vaultContract.totalAssets()
    vault.totalSupply = vaultContract.totalSupply()
    
    vault.createdAt = timestamp
    vault.createdTx = txHash
    vault.lastUpdatedAt = timestamp
    
    vault.save()
    
    log.info("Created Morpho vault: {} ({})", [vault.name, vault.id])
  }
  
  return vault
}

/**
 * Update position for a user
 */
function updatePosition(
  vault: MorphoVault,
  userAddress: Address,
  timestamp: BigInt,
  txHash: string
): void {
  // Skip zero address
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  
  let positionId = vault.id + "-" + userAddress.toHexString()
  let position = MorphoPosition.load(positionId)
  
  // Bind to vault contract
  let vaultContract = ERC4626.bind(Address.fromString(vault.id))
  
  // Get current shares balance
  let sharesBalance = vaultContract.balanceOf(userAddress)
  
  if (sharesBalance.equals(BigInt.zero())) {
    // Position closed - remove entity
    if (position) {
      log.info("Closing position: {}", [positionId])
      // Note: We don't actually delete to preserve history
      // Just set shares to 0
      position.shares = BigInt.zero()
      position.assetValue = BigInt.zero()
      position.lastUpdatedAt = timestamp
      position.lastUpdatedTx = txHash
      position.save()
    }
    return
  }
  
  // Create or update position
  if (!position) {
    position = new MorphoPosition(positionId)
    position.vault = vault.id
    position.user = userAddress
    position.firstDepositAt = timestamp
    
    log.info("Created new position: {}", [positionId])
  }
  
  position.shares = sharesBalance
  position.assetValue = vaultContract.convertToAssets(sharesBalance)
  position.lastUpdatedAt = timestamp
  position.lastUpdatedTx = txHash
  
  position.save()
}

/**
 * Update vault metrics
 */
function updateVaultMetrics(vault: MorphoVault, timestamp: BigInt): void {
  let vaultContract = ERC4626.bind(Address.fromString(vault.id))
  
  vault.totalAssets = vaultContract.totalAssets()
  vault.totalSupply = vaultContract.totalSupply()
  vault.lastUpdatedAt = timestamp
  
  vault.save()
}

/**
 * Handle Transfer events
 */
export function handleTransfer(event: Transfer): void {
  let vault = ensureVault(event.address, event.block.timestamp, event.transaction.hash.toHexString())
  
  // Update sender position (if not mint)
  if (event.params.from.toHexString() != ZERO_ADDRESS) {
    updatePosition(vault, event.params.from, event.block.timestamp, event.transaction.hash.toHexString())
  }
  
  // Update receiver position (if not burn)
  if (event.params.to.toHexString() != ZERO_ADDRESS) {
    updatePosition(vault, event.params.to, event.block.timestamp, event.transaction.hash.toHexString())
  }
  
  // Update vault metrics
  updateVaultMetrics(vault, event.block.timestamp)
}

/**
 * Handle Deposit events
 */
export function handleDeposit(event: Deposit): void {
  let vault = ensureVault(event.address, event.block.timestamp, event.transaction.hash.toHexString())
  
  // Create deposit record
  let depositId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  let deposit = new MorphoDeposit(depositId)
  
  deposit.vault = vault.id
  deposit.sender = event.params.sender
  deposit.owner = event.params.owner
  deposit.assets = event.params.assets
  deposit.shares = event.params.shares
  deposit.timestamp = event.block.timestamp
  deposit.tx = event.transaction.hash
  deposit.blockNumber = event.block.number
  
  deposit.save()
  
  log.info("Deposit: {} deposited {} assets for {} shares", [
    event.params.owner.toHexString(),
    event.params.assets.toString(),
    event.params.shares.toString()
  ])
  
  // Update position (Transfer event will also trigger this, but this ensures it's done)
  updatePosition(vault, event.params.owner, event.block.timestamp, event.transaction.hash.toHexString())
  
  // Update vault metrics
  updateVaultMetrics(vault, event.block.timestamp)
}

/**
 * Handle Withdraw events
 */
export function handleWithdraw(event: Withdraw): void {
  let vault = ensureVault(event.address, event.block.timestamp, event.transaction.hash.toHexString())
  
  // Create withdrawal record
  let withdrawalId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  let withdrawal = new MorphoWithdrawal(withdrawalId)
  
  withdrawal.vault = vault.id
  withdrawal.sender = event.params.sender
  withdrawal.receiver = event.params.receiver
  withdrawal.owner = event.params.owner
  withdrawal.assets = event.params.assets
  withdrawal.shares = event.params.shares
  withdrawal.timestamp = event.block.timestamp
  withdrawal.tx = event.transaction.hash
  withdrawal.blockNumber = event.block.number
  
  withdrawal.save()
  
  log.info("Withdrawal: {} withdrew {} assets by burning {} shares", [
    event.params.owner.toHexString(),
    event.params.assets.toString(),
    event.params.shares.toString()
  ])
  
  // Update position (Transfer event will also trigger this, but this ensures it's done)
  updatePosition(vault, event.params.owner, event.block.timestamp, event.transaction.hash.toHexString())
  
  // Update vault metrics
  updateVaultMetrics(vault, event.block.timestamp)
}

