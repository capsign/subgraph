import { DiamondCreated, UserRoleUpdated } from "../../generated/DiamondFactory/DiamondFactory";
import { Diamond, Wallet, Offering, UserRole } from "../../generated/schema";
import {
  OfferingDiamond,
  TokenDiamond,
  WalletDiamond,
} from "../../generated/templates";

export function handleDiamondCreated(event: DiamondCreated): void {
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

