import {
  MaxSupplyUpdated,
  Paused,
  Unpaused,
  AccountFrozen,
  AccountUnfrozen,
  LotFrozen,
  LotUnfrozen,
  TokenRetired,
  TokenUnretired,
  TokenTypeSet,
  StockSplitApplied,
  StockDividendApplied,
  BaseURIUpdated,
  LotCreated,
  LotTransferred,
  LotAdjusted,
  LotInvalidated,
  LotURIUpdated,
  DefaultTermsSet,
  LotTermsSet,
  SAFEConverted,
  UserRoleUpdated,
  FunctionAccessChanged,
  LotModuleAdded,
  ClaimCreated,
  ClaimRedeemed,
  ClaimCancelled,
  ComplianceModuleAdded,
  ComplianceModuleRemoved,
  AuthorityUpdated,
  DebtTermsSet,
  NoteInitialized
} from "../../generated/templates/TokenDiamond/TokenDiamond";
import {
  Valuation409ARecorded,
  Valuation409AInvalidated
} from "../../generated/templates/TokenDiamond/Token409AFacet";
import {
  OptionGranted,
  OptionExercised,
  OptionExpired,
  OptionForfeited
} from "../../generated/templates/TokenDiamond/TokenOptionFacet";
import { TokenLots } from "../../generated/templates/TokenDiamond/TokenLots";
import { TokenClaims } from "../../generated/templates/TokenDiamond/TokenClaims";
import { ERC20 } from "../../generated/templates/TokenDiamond/ERC20";
import { ShareClass, Lot, CorporateAction, Wallet, Safe, SAFEConversion, Diamond, UserRole, FunctionAccess, TokenClaim, LotComplianceConfig, ComplianceModule, AuthorityDelegation, PromissoryNote, Valuation409A, OptionGrant, OptionExercise } from "../../generated/schema";
import { BigInt, Bytes, log, Address } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// Re-export DiamondCut handler for this template
export { handleDiamondCut } from "./diamond-cut";

/**
 * Handle AuthorityUpdated events for tokens
 * Event: AuthorityUpdated(address indexed oldAuthority, address indexed newAuthority)
 *
 * Tracks when a token delegates its access control to a wallet (AccessManager)
 */
export function handleTokenAuthorityUpdated(event: AuthorityUpdated): void {
  const managedContract = event.address;
  const newAuthority = event.params.newAuthority;
  const oldAuthority = event.params.oldAuthority;

  // Only track if newAuthority is non-zero (authority is being set)
  if (newAuthority.toHexString() != "0x0000000000000000000000000000000000000000") {
    const delegationId = `${managedContract.toHexString()}-${newAuthority.toHexString()}`;

    let delegation = AuthorityDelegation.load(delegationId);
    if (!delegation) {
      delegation = new AuthorityDelegation(delegationId);
      delegation.managedContract = managedContract;
      delegation.authorityWallet = newAuthority.toHexString();
      delegation.setAt = event.block.timestamp;
      delegation.setTx = event.transaction.hash;

      // Store previous authority if it was non-zero
      if (oldAuthority.toHexString() != "0x0000000000000000000000000000000000000000") {
        delegation.previousAuthority = oldAuthority;
      }

      // Ensure the wallet entity exists
      let wallet = Wallet.load(newAuthority.toHexString());
      if (!wallet) {
        wallet = new Wallet(newAuthority.toHexString());
        wallet.deployer = event.transaction.from;
        wallet.createdAt = event.block.timestamp;
        wallet.createdTx = event.transaction.hash;
        wallet.save();
      }

      delegation.save();
    }
  }
}

/**
 * Helper function to get payment currency decimals
 * Handles magic values for ETH and USD, and queries ERC20 contracts for others
 */
// @ts-ignore - i32 is AssemblyScript type, not TypeScript
function getPaymentDecimals(paymentCurrency: Bytes): i32 {
  const currencyHex = paymentCurrency.toHexString().toLowerCase();
  
  // Magic value for ETH (native token)
  if (currencyHex === "0x0000000000000000000000000000000000000000") {
    return 18;
  }
  
  // Magic value for USD (off-chain currency)
  if (currencyHex === "0x0000000000000000000000000000000000000348") {
    return 2; // USD uses 2 decimals (cents)
  }
  
  // For other currencies, try to query decimals() from ERC20 contract
  const paymentToken = ERC20.bind(Address.fromBytes(paymentCurrency));
  const decimalsResult = paymentToken.try_decimals();
  
  if (decimalsResult.reverted) {
    log.warning("Failed to get decimals for payment currency: {}", [currencyHex]);
    return 18; // Default to 18 decimals
  }
  
  return decimalsResult.value;
}

/**
 * Handle LotCreated event
 */
export function handleLotCreated(event: LotCreated): void {
  const tokenAddress = event.address.toHexString();
  const lotId = event.params.lotId.toHexString();
  const ownerAddress = event.params.owner.toHexString();
  
  // Check if token entity exists - skip lots from tokens not created via factory
  const tokenShareClass = ShareClass.load(tokenAddress);
  const tokenSafe = Safe.load(tokenAddress);
  const tokenPromissoryNote = PromissoryNote.load(tokenAddress);
  
  if (!tokenShareClass && !tokenSafe && !tokenPromissoryNote) {
    // Token entity doesn't exist - skip creating orphaned lot
    return;
  }
  
  // Ensure Wallet entity exists (create stub if needed)
  let wallet = Wallet.load(ownerAddress);
  if (!wallet) {
    wallet = new Wallet(ownerAddress);
    wallet.deployer = event.transaction.from;
    wallet.createdAt = event.block.timestamp;
    wallet.createdTx = event.transaction.hash;
    wallet.save();
  }
  
  // Create Lot entity
  const lot = new Lot(lotId);
  lot.lotId = BigInt.fromByteArray(event.params.lotId);
  lot.token = tokenAddress;
  lot.assetId = tokenAddress;
  lot.owner = ownerAddress;
  lot.quantity = event.params.quantity;
  lot.customId = event.params.customId;
  lot.createdAt = event.block.timestamp;
  lot.acquiredFrom = event.address;
  lot.parentLotId = null;
  lot.frozen = false;
  lot.isValid = true;
  // Note: lotSpecificModules is a @derivedFrom field, populated automatically
  
  // Fetch full lot details from contract to get cost basis, payment currency, etc.
  const tokenContract = TokenLots.bind(event.address);
  const lotDetails = tokenContract.try_getLot(event.params.lotId);
  
  if (!lotDetails.reverted) {
    lot.costBasis = lotDetails.value.costBasis;
    lot.acquisitionDate = lotDetails.value.acquisitionDate;
    lot.paymentCurrency = lotDetails.value.paymentCurrency;
    lot.uri = lotDetails.value.uri;
    lot.data = lotDetails.value.data;
    
    // Get payment token decimals using helper function
    lot.paymentDecimals = getPaymentDecimals(lotDetails.value.paymentCurrency);
  } else {
    // Fallback to defaults if contract call fails
    lot.costBasis = BigInt.fromI32(0);
    lot.acquisitionDate = event.block.timestamp;
    lot.paymentCurrency = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    lot.paymentDecimals = 18; // Default to 18 decimals
    lot.uri = null;
    lot.data = null;
  }
  
  lot.transferType = "INTERNAL";
  lot.save();
  
  // Update total supply for ShareClass, Safe, and PromissoryNote tokens
  const shareClass = ShareClass.load(tokenAddress);
  if (shareClass) {
    shareClass.totalSupply = shareClass.totalSupply.plus(event.params.quantity);
    shareClass.save();
  }
  
  const safe = Safe.load(tokenAddress);
  if (safe) {
    safe.totalSupply = safe.totalSupply.plus(event.params.quantity);
    // For SAFEs, totalInvested = sum of all lot cost bases (investment amounts)
    if (!lotDetails.reverted) {
      safe.totalInvested = safe.totalInvested.plus(lotDetails.value.costBasis);
    }
    safe.save();
  }
  
  const promissoryNote = PromissoryNote.load(tokenAddress);
  if (promissoryNote) {
    promissoryNote.totalSupply = promissoryNote.totalSupply.plus(event.params.quantity);
    promissoryNote.save();
  }
  
  // Create activity for recipient (lot received)
  const recipientActivity = createActivity(
    "lot-received-" + lotId,
    "LOT_RECEIVED",
    event.params.owner,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  recipientActivity.lot = lotId;
  recipientActivity.save();
  
  // Create activity for issuer (lot issued)
  // Get the issuer (admin) from the token entity
  let issuerAddress: Bytes | null = null;
  if (shareClass) {
    issuerAddress = shareClass.admin;
  } else if (safe) {
    issuerAddress = safe.admin;
  } else if (promissoryNote) {
    issuerAddress = promissoryNote.admin;
  }
  
  // Only create issuer activity if issuer is different from recipient
  if (issuerAddress && issuerAddress.toHexString() != ownerAddress) {
    const issuerActivity = createActivity(
      "lot-issued-" + lotId,
      "LOT_ISSUED",
      issuerAddress,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    issuerActivity.lot = lotId;
    issuerActivity.save();
  }
}

/**
 * Handle LotTransferred event
 */
export function handleLotTransferred(event: LotTransferred): void {
  const lotId = event.params.newLotId.toHexString();
  const newOwnerAddress = event.params.to.toHexString();
  
  // Ensure Wallet entity exists (create stub if needed)
  let wallet = Wallet.load(newOwnerAddress);
  if (!wallet) {
    wallet = new Wallet(newOwnerAddress);
    wallet.deployer = event.transaction.from;
    wallet.createdAt = event.block.timestamp;
    wallet.createdTx = event.transaction.hash;
    wallet.save();
  }
  
  // Update lot owner
  const lot = Lot.load(lotId);
  if (lot) {
    lot.owner = newOwnerAddress;
    lot.save();
  }
  
  // Create activity for lot transfer
  const activity = createActivity(
    "lot-transferred-" + lotId,
    "LOT_TRANSFERRED",
    event.params.to,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.lot = lotId;
  activity.save();
}

/**
 * Handle LotAdjusted event
 * Called when a lot is modified via adjustLot()
 */
export function handleLotAdjusted(event: LotAdjusted): void {
  const oldLotId = event.params.oldLotId.toHexString();
  const newLotId = event.params.newLotId.toHexString();
  const ownerAddress = event.params.owner.toHexString();
  const tokenAddress = event.address.toHexString();
  
  // Load the lot - adjustLot creates a new lot and invalidates the old one
  // So we need to create the new lot entity
  let lot = Lot.load(newLotId);
  
  if (!lot) {
    // This is a new lot created from adjustment
    lot = new Lot(newLotId);
    lot.lotId = BigInt.fromByteArray(event.params.newLotId);
    lot.token = tokenAddress;
    lot.assetId = tokenAddress;
    lot.owner = ownerAddress;
    lot.parentLotId = BigInt.fromByteArray(event.params.oldLotId);
    lot.frozen = false;
    lot.isValid = true;
    lot.createdAt = event.block.timestamp;
    lot.acquiredFrom = event.address;
    lot.transferType = "INTERNAL";
  }
  
  // Update with the new values from the event
  lot.quantity = event.params.newQuantity;
  lot.costBasis = event.params.newCostBasis;
  lot.acquisitionDate = event.params.newAcquisitionDate;
  
  // Get payment currency and decimals
  const paymentCurrency = event.params.newPaymentCurrency;
  lot.paymentCurrency = Bytes.fromHexString(paymentCurrency.toHexString());
  lot.paymentDecimals = getPaymentDecimals(Bytes.fromHexString(paymentCurrency.toHexString()));
  
  // Fetch additional lot details from contract (URI, data)
  const tokenContract = TokenLots.bind(event.address);
  const lotDetails = tokenContract.try_getLot(event.params.newLotId);
  
  if (!lotDetails.reverted) {
    lot.uri = lotDetails.value.uri;
    lot.data = lotDetails.value.data;
  }
  
  lot.save();
  
  // Invalidate the old lot if it's different from the new one
  if (oldLotId != newLotId) {
    const oldLot = Lot.load(oldLotId);
    if (oldLot) {
      oldLot.isValid = false;
      oldLot.save();
    }
  }
  
  log.info("LotAdjusted: {} -> {}, quantity: {}, costBasis: {}, paymentDecimals: {}", [
    oldLotId,
    newLotId,
    event.params.newQuantity.toString(),
    event.params.newCostBasis.toString(),
    lot.paymentDecimals.toString()
  ]);
}

/**
 * Handle LotInvalidated event
 */
export function handleLotInvalidated(event: LotInvalidated): void {
  const lotId = event.params.lotId.toHexString();
  
  const lot = Lot.load(lotId);
  if (lot) {
    const tokenAddress = lot.token;
    const quantity = lot.quantity;
    const costBasis = lot.costBasis;
    
    lot.isValid = false;
    lot.save();
    
    // Update total supply for both ShareClass and Safe tokens
    const shareClass = ShareClass.load(tokenAddress);
    if (shareClass) {
      shareClass.totalSupply = shareClass.totalSupply.minus(quantity);
      shareClass.save();
    }
    
    const safe = Safe.load(tokenAddress);
    if (safe) {
      safe.totalSupply = safe.totalSupply.minus(quantity);
      // Also subtract from totalInvested (cost basis = investment amount)
      safe.totalInvested = safe.totalInvested.minus(costBasis);
      safe.save();
    }
    
    const promissoryNote = PromissoryNote.load(tokenAddress);
    if (promissoryNote) {
      promissoryNote.totalSupply = promissoryNote.totalSupply.minus(quantity);
      // For promissory notes, also subtract from outstandingBalance
      // (assuming the debt is being cancelled/forgiven)
      promissoryNote.outstandingBalance = promissoryNote.outstandingBalance.minus(quantity);
      promissoryNote.save();
    }
  }
}

/**
 * Handle MaxSupplyUpdated event
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
 * Handle BaseURIUpdated event
 */
export function handleBaseURIUpdated(event: BaseURIUpdated): void {
  const tokenAddress = event.address.toHexString();
  const newBaseURI = event.params.newBaseURI;
  
  // Try loading as ShareClass first
  let shareClass = ShareClass.load(tokenAddress);
  if (shareClass != null) {
    shareClass.baseURI = newBaseURI;
    shareClass.save();
    return;
  }
  
  // Try loading as Safe
  let safe = Safe.load(tokenAddress);
  if (safe != null) {
    safe.baseURI = newBaseURI;
    safe.save();
    return;
  }
  
  // Try loading as PromissoryNote
  let note = PromissoryNote.load(tokenAddress);
  if (note != null) {
    note.baseURI = newBaseURI;
    note.uri = newBaseURI; // Keep for backwards compat
    note.save();
    return;
  }
}

/**
 * Handle LotURIUpdated event
 */
export function handleLotURIUpdated(event: LotURIUpdated): void {
  const tokenAddress = event.address.toHexString();
  const lotId = event.params.lotId;
  const newUri = event.params.newUri;
  
  // Construct lot entity ID (token-lotId)
  const lotEntityId = tokenAddress + "-" + lotId.toHexString();
  
  // Load lot
  let lot = Lot.load(lotEntityId);
  if (lot != null) {
    lot.uri = newUri;
    lot.save();
  } else {
    log.warning("LotURIUpdated event for unknown lot: {} (token: {})", [lotEntityId, tokenAddress]);
  }
}

/**
 * Handle Paused event
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
 * Handle Unpaused event
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
 * Handle AccountFrozen event
 */
export function handleAccountFrozen(event: AccountFrozen): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    const frozenAccounts = shareClass.frozenAccounts;
    const accountBytes = event.params.account as Bytes;
    
    if (!frozenAccounts.includes(accountBytes)) {
      frozenAccounts.push(accountBytes);
      shareClass.frozenAccounts = frozenAccounts;
      shareClass.save();
    }
  }
}

/**
 * Handle AccountUnfrozen event
 */
export function handleAccountUnfrozen(event: AccountUnfrozen): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    const frozenAccounts = shareClass.frozenAccounts;
    const accountBytes = event.params.account as Bytes;
    
    const index = frozenAccounts.indexOf(accountBytes);
    if (index > -1) {
      frozenAccounts.splice(index, 1);
      shareClass.frozenAccounts = frozenAccounts;
      shareClass.save();
    }
  }
}

/**
 * Handle LotFrozen event
 */
export function handleLotFrozen(event: LotFrozen): void {
  const lotId = event.params.lotId.toHexString();
  const lot = Lot.load(lotId);
  
  if (lot) {
    lot.frozen = true;
    lot.save();
  }
}

/**
 * Handle LotUnfrozen event
 */
export function handleLotUnfrozen(event: LotUnfrozen): void {
  const lotId = event.params.lotId.toHexString();
  const lot = Lot.load(lotId);
  
  if (lot) {
    lot.frozen = false;
    lot.save();
  }
}

/**
 * Handle StockSplitApplied event
 */
export function handleStockSplitApplied(event: StockSplitApplied): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    shareClass.splitNum = event.params.splitNum;
    shareClass.splitDen = event.params.splitDen;
    shareClass.totalSplits = shareClass.totalSplits + 1;
    shareClass.save();
    
    // Create corporate action record
    const actionId = tokenAddress + "-split-" + shareClass.totalSplits.toString();
    const action = new CorporateAction(actionId);
    action.token = tokenAddress;
    action.actionType = "STOCK_SPLIT";
    action.numerator = event.params.splitNum;
    action.denominator = event.params.splitDen;
    action.timestamp = event.block.timestamp;
    action.tx = event.transaction.hash;
    action.save();
  }
}

/**
 * Handle StockDividendApplied event
 */
export function handleStockDividendApplied(event: StockDividendApplied): void {
  const tokenAddress = event.address.toHexString();
  const shareClass = ShareClass.load(tokenAddress);
  
  if (shareClass) {
    shareClass.divNum = event.params.divNum;
    shareClass.divDen = event.params.divDen;
    shareClass.totalDividends = shareClass.totalDividends + 1;
    shareClass.save();
    
    // Create corporate action record
    const actionId = tokenAddress + "-dividend-" + shareClass.totalDividends.toString();
    const action = new CorporateAction(actionId);
    action.token = tokenAddress;
    action.actionType = "STOCK_DIVIDEND";
    action.numerator = event.params.divNum;
    action.denominator = event.params.divDen;
    action.timestamp = event.block.timestamp;
    action.tx = event.transaction.hash;
    action.save();
  }
}

/**
 * Handle TokenRetired event
 */
export function handleTokenRetired(event: TokenRetired): void {
  const tokenAddress = event.address.toHexString();
  
  // Try loading as ShareClass first
  let shareClass = ShareClass.load(tokenAddress);
  if (shareClass != null) {
    shareClass.retired = true;
    shareClass.retiredAt = event.params.timestamp;
    shareClass.save();
    return;
  }
  
  // Try loading as Safe
  let safe = Safe.load(tokenAddress);
  if (safe != null) {
    safe.retired = true;
    safe.retiredAt = event.params.timestamp;
    safe.save();
    return;
  }

  // Try loading as PromissoryNote
  let note = PromissoryNote.load(tokenAddress);
  if (note != null) {
    note.retired = true;
    note.retiredAt = event.params.timestamp;
    note.save();
    return;
  }
}

/**
 * Handle TokenUnretired event
 */
export function handleTokenUnretired(event: TokenUnretired): void {
  const tokenAddress = event.address.toHexString();
  
  // Try loading as ShareClass first
  let shareClass = ShareClass.load(tokenAddress);
  if (shareClass != null) {
    shareClass.retired = false;
    shareClass.retiredAt = null;
    shareClass.save();
    return;
  }
  
  // Try loading as Safe
  let safe = Safe.load(tokenAddress);
  if (safe != null) {
    safe.retired = false;
    safe.retiredAt = null;
    safe.save();
    return;
  }

  // Try loading as PromissoryNote
  let note = PromissoryNote.load(tokenAddress);
  if (note != null) {
    note.retired = false;
    note.retiredAt = null;
    note.save();
    return;
  }
}

/**
 * Handle TokenTypeSet event
 * Updates the token's assetType and cfiCode based on the ISO 10962 classification
 */
export function handleTokenTypeSet(event: TokenTypeSet): void {
  const tokenAddress = event.address.toHexString();
  const cfiCode = event.params.cfiCode;
  const assetType = event.params.assetType;
  
  log.info("TokenTypeSet: {} cfiCode={} assetType={}", [
    tokenAddress,
    cfiCode.toHexString(),
    assetType
  ]);
  
  // Try loading as ShareClass first
  let shareClass = ShareClass.load(tokenAddress);
  if (shareClass != null) {
    shareClass.cfiCode = cfiCode;
    // Map assetType string to enum value
    if (assetType == "ShareClass") {
      shareClass.assetType = "ShareClass";
    } else if (assetType == "MembershipUnit") {
      shareClass.assetType = "MembershipUnit";
    } else if (assetType == "DaoToken") {
      shareClass.assetType = "DaoToken";
    } else {
      // Keep existing or default
      shareClass.assetType = "ShareClass";
    }
    shareClass.save();
    return;
  }
  
  // Try loading as Safe
  let safe = Safe.load(tokenAddress);
  if (safe != null) {
    safe.cfiCode = cfiCode;
    safe.assetType = "Safe";
    safe.save();
    return;
  }
  
  // Try loading as PromissoryNote
  let pNote = PromissoryNote.load(tokenAddress);
  if (pNote != null) {
    pNote.cfiCode = cfiCode;
    pNote.assetType = "PromissoryNote";
    pNote.save();
    return;
  }
}

/**
 * Handle DefaultTermsSet event (SAFE tokens)
 */
export function handleDefaultTermsSet(event: DefaultTermsSet): void {
  const tokenAddress = event.address.toHexString();
  const safe = Safe.load(tokenAddress);
  
  if (safe != null) {
    safe.defaultValuationCap = event.params.valuationCap;
    safe.defaultDiscountRate = event.params.discountRate.toI32();
    safe.defaultTargetEquityToken = event.params.targetEquityToken;
    safe.defaultProRataRight = event.params.proRataRight;
    safe.defaultHasMFN = event.params.hasMFN;
    safe.save();
  }
}

/**
 * Handle LotTermsSet event (SAFE tokens)
 */
export function handleLotTermsSet(event: LotTermsSet): void {
  const lotId = event.params.lotId.toHexString();
  const lot = Lot.load(lotId);
  
  if (lot != null) {
    // Store SAFE-specific lot terms in the lot's data field or create a separate entity
    // For now, we'll just log it - you may want to extend the Lot entity or create SAFELotTerms entity
    log.info("SAFE lot terms set for lot {}: cap={}, discount={}, target={}", [
      lotId,
      event.params.valuationCap.toString(),
      event.params.discountRate.toString(),
      event.params.targetEquityToken.toHexString()
    ]);
  }
}

/**
 * Handle SAFEConverted event
 */
export function handleSAFEConverted(event: SAFEConverted): void {
  const tokenAddress = event.address.toHexString();
  const safe = Safe.load(tokenAddress);
  
  if (safe != null) {
    // Update SAFE stats
    safe.totalConverted = safe.totalConverted.plus(event.params.investmentAmount);
    safe.lotsConverted = safe.lotsConverted + 1;
    safe.save();
    
    // Create conversion record
    const conversionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    const conversion = new SAFEConversion(conversionId);
    conversion.safe = tokenAddress;
    conversion.safeLot = event.params.safeLotId.toHexString();
    conversion.investor = event.params.investor;
    conversion.investmentAmount = event.params.investmentAmount;
    conversion.sharesIssued = event.params.sharesIssued;
    conversion.effectivePrice = event.params.effectivePrice;
    conversion.targetShareClass = event.params.targetShareClass;
    conversion.equityLotId = event.params.equityLotId;
    conversion.conversionNote = event.params.conversionNote;
    conversion.convertedAt = event.block.timestamp;
    conversion.convertedTx = event.transaction.hash;
    conversion.blockNumber = event.block.number;
    conversion.logIndex = event.logIndex;
    conversion.save();
    
    // Mark the SAFE lot as converted (invalidated)
    const safeLot = Lot.load(event.params.safeLotId.toHexString());
    if (safeLot != null) {
      safeLot.isValid = false;
      safeLot.save();
    }
  }
}

// ============ ACCESS CONTROL HANDLERS ============

/**
 * Handle UserRoleUpdated events for tokens
 */
export function handleTokenUserRoleUpdated(event: UserRoleUpdated): void {
  const diamondAddress = event.address.toHexString();
  const userAddress = event.params.user.toHexString();
  const role = event.params.role;
  const enabled = event.params.enabled;

  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Create diamond entry if it doesn't exist (for tokens)
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "TOKEN";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    
    // Link to token if it exists (try ShareClass first, then Safe)
    const shareClass = ShareClass.load(diamondAddress);
    const safe = Safe.load(diamondAddress);
    if (shareClass || safe) {
      diamond.token = diamondAddress;
    }
    diamond.save();
  }

  // Create or update UserRole entity
  const userRoleId = `${diamondAddress}-${userAddress}-${role}`;
  let userRole = UserRole.load(userRoleId);

  if (!userRole) {
    userRole = new UserRole(userRoleId);
    userRole.diamond = diamondAddress;
    userRole.user = event.params.user;
    userRole.role = role;
    userRole.grantedAt = event.block.timestamp;
    userRole.grantedTx = event.transaction.hash;
  }

  userRole.enabled = enabled;
  userRole.lastUpdatedAt = event.block.timestamp;
  userRole.lastUpdatedTx = event.transaction.hash;
  
  userRole.save();
}

/**
 * Handle LotModuleAdded event
 */
export function handleLotModuleAdded(event: LotModuleAdded): void {
  const tokenAddress = event.address.toHexString();
  const lotId = event.params.lotId;
  const module = event.params.module;
  
  const lotEntityId = `${tokenAddress}-${lotId.toString()}`;
  const lot = Lot.load(lotEntityId);
  
  if (!lot) {
    log.warning("handleLotModuleAdded: Lot not found: {}", [lotEntityId]);
    return;
  }
  
  // Create compliance module entity if needed
  let complianceModule = ComplianceModule.load(module.toHexString());
  if (!complianceModule) {
    complianceModule = new ComplianceModule(module.toHexString());
    complianceModule.address = module;
    complianceModule.name = "Unknown";
    complianceModule.version = "1.0.0";
    complianceModule.moduleType = "Custom";
    complianceModule.firstUsedAt = event.block.timestamp;
    complianceModule.firstUsedTx = event.transaction.hash;
    complianceModule.save();
  }
  
  // Create lot compliance config
  const configId = tokenAddress + "-" + lotId.toHexString() + "-" + module.toHexString();
  let config = new LotComplianceConfig(configId);
  config.lot = lotEntityId;
  config.module = module.toHexString();
  config.addedAt = event.block.timestamp;
  config.addedTx = event.transaction.hash;
  config.save();
  
  log.info("Added lot-specific module {} to lot {}", [module.toHexString(), lotEntityId]);
}

/**
 * Handle FunctionAccessChanged event for tokens
 */
export function handleTokenFunctionAccessChanged(event: FunctionAccessChanged): void {
  const diamondAddress = event.address.toHexString();
  const functionSelector = event.params.functionSig; // bytes4 function selector
  const role = event.params.role;
  const hasAccess = event.params.enabled; // 'enabled' in TokenDiamond ABI
  
  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Create diamond entry if it doesn't exist
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "TOKEN";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    
    // Link to token if it exists (try ShareClass first, then Safe)
    const shareClass = ShareClass.load(diamondAddress);
    const safe = Safe.load(diamondAddress);
    if (shareClass || safe) {
      diamond.token = diamondAddress;
    }
    diamond.save();
  }
  
  // Create or update FunctionAccess entity
  const functionAccessId = `${diamondAddress}-${functionSelector.toHexString()}-${role.toString()}`;
  let functionAccess = FunctionAccess.load(functionAccessId);
  
  if (!functionAccess) {
    functionAccess = new FunctionAccess(functionAccessId);
    functionAccess.diamond = diamondAddress;
    functionAccess.functionSelector = functionSelector;
    functionAccess.role = role;
    functionAccess.grantedAt = event.block.timestamp;
    functionAccess.grantedTx = event.transaction.hash;
  }
  
  functionAccess.hasAccess = hasAccess;
  functionAccess.lastUpdatedAt = event.block.timestamp;
  functionAccess.lastUpdatedTx = event.transaction.hash;
  
  functionAccess.save();
  
  log.info("Function access updated for diamond {} selector {} role {} hasAccess {}", [
    diamondAddress,
    functionSelector.toHexString(),
    role.toString(),
    hasAccess ? "true" : "false"
  ]);
}

/**
 * Handle ClaimCreated event
 */
export function handleClaimCreated(event: ClaimCreated): void {
  const claimId = event.params.claimId.toHexString();
  const tokenAddress = event.address.toHexString();
  
  let claim = new TokenClaim(claimId);
  claim.token = tokenAddress;
  claim.emailHash = event.params.emailHash;
  claim.quantity = event.params.quantity;
  claim.issuer = event.params.issuer;
  claim.redeemed = false;
  claim.recipient = null;
  claim.lotId = null;
  claim.createdAt = event.block.timestamp;
  claim.createdTx = event.transaction.hash;
  claim.redeemedAt = null;
  claim.redeemedTx = null;
  
  // Fetch expiresAt from contract state
  let contract = TokenClaims.bind(event.address);
  let claimData = contract.try_getClaim(event.params.claimId);
  
  if (!claimData.reverted) {
    // getClaim returns: (emailHash, quantity, expiresAt, redeemed, issuer)
    claim.expiresAt = claimData.value.value2; // value2 is expiresAt (third return value)
  } else {
    // Fallback to 0 if contract call fails
  claim.expiresAt = BigInt.fromI32(0);
  }
  
  claim.save();
  
  log.info("Token claim created: claimId={}, token={}, emailHash={}, quantity={}, expiresAt={}", [
    claimId,
    tokenAddress,
    event.params.emailHash.toHexString(),
    event.params.quantity.toString(),
    claim.expiresAt.toString()
  ]);
}

/**
 * Handle ClaimRedeemed event
 */
export function handleClaimRedeemed(event: ClaimRedeemed): void {
  const claimId = event.params.claimId.toHexString();
  
  let claim = TokenClaim.load(claimId);
  if (claim) {
    claim.redeemed = true;
    claim.recipient = event.params.recipient;
    claim.lotId = event.params.lotId;
    claim.redeemedAt = event.block.timestamp;
    claim.redeemedTx = event.transaction.hash;
    claim.save();
    
    log.info("Token claim redeemed: claimId={}, recipient={}, lotId={}", [
      claimId,
      event.params.recipient.toHexString(),
      event.params.lotId.toHexString()
    ]);
  } else {
    log.warning("ClaimRedeemed event for unknown claim: claimId={}", [claimId]);
  }
}

/**
 * Handle ClaimCancelled event
 */
export function handleClaimCancelled(event: ClaimCancelled): void {
  const claimId = event.params.claimId.toHexString();
  
  let claim = TokenClaim.load(claimId);
  if (claim) {
    // Mark as redeemed to prevent future use (claim is effectively dead)
    claim.redeemed = true;
    claim.save();
    
    log.info("Token claim cancelled: claimId={}, issuer={}", [
      claimId,
      event.params.issuer.toHexString()
    ]);
  } else {
    log.warning("ClaimCancelled event for unknown claim: claimId={}", [claimId]);
  }
}

// Re-export compliance module handlers from token-compliance.ts
export {
  handleComplianceModuleAdded,
  handleComplianceModuleRemoved
} from "./token-compliance";

/**
 * Handle DebtTermsSet event for promissory notes
 * Event: DebtTermsSet(uint256 principalAmount, uint256 interestRate, uint256 issuanceDate, uint256 maturityDate, address paymentCurrency, uint8 paymentType, bool isSubordinated)
 */
export function handleDebtTermsSet(event: DebtTermsSet): void {
  const tokenAddress = event.address.toHexString();
  
  let note = PromissoryNote.load(tokenAddress);
  if (!note) {
    log.warning("DebtTermsSet event for unknown PromissoryNote: {}", [tokenAddress]);
    return;
  }
  
  // Update debt terms
  note.principalAmount = event.params.principalAmount;
  note.interestRate = event.params.interestRate.toI32(); // Convert BigInt to i32
  note.issuanceDate = event.params.issuanceDate;
  note.maturityDate = event.params.maturityDate;
  note.paymentCurrency = event.params.paymentCurrency;
  
  // Map payment type enum (0=BULLET, 1=AMORTIZING, 2=INTEREST_ONLY)
  if (event.params.paymentType == 0) {
    note.paymentType = "BULLET";
  } else if (event.params.paymentType == 1) {
    note.paymentType = "AMORTIZING";
  } else {
    note.paymentType = "INTEREST_ONLY";
  }
  
  note.isSubordinated = event.params.isSubordinated;
  
  // Initialize outstanding balance to principal amount
  note.outstandingBalance = event.params.principalAmount;
  
  note.save();
  
  log.info("Debt terms set for PromissoryNote: token={}, principal={}, rate={}", [
    tokenAddress,
    event.params.principalAmount.toString(),
    event.params.interestRate.toString()
  ]);
}

/**
 * Handle NoteInitialized events from TokenNoteFacet
 * Event: NoteInitialized(address indexed borrower, address indexed lender, uint256 principalAmount, uint16 interestRateBps, uint256 maturityDate)
 * This sets the debtor (borrower) and creditor (lender) fields on the PromissoryNote
 */
export function handleNoteInitialized(event: NoteInitialized): void {
  const tokenAddress = event.address.toHexString();
  
  let note = PromissoryNote.load(tokenAddress);
  if (!note) {
    log.warning("NoteInitialized event for unknown PromissoryNote: {}", [tokenAddress]);
    return;
  }
  
  // Set borrower (debtor) and lender (creditor)
  note.debtor = event.params.borrower;
  note.creditor = event.params.lender;
  
  // Also update the loan terms from this event
  note.principalAmount = event.params.principalAmount;
  note.interestRate = event.params.interestRateBps; // Already in basis points
  note.maturityDate = event.params.maturityDate;
  
  // Initialize outstanding balance to principal amount
  note.outstandingBalance = event.params.principalAmount;
  
  note.save();
  
  log.info("Note initialized: token={}, borrower={}, lender={}, principal={}", [
    tokenAddress,
    event.params.borrower.toHexString(),
    event.params.lender.toHexString(),
    event.params.principalAmount.toString()
  ]);
}

// ============ 409A VALUATION HANDLERS ============

/**
 * Handle Valuation409ARecorded events
 * Event: Valuation409ARecorded(uint256 indexed valuationId, uint256 pricePerShare, uint256 effectiveDate, uint256 expirationDate, bytes32 reportHash, address valuationFirm)
 */
export function handleValuation409ARecorded(event: Valuation409ARecorded): void {
  const tokenAddress = event.address.toHexString();
  const valuationId = event.params.valuationId;
  const id = `${tokenAddress}-${valuationId.toString()}`;

  let valuation = new Valuation409A(id);
  valuation.token = tokenAddress;
  valuation.valuationId = valuationId;
  valuation.pricePerShare = event.params.pricePerShare;
  valuation.effectiveDate = event.params.effectiveDate;
  valuation.expirationDate = event.params.expirationDate;
  valuation.reportHash = event.params.reportHash;
  valuation.valuationFirm = event.params.valuationFirm;
  valuation.recordedBy = event.transaction.from;
  valuation.recordedAt = event.block.timestamp;
  valuation.recordedTx = event.transaction.hash;
  valuation.isValid = true;

  valuation.save();

  log.info("409A Valuation recorded: token={}, id={}, price={}", [
    tokenAddress,
    valuationId.toString(),
    event.params.pricePerShare.toString()
  ]);
}

/**
 * Handle Valuation409AInvalidated events
 * Event: Valuation409AInvalidated(uint256 indexed valuationId, string reason)
 */
export function handleValuation409AInvalidated(event: Valuation409AInvalidated): void {
  const tokenAddress = event.address.toHexString();
  const valuationId = event.params.valuationId;
  const id = `${tokenAddress}-${valuationId.toString()}`;

  let valuation = Valuation409A.load(id);
  if (!valuation) {
    log.warning("409A Valuation invalidated for unknown valuation: {}", [id]);
    return;
  }

  valuation.isValid = false;
  valuation.invalidatedAt = event.block.timestamp;
  valuation.invalidatedTx = event.transaction.hash;

  valuation.save();

  log.info("409A Valuation invalidated: token={}, id={}", [
    tokenAddress,
    valuationId.toString()
  ]);
}

// ============ OPTION GRANT HANDLERS ============

/**
 * Handle OptionGranted events
 * Event: OptionGranted(uint256 indexed grantId, bytes32 indexed lotId, address indexed recipient, uint8 optionType, uint256 totalShares, uint256 strikePrice, uint256 expirationDate)
 */
export function handleOptionGranted(event: OptionGranted): void {
  const tokenAddress = event.address.toHexString();
  const grantId = event.params.grantId;
  const id = `${tokenAddress}-${grantId.toString()}`;

  // Token/ShareClass must exist
  let token = ShareClass.load(tokenAddress);
  if (!token) {
    log.warning("OptionGranted for unknown token: {}", [tokenAddress]);
    return;
  }

  // Ensure recipient wallet exists
  const recipientAddress = event.params.recipient.toHexString();
  let recipientWallet = Wallet.load(recipientAddress);
  if (!recipientWallet) {
    recipientWallet = new Wallet(recipientAddress);
    recipientWallet.deployer = event.transaction.from;
    recipientWallet.createdAt = event.block.timestamp;
    recipientWallet.createdTx = event.transaction.hash;
    recipientWallet.save();
  }

  let grant = new OptionGrant(id);
  grant.equityToken = tokenAddress;
  grant.grantId = grantId;
  grant.lotId = event.params.lotId;
  grant.recipient = recipientAddress;
  
  // Map optionType: 0 = ISO, 1 = NSO
  grant.optionType = event.params.optionType == 0 ? "ISO" : "NSO";
  grant.status = "GRANTED";
  
  grant.totalShares = event.params.totalShares;
  grant.exercisedShares = BigInt.fromI32(0);
  grant.strikePrice = event.params.strikePrice;
  grant.grantDate = event.block.timestamp;
  grant.expirationDate = event.params.expirationDate;
  grant.grantedBy = event.transaction.from;
  grant.grantTx = event.transaction.hash;
  grant.blockNumber = event.block.number;

  grant.save();

  // Create activity with optionGrant reference
  const activity = createActivity(
    "option-granted-" + id,
    "OPTION_GRANTED",
    event.params.recipient,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.optionGrant = id;
  activity.save();

  log.info("Option granted: token={}, grantId={}, recipient={}, shares={}", [
    tokenAddress,
    grantId.toString(),
    recipientAddress,
    event.params.totalShares.toString()
  ]);
}

/**
 * Handle OptionExercised events
 * Event: OptionExercised(uint256 indexed grantId, address indexed recipient, uint256 sharesExercised, uint256 totalPayment, bytes32 equityLotId)
 */
export function handleOptionExercised(event: OptionExercised): void {
  const tokenAddress = event.address.toHexString();
  const grantId = event.params.grantId;
  const grantEntityId = `${tokenAddress}-${grantId.toString()}`;

  let grant = OptionGrant.load(grantEntityId);
  if (!grant) {
    log.warning("Option exercised for unknown grant: {}", [grantEntityId]);
    return;
  }

  // Update grant
  grant.exercisedShares = grant.exercisedShares.plus(event.params.sharesExercised);
  
  // Update status if fully exercised
  if (grant.exercisedShares.equals(grant.totalShares)) {
    grant.status = "EXERCISED";
  } else {
    grant.status = "PARTIALLY_EXERCISED";
  }
  
  grant.save();

  // Create exercise record
  const exerciseId = `${grantEntityId}-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let exercise = new OptionExercise(exerciseId);
  exercise.grant = grantEntityId;
  exercise.sharesExercised = event.params.sharesExercised;
  exercise.paymentAmount = event.params.totalPayment;
  exercise.equityLotId = event.params.equityLotId;
  exercise.exercisedAt = event.block.timestamp;
  exercise.exerciseTx = event.transaction.hash;
  
  exercise.save();

  // Create activity
  const activity = createActivity(
    "option-exercised-" + exerciseId,
    "OPTION_EXERCISED",
    event.params.recipient,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();

  log.info("Option exercised: grantId={}, shares={}, payment={}", [
    grantId.toString(),
    event.params.sharesExercised.toString(),
    event.params.totalPayment.toString()
  ]);
}

/**
 * Handle OptionExpired events
 * Event: OptionExpired(uint256 indexed grantId, address indexed recipient, uint256 unvestedShares)
 */
export function handleOptionExpired(event: OptionExpired): void {
  const tokenAddress = event.address.toHexString();
  const grantId = event.params.grantId;
  const grantEntityId = `${tokenAddress}-${grantId.toString()}`;

  let grant = OptionGrant.load(grantEntityId);
  if (!grant) {
    log.warning("Option expired for unknown grant: {}", [grantEntityId]);
    return;
  }

  grant.status = "EXPIRED";
  grant.save();

  log.info("Option expired: grantId={}, sharesExpired={}", [
    grantId.toString(),
    event.params.sharesExpired.toString()
  ]);
}

/**
 * Handle OptionForfeited events
 * Event: OptionForfeited(uint256 indexed grantId, address indexed recipient, uint256 unvestedShares)
 */
export function handleOptionForfeited(event: OptionForfeited): void {
  const tokenAddress = event.address.toHexString();
  const grantId = event.params.grantId;
  const grantEntityId = `${tokenAddress}-${grantId.toString()}`;

  let grant = OptionGrant.load(grantEntityId);
  if (!grant) {
    log.warning("Option forfeited for unknown grant: {}", [grantEntityId]);
    return;
  }

  grant.status = "FORFEITED";
  grant.save();

  log.info("Option forfeited: grantId={}, sharesForfeited={}", [
    grantId.toString(),
    event.params.sharesForfeited.toString()
  ]);
}
