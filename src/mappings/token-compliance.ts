import { Address, Bytes, log } from "@graphprotocol/graph-ts";
import {
  ComplianceModuleAdded,
  ComplianceModuleRemoved,
  LotModuleAdded,
} from "../../generated/templates/TokenDiamond/TokenCompliance";
import {
  ComplianceModule,
  TokenComplianceConfig,
  LotComplianceConfig,
  Lot,
} from "../../generated/schema";
import {
  HoldingPeriodModule,
  VolumeLimitModule,
  AffiliateStatusModule,
  LockupComplianceModule,
  VestingComplianceModule,
} from "../../generated/templates";

/**
 * Get or create a compliance module entity
 * Attempts to query the module for its name and version
 */
function getOrCreateModule(
  moduleAddress: Address,
  timestamp: i64,
  txHash: Bytes
): ComplianceModule {
  let module = ComplianceModule.load(moduleAddress.toHexString());
  
  if (!module) {
    module = new ComplianceModule(moduleAddress.toHexString());
    module.address = moduleAddress;
    
    // Try to determine module type from name
    // This would ideally call the module's moduleName() function
    // For now, use placeholder values
    module.name = "Unknown";
    module.version = "1.0.0";
    module.moduleType = "Custom";
    
    module.firstUsedAt = timestamp;
    module.firstUsedTx = txHash;
    module.save();
  }
  
  return module;
}

/**
 * Handle global compliance module being added to a token
 */
export function handleComplianceModuleAdded(event: ComplianceModuleAdded): void {
  const tokenAddress = event.address;
  const moduleAddress = event.params.module;
  const moduleName = event.params.name;
  
  // Get or create module
  let module = ComplianceModule.load(moduleAddress.toHexString());
  if (!module) {
    module = new ComplianceModule(moduleAddress.toHexString());
    module.address = moduleAddress;
    module.name = moduleName;
    module.version = "1.0.0";
    
    // Determine module type from name
    if (moduleName.includes("Holding") || moduleName.includes("HoldingPeriod")) {
      module.moduleType = "HoldingPeriod";
    } else if (moduleName.includes("Volume") || moduleName.includes("VolumeLimit")) {
      module.moduleType = "VolumeLimit";
    } else if (moduleName.includes("Affiliate") || moduleName.includes("AffiliateStatus")) {
      module.moduleType = "AffiliateStatus";
    } else if (moduleName.includes("Vesting")) {
      module.moduleType = "Vesting";
    } else if (moduleName.includes("Lockup")) {
      module.moduleType = "Lockup";
    } else {
      module.moduleType = "Custom";
    }
    
    module.firstUsedAt = event.block.timestamp;
    module.firstUsedTx = event.transaction.hash;
    module.save();
    
    // Create data source instance for event indexing
    if (module.moduleType == "HoldingPeriod") {
      HoldingPeriodModule.create(moduleAddress);
    } else if (module.moduleType == "VolumeLimit") {
      VolumeLimitModule.create(moduleAddress);
    } else if (module.moduleType == "AffiliateStatus") {
      AffiliateStatusModule.create(moduleAddress);
    } else if (module.moduleType == "Lockup") {
      LockupComplianceModule.create(moduleAddress);
    } else if (module.moduleType == "Vesting") {
      VestingComplianceModule.create(moduleAddress);
    }
  }
  
  // Create token compliance config
  const configId = tokenAddress.toHexString() + "-" + moduleAddress.toHexString();
  let config = TokenComplianceConfig.load(configId);
  
  if (!config) {
    config = new TokenComplianceConfig(configId);
    config.token = tokenAddress.toHexString();
    config.module = moduleAddress.toHexString();
    config.isGlobal = true;
    config.addedAt = event.block.timestamp;
    config.addedTx = event.transaction.hash;
    config.removedAt = null;
    config.removedTx = null;
    config.isActive = true;
    config.save();
  } else {
    // Module was previously removed and is being re-added
    config.isActive = true;
    config.removedAt = null;
    config.removedTx = null;
    config.save();
  }
  
  log.info("Added compliance module {} ({}) to token {}", [
    moduleName,
    moduleAddress.toHexString(),
    tokenAddress.toHexString(),
  ]);
}

/**
 * Handle global compliance module being removed from a token
 */
export function handleComplianceModuleRemoved(event: ComplianceModuleRemoved): void {
  const tokenAddress = event.address;
  const moduleAddress = event.params.module;
  const moduleName = event.params.name;
  
  const configId = tokenAddress.toHexString() + "-" + moduleAddress.toHexString();
  const config = TokenComplianceConfig.load(configId);
  
  if (config) {
    config.isActive = false;
    config.removedAt = event.block.timestamp;
    config.removedTx = event.transaction.hash;
    config.save();
    
    log.info("Removed compliance module {} ({}) from token {}", [
      moduleName,
      moduleAddress.toHexString(),
      tokenAddress.toHexString(),
    ]);
  }
}

/**
 * Handle lot-specific compliance module being added
 */
export function handleLotModuleAdded(event: LotModuleAdded): void {
  const tokenAddress = event.address;
  const lotId = event.params.lotId;
  const moduleAddress = event.params.module;
  
  // Get or create module
  const module = getOrCreateModule(
    moduleAddress,
    event.block.timestamp,
    event.transaction.hash
  );
  
  // Create lot compliance config
  const configId = tokenAddress.toHexString() + "-" + lotId.toHexString() + "-" + moduleAddress.toHexString();
  let config = new LotComplianceConfig(configId);
  
  // Load the lot to verify it exists
  const lotEntityId = tokenAddress.toHexString() + "-" + lotId.toString();
  const lot = Lot.load(lotEntityId);
  
  if (!lot) {
    log.warning("Lot {} not found for token {} when adding lot module", [
      lotId.toHexString(),
      tokenAddress.toHexString(),
    ]);
    return;
  }
  
  config.lot = lotEntityId;
  config.module = moduleAddress.toHexString();
  config.addedAt = event.block.timestamp;
  config.addedTx = event.transaction.hash;
  config.save();
  
  log.info("Added lot-specific module {} to lot {} on token {}", [
    moduleAddress.toHexString(),
    lotId.toHexString(),
    tokenAddress.toHexString(),
  ]);
}

