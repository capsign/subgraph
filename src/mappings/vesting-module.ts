import {
  VestingScheduleCreated,
  TokensReleased,
  VestingScheduleRevoked,
} from "../../generated/templates/VestingComplianceModule/VestingComplianceModule";
import { VestingConfig } from "../../generated/schema";

export function handleVestingScheduleCreated(event: VestingScheduleCreated): void {
  const lotId = event.params.lotId.toHexString();

  let config = VestingConfig.load(lotId);
  
  if (!config) {
    config = new VestingConfig(lotId);
    config.lotId = event.params.lotId;
    config.createdAt = event.block.timestamp;
    config.createdTx = event.transaction.hash;
  }

  config.holder = event.params.tokenHolder;
  config.totalBasisPoints = event.params.totalBasisPoints; // Percentage of lot (10000 = 100%)
  config.releasedBasisPoints = event.params.totalBasisPoints.minus(event.params.totalBasisPoints); // Initialize to 0
  config.startTime = event.params.startTime;
  config.duration = event.params.duration;
  config.cliffDuration = event.params.cliffDuration;
  config.revocable = event.params.revocable;
  config.revoked = false;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;

  config.save();
}

export function handleTokensReleased(event: TokensReleased): void {
  const lotId = event.params.lotId.toHexString();
  
  const config = VestingConfig.load(lotId);
  if (!config) {
    return; // Shouldn't happen
  }

  // Update the cumulative released basis points from the event
  config.releasedBasisPoints = event.params.releasedBasisPoints;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;

  config.save();
}

export function handleVestingScheduleRevoked(event: VestingScheduleRevoked): void {
  const lotId = event.params.lotId.toHexString();
  
  const config = VestingConfig.load(lotId);
  if (!config) {
    return; // Shouldn't happen
  }

  config.revoked = true;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;

  config.save();
}




