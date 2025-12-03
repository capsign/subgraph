import { log, BigInt } from "@graphprotocol/graph-ts";
import {
  VolumeConfigSet,
  VolumeRecorded,
  WindowReset,
} from "../../generated/templates/VolumeLimitModule/VolumeLimitModule";
import {
  VolumeLimitConfig,
} from "../../generated/schema";

/**
 * Handle volume limit configuration being set for a token
 */
export function handleVolumeConfigSet(event: VolumeConfigSet): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const limitBps = event.params.limitBps;
  const windowSeconds = event.params.windowSeconds;
  const enabled = event.params.enabled;
  
  log.info("Volume config set for token {}: limitBps={}, windowSeconds={}, enabled={}", [
    tokenAddress.toHexString(),
    limitBps.toString(),
    windowSeconds.toString(),
    enabled.toString(),
  ]);
  
  // Note: This updates the token-level configuration
  // Individual holder configs are created when volume is recorded
}

/**
 * Handle volume being recorded for a holder
 */
export function handleVolumeRecorded(event: VolumeRecorded): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const holder = event.params.holder;
  const volume = event.params.volume;
  const windowStart = event.params.windowStart;
  
  // Create or update volume limit config
  const configId = tokenAddress.toHexString() + "-" + holder.toHexString();
  let config = VolumeLimitConfig.load(configId);
  
  if (!config) {
    config = new VolumeLimitConfig(configId);
    config.token = tokenAddress.toHexString();
    config.holder = holder;
    config.module = moduleAddress.toHexString();
    
    // Default limits (1% over 30 days)
    // These should be updated from the token's actual config
    config.limitBps = 100; // 1%
    config.windowSeconds = BigInt.fromI32(2592000); // 30 days
    
    config.createdAt = event.block.timestamp;
    config.createdTx = event.transaction.hash;
  }
  
  config.currentWindowStart = windowStart;
  config.currentVolume = volume;
  config.lastTransferAt = event.block.timestamp;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;
  config.save();
  
  log.info("Volume recorded for holder {} on token {}: {} (window start: {})", [
    holder.toHexString(),
    tokenAddress.toHexString(),
    volume.toString(),
    windowStart.toString(),
  ]);
}

/**
 * Handle volume window being reset for a holder
 */
export function handleWindowReset(event: WindowReset): void {
  const tokenAddress = event.params.token;
  const holder = event.params.holder;
  const newWindowStart = event.params.newWindowStart;
  
  const configId = tokenAddress.toHexString() + "-" + holder.toHexString();
  const config = VolumeLimitConfig.load(configId);
  
  if (config) {
    config.currentWindowStart = newWindowStart;
    config.currentVolume = BigInt.fromI32(0);
    config.lastUpdatedAt = event.block.timestamp;
    config.lastUpdatedTx = event.transaction.hash;
    config.save();
    
    log.info("Volume window reset for holder {} on token {} (new window start: {})", [
      holder.toHexString(),
      tokenAddress.toHexString(),
      newWindowStart.toString(),
    ]);
  }
}

