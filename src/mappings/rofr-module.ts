import { Address, Bytes, log } from "@graphprotocol/graph-ts";
import {
  TransferRequested,
  ROFRPeriodStarted,
  ROFRExercised,
  TransferApproved,
  TransferRejected,
  TransferCompleted,
  TransferCancelled,
} from "../../generated/templates/ROFRModule/ROFRModule";
import { ROFRTransferRequest, EquityToken } from "../../generated/schema";
import { ROFRModule as ROFRModuleContract } from "../../generated/templates/ROFRModule/ROFRModule";

/**
 * Handle a new transfer request being created
 */
export function handleTransferRequested(event: TransferRequested): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  
  // Try to get token address from the module
  const contract = ROFRModuleContract.bind(moduleAddress);
  const tokenResult = contract.try_token();
  const tokenAddress = tokenResult.reverted ? moduleAddress : tokenResult.value;
  
  let request = new ROFRTransferRequest(entityId);
  request.module = moduleAddress;
  request.token = tokenAddress.toHexString();
  request.requestId = requestId;
  request.seller = event.params.seller;
  request.proposedBuyer = event.params.proposedBuyer;
  request.currentBuyer = event.params.proposedBuyer;
  request.amount = event.params.amount;
  request.pricePerToken = event.params.pricePerToken;
  request.paymentToken = event.params.paymentToken;
  request.status = "PENDING";
  request.rofrExpiresAt = null;
  request.rofrExercisedBy = null;
  request.rejectionReason = null;
  request.createdAt = event.block.timestamp;
  request.createdTx = event.transaction.hash;
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.completedAt = null;
  request.completedTx = null;
  request.save();
  
  log.info("ROFR transfer requested: {} from {} to {} for {} tokens", [
    requestId.toString(),
    event.params.seller.toHexString(),
    event.params.proposedBuyer.toHexString(),
    event.params.amount.toString(),
  ]);
}

/**
 * Handle GP starting ROFR period
 */
export function handleROFRPeriodStarted(event: ROFRPeriodStarted): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  let request = ROFRTransferRequest.load(entityId);
  
  if (!request) {
    log.warning("ROFR request not found for ROFR period start: {}", [entityId]);
    return;
  }
  
  request.status = "ROFR_PERIOD";
  request.rofrExpiresAt = event.params.expiresAt;
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.save();
  
  log.info("ROFR period started for request {}, expires at {}", [
    requestId.toString(),
    event.params.expiresAt.toString(),
  ]);
}

/**
 * Handle existing member exercising ROFR
 */
export function handleROFRExercised(event: ROFRExercised): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  let request = ROFRTransferRequest.load(entityId);
  
  if (!request) {
    log.warning("ROFR request not found for ROFR exercise: {}", [entityId]);
    return;
  }
  
  request.status = "ROFR_EXERCISED";
  request.rofrExercisedBy = event.params.exercisedBy;
  request.currentBuyer = event.params.exercisedBy;
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.save();
  
  log.info("ROFR exercised for request {} by {}", [
    requestId.toString(),
    event.params.exercisedBy.toHexString(),
  ]);
}

/**
 * Handle GP approving transfer
 */
export function handleTransferApproved(event: TransferApproved): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  let request = ROFRTransferRequest.load(entityId);
  
  if (!request) {
    log.warning("ROFR request not found for approval: {}", [entityId]);
    return;
  }
  
  request.status = "APPROVED";
  request.currentBuyer = event.params.buyer;
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.save();
  
  log.info("Transfer approved for request {}, buyer: {}", [
    requestId.toString(),
    event.params.buyer.toHexString(),
  ]);
}

/**
 * Handle GP rejecting transfer
 */
export function handleTransferRejected(event: TransferRejected): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  let request = ROFRTransferRequest.load(entityId);
  
  if (!request) {
    log.warning("ROFR request not found for rejection: {}", [entityId]);
    return;
  }
  
  request.status = "REJECTED";
  request.rejectionReason = event.params.reason;
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.save();
  
  log.info("Transfer rejected for request {}: {}", [
    requestId.toString(),
    event.params.reason,
  ]);
}

/**
 * Handle transfer being completed
 */
export function handleTransferCompleted(event: TransferCompleted): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  let request = ROFRTransferRequest.load(entityId);
  
  if (!request) {
    log.warning("ROFR request not found for completion: {}", [entityId]);
    return;
  }
  
  request.status = "COMPLETED";
  request.currentBuyer = event.params.buyer;
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.completedAt = event.block.timestamp;
  request.completedTx = event.transaction.hash;
  request.save();
  
  log.info("Transfer completed for request {}: {} to {}", [
    requestId.toString(),
    event.params.seller.toHexString(),
    event.params.buyer.toHexString(),
  ]);
}

/**
 * Handle seller cancelling request
 */
export function handleTransferCancelled(event: TransferCancelled): void {
  const moduleAddress = event.address;
  const requestId = event.params.requestId;
  
  const entityId = moduleAddress.toHexString() + "-" + requestId.toString();
  let request = ROFRTransferRequest.load(entityId);
  
  if (!request) {
    log.warning("ROFR request not found for cancellation: {}", [entityId]);
    return;
  }
  
  request.status = "CANCELLED";
  request.updatedAt = event.block.timestamp;
  request.updatedTx = event.transaction.hash;
  request.save();
  
  log.info("Transfer cancelled for request {}", [requestId.toString()]);
}
