/**
 * Acquisition Event Handlers
 * 
 * Handles events from individual Acquisition diamonds for tracking
 * business acquisition lifecycle events.
 */

import {
  AcquisitionListed,
  AcquisitionCancelled,
  OfferAccepted,
  DisputeRaised,
} from "../../generated/templates/AcquisitionDiamond/AcquisitionCoreFacet";
import { Acquisition } from "../../generated/schema";
import { log } from "@graphprotocol/graph-ts";

/**
 * Handles when an acquisition is listed (DRAFT -> LISTED)
 */
export function handleAcquisitionListed(event: AcquisitionListed): void {
  log.info("Handling AcquisitionListed event for acquisition: {}", [
    event.address.toHexString(),
  ]);

  let acquisition = Acquisition.load(event.address.toHexString());
  if (!acquisition) {
    log.error("Acquisition not found: {}", [event.address.toHexString()]);
    return;
  }

  acquisition.status = "LISTED";
  acquisition.listedAt = event.block.timestamp;
  acquisition.listedAtBlock = event.block.number;
  acquisition.save();

  log.info("Updated Acquisition status to LISTED: {}", [acquisition.id]);
}

/**
 * Handles when an acquisition is cancelled
 */
export function handleAcquisitionCancelled(event: AcquisitionCancelled): void {
  log.info("Handling AcquisitionCancelled event for acquisition: {}", [
    event.address.toHexString(),
  ]);

  let acquisition = Acquisition.load(event.address.toHexString());
  if (!acquisition) {
    log.error("Acquisition not found: {}", [event.address.toHexString()]);
    return;
  }

  acquisition.status = "CANCELLED";
  acquisition.cancelledAt = event.block.timestamp;
  acquisition.cancelledAtBlock = event.block.number;
  acquisition.save();

  log.info("Updated Acquisition status to CANCELLED: {}", [acquisition.id]);
}

/**
 * Handles when a seller accepts an offer (LISTED -> UNDER_OFFER)
 */
export function handleOfferAccepted(event: OfferAccepted): void {
  log.info("Handling OfferAccepted event for acquisition: {}", [
    event.address.toHexString(),
  ]);

  let acquisition = Acquisition.load(event.address.toHexString());
  if (!acquisition) {
    log.error("Acquisition not found: {}", [event.address.toHexString()]);
    return;
  }

  acquisition.status = "UNDER_OFFER";
  acquisition.buyer = event.params.buyer;
  acquisition.offerAcceptedAt = event.block.timestamp;
  acquisition.offerAcceptedAtBlock = event.block.number;
  acquisition.save();

  log.info("Updated Acquisition status to UNDER_OFFER with buyer: {}", [
    event.params.buyer.toHexString(),
  ]);
}

/**
 * Handles when a dispute is raised (IN_ESCROW -> DISPUTED)
 */
export function handleDisputeRaised(event: DisputeRaised): void {
  log.info("Handling DisputeRaised event for acquisition: {}", [
    event.address.toHexString(),
  ]);

  let acquisition = Acquisition.load(event.address.toHexString());
  if (!acquisition) {
    log.error("Acquisition not found: {}", [event.address.toHexString()]);
    return;
  }

  acquisition.status = "DISPUTED";
  acquisition.disputeRaisedAt = event.block.timestamp;
  acquisition.disputeRaisedAtBlock = event.block.number;
  acquisition.disputeRaisedBy = event.params.initiator;
  acquisition.save();

  log.info("Updated Acquisition status to DISPUTED: {}", [acquisition.id]);
}

