import { Diamond, UserRole } from "../../generated/schema";
import { UserRoleUpdated as UserRoleUpdatedEvent } from "../../generated/templates/OfferingDiamond/OfferingDiamond";

/**
 * Handle UserRoleUpdated events from any diamond
 * Event: UserRoleUpdated(address indexed user, uint8 indexed role, bool enabled)
 * 
 * NOTE: This file provides a generic handler. Specific handlers are implemented in:
 * - offerings.ts: handleOfferingUserRoleUpdated()
 * - tokens.ts: handleTokenUserRoleUpdated()
 * - wallets.ts: handleWalletUserRoleUpdated() (if needed)
 */
export function handleUserRoleUpdated(event: UserRoleUpdatedEvent): void {
  const diamondAddress = event.address.toHexString();
  const userAddress = event.params.user.toHexString();
  const role = event.params.role;
  const enabled = event.params.enabled;

  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // If diamond doesn't exist in our system, create a minimal entry
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "UNKNOWN";
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

