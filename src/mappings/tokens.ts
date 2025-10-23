import {
  TokenInitialized,
  MaxSupplyUpdated,
  Paused,
  Unpaused,
  AccountFrozen,
  AccountUnfrozen,
  LotFrozen,
  LotUnfrozen,
  UserRoleUpdated,
  StockSplitApplied,
  StockDividendApplied,
  EntityPublicStatusUpdated,
  LotCreated,
} from "../../generated/templates/TokenDiamond/TokenDiamond";
import { ShareClass, Diamond, TokenRoleMember, CorporateAction, Lot } from "../../generated/schema";
import { BigInt, Address, Bytes } from "@graphprotocol/graph-ts";

/**
 * Handle TokenInitialized event
 * This updates the ShareClass with metadata from the initialization
 */
export function handleTokenInitialized(event: TokenInitialized): void {
  const tokenAddress = event.address.toHexString();

  // Load ShareClass entity (should already exist from TokenFactory event)
  let shareClass = ShareClass.load(tokenAddress);
  if (!shareClass) {
    // Fallback for tokens created before factory was deployed
    shareClass = new ShareClass(tokenAddress);
    shareClass.admin = event.transaction.from; // Fallback to transaction sender as admin
    shareClass.createdAt = event.block.timestamp;
    shareClass.createdTx = event.transaction.hash;
    shareClass.complianceConditions = []; // Empty array fallback
    shareClass.assetType = "ShareClass";
    
    // Initialize admin state
    shareClass.paused = false;
    shareClass.frozenAccounts = [];
    shareClass.frozenLots = [];
    
    // Initialize transfer conditions
    shareClass.transferController = null;
    shareClass.hasTransferConditions = false;
    
    // Initialize ShareClass-specific fields
    shareClass.maxSupply = BigInt.fromI32(0); // 0 = unlimited
    
    // Initialize corporate actions (1:1 ratios)
    shareClass.splitNum = BigInt.fromI32(1);
    shareClass.splitDen = BigInt.fromI32(1);
    shareClass.divNum = BigInt.fromI32(1);
    shareClass.divDen = BigInt.fromI32(1);
    shareClass.totalSplits = 0;
    shareClass.totalDividends = 0;
    shareClass.isPublic = false;
  }

  // Update with initialization data
  shareClass.name = event.params.name;
  shareClass.symbol = event.params.symbol;
  shareClass.decimals = event.params.decimals; // Already i32 from event
  shareClass.totalSupply = BigInt.fromI32(0);
  
  shareClass.save();
  
  // Update diamond type
  const diamond = Diamond.load(tokenAddress);
  if (diamond) {
    diamond.diamondType = "TOKEN";
    diamond.token = tokenAddress;
    diamond.save();
  }
}

/**
 * Handle LotCreated event from TokenLotsFacet
 * Creates Lot entity when tokens are issued to investors
 */
export function handleLotCreated(event: LotCreated): void {
  const tokenAddress = event.address.toHexString();
  const lotId = event.params.lotId.toHexString();
  
  // Load token
  const shareClass = ShareClass.load(tokenAddress);
  if (!shareClass) {
    // Token not indexed yet - skip
    return;
  }
  
  // Create Lot entity
  const lot = new Lot(lotId);
  lot.lotId = BigInt.fromByteArray(event.params.lotId);
  lot.token = tokenAddress;
  lot.assetId = tokenAddress; // For now, assetId = tokenAddress
  lot.owner = event.params.to.toHexString(); // Reference to Wallet entity by ID
  lot.balance = event.params.quantity;
  lot.quantity = event.params.quantity;
  lot.costBasis = event.params.costBasis;
  lot.acquisitionDate = event.block.timestamp;
  lot.createdAt = event.block.timestamp;
  lot.acquiredFrom = event.address; // Token contract address
  lot.parentLotId = null; // No parent lot for newly created lots
  lot.paymentCurrency = Bytes.fromHexString("0x0000000000000000000000000000000000000000"); // Default to ETH
  lot.save();
  
  // Update total supply (use rawQuantity from event)
  shareClass.totalSupply = shareClass.totalSupply.plus(event.params.rawQuantity);
  shareClass.save();
}

/**
 * Handle MaxSupplyUpdated event from TokenAdminFacet
 */
export function handleMaxSupplyUpdated(event: MaxSupplyUpdated): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    shareClass.maxSupply = event.params.maxSupply;
    shareClass.save();
  }
}

/**
 * Handle Paused event from TokenAdminFacet
 */
export function handlePaused(event: Paused): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    shareClass.paused = true;
    shareClass.save();
  }
}

/**
 * Handle Unpaused event from TokenAdminFacet
 */
export function handleUnpaused(event: Unpaused): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    shareClass.paused = false;
    shareClass.save();
  }
}

/**
 * Handle AccountFrozen event from TokenAdminFacet
 */
export function handleAccountFrozen(event: AccountFrozen): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    const frozenAccounts = shareClass.frozenAccounts;
    const accountBytes = event.params.account as Bytes;
    
    // Add account if not already frozen
    if (!frozenAccounts.includes(accountBytes)) {
      frozenAccounts.push(accountBytes);
      shareClass.frozenAccounts = frozenAccounts;
      shareClass.save();
    }
  }
}

/**
 * Handle AccountUnfrozen event from TokenAdminFacet
 */
export function handleAccountUnfrozen(event: AccountUnfrozen): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    const frozenAccounts = shareClass.frozenAccounts;
    const accountBytes = event.params.account as Bytes;
    
    // Remove account from frozen list
    const index = frozenAccounts.indexOf(accountBytes);
    if (index > -1) {
      frozenAccounts.splice(index, 1);
      shareClass.frozenAccounts = frozenAccounts;
      shareClass.save();
    }
  }
}

/**
 * Handle LotFrozen event from TokenAdminFacet
 */
export function handleLotFrozen(event: LotFrozen): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    const frozenLots = shareClass.frozenLots;
    const lotIdBytes = event.params.lotId as Bytes;
    
    // Add lot if not already frozen
    if (!frozenLots.includes(lotIdBytes)) {
      frozenLots.push(lotIdBytes);
      shareClass.frozenLots = frozenLots;
      shareClass.save();
    }
  }
}

/**
 * Handle LotUnfrozen event from TokenAdminFacet
 */
export function handleLotUnfrozen(event: LotUnfrozen): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    const frozenLots = shareClass.frozenLots;
    const lotIdBytes = event.params.lotId as Bytes;
    
    // Remove lot from frozen list
    const index = frozenLots.indexOf(lotIdBytes);
    if (index > -1) {
      frozenLots.splice(index, 1);
      shareClass.frozenLots = frozenLots;
      shareClass.save();
    }
  }
}

/**
 * Handle UserRoleUpdated event from AccessControlFacet
 * Tracks role grants/revokes for token diamonds
 */
export function handleUserRoleUpdated(event: UserRoleUpdated): void {
  const tokenAddress = event.address.toHexString();
  const user = event.params.user;
  const role = event.params.role;
  const enabled = event.params.enabled;
  
  // Create composite ID: token-user-role
  const id = tokenAddress + "-" + user.toHexString() + "-" + role.toString();
  
  let roleMember = TokenRoleMember.load(id);
  
  if (!roleMember) {
    // First time this role is granted to this user for this token
    roleMember = new TokenRoleMember(id);
    roleMember.token = tokenAddress;
    roleMember.user = user;
    roleMember.role = role;
    roleMember.grantedAt = event.block.timestamp;
    roleMember.grantedTx = event.transaction.hash;
  }
  
  // Update status
  roleMember.enabled = enabled;
  roleMember.lastUpdatedAt = event.block.timestamp;
  roleMember.lastUpdatedTx = event.transaction.hash;
  
  roleMember.save();
}

/**
 * Handle StockSplitApplied event from TokenCorporateActionsFacet
 * Updates cumulative split ratios and creates history entry
 */
export function handleStockSplitApplied(event: StockSplitApplied): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    // Update cumulative split ratio: newRatio = oldRatio * (splitNum/splitDen)
    shareClass.splitNum = shareClass.splitNum.times(event.params.splitNum);
    shareClass.splitDen = shareClass.splitDen.times(event.params.splitDen);
    shareClass.totalSplits++;
    shareClass.save();
    
    // Create history record
    const actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    const action = new CorporateAction(actionId);
    action.token = tokenAddress;
    action.actionType = "StockSplit";
    action.numerator = event.params.splitNum;
    action.denominator = event.params.splitDen;
    action.reducesBasis = false; // Not applicable for splits
    action.timestamp = event.block.timestamp;
    action.tx = event.transaction.hash;
    action.save();
  }
}

/**
 * Handle StockDividendApplied event from TokenCorporateActionsFacet
 * Updates cumulative dividend ratios and creates history entry
 */
export function handleStockDividendApplied(event: StockDividendApplied): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    // Update cumulative dividend ratio: newRatio = oldRatio * (divNum/divDen)
    shareClass.divNum = shareClass.divNum.times(event.params.divNum);
    shareClass.divDen = shareClass.divDen.times(event.params.divDen);
    shareClass.totalDividends++;
    shareClass.save();
    
    // Create history record
    const actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    const action = new CorporateAction(actionId);
    action.token = tokenAddress;
    action.actionType = "StockDividend";
    action.numerator = event.params.divNum;
    action.denominator = event.params.divDen;
    action.reducesBasis = event.params.reducesBasis;
    action.timestamp = event.block.timestamp;
    action.tx = event.transaction.hash;
    action.save();
  }
}

/**
 * Handle EntityPublicStatusUpdated event from TokenCorporateActionsFacet
 * Updates whether the entity is SEC registered
 */
export function handleEntityPublicStatusUpdated(event: EntityPublicStatusUpdated): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    shareClass.isPublic = event.params.isPublic;
    shareClass.save();
  }
}
