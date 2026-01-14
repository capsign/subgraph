import { Diamond, UserRole, UserRoleHistory, AuthorityDelegation, Wallet } from "../../generated/schema";
import { 
  UserRoleUpdated as UserRoleUpdatedEvent,
} from "../../generated/templates/OfferingDiamond/OfferingDiamond";
import {
  AuthorityUpdated as AuthorityUpdatedEvent
} from "../../generated/templates/OfferingDiamond/AccessControl";

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

  // Create history entry for this role change
  const historyId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  const history = new UserRoleHistory(historyId);
  history.diamond = diamondAddress;
  history.user = event.params.user;
  history.role = role;
  history.enabled = enabled;
  history.changedBy = event.transaction.from;
  history.timestamp = event.block.timestamp;
  history.tx = event.transaction.hash;
  history.blockNumber = event.block.number;
  history.save();
}

/**
 * Handle AuthorityUpdated events from tokens/offerings
 * Event: AuthorityUpdated(address indexed oldAuthority, address indexed newAuthority)
 * 
 * Tracks when a token or offering delegates its access control to a wallet (AccessManager)
 */
export function handleAuthorityUpdated(event: AuthorityUpdatedEvent): void {
  const managedContract = event.address;
  const newAuthority = event.params.newAuthority;
  const oldAuthority = event.params.oldAuthority;

  // Only track if newAuthority is non-zero (authority is being set)
  if (newAuthority.toHexString() != "0x0000000000000000000000000000000000000000") {
    const delegationId = `${managedContract.toHexString()}-${newAuthority.toHexString()}`;
    
    let delegation = AuthorityDelegation.load(delegationId);
    if (!delegation) {
      delegation = new AuthorityDelegation(delegationId);
      delegation.managedContract = managedContract;
      delegation.authorityWallet = newAuthority.toHexString();
      delegation.setAt = event.block.timestamp;
      delegation.setTx = event.transaction.hash;
      
      // Store previous authority if it was non-zero
      if (oldAuthority.toHexString() != "0x0000000000000000000000000000000000000000") {
        delegation.previousAuthority = oldAuthority;
      }
      
      // Ensure the wallet entity exists (may be created later by factory, but create placeholder if needed)
      let wallet = Wallet.load(newAuthority.toHexString());
      if (!wallet) {
        wallet = new Wallet(newAuthority.toHexString());
        wallet.deployer = event.transaction.from;
        wallet.createdAt = event.block.timestamp;
        wallet.createdTx = event.transaction.hash;
        wallet.save();
      }
      
      delegation.save();
    }
  }
}

