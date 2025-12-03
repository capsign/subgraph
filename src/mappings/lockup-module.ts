import { LockupSet, LockupExtended, LockupRemoved } from "../../generated/templates/LockupComplianceModule/LockupComplianceModule";
import { LockupConfig } from "../../generated/schema";

export function handleLockupSet(event: LockupSet): void {
  const lotId = event.params.lotId.toHexString();
  const unlockTime = event.params.unlockTime;

  let config = LockupConfig.load(lotId);
  
  if (!config) {
    config = new LockupConfig(lotId);
    config.lotId = event.params.lotId;
    config.createdAt = event.block.timestamp;
    config.createdTx = event.transaction.hash;
  }

  config.unlockTime = unlockTime;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;

  config.save();
}

export function handleLockupExtended(event: LockupExtended): void {
  const lotId = event.params.lotId.toHexString();
  
  const config = LockupConfig.load(lotId);
  if (!config) {
    // Shouldn't happen, but handle gracefully
    const newConfig = new LockupConfig(lotId);
    newConfig.lotId = event.params.lotId;
    newConfig.unlockTime = event.params.newUnlockTime;
    newConfig.createdAt = event.block.timestamp;
    newConfig.createdTx = event.transaction.hash;
    newConfig.lastUpdatedAt = event.block.timestamp;
    newConfig.lastUpdatedTx = event.transaction.hash;
    newConfig.save();
    return;
  }

  config.unlockTime = event.params.newUnlockTime;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;

  config.save();
}

export function handleLockupRemoved(event: LockupRemoved): void {
  const lotId = event.params.lotId.toHexString();
  
  // Remove the lockup config
  const config = LockupConfig.load(lotId);
  if (config) {
    // Instead of deleting, we could set unlockTime to 0 to indicate removed
    // But for now, just remove it from the graph
    // store.remove("LockupConfig", lotId);
    
    // Or update to show it's been removed (set unlock to past)
    config.unlockTime = event.block.timestamp;
    config.lastUpdatedAt = event.block.timestamp;
    config.lastUpdatedTx = event.transaction.hash;
    config.save();
  }
}




