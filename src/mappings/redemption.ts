// RedemptionControlFacet events
import {
  RedemptionRequested,
  RedemptionProcessed,
  RedemptionCancelled,
  RedemptionsSuspended,
  RedemptionsResumed,
  SidePocketCreated,
  SidePocketDistributed,
  GatePeriodReset,
} from "../../generated/templates/WalletDiamond/RedemptionControlFacet";
import {
  RedemptionRequest,
  RedemptionSuspension,
  SidePocket,
  GatePeriod,
} from "../../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// ============ REDEMPTION CONTROL HANDLERS ============

/**
 * Handle RedemptionRequested event
 * Creates a new redemption request entity
 */
export function handleRedemptionRequested(event: RedemptionRequested): void {
  const walletAddress = event.address.toHexString();
  const requestId = event.params.requestId;
  const entityId = `${walletAddress}-${requestId.toString()}`;

  let request = new RedemptionRequest(entityId);
  request.wallet = walletAddress;
  request.requestId = requestId;
  request.investor = event.params.investor;
  request.sharesRequested = event.params.shares;
  request.sharesFulfilled = BigInt.fromI32(0);
  request.sharesRemaining = event.params.shares;
  request.amountPaid = BigInt.fromI32(0);
  request.navPerShare = BigInt.fromI32(0);
  request.status = "PENDING";
  request.requestedAt = event.block.timestamp;
  request.eligibleAt = event.params.eligibleAt;
  request.transactionHash = event.transaction.hash;
  request.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "REDEMPTION_REQUESTED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle RedemptionProcessed event
 * Updates the redemption request with fulfilled amounts
 */
export function handleRedemptionProcessed(event: RedemptionProcessed): void {
  const walletAddress = event.address.toHexString();
  const requestId = event.params.requestId;
  const entityId = `${walletAddress}-${requestId.toString()}`;

  let request = RedemptionRequest.load(entityId);
  if (!request) return;

  request.sharesFulfilled = request.sharesFulfilled.plus(event.params.sharesFulfilled);
  request.sharesRemaining = request.sharesRequested.minus(request.sharesFulfilled);
  request.amountPaid = request.amountPaid.plus(event.params.amountPaid);
  request.navPerShare = event.params.navPerShare;
  request.processedAt = event.block.timestamp;

  // Update status
  if (request.sharesRemaining.equals(BigInt.fromI32(0))) {
    request.status = "FULFILLED";
  } else {
    request.status = "PARTIAL";
  }

  request.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "REDEMPTION_PROCESSED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle RedemptionCancelled event
 */
export function handleRedemptionCancelled(event: RedemptionCancelled): void {
  const walletAddress = event.address.toHexString();
  const requestId = event.params.requestId;
  const entityId = `${walletAddress}-${requestId.toString()}`;

  let request = RedemptionRequest.load(entityId);
  if (!request) return;

  request.status = "CANCELLED";
  request.cancelledAt = event.block.timestamp;
  request.cancelReason = event.params.reason;
  request.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "REDEMPTION_CANCELLED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle RedemptionsSuspended event
 */
export function handleRedemptionsSuspended(event: RedemptionsSuspended): void {
  const walletAddress = event.address.toHexString();
  const entityId = `${walletAddress}-${event.block.timestamp.toString()}`;

  // Map the uint8 reason to string
  const reasonIndex = event.params.reason;
  let reasonString: string;
  if (reasonIndex == 0) {
    reasonString = "MARKET_STRESS";
  } else if (reasonIndex == 1) {
    reasonString = "LIQUIDITY";
  } else if (reasonIndex == 2) {
    reasonString = "NAV_UNCERTAINTY";
  } else if (reasonIndex == 3) {
    reasonString = "REGULATORY";
  } else {
    reasonString = "OTHER";
  }

  let suspension = new RedemptionSuspension(entityId);
  suspension.wallet = walletAddress;
  suspension.reason = reasonString;
  suspension.description = event.params.description;
  suspension.suspendedBy = event.params.suspendedBy;
  suspension.suspendedAt = event.block.timestamp;
  suspension.transactionHash = event.transaction.hash;
  suspension.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "REDEMPTIONS_SUSPENDED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle RedemptionsResumed event
 */
export function handleRedemptionsResumed(event: RedemptionsResumed): void {
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "REDEMPTIONS_RESUMED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle SidePocketCreated event
 */
export function handleSidePocketCreated(event: SidePocketCreated): void {
  const walletAddress = event.address.toHexString();
  const sidePocketId = event.params.sidePocketId;
  const entityId = `${walletAddress}-${sidePocketId.toString()}`;

  let sidePocket = new SidePocket(entityId);
  sidePocket.wallet = walletAddress;
  sidePocket.sidePocketId = sidePocketId;
  sidePocket.investmentId = event.params.investmentId;
  sidePocket.reason = event.params.reason;
  sidePocket.isActive = true;
  sidePocket.createdAt = event.block.timestamp;
  sidePocket.createdTx = event.transaction.hash;
  sidePocket.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "SIDE_POCKET_CREATED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle SidePocketDistributed event
 */
export function handleSidePocketDistributed(event: SidePocketDistributed): void {
  const walletAddress = event.address.toHexString();
  const sidePocketId = event.params.sidePocketId;
  const entityId = `${walletAddress}-${sidePocketId.toString()}`;

  let sidePocket = SidePocket.load(entityId);
  if (!sidePocket) return;

  sidePocket.isActive = false;
  sidePocket.distributedAt = event.block.timestamp;
  sidePocket.totalDistributed = event.params.totalDistributed;
  sidePocket.recipientCount = event.params.recipientCount;
  sidePocket.distributedTx = event.transaction.hash;
  sidePocket.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "SIDE_POCKET_DISTRIBUTED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle GatePeriodReset event
 */
export function handleGatePeriodReset(event: GatePeriodReset): void {
  const walletAddress = event.address.toHexString();
  const periodStart = event.params.periodStart;
  const entityId = `${walletAddress}-${periodStart.toString()}`;

  let gatePeriod = new GatePeriod(entityId);
  gatePeriod.wallet = walletAddress;
  gatePeriod.periodStart = periodStart;
  gatePeriod.periodEnd = event.params.periodEnd;
  gatePeriod.gateLimit = event.params.gateLimit;
  gatePeriod.totalFulfilled = BigInt.fromI32(0);
  gatePeriod.transactionHash = event.transaction.hash;
  gatePeriod.save();

  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  let activity = createActivity(
    activityId,
    "GATE_PERIOD_RESET",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}
