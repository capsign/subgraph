import { OfferingCreated } from "../../generated/OfferingFactory/OfferingFactory";
import { Diamond, Offering } from "../../generated/schema";
import { OfferingDiamond } from "../../generated/templates";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

/**
 * Handle offering creation from OfferingFactory
 * This event provides immediate type information and configuration
 */
export function handleOfferingCreated(event: OfferingCreated): void {
  const offeringAddress = event.params.offeringDiamond.toHexString();

  // Create or update Diamond entity
  let diamond = Diamond.load(offeringAddress);
  if (!diamond) {
    diamond = new Diamond(offeringAddress);
    diamond.creator = event.params.issuer;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
  }
  diamond.diamondType = "OFFERING";
  diamond.save();

  // Create Offering entity with factory data
  let offering = new Offering(offeringAddress);
  offering.issuer = event.params.issuer;
  offering.admin = event.params.admin;
  offering.deployer = event.transaction.from;
  offering.createdAt = event.block.timestamp;
  offering.createdTx = event.transaction.hash;

  // Store compliance modules
  const modules: Bytes[] = [];
  for (let i = 0; i < event.params.complianceModules.length; i++) {
    modules.push(event.params.complianceModules[i]);
  }
  offering.complianceModules = modules;

  // Initialize with default values (will be updated by OfferingInitialized event)
  offering.token = "0x0000000000000000000000000000000000000000"; // Placeholder
  offering.paymentToken = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
  offering.paymentRecipient = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
  offering.pricePerToken = BigInt.fromI32(0);
  offering.minInvestment = BigInt.fromI32(0);
  offering.maxAmount = BigInt.fromI32(0);
  offering.deadline = BigInt.fromI32(0);
  offering.totalInvested = BigInt.fromI32(0);
  offering.investorCount = BigInt.fromI32(0);
  offering.status = "ACTIVE";
  offering.uri = null;
  offering.metadataFetched = false;

  offering.save();

  // Link offering to diamond
  diamond.offering = offeringAddress;
  diamond.save();

  // Start tracking offering diamond for events
  OfferingDiamond.create(event.params.offeringDiamond);
}
