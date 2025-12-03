import { Address, Bytes, log, BigInt } from "@graphprotocol/graph-ts";
import {
  HoldingPeriodSet,
  AcquisitionDateSet,
  AcquisitionDateUpdated,
} from "../../generated/templates/HoldingPeriodModule/HoldingPeriodModule";
import {
  HoldingPeriodConfig,
  ComplianceModule,
} from "../../generated/schema";

/**
 * Handle holding period being set for a token
 * This updates all existing configurations for this token
 */
export function handleHoldingPeriodSet(event: HoldingPeriodSet): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const period = event.params.period;
  
  log.info("Holding period set to {} seconds for token {} on module {}", [
    period.toString(),
    tokenAddress.toHexString(),
    moduleAddress.toHexString(),
  ]);
  
  // Note: This doesn't create individual HoldingPeriodConfig entities
  // Those are created when acquisition dates are set
  // The period is stored at the module level and applied to all lots
}

/**
 * Handle acquisition date being set for a lot holder
 */
export function handleAcquisitionDateSet(event: AcquisitionDateSet): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const lotId = event.params.lotId;
  const holder = event.params.holder;
  const date = event.params.date;
  
  // Create holding period config
  const configId = tokenAddress.toHexString() + "-" + lotId.toHexString() + "-" + holder.toHexString();
  let config = HoldingPeriodConfig.load(configId);
  
  if (!config) {
    config = new HoldingPeriodConfig(configId);
    config.token = tokenAddress.toHexString();
    config.lotId = lotId;
    config.holder = holder;
    config.module = moduleAddress.toHexString();
    
    // Default holding period (12 months in seconds)
    // This should be updated when we can query the module
    config.holdingPeriod = BigInt.fromI32(31536000); // 365 days
    
    config.createdAt = event.block.timestamp;
    config.createdTx = event.transaction.hash;
  }
  
  config.acquisitionDate = date;
  config.unlockDate = date.plus(config.holdingPeriod);
  config.isUnlocked = event.block.timestamp >= config.unlockDate;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;
  config.save();
  
  log.info("Acquisition date set for holder {} on lot {} (token {}): {}", [
    holder.toHexString(),
    lotId.toHexString(),
    tokenAddress.toHexString(),
    date.toString(),
  ]);
}

/**
 * Handle acquisition date being updated for a lot holder
 */
export function handleAcquisitionDateUpdated(event: AcquisitionDateUpdated): void {
  // Same logic as set, but this is a separate event for tracking purposes
  handleAcquisitionDateSet(
    new AcquisitionDateSet(
      event.address,
      event.logIndex,
      event.transactionLogIndex,
      event.logType,
      event.block,
      event.transaction,
      event.parameters,
      event.receipt
    )
  );
  
  log.info("Acquisition date updated for holder {} on lot {} (token {})", [
    event.params.holder.toHexString(),
    event.params.lotId.toHexString(),
    event.params.token.toHexString(),
  ]);
}

