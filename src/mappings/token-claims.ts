import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ClaimCreated as ClaimCreatedEvent,
  ClaimRedeemed as ClaimRedeemedEvent,
  ClaimCancelled as ClaimCancelledEvent,
} from "../../generated/templates/TokenDiamond/TokenDiamond";
import { TokenClaims } from "../../generated/templates/TokenDiamond/TokenClaims";
import { TokenClaim, EquityToken } from "../../generated/schema";

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
  
  // Fetch expiresAt from contract state
  let contract = TokenClaims.bind(event.address);
  let claimData = contract.try_getClaim(event.params.claimId);
  
  if (!claimData.reverted) {
    // getClaim returns: (emailHash, quantity, expiresAt, redeemed, issuer)
    claim.expiresAt = claimData.value.value2; // value2 is expiresAt (third return value)
  } else {
    // Fallback to 0 if contract call fails
  claim.expiresAt = BigInt.fromI32(0);
  }
  
  claim.save();
  
  // Update token to track claim
  let token = EquityToken.load(event.address.toHexString());
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

