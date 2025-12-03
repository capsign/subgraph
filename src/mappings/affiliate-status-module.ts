import { log } from "@graphprotocol/graph-ts";
import {
  AffiliateStatusSet,
  AffiliateStatusBatchSet,
} from "../../generated/templates/AffiliateStatusModule/AffiliateStatusModule";
import {
  AffiliateStatus,
  AffiliateStatusChange,
} from "../../generated/schema";

/**
 * Handle affiliate status being set for a holder
 */
export function handleAffiliateStatusSet(event: AffiliateStatusSet): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const holder = event.params.holder;
  const isAffiliate = event.params.isAffiliate;
  
  // Create or update affiliate status
  const statusId = tokenAddress.toHexString() + "-" + holder.toHexString();
  let status = AffiliateStatus.load(statusId);
  
  const wasAffiliate = status ? status.isAffiliate : false;
  
  if (!status) {
    status = new AffiliateStatus(statusId);
    status.token = tokenAddress.toHexString();
    status.holder = holder;
    status.module = moduleAddress.toHexString();
    status.affiliateSince = null;
    status.affiliateUntil = null;
    status.createdAt = event.block.timestamp;
    status.createdTx = event.transaction.hash;
  }
  
  status.isAffiliate = isAffiliate;
  
  // Update timestamps based on status change
  if (isAffiliate && !wasAffiliate) {
    // Became affiliate
    status.affiliateSince = event.block.timestamp;
    status.affiliateUntil = null;
  } else if (!isAffiliate && wasAffiliate) {
    // Stopped being affiliate
    status.affiliateUntil = event.block.timestamp;
  }
  
  status.lastUpdatedAt = event.block.timestamp;
  status.lastUpdatedTx = event.transaction.hash;
  status.save();
  
  // Create status change record
  const changeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const change = new AffiliateStatusChange(changeId);
  change.affiliateStatus = statusId;
  change.becameAffiliate = isAffiliate;
  change.changedAt = event.block.timestamp;
  change.changedTx = event.transaction.hash;
  change.save();
  
  log.info("Affiliate status set for holder {} on token {}: {}", [
    holder.toHexString(),
    tokenAddress.toHexString(),
    isAffiliate.toString(),
  ]);
}

/**
 * Handle batch affiliate status update
 */
export function handleAffiliateStatusBatchSet(event: AffiliateStatusBatchSet): void {
  const tokenAddress = event.params.token;
  const count = event.params.count;
  
  log.info("Batch affiliate status update for token {}: {} holders updated", [
    tokenAddress.toHexString(),
    count.toString(),
  ]);
  
  // Individual status updates are tracked via AffiliateStatusSet events
  // This is just a summary event
}

