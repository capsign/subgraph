import {
  MaxSupplyUpdated,
  Paused,
  Unpaused,
  AccountFrozen,
  AccountUnfrozen,
  LotFrozen,
  LotUnfrozen,
  StockSplitApplied,
  StockDividendApplied,
  BaseURIUpdated,
  LotCreated,
  LotTransferred,
  LotInvalidated,
} from "../../generated/templates/TokenDiamond/TokenDiamond";
import { ShareClass, Lot, CorporateAction, Wallet } from "../../generated/schema";
import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

/**
 * Handle LotCreated event
 */
export function handleLotCreated(event: LotCreated): void {
  const tokenAddress = event.address.toHexString();
  const lotId = event.params.lotId.toHexString();
  const ownerAddress = event.params.owner.toHexString();
  
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
  
  // Set defaults
  lot.costBasis = BigInt.fromI32(0);
  lot.acquisitionDate = event.block.timestamp;
  lot.uri = null;
  lot.data = null;
  lot.transferType = "INTERNAL";
  lot.paymentCurrency = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
  lot.paymentDecimals = 0;
  
  lot.save();
  
  // Update total supply
  const shareClass = ShareClass.load(tokenAddress);
  if (shareClass) {
    shareClass.totalSupply = shareClass.totalSupply.plus(event.params.quantity);
    shareClass.save();
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
    lot.isValid = false;
    lot.save();
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
