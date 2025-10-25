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
  LotAdjusted,
  CustomIdUpdated,
  LotInvalidated,
} from "../../generated/templates/TokenDiamond/TokenDiamond";
import { ShareClass, Diamond, TokenRoleMember, CorporateAction, Lot, LotAdjustment, CustomIdUpdate } from "../../generated/schema";
import { BigInt, Address, Bytes } from "@graphprotocol/graph-ts";
import { ERC20 } from "../../generated/templates/TokenDiamond/ERC20";
import { createActivity } from "./activity";

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
  lot.quantity = event.params.rawQuantity; // Store RAW quantity (before corporate actions)
  lot.costBasis = event.params.costBasis;
  lot.acquisitionDate = event.params.acquisitionDate;
  lot.createdAt = event.params.acquisitionDate; // Use acquisitionDate as createdAt
  lot.acquiredFrom = event.address; // Token contract address
  lot.parentLotId = null; // No parent lot for newly created lots
  lot.customId = event.params.customId; // Custom ID from event
  lot.uri = event.params.uri; // URI from event
  lot.data = event.params.data; // Additional data from event
  lot.frozen = false; // New lots are not frozen by default
  lot.isValid = true; // New lots are valid by default
  
  // Map transfer type enum to string
  const transferTypeMap = ["INTERNAL", "SALE", "GIFT", "INHERITANCE", "INCOME"];
  lot.transferType = transferTypeMap[event.params.tType];
  
  // Set payment currency from event
  const paymentCurrency = event.params.paymentCurrency;
  lot.paymentCurrency = paymentCurrency;
  
  // If payment currency is zero address, it's ETH (18 decimals)
  // Otherwise, read decimals from the ERC20 contract
  if (paymentCurrency.toHexString() === "0x0000000000000000000000000000000000000000") {
    lot.paymentDecimals = 18; // ETH
  } else {
    // Bind to ERC20 contract and read decimals
    const erc20 = ERC20.bind(paymentCurrency);
    const decimalsResult = erc20.try_decimals();
    
    if (!decimalsResult.reverted) {
      lot.paymentDecimals = decimalsResult.value;
    } else {
      // Fallback to 18 if we can't read decimals
      lot.paymentDecimals = 18;
    }
  }
  
  lot.save();
  
  // Create activity for lot received
  const activity = createActivity(
    "lot-received-" + lotId,
    "LOT_RECEIVED",
    event.params.to,
    event.params.acquisitionDate,
    event.transaction.hash,
    event.block.number
  );
  activity.lot = lotId;
  activity.save();
  
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
    
    // Create activity for corporate action
    const activity = createActivity(
      "corporate-action-" + actionId,
      "CORPORATE_ACTION",
      shareClass.admin,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.corporateAction = actionId;
    activity.save();
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
    
    // Create activity for corporate action
    const activity = createActivity(
      "corporate-action-" + actionId,
      "CORPORATE_ACTION",
      shareClass.admin,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.corporateAction = actionId;
    activity.save();
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

/**
 * Handle LotAdjusted event from TokenLotsFacet
 * Creates adjustment history record and updates lots
 */
export function handleLotAdjusted(event: LotAdjusted): void {
  const tokenAddress = event.address.toHexString();
  const oldLotId = event.params.oldLotId.toHexString();
  const newLotId = event.params.newLotId.toHexString();
  
  // Load old lot to get original values
  const oldLot = Lot.load(oldLotId);
  if (!oldLot) {
    // Old lot doesn't exist, can't proceed
    return;
  }
  
  // Mark the old lot as invalid (this handles lots adjusted before the protocol fix)
  oldLot.isValid = false;
  oldLot.save();
  
  // Load token to ensure it exists
  const shareClass = ShareClass.load(tokenAddress);
  if (!shareClass) {
    return;
  }
  
  // Create the new lot entity (LotCreated event is not emitted for adjusted lots)
  const newLot = new Lot(newLotId);
  newLot.lotId = BigInt.fromByteArray(event.params.newLotId);
  newLot.token = tokenAddress;
  newLot.assetId = tokenAddress;
  newLot.owner = event.params.owner.toHexString();
  newLot.quantity = event.params.newQuantity; // This is the RAW quantity
  newLot.costBasis = event.params.newCostBasis;
  newLot.acquisitionDate = event.params.acquisitionDate;
  newLot.createdAt = event.block.timestamp; // Use block timestamp for adjusted lots
  newLot.acquiredFrom = event.address; // Token contract address
  newLot.parentLotId = BigInt.fromByteArray(event.params.oldLotId);
  newLot.customId = oldLot.customId; // Preserve custom ID
  newLot.uri = event.params.uri;
  newLot.data = event.params.data;
  newLot.frozen = false;
  newLot.isValid = true; // New adjusted lots are valid by default
  newLot.adjustedFrom = oldLotId;
  
  // Map transfer type enum to string
  const transferTypeMap = ["INTERNAL", "SALE", "GIFT", "INHERITANCE", "INCOME"];
  newLot.transferType = transferTypeMap[event.params.tType];
  
  // Handle payment currency from the adjustment event
  const paymentCurrency = event.params.paymentCurrency;
  newLot.paymentCurrency = paymentCurrency;
  
  // If payment currency is zero address, it's ETH (18 decimals)
  // Otherwise, read decimals from the ERC20 contract
  if (paymentCurrency.toHexString() === "0x0000000000000000000000000000000000000000") {
    newLot.paymentDecimals = 18; // ETH
  } else {
    // Bind to ERC20 contract and read decimals
    const erc20 = ERC20.bind(paymentCurrency);
    const decimalsResult = erc20.try_decimals();
    
    if (!decimalsResult.reverted) {
      newLot.paymentDecimals = decimalsResult.value;
    } else {
      // Fallback to old lot's payment decimals if we can't read from ERC20
      newLot.paymentDecimals = oldLot.paymentDecimals;
    }
  }
  
  newLot.save();
  
  // Create adjustment record
  const adjustmentId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const adjustment = new LotAdjustment(adjustmentId);
  
  adjustment.oldLot = oldLotId;
  adjustment.newLot = newLotId;
  adjustment.operator = event.params.operator;
  adjustment.owner = event.params.owner;
  adjustment.newQuantity = event.params.newQuantity;
  adjustment.newCostBasis = event.params.newCostBasis;
  adjustment.paymentCurrency = event.params.paymentCurrency;
  adjustment.acquisitionDate = event.params.acquisitionDate;
  adjustment.uri = event.params.uri;
  adjustment.data = event.params.data;
  adjustment.reason = event.params.reason;
  adjustment.transferType = transferTypeMap[event.params.tType];
  adjustment.adjustedCostBasis = event.params.adjustedCostBasis;
  adjustment.timestamp = event.block.timestamp;
  adjustment.transaction = event.transaction.hash;
  adjustment.lot = newLotId; // For reverse lookup
  
  adjustment.save();
  
  // Update old lot to mark as adjusted/frozen
  oldLot.frozen = true; // Mark as frozen since it's been adjusted
  oldLot.save();
  
  // Update total supply if quantity changed
  const quantityDelta = event.params.newQuantity.minus(oldLot.quantity);
  if (!quantityDelta.isZero()) {
    shareClass.totalSupply = shareClass.totalSupply.plus(quantityDelta);
    shareClass.save();
  }
}

/**
 * Handle CustomIdUpdated event from TokenLotsFacet
 * Records custom ID changes
 */
export function handleCustomIdUpdated(event: CustomIdUpdated): void {
  const lotId = event.params.lotId.toHexString();
  
  // Create custom ID update record
  const updateId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const update = new CustomIdUpdate(updateId);
  
  update.lot = lotId;
  update.oldCustomId = event.params.oldCustomId;
  update.newCustomId = event.params.newCustomId;
  update.timestamp = event.block.timestamp;
  update.transaction = event.transaction.hash;
  
  update.save();
  
  // Update lot's custom ID
  const lot = Lot.load(lotId);
  if (lot) {
    lot.customId = event.params.newCustomId;
    lot.save();
  }
}

/**
 * Handle LotInvalidated event from TokenLotsFacet
 * Marks lots as invalid (burned/cancelled)
 */
export function handleLotInvalidated(event: LotInvalidated): void {
  const tokenAddress = event.address.toHexString();
  const lotIdBytes = event.params.lotId;
  const lotId = tokenAddress + "-" + lotIdBytes.toHexString();
  
  const lot = Lot.load(lotId);
  if (lot) {
    lot.isValid = false;
    lot.save();
    
    // Create activity for lot invalidation
    const activity = createActivity(
      "lot-invalidated-" + tokenAddress + "-" + lotId,
      "LOT_INVALIDATED",
      Bytes.fromHexString(lot.owner),
      event.block.timestamp,
      event.transaction.hash,
      event.block.number,
    );
    
    activity.lot = lotId;
    activity.save();
  }
}

