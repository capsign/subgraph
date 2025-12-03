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
  StockSplitApplied,
  StockDividendApplied,
  BaseURIUpdated,
  LotCreated,
  LotTransferred,
  LotInvalidated,
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
  ComplianceModuleRemoved
} from "../../generated/templates/TokenDiamond/TokenDiamond";
import { TokenLots } from "../../generated/templates/TokenDiamond/TokenLots";
import { ERC20 } from "../../generated/templates/TokenDiamond/ERC20";
import { ShareClass, Lot, CorporateAction, Wallet, Safe, SAFEConversion, Diamond, UserRole, FunctionAccess, TokenClaim, LotComplianceConfig, ComplianceModule } from "../../generated/schema";
import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

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
  
  if (!tokenShareClass && !tokenSafe) {
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
    wallet.type = "EOA"; // Default to EOA for non-factory created wallets
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
    
    // Get payment token decimals if not ETH
    if (lotDetails.value.paymentCurrency.toHexString() != "0x0000000000000000000000000000000000000000") {
      const paymentToken = ERC20.bind(lotDetails.value.paymentCurrency);
      const decimalsResult = paymentToken.try_decimals();
      lot.paymentDecimals = decimalsResult.reverted ? 0 : decimalsResult.value;
    } else {
      lot.paymentDecimals = 18; // ETH has 18 decimals
    }
  } else {
    // Fallback to defaults if contract call fails
    lot.costBasis = BigInt.fromI32(0);
    lot.acquisitionDate = event.block.timestamp;
    lot.paymentCurrency = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    lot.paymentDecimals = 0;
    lot.uri = null;
    lot.data = null;
  }
  
  lot.transferType = "INTERNAL";
  lot.save();
  
  // Update total supply for both ShareClass and Safe tokens
  const shareClass = ShareClass.load(tokenAddress);
  if (shareClass) {
    shareClass.totalSupply = shareClass.totalSupply.plus(event.params.quantity);
    shareClass.save();
  }
  
  const safe = Safe.load(tokenAddress);
  if (safe) {
    safe.totalSupply = safe.totalSupply.plus(event.params.quantity);
    safe.save();
  }
  
  // Create activity
  createActivity(
    "lot-created-" + lotId,
    "LOT_CREATED",
    event.params.owner,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
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
    wallet.type = "EOA"; // Default to EOA for non-factory created wallets
    wallet.save();
  }
  
  // Update lot owner
  const lot = Lot.load(lotId);
  if (lot) {
    lot.owner = newOwnerAddress;
    lot.save();
  }
  
  // Create activity
  createActivity(
    "lot-transferred-" + lotId,
    "LOT_TRANSFERRED",
    event.params.to,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
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
      safe.save();
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
  // TODO: Store base URI if needed
  log.info("BaseURIUpdated: {}", [event.params.newBaseURI]);
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
  
  // Note: expiresAt needs to be fetched from contract state
  // For now, setting to 0 - will be updated via a contract call if needed
  claim.expiresAt = BigInt.fromI32(0);
  
  claim.save();
  
  log.info("Token claim created: claimId={}, token={}, emailHash={}, quantity={}", [
    claimId,
    tokenAddress,
    event.params.emailHash.toHexString(),
    event.params.quantity.toString()
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
