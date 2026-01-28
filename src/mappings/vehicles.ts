// MemberCapitalFacet events
import {
  MemberAdded,
  MemberRemoved,
  OwnershipUpdated,
  CapitalContributed,
  DistributionCreated as MemberDistributionCreated,
  DistributionClaimed as MemberDistributionClaimed,
  DistributionCancelled as MemberDistributionCancelled,
} from "../../generated/templates/WalletDiamond/MemberCapitalFacet";

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

// WalletTypeFacet events
import {
  EntityTypeSet,
  LEISet,
} from "../../generated/templates/WalletDiamond/WalletTypeFacet";
import {
  Vehicle,
  VehicleMember,
  CapitalContribution as CapitalContributionEntity,
  Distribution,
  DistributionClaim,
  VehicleInvestment,
  Wallet,
  EntityClassification,
} from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
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

// ============ MEMBER CAPITAL HANDLERS ============

/**
 * Handle CapitalContributed event (MemberCapitalFacet)
 * Tracks capital contributions and updates member accounts
 */
export function handleCapitalContributed(event: CapitalContributed): void {
  const vehicleAddress = event.address.toHexString();
  const memberAddress = event.params.member;
  const memberId = `${vehicleAddress}-${memberAddress.toHexString()}`;
  
  // Load or create Vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    // Vehicle should exist, but create if missing
    vehicle = new Vehicle(vehicleAddress);
    vehicle.wallet = vehicleAddress;
    vehicle.vehicleType = "DAO"; // Default
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.memberCount = 0;
    vehicle.createdAt = event.block.timestamp;
    vehicle.createdTx = event.transaction.hash;
  }
  
  // Update vehicle totals
  vehicle.totalCapitalContributed = vehicle.totalCapitalContributed.plus(event.params.amount);
  vehicle.save();
  
  // Load or create VehicleMember
  let member = VehicleMember.load(memberId);
  if (!member) {
    member = new VehicleMember(memberId);
    member.vehicle = vehicleAddress;
    member.memberAddress = memberAddress;
    member.capitalContributed = BigInt.fromI32(0);
    member.distributionsReceived = BigInt.fromI32(0);
    member.tokenBalance = BigInt.fromI32(0); // Updated from token events
    member.removed = false;
    member.addedAt = event.block.timestamp;
    member.addedTx = event.transaction.hash;
    
    // Increment member count
    vehicle.memberCount = vehicle.memberCount + 1;
    vehicle.save();
  }
  
  // Update member totals
  member.capitalContributed = member.capitalContributed.plus(event.params.amount);
  member.save();
  
  // Create CapitalContribution entity
  const contributionId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  const contribution = new CapitalContributionEntity(contributionId);
  contribution.vehicle = vehicleAddress;
  contribution.member = memberId;
  contribution.memberAddress = memberAddress;
  contribution.amount = event.params.amount;
  contribution.source = "DIRECT"; // Manual recording, not from offering
  contribution.timestamp = event.params.timestamp;
  contribution.tx = event.transaction.hash;
  contribution.blockNumber = event.block.number;
  contribution.logIndex = event.logIndex;
  contribution.save();
  
  // Create activity
  createActivity(
    contributionId,
    "CAPITAL_CONTRIBUTED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  ).save();
}

/**
 * Handle OwnershipUpdated event (MemberCapitalFacet)
 * Tracks ownership percentage changes
 */
export function handleOwnershipUpdated(event: OwnershipUpdated): void {
  const vehicleAddress = event.address.toHexString();
  const memberAddress = event.params.member;
  const memberId = `${vehicleAddress}-${memberAddress.toHexString()}`;
  
  let member = VehicleMember.load(memberId);
  if (member) {
    member.ownershipBps = event.params.newOwnershipBps.toI32();
    member.save();
  }
}

// ============ MEMBER CAPITAL DISTRIBUTION HANDLERS ============

/**
 * Handle DistributionCreated event (MemberCapitalFacet)
 * Creates distribution record for stored-ownership entities
 */
export function handleMemberDistributionCreated(event: MemberDistributionCreated): void {
  const vehicleAddress = event.address.toHexString();
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  
  // Load vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    // Create vehicle if missing
    vehicle = new Vehicle(vehicleAddress);
    vehicle.wallet = vehicleAddress;
    vehicle.vehicleType = "DAO";
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.memberCount = 0;
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
  distribution.lpAmount = BigInt.fromI32(0); // Not applicable for MemberCapital
  distribution.carryAmount = BigInt.fromI32(0); // Not applicable for MemberCapital
  distribution.paymentToken = event.params.paymentToken;
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
 * Handle DistributionClaimed event (MemberCapitalFacet)
 */
export function handleMemberDistributionClaimed(event: MemberDistributionClaimed): void {
  const vehicleAddress = event.address.toHexString();
  const memberAddress = event.params.member;
  const memberId = `${vehicleAddress}-${memberAddress.toHexString()}`;
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  const claimId = `${distributionId}-${memberAddress.toHexString()}`;
  
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
  
  // Load member
  let member = VehicleMember.load(memberId);
  if (member) {
    member.distributionsReceived = member.distributionsReceived.plus(event.params.amount);
    member.save();
  }
  
  // Create DistributionClaim
  let claim = new DistributionClaim(claimId);
  claim.distribution = distributionId;
  claim.claimantAddress = memberAddress;
  claim.amount = event.params.amount;
  claim.vehicleMember = memberId;
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
 * Handle DistributionCancelled event (MemberCapitalFacet)
 */
export function handleMemberDistributionCancelled(event: MemberDistributionCancelled): void {
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
    vehicle.memberCount = 0;
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

// ============ INVESTMENT HANDLERS ============

/**
 * Handle MemberAdded event (MemberCapitalFacet)
 * Tracks when new members join the vehicle
 */
export function handleMemberAdded(event: MemberAdded): void {
  const vehicleAddress = event.address.toHexString();
  const memberAddress = event.params.member;
  const memberId = `${vehicleAddress}-${memberAddress.toHexString()}`;
  
  let member = VehicleMember.load(memberId);
  if (!member) {
    member = new VehicleMember(memberId);
    member.vehicle = vehicleAddress;
    member.memberAddress = memberAddress;
    member.ownershipBps = event.params.ownershipBps.toI32();
    member.capitalContributed = BigInt.fromI32(0);
    member.distributionsReceived = BigInt.fromI32(0);
    member.tokenBalance = BigInt.fromI32(0);
    member.removed = false;
    member.addedAt = event.block.timestamp;
    member.addedTx = event.transaction.hash;
    member.save();
    
    // Increment member count
    let vehicle = Vehicle.load(vehicleAddress);
    if (vehicle) {
      vehicle.memberCount = vehicle.memberCount + 1;
      vehicle.save();
    }
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    createActivity(
      activityId,
      "MEMBER_ADDED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    ).save();
  }
}

/**
 * Handle MemberRemoved event (MemberCapitalFacet)
 * Tracks when members leave the vehicle
 */
export function handleMemberRemoved(event: MemberRemoved): void {
  const vehicleAddress = event.address.toHexString();
  const memberAddress = event.params.member;
  const memberId = `${vehicleAddress}-${memberAddress.toHexString()}`;
  
  let member = VehicleMember.load(memberId);
  if (member) {
    member.removed = true;
    member.removedAt = event.block.timestamp;
    member.removedTx = event.transaction.hash;
    member.save();
    
    // Decrement member count
    let vehicle = Vehicle.load(vehicleAddress);
    if (vehicle) {
      vehicle.memberCount = vehicle.memberCount - 1;
      vehicle.save();
    }
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    createActivity(
      activityId,
      "MEMBER_REMOVED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    ).save();
  }
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

