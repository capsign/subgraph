/**
 * Acquisition Factory Event Handlers
 * 
 * Handles events from the AcquisitionFactory contract for tracking business
 * acquisitions/listings created through the platform.
 */

import { AcquisitionCreated } from "../../generated/AcquisitionFactory/AcquisitionFactoryCoreFacet";
import { Diamond, Acquisition } from "../../generated/schema";
import { log } from "@graphprotocol/graph-ts";

/**
 * Handles the creation of a new Acquisition diamond
 */
export function handleAcquisitionCreated(event: AcquisitionCreated): void {
  log.info("Handling AcquisitionCreated event for acquisition: {}", [
    event.params.acquisition.toHexString(),
  ]);

  // Create Diamond entity
  let diamond = new Diamond(event.params.acquisition.toHexString());
  diamond.creator = event.params.seller;
  diamond.createdAt = event.block.timestamp;
  diamond.createdTx = event.transaction.hash;
  diamond.diamondType = "ACQUISITION";
  diamond.save();

  // Create Acquisition entity
  let acquisition = new Acquisition(event.params.acquisition.toHexString());
  acquisition.address = event.params.acquisition;
  acquisition.seller = event.params.seller;
  acquisition.price = event.params.price;
  acquisition.status = "DRAFT"; // Initial status
  acquisition.createdAt = event.block.timestamp;
  acquisition.createdAtBlock = event.block.number;
  acquisition.transactionHash = event.transaction.hash;
  acquisition.save();

  log.info("Created Acquisition entity: {}", [acquisition.id]);
}

// Re-export payment and access control handlers from offering-factory
// These use the exact same event signatures
export {
  handlePaymentModuleInitialized,
  handlePaymentTokenConfigured,
  handlePaymentCollected,
  handleFeeRecipientUpdated,
  handlePaymentsStatusChanged,
  handleUserRoleUpdated,
} from "./offering-factory";
