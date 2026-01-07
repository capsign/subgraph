/**
 * Escrow Factory Event Handlers
 * 
 * Handles events from the EscrowFactory contract for tracking
 * escrows created through the platform.
 */

import { AcquisitionCreated } from "../../generated/EscrowFactory/AcquisitionFactoryCoreFacet";
import { Diamond, Escrow } from "../../generated/schema";
import { EscrowDiamond } from "../../generated/templates";
import { log } from "@graphprotocol/graph-ts";

/**
 * Handles the creation of a new Escrow diamond
 */
export function handleEscrowCreated(event: AcquisitionCreated): void {
  log.info("Handling EscrowCreated event for escrow: {}", [
    event.params.acquisition.toHexString(),
  ]);

  // Create Diamond entity
  let diamond = new Diamond(event.params.acquisition.toHexString());
  diamond.creator = event.params.seller;
  diamond.createdAt = event.block.timestamp;
  diamond.createdTx = event.transaction.hash;
  diamond.diamondType = "ESCROW";
  diamond.save();

  // Create Escrow entity
  let escrow = new Escrow(event.params.acquisition.toHexString());
  escrow.address = event.params.acquisition;
  escrow.seller = event.params.seller;
  escrow.price = event.params.price;
  escrow.status = "DRAFT"; // Initial status
  escrow.createdAt = event.block.timestamp;
  escrow.createdAtBlock = event.block.number;
  escrow.transactionHash = event.transaction.hash;
  escrow.save();

  // Start tracking this escrow diamond for lifecycle events
  EscrowDiamond.create(event.params.acquisition);

  log.info("Created Escrow entity and started tracking diamond: {}", [escrow.id]);
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
