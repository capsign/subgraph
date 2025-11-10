import {
  OfferingInitialized,
  FundsDeposited,
  InvestmentAccepted,
  InvestmentRejected,
  OfferingStatusChanged,
} from "../../generated/templates/OfferingDiamond/OfferingCore";
import {
  DocumentSigned,
} from "../../generated/templates/OfferingDiamond/OfferingDocuments";
import {
  ComplianceInitialized,
  AllowsGeneralSolicitationUpdated,
  AllowsSelfCertificationUpdated,
  ComplianceModuleRegistered,
  ComplianceModuleEnabled,
} from "../../generated/templates/OfferingDiamond/OfferingCompliance";
import {
  KYCStatusUpdated,
  KYCRevoked,
  ClassificationUpdated,
  ClassificationRevoked,
} from "../../generated/templates/OfferingDiamond/ComplianceAdmin";
import { Offering, Investment, Diamond, DocumentSignature, Document, InvestmentLookup } from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// Re-export compliance handlers
export {
  handleKYCStatusUpdated,
  handleKYCRevoked,
  handleClassificationUpdated,
  handleClassificationRevoked,
} from "./compliance";

export function handleOfferingInitialized(event: OfferingInitialized): void {
  const offeringAddress = event.address.toHexString();

  // Load offering entity (should already exist from OfferingFactory event)
  let offering = Offering.load(offeringAddress);
  if (!offering) {
    // Fallback for offerings created before factory was deployed
    offering = new Offering(offeringAddress);
    offering.createdAt = event.block.timestamp;
    offering.createdTx = event.transaction.hash;
    offering.admin = event.params.issuer; // Fallback to issuer
    offering.deployer = event.transaction.from;
    offering.complianceModules = []; // Empty array fallback
  }

  // Update offering with initialization data from event
  offering.issuer = event.params.issuer;
  offering.token = event.params.token.toHexString();
  offering.paymentToken = event.params.paymentToken;
  offering.paymentRecipient = event.params.paymentRecipient;
  offering.pricePerToken = event.params.pricePerToken;
  offering.minInvestment = event.params.minInvestment;
  offering.maxAmount = event.params.maxAmount;
  offering.deadline = event.params.deadline;
  offering.uri = event.params.uri; // Offering metadata URI
  
  offering.totalInvested = BigInt.fromI32(0);
  offering.investorCount = BigInt.fromI32(0);
  offering.status = "ACTIVE";

  offering.save();
  
  // Create activity for offering creation
  const offeringActivity = createActivity(
    "offering-created-" + offeringAddress + "-" + event.logIndex.toString(),
    "OFFERING_CREATED",
    offering.issuer,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  offeringActivity.offering = offeringAddress;
  offeringActivity.save();
  
  // Update diamond type
  const diamond = Diamond.load(offeringAddress);
  if (diamond) {
    diamond.diamondType = "OFFERING";
    diamond.offering = offeringAddress;
    diamond.save();
  }
}

export function handleFundsDeposited(event: FundsDeposited): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  // Use tx-hash-logIndex for globally unique ID
  const investmentId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  
  // Create composite ID for protocol lookups (offering-investmentId)
  const compositeId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  
  const investment = new Investment(investmentId);
  investment.compositeId = compositeId;
  investment.offering = offering.id;
  investment.investor = event.params.investor.toHexString();
  investment.investmentId = event.params.investmentId;
  investment.amount = event.params.amount;
  investment.tokenQuantity = event.params.tokenQuantity; // Now included in event!
  investment.investedAt = event.block.timestamp;
  investment.investedTx = event.transaction.hash;
  investment.investedBlockNumber = event.block.number;
  investment.status = "PENDING"; // Initial status
  investment.identityUID = event.params.identityUID;
  investment.qualificationUID = event.params.qualificationUID;
  investment.save();
  
  // Create lookup entity for composite ID queries
  const lookup = new InvestmentLookup(compositeId);
  lookup.investment = investmentId;
  lookup.save();

  // Update offering totals
  offering.totalInvested = offering.totalInvested.plus(event.params.amount);
  offering.investorCount = offering.investorCount.plus(BigInt.fromI32(1));
  offering.save();
  
  // Create activity for investment made (investor's perspective)
  const investorActivity = createActivity(
    "investment-made-" + investmentId,
    "INVESTMENT_MADE",
    event.params.investor,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  investorActivity.investment = investmentId;
  investorActivity.save();
  
  // Create activity for investment received (issuer's perspective)
  const issuerActivity = createActivity(
    "investment-received-" + investmentId,
    "INVESTMENT_RECEIVED",
    offering.issuer,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  issuerActivity.investment = investmentId;
  issuerActivity.save();
}

export function handleInvestmentAccepted(
  event: InvestmentAccepted
): void {
  // Look up investment by compositeId (offering-investmentId)
  const compositeId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const lookup = InvestmentLookup.load(compositeId);
  if (!lookup) return; // Investment not found
  
  const investment = Investment.load(lookup.investment);
  if (!investment) return;

  investment.status = "ACCEPTED";
  investment.countersignedAt = event.block.timestamp;
  investment.countersignedTx = event.transaction.hash;
  investment.save();
}

export function handleInvestmentRejected(event: InvestmentRejected): void {
  // Look up investment by compositeId (offering-investmentId)
  const compositeId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const lookup = InvestmentLookup.load(compositeId);
  if (!lookup) return; // Investment not found
  
  const investment = Investment.load(lookup.investment);
  if (!investment) return;

  investment.status = "REJECTED";
  investment.rejectedAt = event.block.timestamp;
  investment.rejectedTx = event.transaction.hash;
  investment.save();

  // Update offering totals
  const offering = Offering.load(event.address.toHexString());
  if (offering) {
    offering.totalInvested = offering.totalInvested.minus(investment.amount);
    offering.investorCount = offering.investorCount.minus(BigInt.fromI32(1));
    offering.save();
  }
}

export function handleOfferingStatusChanged(
  event: OfferingStatusChanged
): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  // Map uint8 to enum string
  // Matches OfferingCoreStorage.OfferingStatus: DRAFT(0), ACTIVE(1), COMPLETED(2), CANCELLED(3)
  const statusMap = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"];
  offering.status = statusMap[event.params.newStatus];
  offering.save();
}

/**
 * Handle document signatures from offering contracts
 * Documents are stored in the issuer's wallet, but signatures go through the offering
 * for compliance checks (ONLY_COMPLIANT signer eligibility)
 */
export function handleOfferingDocumentSigned(event: DocumentSigned): void {
  const documentId = event.params.documentId.toHexString();
  const signer = event.params.signer;
  
  // Check if the document exists - it should have been created by handleDocumentUploaded
  const document = Document.load(documentId);
  if (!document) {
    // Document hasn't been indexed yet, skip (signature will be created by wallet handler)
    return;
  }
  
  // Signature entity ID is: tx-hash-logIndex
  const signatureId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

  // Create document signature entity
  let signature = new DocumentSignature(signatureId);
  signature.document = documentId;
  signature.signer = signer;
  signature.signedAt = event.params.timestamp;
  signature.tx = event.transaction.hash;
  signature.blockNumber = event.block.number;
  signature.logIndex = event.logIndex;
  
  signature.save();
}

/**
 * Handle compliance initialization
 * Captures initial generalSolicitation and allowsSelfCertification settings
 */
export function handleComplianceInitialized(event: ComplianceInitialized): void {
  const offeringAddress = event.address.toHexString();
  let offering = Offering.load(offeringAddress);
  
  if (!offering) {
    // Offering not yet created by factory - create it now to capture compliance settings
    // This handles the race condition where ComplianceInitialized fires before OfferingCreated
    offering = new Offering(offeringAddress);
    offering.issuer = event.transaction.from; // Temporary - will be updated by OfferingCreated
    offering.admin = event.transaction.from; // Temporary - will be updated by OfferingCreated
    offering.deployer = event.transaction.from;
    offering.createdAt = event.block.timestamp;
    offering.createdTx = event.transaction.hash;
    
    // Initialize with defaults
    offering.token = "0x0000000000000000000000000000000000000000";
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
    offering.complianceModules = []; // Initialize empty array for non-nullable field
  }
  
  // Set compliance settings from event parameters
  offering.generalSolicitation = event.params.allowsGeneralSolicitation;
  offering.allowsSelfCertification = event.params.allowsSelfCertification;
  
  offering.save();
}

/**
 * Handle general solicitation setting updates
 */
export function handleAllowsGeneralSolicitationUpdated(event: AllowsGeneralSolicitationUpdated): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    return; // Skip if offering not found
  }
  
  offering.generalSolicitation = event.params.allowed;
  offering.save();
}

/**
 * Handle self-certification setting updates
 */
export function handleAllowsSelfCertificationUpdated(event: AllowsSelfCertificationUpdated): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    return; // Skip if offering not found
  }
  
  offering.allowsSelfCertification = event.params.allowed;
  offering.save();
}

/**
 * Handle compliance module registration
 */
export function handleComplianceModuleRegistered(event: ComplianceModuleRegistered): void {
  // TODO: Store compliance module details if needed
  // For now, just log the event
}

/**
 * Handle compliance module enabled/disabled
 */
export function handleComplianceModuleEnabled(event: ComplianceModuleEnabled): void {
  // TODO: Store compliance module status if needed
  // For now, just log the event
}
