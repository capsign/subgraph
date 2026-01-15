import { DiamondCreated, FacetRegistryUpdated, UserRoleUpdated } from "../../generated/DiamondFactory/DiamondFactory";
import { Diamond, Wallet, Offering, UserRole, SystemConfig, FactoryPaymentConfig } from "../../generated/schema";
import {
  OfferingDiamond,
  TokenDiamond,
  WalletDiamond,
} from "../../generated/templates";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";

// Helper to get or create factory payment config for DiamondFactory
function getOrCreateFactoryPaymentConfig(
  factoryAddress: Address,
  timestamp: BigInt,
  tx: Bytes
): FactoryPaymentConfig {
  let id = factoryAddress.toHexString();
  let config = FactoryPaymentConfig.load(id);

  if (!config) {
    config = new FactoryPaymentConfig(id);
    config.factory = factoryAddress;
    config.factoryType = "DIAMOND";
    config.feeRecipient = Address.fromString("0x0000000000000000000000000000000000000000");
    config.paymentsEnabled = false; // DiamondFactory doesn't have payments
    config.deploymentCount = BigInt.zero();
    config.createdAt = timestamp;
    config.createdTx = tx;
    config.save();
  }

  return config;
}

export function handleDiamondCreated(event: DiamondCreated): void {
  // Initialize SystemConfig if it doesn't exist
  let systemConfig = SystemConfig.load("system");
  if (!systemConfig) {
    systemConfig = new SystemConfig("system");
    systemConfig.diamondFactory = event.address;
    systemConfig.facetRegistry = event.address; // Will be updated by FacetRegistryUpdated event
    systemConfig.lastUpdatedAt = event.block.timestamp;
    systemConfig.lastUpdatedTx = event.transaction.hash;
    systemConfig.save();
  }

  // Get or create FactoryPaymentConfig and increment deployment count
  let config = getOrCreateFactoryPaymentConfig(
    event.address,
    event.block.timestamp,
    event.transaction.hash
  );
  config.deploymentCount = config.deploymentCount.plus(BigInt.fromI32(1));
  config.save();

  const diamond = new Diamond(event.params.diamond.toHexString());
  diamond.diamondType = "UNKNOWN"; // Type will be determined by initialization events
  diamond.creator = event.params.deployer;
  diamond.createdAt = event.block.timestamp;
  diamond.createdTx = event.transaction.hash;
  diamond.save();

  // Start tracking all diamond types
  // The actual type will be determined by the initialization event (WalletInitialized, OfferingInitialized, TokenInitialized)
  WalletDiamond.create(event.params.diamond);
  OfferingDiamond.create(event.params.diamond);
  TokenDiamond.create(event.params.diamond);
}

/**
 * Handle FacetRegistryUpdated events from DiamondFactory
 * Tracks when the factory's facet registry is updated
 */
export function handleFacetRegistryUpdated(event: FacetRegistryUpdated): void {
  const factoryAddress = event.address.toHexString();
  
  // Update SystemConfig
  let systemConfig = SystemConfig.load("system");
  if (!systemConfig) {
    systemConfig = new SystemConfig("system");
  }
  // Always update to the latest DiamondFactory address emitting the event
  systemConfig.diamondFactory = event.address;
  systemConfig.facetRegistry = event.params.registry;
  systemConfig.lastUpdatedAt = event.block.timestamp;
  systemConfig.lastUpdatedTx = event.transaction.hash;
  systemConfig.save();
  
  // Load or create diamond entity for the factory
  let diamond = Diamond.load(factoryAddress);
  if (!diamond) {
    diamond = new Diamond(factoryAddress);
    diamond.diamondType = "FACTORY";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
  }
  
  // Update facet registry
  diamond.facetRegistry = event.params.registry;
  diamond.save();
}

/**
 * Handle UserRoleUpdated events from DiamondFactory
 * Tracks admin role changes for the factory diamond itself
 */
export function handleUserRoleUpdated(event: UserRoleUpdated): void {
  const diamondAddress = event.address.toHexString();
  const userAddress = event.params.user.toHexString();
  const role = event.params.role;
  const enabled = event.params.enabled;

  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Factory doesn't exist in our system, create a minimal entry
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "FACTORY";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    diamond.save();
  }

  // Create or update UserRole entity
  const userRoleId = `${diamondAddress}-${userAddress}-${role}`;
  let userRole = UserRole.load(userRoleId);

  if (!userRole) {
    userRole = new UserRole(userRoleId);
    userRole.diamond = diamondAddress;
    userRole.user = event.params.user;
    userRole.role = role;
    userRole.grantedAt = event.block.timestamp;
    userRole.grantedTx = event.transaction.hash;
  }

  userRole.enabled = enabled;
  userRole.lastUpdatedAt = event.block.timestamp;
  userRole.lastUpdatedTx = event.transaction.hash;
  
  userRole.save();
}
