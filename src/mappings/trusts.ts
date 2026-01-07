import {
  TrustInitialized,
  TrustStatusChanged,
  TrustRevoked,
  ParticipantAdded,
  ParticipantRemoved,
  BeneficiaryShareUpdated,
} from "../../generated/templates/WalletDiamond/TrustCoreFacet";
import {
  ClaimableDistributionCreated,
  DistributionClaimed,
  DistributionCancelled,
  DistributionScheduleCreated,
  DistributionScheduleRevoked,
  MilestoneCreated,
  MilestoneAchieved,
  VestedAmountReleased,
} from "../../generated/templates/WalletDiamond/TrustDistributionFacet";
import {
  Trust,
  TrustParticipant,
  Distribution,
  DistributionClaim,
  TrustMilestone,
  TrustVestingSchedule,
  Wallet,
} from "../../generated/schema";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// Map trust type enum from contract
// @ts-ignore: i32 is a valid AssemblyScript type
function mapTrustType(trustType: i32): string {
  if (trustType == 0) return "REVOCABLE_LIVING";
  if (trustType == 1) return "IRREVOCABLE";
  if (trustType == 2) return "TESTAMENTARY";
  if (trustType == 3) return "CHARITABLE";
  if (trustType == 4) return "SPECIAL_NEEDS";
  if (trustType == 5) return "SPENDTHRIFT";
  return "OTHER";
}

// Map trust status enum from contract
// @ts-ignore: i32 is a valid AssemblyScript type
function mapTrustStatus(status: i32): string {
  if (status == 0) return "ACTIVE";
  if (status == 1) return "SUSPENDED";
  if (status == 2) return "TERMINATED";
  return "ACTIVE";
}

// Map participant role enum from contract
// @ts-ignore: i32 is a valid AssemblyScript type
function mapParticipantRole(role: i32): string {
  if (role == 0) return "GRANTOR";
  if (role == 1) return "TRUSTEE";
  if (role == 2) return "SUCCESSOR_TRUSTEE";
  if (role == 3) return "BENEFICIARY";
  if (role == 4) return "PROTECTOR";
  return "BENEFICIARY";
}

// Map distribution type enum from contract
// @ts-ignore: i32 is a valid AssemblyScript type
function mapDistributionType(distType: i32): string {
  if (distType == 0) return "INCOME";
  if (distType == 1) return "PRINCIPAL";
  if (distType == 2) return "LIQUIDATING";
  return "INCOME";
}

/**
 * Handle TrustInitialized event
 * Creates Trust entity when a wallet is initialized with trust facets
 */
export function handleTrustInitialized(event: TrustInitialized): void {
  const trustAddress = event.address.toHexString();
  
  // Load or create Trust
  let trust = Trust.load(trustAddress);
  if (!trust) {
    trust = new Trust(trustAddress);
    trust.wallet = trustAddress;
    trust.trustType = mapTrustType(event.params.trustType);
    trust.status = "ACTIVE";
    trust.trustInstrumentHash = Bytes.empty(); // Set later via TrustInstrumentUpdated
    trust.dateEstablished = event.block.timestamp;
    trust.isRevocable = event.params.isRevocable;
    trust.grantor = event.params.grantor;
    trust.trustees = [event.params.trustee];
    trust.successorTrustees = [];
    trust.beneficiaries = [];
    trust.protectors = [];
    trust.totalDistributed = BigInt.fromI32(0);
    trust.totalDistributionsClaimed = BigInt.fromI32(0);
    trust.participantCount = 2; // Grantor + initial trustee
    trust.createdAt = event.block.timestamp;
    trust.createdTx = event.transaction.hash;
    trust.save();
    
    // Update wallet reference
    let wallet = Wallet.load(trustAddress);
    if (wallet) {
      wallet.trust = trustAddress;
      wallet.save();
    }
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    let activity = createActivity(
      activityId,
      "TRUST_CREATED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.trust = trustAddress;
    activity.save();
  }
}

/**
 * Handle TrustStatusChanged event
 */
export function handleTrustStatusChanged(event: TrustStatusChanged): void {
  const trustAddress = event.address.toHexString();
  
  let trust = Trust.load(trustAddress);
  if (trust) {
    trust.status = mapTrustStatus(event.params.newStatus);
    trust.save();
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    let activity = createActivity(
      activityId,
      "TRUST_STATUS_CHANGED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.trust = trustAddress;
    activity.save();
  }
}

/**
 * Handle TrustRevoked event
 */
export function handleTrustRevoked(event: TrustRevoked): void {
  const trustAddress = event.address.toHexString();
  
  let trust = Trust.load(trustAddress);
  if (trust) {
    trust.status = "TERMINATED";
    trust.save();
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    let activity = createActivity(
      activityId,
      "TRUST_REVOKED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.trust = trustAddress;
    activity.save();
  }
}

/**
 * Handle ParticipantAdded event
 */
export function handleParticipantAdded(event: ParticipantAdded): void {
  const trustAddress = event.address.toHexString();
  const participantAddress = event.params.account;
  const participantId = `${trustAddress}-${participantAddress.toHexString()}`;
  const role = mapParticipantRole(event.params.role);
  
  let participant = TrustParticipant.load(participantId);
  if (!participant) {
    participant = new TrustParticipant(participantId);
    participant.trust = trustAddress;
    participant.participantAddress = participantAddress;
    participant.role = role;
    participant.benefitPercentage = event.params.benefitShare.toI32();
    participant.removed = false;
    participant.addedAt = event.block.timestamp;
    participant.addedTx = event.transaction.hash;
    participant.save();
    
    // Update trust arrays based on role
    let trust = Trust.load(trustAddress);
    if (trust) {
      trust.participantCount = trust.participantCount + 1;
      
      if (role == "BENEFICIARY") {
        let beneficiaries = trust.beneficiaries;
        beneficiaries.push(participantAddress);
        trust.beneficiaries = beneficiaries;
      } else if (role == "TRUSTEE") {
        let trustees = trust.trustees;
        trustees.push(participantAddress);
        trust.trustees = trustees;
      } else if (role == "SUCCESSOR_TRUSTEE") {
        let successorTrustees = trust.successorTrustees;
        successorTrustees.push(participantAddress);
        trust.successorTrustees = successorTrustees;
      } else if (role == "PROTECTOR") {
        let protectors = trust.protectors;
        protectors.push(participantAddress);
        trust.protectors = protectors;
      }
      
      trust.save();
    }
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    let activity = createActivity(
      activityId,
      "TRUST_PARTICIPANT_ADDED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.trust = trustAddress;
    activity.save();
  }
}

/**
 * Handle ParticipantRemoved event
 */
export function handleParticipantRemoved(event: ParticipantRemoved): void {
  const trustAddress = event.address.toHexString();
  const participantAddress = event.params.account;
  const participantId = `${trustAddress}-${participantAddress.toHexString()}`;
  
  let participant = TrustParticipant.load(participantId);
  if (participant) {
    participant.removed = true;
    participant.removedAt = event.block.timestamp;
    participant.removedTx = event.transaction.hash;
    participant.save();
    
    // Update trust participant count
    let trust = Trust.load(trustAddress);
    if (trust) {
      trust.participantCount = trust.participantCount - 1;
      trust.save();
    }
    
    // Create activity
    const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
    let activity = createActivity(
      activityId,
      "TRUST_PARTICIPANT_REMOVED",
      event.address,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.trust = trustAddress;
    activity.save();
  }
}

/**
 * Handle BeneficiaryShareUpdated event
 */
export function handleBeneficiaryShareUpdated(event: BeneficiaryShareUpdated): void {
  const trustAddress = event.address.toHexString();
  const beneficiaryAddress = event.params.beneficiary;
  const participantId = `${trustAddress}-${beneficiaryAddress.toHexString()}`;
  
  let participant = TrustParticipant.load(participantId);
  if (participant) {
    participant.benefitPercentage = event.params.newShare.toI32();
    participant.save();
  }
}

/**
 * Handle ClaimableDistributionCreated event
 * Creates a new claimable distribution for trust beneficiaries
 */
export function handleTrustClaimableDistributionCreated(event: ClaimableDistributionCreated): void {
  const trustAddress = event.address.toHexString();
  const distributionId = `${trustAddress}-${event.params.distributionId.toString()}`;
  
  let trust = Trust.load(trustAddress);
  if (!trust) {
    return;
  }
  
  // Create Distribution entity
  let distribution = new Distribution(distributionId);
  distribution.trust = trustAddress;
  distribution.distributionId = event.params.distributionId;
  distribution.totalAmount = event.params.totalAmount;
  distribution.totalClaimed = BigInt.fromI32(0);
  distribution.lpAmount = BigInt.fromI32(0); // Not applicable for trusts
  distribution.carryAmount = BigInt.fromI32(0); // Not applicable for trusts
  distribution.paymentToken = event.params.paymentToken;
  distribution.membershipToken = event.params.beneficialInterestToken;
  distribution.distributionType = mapDistributionType(event.params.distType);
  distribution.cancelled = false;
  distribution.createdAt = event.block.timestamp;
  distribution.createdTx = event.transaction.hash;
  distribution.blockNumber = event.block.number;
  distribution.save();
  
  // Update trust totals
  trust.totalDistributed = trust.totalDistributed.plus(event.params.totalAmount);
  trust.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "TRUST_DISTRIBUTION_CREATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.trust = trustAddress;
  activity.distribution = distributionId;
  activity.save();
}

/**
 * Handle DistributionClaimed event (Trust)
 */
export function handleTrustDistributionClaimed(event: DistributionClaimed): void {
  const trustAddress = event.address.toHexString();
  const beneficiaryAddress = event.params.beneficiary;
  const distributionId = `${trustAddress}-${event.params.distributionId.toString()}`;
  const claimId = `${distributionId}-${beneficiaryAddress.toHexString()}`;
  const participantId = `${trustAddress}-${beneficiaryAddress.toHexString()}`;
  
  // Load trust
  let trust = Trust.load(trustAddress);
  if (!trust) {
    return;
  }
  
  // Update trust totals
  trust.totalDistributionsClaimed = trust.totalDistributionsClaimed.plus(event.params.amount);
  trust.save();
  
  // Update distribution totals
  let distribution = Distribution.load(distributionId);
  if (distribution) {
    distribution.totalClaimed = distribution.totalClaimed.plus(event.params.amount);
    distribution.save();
  }
  
  // Create DistributionClaim
  let claim = new DistributionClaim(claimId);
  claim.distribution = distributionId;
  claim.claimantAddress = beneficiaryAddress;
  claim.amount = event.params.amount;
  claim.trustParticipant = participantId;
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
    "TRUST_DISTRIBUTION_CLAIMED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.trust = trustAddress;
  activity.distribution = distributionId;
  activity.distributionClaim = claimId;
  activity.save();
}

/**
 * Handle DistributionCancelled event (Trust)
 */
export function handleTrustDistributionCancelled(event: DistributionCancelled): void {
  const trustAddress = event.address.toHexString();
  const distributionId = `${trustAddress}-${event.params.distributionId.toString()}`;
  
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
  activity.trust = trustAddress;
  activity.distribution = distributionId;
  activity.save();
}

/**
 * Handle DistributionScheduleCreated event (Vesting)
 */
export function handleDistributionScheduleCreated(event: DistributionScheduleCreated): void {
  const trustAddress = event.address.toHexString();
  const beneficiaryAddress = event.params.beneficiary;
  const scheduleId = `${trustAddress}-${beneficiaryAddress.toHexString()}`;
  
  let schedule = new TrustVestingSchedule(scheduleId);
  schedule.trust = trustAddress;
  schedule.beneficiary = beneficiaryAddress;
  schedule.token = Bytes.empty(); // Token not in event, will be set from storage or later
  schedule.totalAmount = event.params.totalAmount;
  schedule.releasedAmount = BigInt.fromI32(0);
  schedule.startTime = event.params.startTime;
  // Calculate duration from endTime - startTime
  schedule.duration = event.params.endTime.minus(event.params.startTime);
  schedule.cliffDuration = BigInt.fromI32(0); // No cliff in this event signature
  schedule.revoked = false;
  schedule.createdAt = event.block.timestamp;
  schedule.createdTx = event.transaction.hash;
  schedule.lastUpdatedAt = event.block.timestamp;
  schedule.lastUpdatedTx = event.transaction.hash;
  schedule.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "TRUST_VESTING_CREATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.trust = trustAddress;
  activity.trustVestingSchedule = scheduleId;
  activity.save();
}

/**
 * Handle DistributionScheduleRevoked event
 */
export function handleDistributionScheduleRevoked(event: DistributionScheduleRevoked): void {
  const trustAddress = event.address.toHexString();
  const beneficiaryAddress = event.params.beneficiary;
  const scheduleId = `${trustAddress}-${beneficiaryAddress.toHexString()}`;
  
  let schedule = TrustVestingSchedule.load(scheduleId);
  if (schedule) {
    schedule.revoked = true;
    schedule.revokedAt = event.block.timestamp;
    schedule.revokedTx = event.transaction.hash;
    schedule.lastUpdatedAt = event.block.timestamp;
    schedule.lastUpdatedTx = event.transaction.hash;
    schedule.save();
  }
}

/**
 * Handle VestedAmountReleased event
 */
export function handleVestedAmountReleased(event: VestedAmountReleased): void {
  const trustAddress = event.address.toHexString();
  const beneficiaryAddress = event.params.beneficiary;
  const scheduleId = `${trustAddress}-${beneficiaryAddress.toHexString()}`;
  
  let schedule = TrustVestingSchedule.load(scheduleId);
  if (schedule) {
    // totalReleased is cumulative, so set it directly
    schedule.releasedAmount = event.params.totalReleased;
    schedule.lastUpdatedAt = event.block.timestamp;
    schedule.lastUpdatedTx = event.transaction.hash;
    schedule.save();
  }
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "TRUST_VESTING_RELEASED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.trust = trustAddress;
  activity.trustVestingSchedule = scheduleId;
  activity.save();
}

/**
 * Handle MilestoneCreated event
 */
export function handleMilestoneCreated(event: MilestoneCreated): void {
  const trustAddress = event.address.toHexString();
  const milestoneIdHex = event.params.milestoneId.toHexString();
  const entityId = `${trustAddress}-${milestoneIdHex}`;
  
  let milestone = new TrustMilestone(entityId);
  milestone.trust = trustAddress;
  milestone.milestoneId = event.params.milestoneId;
  milestone.beneficiary = event.params.beneficiary;
  milestone.description = event.params.description;
  milestone.distributionAmount = event.params.unlockAmount;
  milestone.token = Bytes.empty(); // Token not in event, will be set from storage
  milestone.achieved = false;
  milestone.claimed = false;
  milestone.createdAt = event.block.timestamp;
  milestone.createdTx = event.transaction.hash;
  milestone.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "TRUST_MILESTONE_CREATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.trust = trustAddress;
  activity.trustMilestone = entityId;
  activity.save();
}

/**
 * Handle MilestoneAchieved event
 */
export function handleMilestoneAchieved(event: MilestoneAchieved): void {
  const trustAddress = event.address.toHexString();
  const milestoneIdHex = event.params.milestoneId.toHexString();
  const entityId = `${trustAddress}-${milestoneIdHex}`;
  
  let milestone = TrustMilestone.load(entityId);
  if (milestone) {
    milestone.achieved = true;
    milestone.achievedAt = event.block.timestamp;
    milestone.achievedTx = event.transaction.hash;
    milestone.attestedBy = event.params.attestedBy;
    // Update distribution amount with unlocked amount if needed
    milestone.save();
  }
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "TRUST_MILESTONE_ACHIEVED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.trust = trustAddress;
  activity.trustMilestone = entityId;
  activity.save();
}

