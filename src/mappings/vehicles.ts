// CapitalCallFacet events
import {
  CapitalCallCreated,
  ContributionReceived,
  CapitalCallCancelled,
  CapitalCallFunded,
  CommitmentCalculated,
  CommitmentsTransferred,
} from "../../generated/templates/WalletDiamond/CapitalCallFacet";

// TokenDistributionFacet events
import {
  DistributionCreated as TokenDistributionCreated,
  DistributionClaimed as TokenDistributionClaimed,
  DistributionCancelled as TokenDistributionCancelled,
} from "../../generated/templates/WalletDiamond/TokenDistributionFacet";

// InvestmentFacet events
import {
  InvestmentCreated,
  InvestmentExecuted,
  ValuationUpdated,
  InvestmentExited,
} from "../../generated/templates/WalletDiamond/InvestmentFacet";

// AssetDisposalFacet events
import {
  AssetDisposed,
} from "../../generated/templates/WalletDiamond/AssetDisposalFacet";

// WalletTypeFacet events
import {
  EntityTypeSet,
  LEISet,
} from "../../generated/templates/WalletDiamond/WalletTypeFacet";
import {
  Vehicle,
  CapitalContribution as CapitalContributionEntity,
  Distribution,
  DistributionClaim,
  VehicleInvestment,
  Wallet,
  EntityClassification,
  CapitalCall,
  CallCommitment,
  AssetDisposal,
  FundTaxYearSummary,
  ShareClass,
  CallContribution,
} from "../../generated/schema";
import { BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// ============ ENTITY CLASSIFICATION HANDLERS ============

/**
 * Handle EntityTypeSet event (WalletTypeFacet)
 * Sets the GLEIF ELF classification for an entity
 */
export function handleEntityTypeSet(event: EntityTypeSet): void {
  const walletAddress = event.address.toHexString();
  
  // Load or create EntityClassification
  let classification = EntityClassification.load(walletAddress);
  if (!classification) {
    classification = new EntityClassification(walletAddress);
    classification.wallet = walletAddress;
    classification.createdAt = event.block.timestamp;
    classification.createdTx = event.transaction.hash;
  }
  
  classification.elfCode = event.params.elfCode;
  classification.jurisdictionCode = event.params.jurisdictionCode;
  classification.elfName = event.params.elfName;
  classification.lastUpdatedAt = event.block.timestamp;
  classification.lastUpdatedTx = event.transaction.hash;
  classification.save();
  
  // Update wallet reference
  let wallet = Wallet.load(walletAddress);
  if (wallet) {
    wallet.entityClassification = walletAddress;
    wallet.save();
  }
}

/**
 * Handle LEISet event (WalletTypeFacet)
 * Sets the Legal Entity Identifier for an entity
 */
export function handleLEISet(event: LEISet): void {
  const walletAddress = event.address.toHexString();
  
  let classification = EntityClassification.load(walletAddress);
  if (classification) {
    classification.lei = event.params.lei;
    classification.lastUpdatedAt = event.block.timestamp;
    classification.lastUpdatedTx = event.transaction.hash;
    classification.save();
  }
}

// ============ CAPITAL CALL HANDLERS ============

/**
 * Handle CapitalCallCreated event (CapitalCallFacet)
 * Creates a new capital call for the fund
 */
export function handleCapitalCallCreated(event: CapitalCallCreated): void {
  const vehicleAddress = event.address.toHexString();
  const callId = `${vehicleAddress}-${event.params.callId.toString()}`;
  
  // Load or create Vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    vehicle = new Vehicle(vehicleAddress);
    vehicle.wallet = vehicleAddress;
    vehicle.vehicleType = "FUND";
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.createdAt = event.block.timestamp;
    vehicle.createdTx = event.transaction.hash;
    vehicle.save();
  }
  
  // Create CapitalCall entity
  let capitalCall = new CapitalCall(callId);
  capitalCall.vehicle = vehicleAddress;
  capitalCall.callId = event.params.callId;
  capitalCall.totalAmount = event.params.totalAmount;
  capitalCall.totalReceived = BigInt.fromI32(0);
  capitalCall.dueDate = event.params.dueDate;
  capitalCall.purposeHash = event.params.purposeHash;
  capitalCall.paymentToken = event.params.paymentToken;
  capitalCall.status = "PENDING";
  capitalCall.cancelled = false;
  capitalCall.createdAt = event.block.timestamp;
  capitalCall.createdTx = event.transaction.hash;
  capitalCall.blockNumber = event.block.number;
  capitalCall.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "CAPITAL_CALL_CREATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.capitalCall = callId;
  activity.save();
}

/**
 * Handle CommitmentCalculated event (CapitalCallFacet)
 * Creates commitment records for each member when a capital call is created
 * NOTE: VehicleMember entity has been deprecated - membership is derived from token lots
 */
export function handleCommitmentCalculated(event: CommitmentCalculated): void {
  const vehicleAddress = event.address.toHexString();
  const callId = `${vehicleAddress}-${event.params.callId.toString()}`;
  const memberAddress = event.params.member;
  const commitmentId = `${callId}-${memberAddress.toHexString()}`;
  
  // Create commitment
  let commitment = new CallCommitment(commitmentId);
  commitment.capitalCall = callId;
  commitment.memberAddress = memberAddress;
  commitment.amountDue = event.params.amountDue;
  commitment.amountPaid = BigInt.fromI32(0);
  commitment.status = "PENDING";
  commitment.createdAt = event.block.timestamp;
  commitment.createdTx = event.transaction.hash;
  commitment.lastUpdatedAt = event.block.timestamp;
  commitment.lastUpdatedTx = event.transaction.hash;
  commitment.save();
}

/**
 * Handle ContributionReceived event (CapitalCallFacet)
 * Records a member's contribution (on-chain or off-chain) to a capital call
 * NOTE: VehicleMember entity has been deprecated - membership is derived from token lots
 */
export function handleContributionReceived(event: ContributionReceived): void {
  const vehicleAddress = event.address.toHexString();
  const callId = `${vehicleAddress}-${event.params.callId.toString()}`;
  const memberAddress = event.params.member;
  const commitmentId = `${callId}-${memberAddress.toHexString()}`;
  const contributionId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Load capital call and update totals
  let capitalCall = CapitalCall.load(callId);
  if (capitalCall) {
    capitalCall.totalReceived = capitalCall.totalReceived.plus(event.params.amount);
    
    // Update status
    if (capitalCall.totalReceived.ge(capitalCall.totalAmount)) {
      capitalCall.status = "FUNDED";
    } else if (capitalCall.totalReceived.gt(BigInt.fromI32(0))) {
      capitalCall.status = "PARTIAL";
    }
    capitalCall.save();
  }
  
  // Update commitment
  let commitment = CallCommitment.load(commitmentId);
  if (commitment) {
    commitment.amountPaid = commitment.amountPaid.plus(event.params.amount);
    
    // Update commitment status
    if (commitment.amountPaid.ge(commitment.amountDue)) {
      commitment.status = "PAID";
    } else if (commitment.amountPaid.gt(BigInt.fromI32(0))) {
      commitment.status = "PARTIAL";
    }
    commitment.lastUpdatedAt = event.block.timestamp;
    commitment.lastUpdatedTx = event.transaction.hash;
    commitment.save();
  }
  
  // Create contribution record
  let contribution = new CallContribution(contributionId);
  contribution.capitalCall = callId;
  contribution.commitment = commitmentId;
  contribution.memberAddress = memberAddress;
  contribution.amount = event.params.amount;
  contribution.isOffchain = event.params.isOffchain;
  contribution.timestamp = event.block.timestamp;
  contribution.tx = event.transaction.hash;
  contribution.blockNumber = event.block.number;
  contribution.logIndex = event.logIndex;
  contribution.save();
  
  // Update vehicle totals
  let vehicle = Vehicle.load(vehicleAddress);
  if (vehicle) {
    vehicle.totalCapitalContributed = vehicle.totalCapitalContributed.plus(event.params.amount);
    vehicle.save();
  }
  
  // Create activity
  const activityType = event.params.isOffchain ? "CAPITAL_CALL_OFFCHAIN_CONTRIBUTION" : "CAPITAL_CALL_CONTRIBUTION";
  let activity = createActivity(
    contributionId,
    activityType,
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.capitalCall = callId;
  activity.callContribution = contributionId;
  activity.save();
}

/**
 * Handle CapitalCallFunded event (CapitalCallFacet)
 * Emitted when a capital call is fully funded
 */
export function handleCapitalCallFunded(event: CapitalCallFunded): void {
  const vehicleAddress = event.address.toHexString();
  const callId = `${vehicleAddress}-${event.params.callId.toString()}`;
  
  let capitalCall = CapitalCall.load(callId);
  if (capitalCall) {
    capitalCall.status = "FUNDED";
    capitalCall.totalReceived = event.params.totalReceived;
    capitalCall.save();
  }
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "CAPITAL_CALL_FUNDED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.capitalCall = callId;
  activity.save();
}

/**
 * Handle CapitalCallCancelled event (CapitalCallFacet)
 * Marks a capital call as cancelled
 */
export function handleCapitalCallCancelled(event: CapitalCallCancelled): void {
  const vehicleAddress = event.address.toHexString();
  const callId = `${vehicleAddress}-${event.params.callId.toString()}`;
  
  let capitalCall = CapitalCall.load(callId);
  if (capitalCall) {
    capitalCall.cancelled = true;
    capitalCall.status = "CANCELLED";
    capitalCall.cancelledAt = event.block.timestamp;
    capitalCall.cancelledTx = event.transaction.hash;
    capitalCall.save();
  }
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "CAPITAL_CALL_CANCELLED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.capitalCall = callId;
  activity.save();
}

/**
 * Handle CommitmentsTransferred event (CapitalCallFacet)
 * Called when token transfers trigger commitment reallocation
 * NOTE: VehicleMember entity has been deprecated - membership is derived from token lots
 */
export function handleCommitmentsTransferred(event: CommitmentsTransferred): void {
  const vehicleAddress = event.address.toHexString();
  const callId = `${vehicleAddress}-${event.params.callId.toString()}`;
  const fromAddress = event.params.from;
  const toAddress = event.params.to;
  const fromCommitmentId = `${callId}-${fromAddress.toHexString()}`;
  const toCommitmentId = `${callId}-${toAddress.toHexString()}`;
  
  // Update 'from' commitment (reduce amountDue and amountPaid)
  let fromCommitment = CallCommitment.load(fromCommitmentId);
  if (fromCommitment) {
    fromCommitment.amountDue = fromCommitment.amountDue.minus(event.params.amountDueTransferred);
    fromCommitment.amountPaid = fromCommitment.amountPaid.minus(event.params.amountPaidTransferred);
    
    // Recalculate status
    if (fromCommitment.amountPaid.ge(fromCommitment.amountDue)) {
      fromCommitment.status = "PAID";
    } else if (fromCommitment.amountPaid.gt(BigInt.fromI32(0))) {
      fromCommitment.status = "PARTIAL";
    } else {
      fromCommitment.status = "PENDING";
    }
    fromCommitment.lastUpdatedAt = event.block.timestamp;
    fromCommitment.lastUpdatedTx = event.transaction.hash;
    fromCommitment.save();
  }
  
  // Update 'to' commitment (increase amountDue)
  let toCommitment = CallCommitment.load(toCommitmentId);
  if (!toCommitment) {
    // Create new commitment for recipient
    toCommitment = new CallCommitment(toCommitmentId);
    toCommitment.capitalCall = callId;
    toCommitment.memberAddress = toAddress;
    toCommitment.amountDue = BigInt.fromI32(0);
    toCommitment.amountPaid = BigInt.fromI32(0);
    toCommitment.status = "PENDING";
    toCommitment.createdAt = event.block.timestamp;
    toCommitment.createdTx = event.transaction.hash;
  }
  toCommitment.amountDue = toCommitment.amountDue.plus(event.params.amountDueTransferred);
  toCommitment.amountPaid = toCommitment.amountPaid.plus(event.params.amountPaidTransferred);
  
  // Recalculate status
  if (toCommitment.amountPaid.ge(toCommitment.amountDue)) {
    toCommitment.status = "PAID";
  } else if (toCommitment.amountPaid.gt(BigInt.fromI32(0))) {
    toCommitment.status = "PARTIAL";
  } else {
    toCommitment.status = "PENDING";
  }
  toCommitment.lastUpdatedAt = event.block.timestamp;
  toCommitment.lastUpdatedTx = event.transaction.hash;
  toCommitment.save();
}


// ============ TOKEN DISTRIBUTION HANDLERS ============

/**
 * Handle DistributionCreated event (TokenDistributionFacet)
 * Creates distribution record for token-based ownership entities
 */
export function handleTokenDistributionCreated(event: TokenDistributionCreated): void {
  const vehicleAddress = event.address.toHexString();
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  
  // Load vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    // Create vehicle if missing
    vehicle = new Vehicle(vehicleAddress);
    vehicle.wallet = vehicleAddress;
    vehicle.vehicleType = "FUND"; // Token-based distributions are typically for funds
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.createdAt = event.block.timestamp;
    vehicle.createdTx = event.transaction.hash;
  }
  
  // Update vehicle totals
  vehicle.totalDistributionsExecuted = vehicle.totalDistributionsExecuted.plus(event.params.totalAmount);
  vehicle.save();
  
  // Create Distribution entity
  let distribution = new Distribution(distributionId);
  distribution.vehicle = vehicleAddress;
  distribution.distributionId = event.params.distributionId;
  distribution.totalAmount = event.params.totalAmount;
  distribution.totalClaimed = BigInt.fromI32(0);
  distribution.lpAmount = BigInt.fromI32(0);
  distribution.carryAmount = BigInt.fromI32(0);
  distribution.paymentToken = event.params.paymentToken;
  distribution.membershipToken = event.params.membershipToken;
  distribution.cancelled = false;
  distribution.createdAt = event.block.timestamp;
  distribution.createdTx = event.transaction.hash;
  distribution.blockNumber = event.block.number;
  distribution.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "DISTRIBUTION_CREATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.distribution = distributionId;
  activity.save();
}

/**
 * Handle DistributionClaimed event (TokenDistributionFacet)
 */
export function handleTokenDistributionClaimed(event: TokenDistributionClaimed): void {
  const vehicleAddress = event.address.toHexString();
  const claimantAddress = event.params.claimant;
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  const claimId = `${distributionId}-${claimantAddress.toHexString()}`;
  
  // Load vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (vehicle) {
    vehicle.totalDistributionsClaimed = vehicle.totalDistributionsClaimed.plus(event.params.amount);
    vehicle.save();
  }
  
  // Update distribution totals
  let distribution = Distribution.load(distributionId);
  if (distribution) {
    distribution.totalClaimed = distribution.totalClaimed.plus(event.params.amount);
    distribution.save();
  }
  
  // Create DistributionClaim
  let claim = new DistributionClaim(claimId);
  claim.distribution = distributionId;
  claim.claimantAddress = claimantAddress;
  claim.amount = event.params.amount;
  claim.isCarryRecipient = false;
  claim.claimed = true;
  claim.claimedAt = event.block.timestamp;
  claim.claimedTx = event.transaction.hash;
  claim.blockNumber = event.block.number;
  claim.logIndex = event.logIndex;
  claim.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "DISTRIBUTION_CLAIMED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.distribution = distributionId;
  activity.distributionClaim = claimId;
  activity.save();
}

/**
 * Handle DistributionCancelled event (TokenDistributionFacet)
 */
export function handleTokenDistributionCancelled(event: TokenDistributionCancelled): void {
  const vehicleAddress = event.address.toHexString();
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  
  let distribution = Distribution.load(distributionId);
  if (distribution) {
    distribution.cancelled = true;
    distribution.cancelledAt = event.block.timestamp;
    distribution.cancelledTx = event.transaction.hash;
    distribution.save();
  }
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "DISTRIBUTION_CANCELLED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.distribution = distributionId;
  activity.save();
}

// ============ INVESTMENT HANDLERS (InvestmentFacet) ============

/**
 * Handle InvestmentCreated event (InvestmentFacet)
 * Creates investment record when target is set
 */
export function handleInvestmentCreated(event: InvestmentCreated): void {
  const vehicleAddress = event.address.toHexString();
  const investmentId = `${vehicleAddress}-${event.params.investmentId.toString()}`;
  
  let investment = new VehicleInvestment(investmentId);
  investment.vehicle = vehicleAddress;
  investment.investmentId = event.params.investmentId;
  
  // Map AssetType enum from new facet
  // EQUITY=0, REAL_ESTATE=1, DEBT=2, TOKEN=3, FUND=4, OTHER=5
  if (event.params.assetType == 0) {
    investment.assetType = "EQUITY";
  } else if (event.params.assetType == 1) {
    investment.assetType = "REAL_ESTATE";
  } else if (event.params.assetType == 2) {
    investment.assetType = "DEBT";
  } else if (event.params.assetType == 3) {
    investment.assetType = "CRYPTO"; // TOKEN maps to CRYPTO for compatibility
  } else if (event.params.assetType == 4) {
    investment.assetType = "DEFI"; // FUND maps to DEFI for compatibility
  } else {
    investment.assetType = "OTHER";
  }
  
  investment.target = event.params.target;
  investment.amount = BigInt.fromI32(0); // Set when executed
  investment.entryDate = BigInt.fromI32(0); // Set when executed
  investment.exited = false;
  investment.currentValuation = BigInt.fromI32(0);
  investment.lastValuationUpdate = BigInt.fromI32(0);
  
  investment.save();
}

/**
 * Handle InvestmentExecuted event (InvestmentFacet)
 * Updates investment when capital is deployed
 */
export function handleInvestmentExecuted(event: InvestmentExecuted): void {
  const vehicleAddress = event.address.toHexString();
  const investmentId = `${vehicleAddress}-${event.params.investmentId.toString()}`;
  
  let investment = VehicleInvestment.load(investmentId);
  if (investment) {
    investment.amount = event.params.amount;
    investment.entryDate = event.params.timestamp;
    investment.entryTx = event.transaction.hash;
    investment.currentValuation = event.params.amount; // Initial valuation = amount invested
    investment.lastValuationUpdate = event.params.timestamp;
    investment.save();
  }
}

/**
 * Handle ValuationUpdated event (InvestmentFacet)
 * Updates SPV investment valuations (used for NAV calculation)
 */
export function handleValuationUpdated(event: ValuationUpdated): void {
  const vehicleAddress = event.address.toHexString();
  const investmentId = `${vehicleAddress}-${event.params.investmentId.toString()}`;
  
  let investment = VehicleInvestment.load(investmentId);
  if (investment) {
    investment.currentValuation = event.params.newValue;
    investment.lastValuationUpdate = event.params.timestamp;
    investment.save();
  }
}

/**
 * Handle InvestmentExited event (InvestmentFacet)
 * Tracks when SPV exits an investment
 */
export function handleInvestmentExited(event: InvestmentExited): void {
  const vehicleAddress = event.address.toHexString();
  const investmentId = `${vehicleAddress}-${event.params.investmentId.toString()}`;
  
  let investment = VehicleInvestment.load(investmentId);
  if (investment) {
    investment.exited = true;
    investment.exitAmount = event.params.exitValue;
    investment.exitDate = event.params.timestamp;
    investment.exitTx = event.transaction.hash;
    investment.currentValuation = event.params.exitValue; // Final valuation
    investment.save();
  }
}

// ============ ASSET DISPOSAL HANDLERS ============

const ONE_YEAR_SECONDS = BigInt.fromI32(365 * 24 * 60 * 60);

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
function getTaxYear(timestamp: BigInt): i32 {
  // Simple calculation: Unix timestamp / seconds per year + 1970
  // More accurate: use Date but AssemblyScript has limited Date support
  const secondsPerYear = BigInt.fromI32(31536000);
  const yearsSince1970 = timestamp.div(secondsPerYear);
  return 1970 + yearsSince1970.toI32();
}

/**
 * Handle AssetDisposed event (AssetDisposalFacet)
 * Tracks asset sales and calculates capital gains for K-1 reporting
 */
export function handleAssetDisposed(event: AssetDisposed): void {
  const fundWalletAddress = event.params.fundWallet.toHexString();
  const disposalId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Load vehicle (fund wallet)
  let vehicle = Vehicle.load(fundWalletAddress);
  if (!vehicle) {
    // Create minimal vehicle if it doesn't exist
    vehicle = new Vehicle(fundWalletAddress);
    vehicle.wallet = fundWalletAddress;
    vehicle.vehicleType = "FUND";
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.createdAt = event.block.timestamp;
    vehicle.createdTx = event.transaction.hash;
    vehicle.save();
  }
  
  // Load token for symbol (ShareClass is the main token entity)
  const tokenAddress = event.params.token.toHexString();
  let shareClass = ShareClass.load(tokenAddress);
  let tokenSymbol = tokenAddress.slice(0, 10); // Default: truncated address
  if (shareClass) {
    tokenSymbol = shareClass.symbol;
  }
  
  // Get payment token symbol - for now just use USDC as default
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
  
  // Determine long-term status based on disposal type enum
  // The contract calculates this based on oldest lot's acquisition date
  // For now, we'll trust the contract's calculation (passed in event)
  // TODO: Could verify by checking lot acquisition dates
  const isLongTerm = event.params.disposalType == 0 || event.params.disposalType == 1; // Placeholder - need actual holding period check
  
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
 * Update the fund's tax year summary with a new disposal
 */
function updateFundTaxYearSummary(disposal: AssetDisposal, timestamp: BigInt): void {
  const taxYear = getTaxYear(timestamp);
  const summaryId = `${disposal.fundWallet}-${taxYear.toString()}`;
  
  let summary = FundTaxYearSummary.load(summaryId);
  if (!summary) {
    summary = new FundTaxYearSummary(summaryId);
    summary.fundWallet = disposal.fundWallet;
    summary.taxYear = taxYear;
    summary.shortTermGains = BigDecimal.zero();
    summary.shortTermLosses = BigDecimal.zero();
    summary.netShortTermGain = BigDecimal.zero();
    summary.longTermGains = BigDecimal.zero();
    summary.longTermLosses = BigDecimal.zero();
    summary.netLongTermGain = BigDecimal.zero();
    summary.disposals = [];
  }
  
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
