import { BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  AssetDisposed,
  WashSaleDetected,
} from "../../generated/templates/WalletDiamond/AssetDisposalFacet";
import {
  AssetDisposal,
  FundTaxYearSummary,
  Vehicle,
  EquityToken,
  WashSale,
} from "../../generated/schema";
import { createActivity } from "./activity";

/**
 * Map tax strategy enum from contract to string
 */
// @ts-ignore: i32 is a valid AssemblyScript type
function mapTaxStrategy(strategy: i32): string {
  if (strategy == 0) return "FIFO";
  if (strategy == 1) return "LIFO";
  if (strategy == 2) return "HIFO";
  return "LOFO";
}

/**
 * Map disposal type enum from contract to string
 */
// @ts-ignore: i32 is a valid AssemblyScript type
function mapDisposalType(disposalType: i32): string {
  if (disposalType == 0) return "SALE";
  if (disposalType == 1) return "REDEMPTION";
  if (disposalType == 2) return "DISTRIBUTION";
  return "LIQUIDATION";
}

/**
 * Get tax year from timestamp (assumes calendar year)
 */
// @ts-ignore: i32 is a valid AssemblyScript type
export function getTaxYear(timestamp: BigInt): i32 {
  // Simple calculation: Unix timestamp / seconds per year + 1970
  const secondsPerYear = BigInt.fromI32(31536000);
  const yearsSince1970 = timestamp.div(secondsPerYear);
  return 1970 + yearsSince1970.toI32();
}

/**
 * Handle AssetDisposed event (AssetDisposalFacet)
 * Tracks asset sales and calculates capital gains for K-1 reporting
 */
export function handleAssetDisposed(event: AssetDisposed): void {
  const fundWalletAddress = event.params.wallet.toHexString();
  const disposalId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Load vehicle (fund wallet)
  let vehicle = Vehicle.load(fundWalletAddress);
  if (!vehicle) {
    // Create minimal vehicle if it doesn't exist
    vehicle = new Vehicle(fundWalletAddress);
    vehicle.wallet = fundWalletAddress;
    vehicle.vehicleType = "FUND";
    vehicle.fundingMode = "COMMITMENT";
    vehicle.isOpenEnded = false;
    vehicle.totalCapitalCommitted = BigInt.fromI32(0);
    vehicle.totalCapitalCalled = BigInt.fromI32(0);
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.accruedManagementFees = BigInt.fromI32(0);
    vehicle.totalManagementFeesPaid = BigInt.fromI32(0);
    vehicle.createdAt = event.block.timestamp;
    vehicle.createdTx = event.transaction.hash;
    vehicle.save();
  }
  
  // Load token for symbol (EquityToken is the main token entity)
  const tokenAddress = event.params.token.toHexString();
  let equityToken = EquityToken.load(tokenAddress);
  let tokenSymbol = tokenAddress.slice(0, 10); // Default: truncated address
  if (equityToken) {
    tokenSymbol = equityToken.symbol;
  }
  
  // Get payment token symbol - for now just use USDC as default
  // Payment tokens are typically stablecoins, not EquityToken entities
  let paymentTokenSymbol = "USDC";
  
  // Calculate totals
  const totalUnits = event.params.totalUnits.toBigDecimal();
  const proceeds = event.params.proceeds.toBigDecimal();
  const costBasis = event.params.costBasis.toBigDecimal();
  
  // Calculate gain/loss
  const realizedGain = proceeds.minus(costBasis);
  
  // Calculate per-unit values
  let proceedsPerUnit = BigDecimal.zero();
  let costBasisPerUnit = BigDecimal.zero();
  let realizedGainPerUnit = BigDecimal.zero();
  if (!totalUnits.equals(BigDecimal.zero())) {
    proceedsPerUnit = proceeds.div(totalUnits);
    costBasisPerUnit = costBasis.div(totalUnits);
    realizedGainPerUnit = realizedGain.div(totalUnits);
  }
  
  // For isLongTerm, we'd need to check lot acquisition dates
  // The contract should ideally pass this, but for now we default to false
  // and can enhance later by looking up lots
  const isLongTerm = false; // TODO: Check oldest lot acquisition date
  
  // Create AssetDisposal entity
  let disposal = new AssetDisposal(disposalId);
  disposal.fundWallet = fundWalletAddress;
  disposal.token = tokenAddress;
  disposal.tokenSymbol = tokenSymbol;
  // @ts-ignore: changetype is an AssemblyScript built-in
  disposal.lotIds = changetype<Bytes[]>(event.params.lotIds);
  disposal.quantities = event.params.quantities;
  disposal.totalUnits = totalUnits;
  disposal.costBasis = costBasis;
  disposal.costBasisPerUnit = costBasisPerUnit;
  disposal.counterparty = event.params.counterparty;
  disposal.paymentToken = event.params.paymentToken;
  disposal.paymentTokenSymbol = paymentTokenSymbol;
  disposal.proceeds = proceeds;
  disposal.proceedsPerUnit = proceedsPerUnit;
  disposal.realizedGain = realizedGain;
  disposal.realizedGainPerUnit = realizedGainPerUnit;
  disposal.isLongTerm = isLongTerm;
  disposal.taxStrategy = mapTaxStrategy(event.params.taxStrategy);
  disposal.disposalType = mapDisposalType(event.params.disposalType);
  disposal.timestamp = event.block.timestamp;
  disposal.txHash = event.transaction.hash;
  disposal.blockNumber = event.block.number;
  disposal.save();
  
  // Update FundTaxYearSummary
  updateFundTaxYearSummary(disposal, event.block.timestamp);
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}-disposal`;
  let activity = createActivity(
    activityId,
    "ASSET_DISPOSED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Get or create FundTaxYearSummary
 */
export function getOrCreateFundTaxYearSummary(fundWalletId: string, timestamp: BigInt): FundTaxYearSummary {
  const taxYear = getTaxYear(timestamp);
  const summaryId = `${fundWalletId}-${taxYear.toString()}`;
  
  let summary = FundTaxYearSummary.load(summaryId);
  if (!summary) {
    summary = new FundTaxYearSummary(summaryId);
    summary.fundWallet = fundWalletId;
    summary.taxYear = taxYear;
    summary.shortTermGains = BigDecimal.zero();
    summary.shortTermLosses = BigDecimal.zero();
    summary.netShortTermGain = BigDecimal.zero();
    summary.longTermGains = BigDecimal.zero();
    summary.longTermLosses = BigDecimal.zero();
    summary.netLongTermGain = BigDecimal.zero();
    // New income fields
    summary.ordinaryIncome = BigDecimal.zero();
    summary.interestIncome = BigDecimal.zero();
    summary.dividendIncome = BigDecimal.zero();
    summary.rentalIncome = BigDecimal.zero();
    summary.otherIncome = BigDecimal.zero();
    // Wash sale tracking
    summary.washSaleDisallowed = BigDecimal.zero();
    summary.disposals = [];
    summary.lastUpdated = timestamp;
  }
  
  return summary;
}

/**
 * Update the fund's tax year summary with a new disposal
 */
function updateFundTaxYearSummary(disposal: AssetDisposal, timestamp: BigInt): void {
  let summary = getOrCreateFundTaxYearSummary(disposal.fundWallet, timestamp);
  
  const gain = disposal.realizedGain;
  
  if (disposal.isLongTerm) {
    if (gain.gt(BigDecimal.zero())) {
      summary.longTermGains = summary.longTermGains.plus(gain);
    } else {
      summary.longTermLosses = summary.longTermLosses.plus(gain.neg());
    }
    summary.netLongTermGain = summary.longTermGains.minus(summary.longTermLosses);
  } else {
    if (gain.gt(BigDecimal.zero())) {
      summary.shortTermGains = summary.shortTermGains.plus(gain);
    } else {
      summary.shortTermLosses = summary.shortTermLosses.plus(gain.neg());
    }
    summary.netShortTermGain = summary.shortTermGains.minus(summary.shortTermLosses);
  }
  
  // Add disposal to list
  let disposals = summary.disposals;
  disposals.push(disposal.id);
  summary.disposals = disposals;
  
  summary.lastUpdated = timestamp;
  summary.save();
}

/**
 * Handle WashSaleDetected event (AssetDisposalFacet)
 * Tracks wash sales for tax reporting - losses are disallowed and added to replacement lot basis
 */
export function handleWashSaleDetected(event: WashSaleDetected): void {
  const fundWalletAddress = event.params.wallet.toHexString();
  const washSaleId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Find the most recent disposal for this wallet and token
  // The wash sale event is emitted immediately after the AssetDisposed event
  const disposalId = `${event.transaction.hash.toHexString()}-${event.logIndex.minus(BigInt.fromI32(1)).toString()}`;
  let disposal = AssetDisposal.load(disposalId);
  
  // If we can't find it, try the same log index (in case they're emitted together)
  if (!disposal) {
    disposal = AssetDisposal.load(`${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`);
  }
  
  // Create WashSale entity
  let washSale = new WashSale(washSaleId);
  washSale.fundWallet = fundWalletAddress;
  
  // Link to disposal if found
  if (disposal) {
    washSale.disposal = disposal.id;
  } else {
    // Create a placeholder - shouldn't happen in normal flow
    washSale.disposal = disposalId;
  }
  
  // Get tax year summary
  const taxYear = getTaxYear(event.block.timestamp);
  const summaryId = `${fundWalletAddress}-${taxYear.toString()}`;
  let summary = getOrCreateFundTaxYearSummary(fundWalletAddress, event.block.timestamp);
  washSale.taxYearSummary = summary.id;
  
  // Wash sale details
  const disallowedLoss = event.params.disallowedLoss.toBigDecimal();
  washSale.disallowedLoss = disallowedLoss;
  washSale.basisAdjustment = disallowedLoss; // Added to replacement lot basis
  
  // Window timing
  washSale.windowStart = event.params.windowStart;
  washSale.windowEnd = event.params.windowEnd;
  washSale.originalSaleDate = event.block.timestamp;
  
  // For now, we don't have the exact wash purchase info from the event
  // The contract tracks this internally
  washSale.washPurchaseDate = event.block.timestamp; // Placeholder
  washSale.washPurchaseLotId = Bytes.empty();
  
  washSale.taxYear = taxYear;
  washSale.detectedAt = event.block.timestamp;
  washSale.txHash = event.transaction.hash;
  washSale.blockNumber = event.block.number;
  washSale.save();
  
  // Update tax year summary - add to disallowed losses
  summary.washSaleDisallowed = summary.washSaleDisallowed.plus(disallowedLoss);
  summary.lastUpdated = event.block.timestamp;
  summary.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}-washsale`;
  let activity = createActivity(
    activityId,
    "WASH_SALE_DETECTED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}
