import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ClaimCreated as ClaimCreatedEvent,
  ClaimRedeemed as ClaimRedeemedEvent,
  ClaimCancelled as ClaimCancelledEvent,
} from "../../generated/ShareClassFactory/TokenClaimsFacet";
import { TokenClaim, ShareClass } from "../../generated/schema";

/**
 * Handle ClaimCreated event
 */
export function handleClaimCreated(event: ClaimCreatedEvent): void {
  const claimId = event.params.claimId.toHexString();
  
  let claim = new TokenClaim(claimId);
  claim.token = event.address.toHexString(); // Token address
  claim.emailHash = event.params.emailHash;
  claim.quantity = event.params.quantity;
  claim.issuer = event.params.issuer;
  claim.redeemed = false;
  claim.recipient = null;
  claim.lotId = null;
  claim.createdAt = event.block.timestamp;
  claim.createdTx = event.transaction.hash;
  claim.redeemedAt = null;
  claim.redeemedTx = null;
  
  // Note: expiresAt needs to be fetched from contract state
  // For now, we'll set it to 0 and update it when we add a contract call
  claim.expiresAt = BigInt.fromI32(0);
  
  claim.save();
  
  // Update token to track claim
  let token = ShareClass.load(event.address.toHexString());
  if (token) {
    // Could add claim count tracking here if needed
    token.save();
  }
}

/**
 * Handle ClaimRedeemed event
 */
export function handleClaimRedeemed(event: ClaimRedeemedEvent): void {
  const claimId = event.params.claimId.toHexString();
  
  let claim = TokenClaim.load(claimId);
  if (claim) {
    claim.redeemed = true;
    claim.recipient = event.params.recipient;
    claim.lotId = event.params.lotId;
    claim.redeemedAt = event.block.timestamp;
    claim.redeemedTx = event.transaction.hash;
    claim.save();
  }
}

/**
 * Handle ClaimCancelled event
 */
export function handleClaimCancelled(event: ClaimCancelledEvent): void {
  const claimId = event.params.claimId.toHexString();
  
  let claim = TokenClaim.load(claimId);
  if (claim) {
    // Mark as redeemed to prevent future use (claim is effectively dead)
    claim.redeemed = true;
    claim.save();
  }
}

