// VaultAdapterFacet events
import {
  VaultRegistered,
  VaultUnregistered,
  VaultDeposit,
  VaultWithdrawal,
  VaultValuationUpdated,
} from "../../generated/templates/WalletDiamond/VaultAdapterFacet";
import {
  DeFiVault,
  VaultPosition,
  VaultDeposit as VaultDepositEntity,
  VaultWithdrawal as VaultWithdrawalEntity,
  VaultValuationUpdate,
  Wallet,
} from "../../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// ============ DEFI INTEGRATION HANDLERS ============

/**
 * Handle VaultRegistered event (VaultAdapterFacet)
 * Registers an ERC-4626 vault for treasury management
 */
export function handleVaultRegistered(event: VaultRegistered): void {
  const walletAddress = event.address.toHexString();
  const vaultAddress = event.params.vault.toHexString();
  const vaultId = `${vaultAddress}-${walletAddress}`;
  
  // Create DeFiVault entity
  let vault = new DeFiVault(vaultId);
  vault.vault = event.params.vault;
  vault.wallet = walletAddress;
  vault.asset = event.params.asset;
  vault.name = event.params.name;
  vault.registeredAt = event.block.timestamp;
  vault.registeredTx = event.transaction.hash;
  vault.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "VAULT_REGISTERED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.vault = vaultId;
  activity.vaultName = event.params.name;
  activity.save();
}

/**
 * Handle VaultUnregistered event (VaultAdapterFacet)
 * Removes a vault from the registered list
 */
export function handleVaultUnregistered(event: VaultUnregistered): void {
  const walletAddress = event.address.toHexString();
  const vaultAddress = event.params.vault.toHexString();
  const vaultId = `${vaultAddress}-${walletAddress}`;
  
  // Load and remove DeFiVault entity
  let vault = DeFiVault.load(vaultId);
  if (vault) {
    // Note: The Graph doesn't support entity deletion, so we just mark it as unregistered
    // by setting a flag or removing from wallet's registeredVaults would require schema changes
    // For now, we just create an activity to track the event
  }
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "VAULT_UNREGISTERED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle VaultDeposit event (VaultAdapterFacet)
 * Records deposit to an ERC-4626 vault
 */
export function handleVaultDeposit(event: VaultDeposit): void {
  const walletAddress = event.address.toHexString();
  const vaultAddress = event.params.vault.toHexString();
  const investmentId = event.params.investmentId;
  const positionId = `${walletAddress}-${investmentId.toString()}`;
  const vaultId = `${vaultAddress}-${walletAddress}`;
  const depositId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Load or create VaultPosition
  let position = VaultPosition.load(positionId);
  if (!position) {
    position = new VaultPosition(positionId);
    position.wallet = walletAddress;
    position.vault = vaultId;
    position.investmentId = investmentId;
    position.sharesBalance = BigInt.fromI32(0);
    position.costBasis = BigInt.fromI32(0);
    position.currentValue = BigInt.fromI32(0);
    position.unrealizedGain = BigInt.fromI32(0);
    position.totalRealizedGain = BigInt.fromI32(0);
    position.isActive = true;
    position.createdAt = event.block.timestamp;
    position.createdTx = event.transaction.hash;
    position.lastUpdated = event.block.timestamp;
  }
  
  // Update position
  position.sharesBalance = position.sharesBalance.plus(event.params.sharesReceived);
  position.costBasis = position.costBasis.plus(event.params.assetsDeposited);
  // At deposit time, currentValue equals costBasis (no yield yet)
  position.currentValue = position.costBasis;
  position.unrealizedGain = BigInt.fromI32(0);
  position.lastUpdated = event.block.timestamp;
  position.save();
  
  // Create VaultDeposit entity
  let deposit = new VaultDepositEntity(depositId);
  deposit.position = positionId;
  deposit.wallet = walletAddress;
  deposit.vaultAddress = event.params.vault;
  deposit.asset = event.params.asset;
  deposit.assetsDeposited = event.params.assetsDeposited;
  deposit.sharesReceived = event.params.sharesReceived;
  deposit.timestamp = event.block.timestamp;
  deposit.tx = event.transaction.hash;
  deposit.blockNumber = event.block.number;
  deposit.save();
  
  // Create activity with vault details
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}-deposit`;
  let activity = createActivity(
    activityId,
    "VAULT_DEPOSIT",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.vaultPosition = positionId;
  activity.vaultDeposit = depositId;
  activity.vault = vaultId;
  activity.vaultAmount = event.params.assetsDeposited;
  
  // Get vault name from the DeFiVault entity
  let vaultEntity = DeFiVault.load(vaultId);
  if (vaultEntity) {
    activity.vaultName = vaultEntity.name;
  }
  activity.save();
}

/**
 * Handle VaultWithdrawal event (VaultAdapterFacet)
 * Records withdrawal from an ERC-4626 vault
 */
export function handleVaultWithdrawal(event: VaultWithdrawal): void {
  const walletAddress = event.address.toHexString();
  const vaultAddress = event.params.vault.toHexString();
  const investmentId = event.params.investmentId;
  const positionId = `${walletAddress}-${investmentId.toString()}`;
  const vaultId = `${vaultAddress}-${walletAddress}`;
  const withdrawalId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Load position
  let position = VaultPosition.load(positionId);
  if (position) {
    // Calculate proportional cost basis reduction
    const originalShares = position.sharesBalance;
    const sharesRedeemed = event.params.sharesRedeemed;
    
    // Cost basis reduction = (original cost basis * shares redeemed) / original shares
    let costBasisReduction = BigInt.fromI32(0);
    if (originalShares.gt(BigInt.fromI32(0))) {
      costBasisReduction = position.costBasis.times(sharesRedeemed).div(originalShares);
    }
    
    // Update position
    position.sharesBalance = position.sharesBalance.minus(sharesRedeemed);
    position.costBasis = position.costBasis.minus(costBasisReduction);
    position.totalRealizedGain = position.totalRealizedGain.plus(event.params.realizedGain);
    position.isActive = !event.params.isFullExit;
    position.lastUpdated = event.block.timestamp;
    
    if (event.params.isFullExit) {
      position.exitedAt = event.block.timestamp;
      position.exitedTx = event.transaction.hash;
    }
    
    position.save();
  }
  
  // Create VaultWithdrawal entity
  let withdrawal = new VaultWithdrawalEntity(withdrawalId);
  withdrawal.position = positionId;
  withdrawal.wallet = walletAddress;
  withdrawal.vaultAddress = event.params.vault;
  withdrawal.sharesRedeemed = event.params.sharesRedeemed;
  withdrawal.assetsReceived = event.params.assetsReceived;
  withdrawal.realizedGain = event.params.realizedGain;
  withdrawal.isFullExit = event.params.isFullExit;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.tx = event.transaction.hash;
  withdrawal.blockNumber = event.block.number;
  withdrawal.save();
  
  // Create activity
  // Create activity with vault details
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}-withdrawal`;
  let activity = createActivity(
    activityId,
    "VAULT_WITHDRAWAL",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.vaultPosition = positionId;
  activity.vaultWithdrawal = withdrawalId;
  activity.vault = vaultId;
  activity.vaultAmount = event.params.assetsReceived;
  
  // Get vault name from the DeFiVault entity
  let vaultEntity = DeFiVault.load(vaultId);
  if (vaultEntity) {
    activity.vaultName = vaultEntity.name;
  }
  activity.save();
}

/**
 * Handle VaultValuationUpdated event (VaultAdapterFacet)
 * Records valuation update for a vault position
 */
export function handleVaultValuationUpdated(event: VaultValuationUpdated): void {
  const walletAddress = event.address.toHexString();
  const vaultAddress = event.params.vault.toHexString();
  const investmentId = event.params.investmentId;
  const positionId = `${walletAddress}-${investmentId.toString()}`;
  const vaultId = `${vaultAddress}-${walletAddress}`;
  const updateId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Update position
  let position = VaultPosition.load(positionId);
  if (position) {
    const newValue = event.params.newValue;
    const costBasis = position.costBasis;
    
    // Calculate unrealized gain (newValue - costBasis)
    // Note: Can be negative (loss)
    let unrealizedGain = BigInt.fromI32(0);
    if (newValue.ge(costBasis)) {
      unrealizedGain = newValue.minus(costBasis);
    } else {
      // Store as negative (loss) - multiply by -1
      unrealizedGain = costBasis.minus(newValue).neg();
    }
    
    position.currentValue = newValue;
    position.unrealizedGain = unrealizedGain;
    position.lastUpdated = event.block.timestamp;
    position.save();
  }
  
  // Create VaultValuationUpdate entity
  let update = new VaultValuationUpdate(updateId);
  update.position = positionId;
  update.wallet = walletAddress;
  update.vaultAddress = event.params.vault;
  update.oldValue = event.params.oldValue;
  update.newValue = event.params.newValue;
  update.timestamp = event.block.timestamp;
  update.tx = event.transaction.hash;
  update.blockNumber = event.block.number;
  update.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}-valuation`;
  let activity = createActivity(
    activityId,
    "VAULT_VALUATION_UPDATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.vaultPosition = positionId;
  activity.save();
}
