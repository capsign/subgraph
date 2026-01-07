import {
  CapitalContributed,
  DistributionExecuted,
  DistributionClaimed,
  MemberAdded,
  MemberRemoved,
  InvestmentMade,
  ValuationUpdated,
  InvestmentExited,
} from "../../generated/templates/WalletDiamond/VehicleMembers";
import {
  DistributionCreated,
  DistributionCancelled,
} from "../../generated/templates/WalletDiamond/VehicleDistributionFacet";
import {
  Vehicle,
  VehicleMember,
  CapitalContribution as CapitalContributionEntity,
  Distribution,
  DistributionClaim,
  VehicleInvestment,
  Wallet,
} from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

/**
 * Handle CapitalContributed event
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
 * Handle DistributionCreated event (new claim-based model)
 * Creates distribution record when a claimable distribution is created
 */
export function handleDistributionCreated(event: DistributionCreated): void {
  const vehicleAddress = event.address.toHexString();
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  
  // Load vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    return;
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
  distribution.lpAmount = event.params.lpPoolAmount;
  distribution.carryAmount = event.params.carryPoolAmount;
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
 * Handle DistributionExecuted event (legacy - kept for backward compatibility)
 * Creates distribution record when yield is distributed
 */
export function handleDistributionExecuted(event: DistributionExecuted): void {
  const vehicleAddress = event.address.toHexString();
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  
  // Load vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    return; // Should not happen
  }
  
  // Check if distribution already exists (from DistributionCreated)
  let distribution = Distribution.load(distributionId);
  if (!distribution) {
    // Legacy path - create distribution
    distribution = new Distribution(distributionId);
    distribution.vehicle = vehicleAddress;
    distribution.distributionId = event.params.distributionId;
    distribution.totalAmount = event.params.totalAmount;
    distribution.totalClaimed = BigInt.fromI32(0);
    distribution.lpAmount = BigInt.fromI32(0);
    distribution.carryAmount = BigInt.fromI32(0);
    distribution.paymentToken = Bytes.empty();
    distribution.cancelled = false;
    distribution.createdAt = event.params.timestamp;
    distribution.createdTx = event.transaction.hash;
    distribution.blockNumber = event.block.number;
    distribution.save();
    
    // Update vehicle totals
    vehicle.totalDistributionsExecuted = vehicle.totalDistributionsExecuted.plus(event.params.totalAmount);
    vehicle.save();
    
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
}

/**
 * Handle DistributionCancelled event (Vehicle)
 */
export function handleVehicleDistributionCancelled(event: DistributionCancelled): void {
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

/**
 * Handle DistributionClaimed event
 * Tracks when individual members claim their distributions
 */
export function handleDistributionClaimed(event: DistributionClaimed): void {
  const vehicleAddress = event.address.toHexString();
  const memberAddress = event.params.member;
  const memberId = `${vehicleAddress}-${memberAddress.toHexString()}`;
  const distributionId = `${vehicleAddress}-${event.params.distributionId.toString()}`;
  const claimId = `${distributionId}-${memberAddress.toHexString()}`;
  
  // Load vehicle
  let vehicle = Vehicle.load(vehicleAddress);
  if (!vehicle) {
    return;
  }
  
  // Update vehicle totals
  vehicle.totalDistributionsClaimed = vehicle.totalDistributionsClaimed.plus(event.params.amount);
  vehicle.save();
  
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
  claim.isCarryRecipient = false; // Will need to be determined from member status
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
 * Handle MemberAdded event
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
    member.capitalContributed = BigInt.fromI32(0);
    member.distributionsReceived = BigInt.fromI32(0);
    member.tokenBalance = BigInt.fromI32(0);
    member.removed = false;
    member.addedAt = event.params.timestamp;
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
 * Handle MemberRemoved event
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

/**
 * Handle InvestmentMade event
 * Tracks SPV investments (e.g., deploying capital to Morpho)
 */
export function handleInvestmentMade(event: InvestmentMade): void {
  const vehicleAddress = event.address.toHexString();
  const investmentId = `${vehicleAddress}-${event.params.investmentId.toString()}`;
  
  let investment = new VehicleInvestment(investmentId);
  investment.vehicle = vehicleAddress;
  investment.investmentId = event.params.investmentId;
  
  // Map AssetType enum
  if (event.params.assetType == 0) {
    investment.assetType = "REAL_ESTATE";
  } else if (event.params.assetType == 1) {
    investment.assetType = "EQUITY";
  } else if (event.params.assetType == 2) {
    investment.assetType = "CRYPTO";
  } else if (event.params.assetType == 3) {
    investment.assetType = "DEBT";
  } else {
    investment.assetType = "OTHER";
  }
  
  investment.target = event.params.target;
  investment.amount = event.params.amount;
  investment.entryDate = event.params.timestamp;
  investment.entryTx = event.transaction.hash;
  investment.exited = false;
  investment.currentValuation = event.params.amount; // Initial valuation = amount invested
  investment.lastValuationUpdate = event.params.timestamp;
  
  investment.save();
}

/**
 * Handle ValuationUpdated event
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
 * Handle InvestmentExited event
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
    investment.currentValuation = BigInt.fromI32(0); // No longer has value
    investment.save();
  }
}

