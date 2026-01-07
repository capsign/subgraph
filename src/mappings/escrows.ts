/**
 * Escrow Event Handlers
 * 
 * Handles events from individual Escrow diamonds for tracking
 * escrow lifecycle events.
 */

import {
  AcquisitionListed,
  AcquisitionCancelled,
  OfferAccepted,
  DisputeRaised,
} from "../../generated/templates/EscrowDiamond/AcquisitionCoreFacet";
import { Escrow } from "../../generated/schema";
import { log } from "@graphprotocol/graph-ts";

/**
 * Handles when an escrow is activated (DRAFT -> ACTIVE)
 */
export function handleEscrowActivated(event: AcquisitionListed): void {
  log.info("Handling EscrowActivated event for escrow: {}", [
    event.address.toHexString(),
  ]);

  let escrow = Escrow.load(event.address.toHexString());
  if (!escrow) {
    log.error("Escrow not found: {}", [event.address.toHexString()]);
    return;
  }

  escrow.status = "ACTIVE";
  escrow.activatedAt = event.block.timestamp;
  escrow.activatedAtBlock = event.block.number;
  escrow.save();

  log.info("Updated Escrow status to ACTIVE: {}", [escrow.id]);
}

/**
 * Handles when an escrow is cancelled
 */
export function handleEscrowCancelled(event: AcquisitionCancelled): void {
  log.info("Handling EscrowCancelled event for escrow: {}", [
    event.address.toHexString(),
  ]);

  let escrow = Escrow.load(event.address.toHexString());
  if (!escrow) {
    log.error("Escrow not found: {}", [event.address.toHexString()]);
    return;
  }

  escrow.status = "CANCELLED";
  escrow.cancelledAt = event.block.timestamp;
  escrow.cancelledAtBlock = event.block.number;
  escrow.save();

  log.info("Updated Escrow status to CANCELLED: {}", [escrow.id]);
}

/**
 * Handles when a seller accepts an offer (ACTIVE -> PENDING)
 */
export function handleOfferAccepted(event: OfferAccepted): void {
  log.info("Handling OfferAccepted event for escrow: {}", [
    event.address.toHexString(),
  ]);

  let escrow = Escrow.load(event.address.toHexString());
  if (!escrow) {
    log.error("Escrow not found: {}", [event.address.toHexString()]);
    return;
  }

  escrow.status = "PENDING";
  escrow.buyer = event.params.buyer;
  escrow.offerAcceptedAt = event.block.timestamp;
  escrow.offerAcceptedAtBlock = event.block.number;
  escrow.save();

  log.info("Updated Escrow status to PENDING with buyer: {}", [
    event.params.buyer.toHexString(),
  ]);
}

/**
 * Handles when a dispute is raised (FUNDED -> DISPUTED)
 */
export function handleDisputeRaised(event: DisputeRaised): void {
  log.info("Handling DisputeRaised event for escrow: {}", [
    event.address.toHexString(),
  ]);

  let escrow = Escrow.load(event.address.toHexString());
  if (!escrow) {
    log.error("Escrow not found: {}", [event.address.toHexString()]);
    return;
  }

  escrow.status = "DISPUTED";
  escrow.disputeRaisedAt = event.block.timestamp;
  escrow.disputeRaisedAtBlock = event.block.number;
  escrow.disputeRaisedBy = event.params.initiator;
  escrow.save();

  log.info("Updated Escrow status to DISPUTED: {}", [escrow.id]);
}
