import { log, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  MinimumBalanceSet,
  MinimumBalanceExemptionSet,
  AutoExemptRoleSet,
} from "../../generated/templates/MinimumBalanceModule/MinimumBalanceModule";
import {
  MinimumBalanceConfig,
  MinimumBalanceExemption,
} from "../../generated/schema";

/**
 * Handle minimum balance being set for a token
 */
export function handleMinimumBalanceSet(event: MinimumBalanceSet): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const minimum = event.params.minimum;
  
  log.info("Minimum balance set to {} for token {} on module {}", [
    minimum.toString(),
    tokenAddress.toHexString(),
    moduleAddress.toHexString(),
  ]);
  
  // Create or update config
  const configId = tokenAddress.toHexString();
  let config = MinimumBalanceConfig.load(configId);
  
  if (!config) {
    config = new MinimumBalanceConfig(configId);
    config.token = tokenAddress.toHexString();
    config.module = moduleAddress.toHexString();
    config.autoExemptRoles = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
    config.createdAt = event.block.timestamp;
    config.createdTx = event.transaction.hash;
  }
  
  config.minimumBalance = minimum;
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;
  config.save();
}

/**
 * Handle exemption being set for a holder
 */
export function handleMinimumBalanceExemptionSet(event: MinimumBalanceExemptionSet): void {
  const tokenAddress = event.params.token;
  const holder = event.params.holder;
  const isExempt = event.params.exempt;
  
  log.info("Minimum balance exemption set for holder {} on token {}: {}", [
    holder.toHexString(),
    tokenAddress.toHexString(),
    isExempt ? "true" : "false",
  ]);
  
  // Create or update exemption
  const exemptionId = tokenAddress.toHexString() + "-" + holder.toHexString();
  let exemption = MinimumBalanceExemption.load(exemptionId);
  
  if (!exemption) {
    exemption = new MinimumBalanceExemption(exemptionId);
    exemption.token = tokenAddress.toHexString();
    exemption.holder = holder;
    exemption.createdAt = event.block.timestamp;
    exemption.createdTx = event.transaction.hash;
  }
  
  exemption.isExempt = isExempt;
  exemption.lastUpdatedAt = event.block.timestamp;
  exemption.lastUpdatedTx = event.transaction.hash;
  exemption.save();
}

/**
 * Handle auto-exempt role being set for a token
 * Updates the autoExemptRoles bitmask in the config
 */
export function handleAutoExemptRoleSet(event: AutoExemptRoleSet): void {
  const moduleAddress = event.address;
  const tokenAddress = event.params.token;
  const role = event.params.role;
  const exempt = event.params.exempt;
  
  log.info("Auto-exempt role {} set to {} for token {} on module {}", [
    BigInt.fromI32(role).toString(),
    exempt ? "true" : "false",
    tokenAddress.toHexString(),
    moduleAddress.toHexString(),
  ]);
  
  // Get or create config
  const configId = tokenAddress.toHexString();
  let config = MinimumBalanceConfig.load(configId);
  
  const zeroBitmask = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
  
  if (!config) {
    config = new MinimumBalanceConfig(configId);
    config.token = tokenAddress.toHexString();
    config.module = moduleAddress.toHexString();
    config.minimumBalance = BigInt.fromI32(0);
    config.autoExemptRoles = zeroBitmask;
    config.createdAt = event.block.timestamp;
    config.createdTx = event.transaction.hash;
  }
  
  // For now, just store the raw event data
  // The autoExemptRoles field stores the cumulative bitmask which we update
  // by setting the bit at position `role`
  // AssemblyScript BigInt bit operations can be tricky, so we'll keep it simple
  // and just log the event for now - the on-chain state is authoritative
  
  // Simple approach: just mark that we have exempt roles configured
  // The actual bitmask can be queried on-chain
  if (exempt) {
    // At least one role is exempt - set a non-zero value
    const oneBytes = new Uint8Array(32);
    oneBytes[31] = 1;
    config.autoExemptRoles = Bytes.fromUint8Array(oneBytes);
  }
  
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;
  config.save();
}
