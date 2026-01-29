import {
  OfferingInitialized,
  FundsDeposited,
  InvestmentAccepted,
  InvestmentRejected,
  CommitmentMade,
  OfferingStatusChanged,
  DocumentSignerRoleUpdated,
  OfferingURIUpdated,
  PaymentRecipientUpdated,
  PricePerTokenUpdated,
  DeadlineExtended,
  MinMaxInvestmentUpdated,
} from "../../generated/templates/OfferingDiamond/OfferingCore";
import {
  DocumentSigned,
  DocumentCreated,
  DocumentRequirementAdded,
  DocumentRequirementUpdated,
  DocumentRequirementRemoved,
  DocumentEligibilityModeSet,
  CustomEligibilityModuleSet,
  RequiredSignersSet,
  RequiredSignerAdded,
  RequiredSignerRemoved,
  OfferingDocuments,
} from "../../generated/templates/OfferingDiamond/OfferingDocuments";
import {
  TemplateRegistered,
  RequiredDocumentSet,
} from "../../generated/templates/OfferingDiamond/OfferingDiamond";
import {
  ComplianceInitialized,
  AllowsGeneralSolicitationUpdated,
  AllowsSelfCertificationUpdated,
  ComplianceModuleRegistered,
  ComplianceModuleEnabled,
} from "../../generated/templates/OfferingDiamond/OfferingCompliance";
import {
  OffchainInvestmentRecorded,
  OffchainInvestmentConfirmed,
  OffchainInvestmentCancelled,
} from "../../generated/templates/OfferingDiamond/OfferingOffchain";
import {
  KYCStatusUpdated,
  KYCRevoked,
  ClassificationUpdated,
  ClassificationRevoked,
} from "../../generated/templates/OfferingDiamond/ComplianceAdmin";
import {
  UserRoleUpdated,
  FunctionAccessChanged,
  AuthorityUpdated,
} from "../../generated/templates/OfferingDiamond/OfferingDiamond";
import {
  CustomTermsSet,
} from "../../generated/templates/OfferingDiamond/OfferingTerms";
import { Offering, Investment, Diamond, DocumentSignature, Document, InvestmentLookup, OfferingInvestor, SafePreApprovedTerms, OffchainInvestment, UserRole, FunctionAccess, OfferingTemplate, OfferingDocument, OfferingDocumentSignature, DocumentRequirement, RequiredSigner, AuthorityDelegation } from "../../generated/schema";
import { BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// Re-export DiamondCut handler for this template
export { handleDiamondCut } from "./diamond-cut";

// Helper function to ensure offering has offchain fields initialized
function ensureOffchainFieldsInitialized(offering: Offering): void {
  if (!offering.totalOffchainPending) {
    offering.totalOffchainPending = BigInt.fromI32(0);
  }
  if (!offering.totalOffchainConfirmed) {
    offering.totalOffchainConfirmed = BigInt.fromI32(0);
  }
}

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
  offering.totalOffchainPending = BigInt.fromI32(0);
  offering.totalOffchainConfirmed = BigInt.fromI32(0);
  offering.status = "ACTIVE";
  
  // Set default document eligibility mode (2 = COMPLIANT_ONLY)
  offering.documentEligibilityMode = 2;

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
  
  // Investments are always made directly by the investor (entity wallet or individual)
  // Delegation is handled at the document signing level, not investment level
  investment.isInvestmentDelegated = false;
  
  investment.save();
  
  // Create lookup entity for composite ID queries
  const lookup = new InvestmentLookup(compositeId);
  lookup.investment = investmentId;
  lookup.save();

  // Update offering totals
  ensureOffchainFieldsInitialized(offering);
  offering.totalInvested = offering.totalInvested.plus(event.params.amount);
  
  // Track unique investors - only increment count if this is a new investor
  const offeringInvestorId = event.address.toHexString() + "-" + event.params.investor.toHexString();
  let offeringInvestor = OfferingInvestor.load(offeringInvestorId);
  
  if (!offeringInvestor) {
    // New unique investor for this offering
    offeringInvestor = new OfferingInvestor(offeringInvestorId);
    offeringInvestor.offering = offering.id;
    offeringInvestor.investor = event.params.investor.toHexString();
    offeringInvestor.firstInvestedAt = event.block.timestamp;
    offeringInvestor.investmentCount = 1;
    offeringInvestor.save();
    
    // Only increment investor count for new unique investors
    offering.investorCount = offering.investorCount.plus(BigInt.fromI32(1));
  } else {
    // Existing investor making another investment
    offeringInvestor.investmentCount = offeringInvestor.investmentCount + 1;
    offeringInvestor.save();
  }
  
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

export function handleDocumentSignerRoleUpdated(event: DocumentSignerRoleUpdated): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;
  
  offering.documentSignerRoleId = event.params.roleId;
  offering.save();
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
  
  // Check if countersigner is different from issuer (indicates representative countersigning)
  const offering = Offering.load(event.address.toHexString());
  if (offering && event.transaction.from.toHexString() != offering.issuer.toHexString()) {
    // This was countersigned by a representative
    investment.countersignedBy = event.transaction.from.toHexString();
    investment.countersignedOnBehalfOf = offering.issuer.toHexString();
    investment.isCountersignDelegated = true;
  } else {
    // Direct countersigning by issuer
    investment.isCountersignDelegated = false;
  }
  
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
    ensureOffchainFieldsInitialized(offering);
    offering.totalInvested = offering.totalInvested.minus(investment.amount);
    
    // Update OfferingInvestor tracking
    const offeringInvestorId = event.address.toHexString() + "-" + investment.investor;
    const offeringInvestor = OfferingInvestor.load(offeringInvestorId);
    
    if (offeringInvestor) {
      offeringInvestor.investmentCount = offeringInvestor.investmentCount - 1;
      offeringInvestor.save();
      
      // Only decrement investor count if this was their last investment
      if (offeringInvestor.investmentCount <= 0) {
        offering.investorCount = offering.investorCount.minus(BigInt.fromI32(1));
      }
    }
    
    offering.save();
  }
}

/**
 * Handle commitment made event for commitment-based offerings.
 * This is similar to FundsDeposited but for offerings where investors commit
 * capital without immediate payment.
 */
export function handleCommitmentMade(event: CommitmentMade): void {
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
  investment.amount = event.params.commitmentAmount;
  investment.tokenQuantity = event.params.tokenQuantity;
  investment.investedAt = event.block.timestamp;
  investment.investedTx = event.transaction.hash;
  investment.investedBlockNumber = event.block.number;
  // Commitment-based investments are accepted immediately (no escrow)
  investment.status = "ACCEPTED";
  investment.countersignedAt = event.block.timestamp;
  investment.countersignedTx = event.transaction.hash;
  // Empty bytes32 for attestation UIDs (commitment-based uses on-chain compliance)
  investment.identityUID = event.params.subscriptionAgreementRef;
  investment.qualificationUID = event.params.subscriptionAgreementRef;
  investment.isInvestmentDelegated = false;
  
  investment.save();
  
  // Create lookup entity for composite ID queries
  const lookup = new InvestmentLookup(compositeId);
  lookup.investment = investmentId;
  lookup.save();

  // For commitment-based offerings, commitmentAmount is the commitment, not actual funds
  // totalInvested tracks actual funds received, so we don't update it here
  // Instead, we should track totalCommitted separately (future enhancement)
  ensureOffchainFieldsInitialized(offering);
  
  // Track unique investors - only increment count if this is a new investor
  const offeringInvestorId = event.address.toHexString() + "-" + event.params.investor.toHexString();
  let offeringInvestor = OfferingInvestor.load(offeringInvestorId);
  
  if (!offeringInvestor) {
    // New unique investor for this offering
    offeringInvestor = new OfferingInvestor(offeringInvestorId);
    offeringInvestor.offering = offering.id;
    offeringInvestor.investor = event.params.investor.toHexString();
    offeringInvestor.firstInvestedAt = event.block.timestamp;
    offeringInvestor.investmentCount = 1;
    offeringInvestor.save();
    
    // Only increment investor count for new unique investors
    offering.investorCount = offering.investorCount.plus(BigInt.fromI32(1));
  } else {
    // Existing investor making another commitment
    offeringInvestor.investmentCount = offeringInvestor.investmentCount + 1;
    offeringInvestor.save();
  }
  
  offering.save();
}

export function handleOfferingStatusChanged(
  event: OfferingStatusChanged
): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  // Map uint8 to enum string
  // Matches OfferingCoreStorage.OfferingStatus: DRAFT(0), ACTIVE(1), COMPLETED(2), CANCELLED(3)
  const statusMap = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"];
  ensureOffchainFieldsInitialized(offering);
  offering.status = statusMap[event.params.newStatus];
  offering.save();
}

/**
 * Handle template registration in offering contracts
 * Templates are stored in the offering contract and used to create document instances
 */
export function handleTemplateRegistered(event: TemplateRegistered): void {
  const templateId = event.params.templateId.toHexString();
  const offeringAddress = event.address.toHexString();
  
  // Create template entity
  let template = new OfferingTemplate(templateId);
  template.offering = offeringAddress;
  template.contentHash = event.params.contentHash;
  template.title = event.params.title;
  template.creator = event.params.creator;
  template.createdAt = event.block.timestamp;
  template.createdTx = event.transaction.hash;
  
  template.save();
}

/**
 * Handle required document set (links template to offering and sets eligibility)
 */
export function handleRequiredDocumentSet(event: RequiredDocumentSet): void {
  const templateId = event.params.templateId.toHexString();
  const offeringAddress = event.address.toHexString();
  
  // Load offering and set required template
  let offering = Offering.load(offeringAddress);
  if (offering) {
    offering.requiredTemplate = templateId;
    offering.save();
  }
  
  // Load template and set eligibility
  let template = OfferingTemplate.load(templateId);
  if (template) {
    const eligibilityMode = event.params.eligibility;
    if (eligibilityMode == 0) {
      template.eligibility = "COMPLIANT_ONLY";
    } else if (eligibilityMode == 1) {
      template.eligibility = "WHITELISTED_ONLY";
    } else if (eligibilityMode == 2) {
      template.eligibility = "CUSTOM_MODULE";
    } else if (eligibilityMode == 3) {
      template.eligibility = "EXPLICIT_LIST";
    }
    template.save();
  }
}

/**
 * Handle document creation from template
 * Creates a personalized document instance from a template
 */
export function handleDocumentCreated(event: DocumentCreated): void {
  const documentId = event.params.documentId.toHexString();
  const templateId = event.params.templateId.toHexString();
  const offeringAddress = event.address.toHexString();
  
  // Create document instance entity
  let document = new OfferingDocument(documentId);
  document.offering = offeringAddress;
  document.template = templateId;
  document.title = event.params.title;
  document.creator = event.params.creator;
  document.createdAt = event.block.timestamp;
  document.createdTx = event.transaction.hash;
  
  document.save();
  
  // IMPORTANT: Update any signatures for this document that were created in the same transaction
  // This handles the race condition where DocumentSigned is processed before DocumentCreated
  // We need to find signatures for this document in the current transaction and update their template
  const txHash = event.transaction.hash.toHexString();
  const block = event.block.number;
  
  // Note: We can't query by transaction in the subgraph efficiently, so we'll rely on
  // the signature handler to check back and update itself if needed
}

/**
 * Handle document signatures from offering contracts
 * Documents are now stored in the offering contract, not the issuer's wallet
 */
export function handleOfferingDocumentSigned(event: DocumentSigned): void {
  const documentId = event.params.documentId.toHexString();
  const signer = event.params.signer;
  const offeringAddress = event.address.toHexString();
  
  // Signature entity ID is: tx-hash-logIndex
  const signatureId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

  // Try to load the offering document to get the template
  const offeringDocument = OfferingDocument.load(documentId);
  
  // If document doesn't exist yet (race condition in same tx), create signature anyway
  // The template will be set when the document is indexed
  let signature = new OfferingDocumentSignature(signatureId);
  signature.offering = offeringAddress;
  signature.template = offeringDocument ? offeringDocument.template : null;
  signature.document = documentId;
  signature.signer = signer;
  signature.signedAt = event.params.timestamp;
  signature.tx = event.transaction.hash;
  signature.blockNumber = event.block.number;
  signature.logIndex = event.logIndex;
  
  // Initialize representative signing fields (not delegated for regular DocumentSigned)
  signature.isDelegated = false;
  
  signature.save();
  
  // Create activity for document signing
  const activity = createActivity(
    "doc-signed-" + signatureId,
    "DOCUMENT_SIGNED",
    signer,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.offeringDocumentSignature = signatureId;
  activity.save();
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
  
  ensureOffchainFieldsInitialized(offering);
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
  
  ensureOffchainFieldsInitialized(offering);
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
  
  ensureOffchainFieldsInitialized(offering);
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

/**
 * Handle CustomTermsSet event
 * Creates/updates pre-approved terms for investors
 * When investmentId = 0, it's a pre-approved term (set before investment)
 */
export function handleCustomTermsSet(event: CustomTermsSet): void {
  const investmentId = event.params.investmentId;
  
  // Only handle pre-approved terms (investmentId = 0)
  // investmentId > 0 means terms set for an existing investment
  if (!investmentId.equals(BigInt.fromI32(0))) {
    return;
  }
  
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    return; // Skip if offering not found
  }
  
  // Get investor address directly from the event parameter (now indexed in v3)
  const investor = event.params.investor;
  
  // Determine asset type from offering's token
  let assetType = "Safe"; // Default to SAFE for now
  // TODO: Query the token contract to get actual asset type
  
  // Create entity ID
  const id = offeringAddress + "-" + investor.toHexString();
  
  // Check asset type and create appropriate entity
  if (assetType == "Safe") {
    let terms = SafePreApprovedTerms.load(id);
    if (!terms) {
      terms = new SafePreApprovedTerms(id);
      terms.offering = offeringAddress;
      terms.investor = investor;
      terms.assetType = assetType;
      terms.cleared = false;
    }
    
    // Store raw encoded terms
    terms.encodedTerms = event.params.termsData;
    terms.setAt = event.block.timestamp;
    terms.setTx = event.transaction.hash;
    terms.setBy = event.transaction.from;
    
    // Decode SAFE-specific fields
    // Format: (uint256 valuationCap, uint256 discountRate, uint256 interestRate, uint256 maturityDate)
    const encodedTerms = event.params.termsData;
    
    // Debug log the raw data
    // log.info("Decoding SAFE terms, length: {}, first 32 bytes for valuation cap", [
    //   encodedTerms.length.toString(),
    // ]);
    
    if (encodedTerms.length >= 128) { // 4 * 32 bytes
      // Decode each uint256 (32 bytes each)
      // Solidity ABI encoding uses big-endian, but BigInt.fromUnsignedBytes expects little-endian
      // So we need to reverse the byte order manually
      const valuationCapBytes = encodedTerms.subarray(0, 32);
      const discountRateBytes = encodedTerms.subarray(32, 64);
      const interestRateBytes = encodedTerms.subarray(64, 96);
      const maturityDateBytes = encodedTerms.subarray(96, 128);
      
      // Reverse bytes manually (big-endian to little-endian)
      const valuationCapReversed = new Uint8Array(32);
      const discountRateReversed = new Uint8Array(32);
      const interestRateReversed = new Uint8Array(32);
      const maturityDateReversed = new Uint8Array(32);
      
      for (let i = 0; i < 32; i++) {
        valuationCapReversed[i] = valuationCapBytes[31 - i];
        discountRateReversed[i] = discountRateBytes[31 - i];
        interestRateReversed[i] = interestRateBytes[31 - i];
        maturityDateReversed[i] = maturityDateBytes[31 - i];
      }
      
      // Convert to BigInt
      terms.valuationCap = BigInt.fromUnsignedBytes(Bytes.fromUint8Array(valuationCapReversed));
      terms.maturityDate = BigInt.fromUnsignedBytes(Bytes.fromUint8Array(maturityDateReversed));
      
      // For rates (should be small numbers like 1500 for 15%), convert directly
      const discountRateBigInt = BigInt.fromUnsignedBytes(Bytes.fromUint8Array(discountRateReversed));
      const interestRateBigInt = BigInt.fromUnsignedBytes(Bytes.fromUint8Array(interestRateReversed));
      
      // Only clamp if truly unreasonable (> 100 million basis points = 1 million %)
      const maxReasonable = BigInt.fromI32(100000000); // 100 million basis points
      if (discountRateBigInt.gt(maxReasonable)) {
        // Value is unreasonably large, probably a decoding error - use 0
        terms.discountRate = 0;
      } else {
        terms.discountRate = discountRateBigInt.toI32();
      }
      
      if (interestRateBigInt.gt(maxReasonable)) {
        terms.interestRate = 0;
      } else {
        terms.interestRate = interestRateBigInt.toI32();
      }
    }
    
    terms.save();
  }
  // Future: Add handling for other asset types
}

// ============ OFFCHAIN INVESTMENT HANDLERS ============

export function handleOffchainInvestmentRecorded(event: OffchainInvestmentRecorded): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  // Use compositeId as primary ID (offering-investmentId)
  const compositeId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  
  const offchainInvestment = new OffchainInvestment(compositeId);
  offchainInvestment.offering = offering.id;
  offchainInvestment.investor = event.params.investor.toHexString();
  offchainInvestment.investmentId = event.params.investmentId;
  offchainInvestment.amount = event.params.amount;
  offchainInvestment.tokenQuantity = event.params.tokenQuantity;
  offchainInvestment.paymentMethod = event.params.paymentMethod;
  offchainInvestment.referenceId = "";
  offchainInvestment.recordedAt = event.block.timestamp;
  offchainInvestment.recordedTx = event.transaction.hash;
  offchainInvestment.recordedBlockNumber = event.block.number;
  offchainInvestment.recordedBy = event.transaction.from;
  offchainInvestment.status = "PENDING";
  offchainInvestment.save();
  
  // Update offering stats (add to pending, not confirmed yet)
  ensureOffchainFieldsInitialized(offering);
  offering.totalOffchainPending = offering.totalOffchainPending!.plus(event.params.amount);
  offering.save();
}

export function handleOffchainInvestmentConfirmed(event: OffchainInvestmentConfirmed): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;
  
  // Load offchain investment directly by compositeId
  const compositeId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const offchainInvestment = OffchainInvestment.load(compositeId);
  if (!offchainInvestment) return;
  
  // Update investment status
  offchainInvestment.status = "CONFIRMED";
  offchainInvestment.confirmedAt = event.block.timestamp;
  offchainInvestment.confirmedTx = event.transaction.hash;
  offchainInvestment.confirmedBy = event.params.confirmedBy;
  offchainInvestment.save();
  
  // Update offering totals: move from pending to confirmed
  ensureOffchainFieldsInitialized(offering);
  offering.totalOffchainPending = offering.totalOffchainPending!.minus(offchainInvestment.amount);
  offering.totalOffchainConfirmed = offering.totalOffchainConfirmed!.plus(offchainInvestment.amount);
  
  // Track unique investors using OfferingInvestor entity
  const investorAddress = Bytes.fromHexString(offchainInvestment.investor);
  const offeringInvestorId = event.address.toHexString() + "-" + investorAddress.toHexString();
  let offeringInvestor = OfferingInvestor.load(offeringInvestorId);
  
  if (!offeringInvestor) {
    // New unique investor for this offering
    offeringInvestor = new OfferingInvestor(offeringInvestorId);
    offeringInvestor.offering = offering.id;
    offeringInvestor.investor = offchainInvestment.investor;
    offeringInvestor.firstInvestedAt = event.block.timestamp;
    offeringInvestor.investmentCount = 1;
    offeringInvestor.save();
    
    // Only increment investor count for new unique investors
    offering.investorCount = offering.investorCount.plus(BigInt.fromI32(1));
  } else {
    // Existing investor - increment their investment count
    offeringInvestor.investmentCount = offeringInvestor.investmentCount + 1;
    offeringInvestor.save();
  }
  
  offering.save();
  
  // Create activity
  createActivity(
    "offchain-confirmed-" + offchainInvestment.id,
    "OFFCHAIN_INVESTMENT_CONFIRMED",
    event.params.confirmedBy,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  ).save();
}

export function handleOffchainInvestmentCancelled(event: OffchainInvestmentCancelled): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;
  
  // Load offchain investment directly by compositeId
  const compositeId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const offchainInvestment = OffchainInvestment.load(compositeId);
  if (!offchainInvestment) return;
  
  // Update investment status
  offchainInvestment.status = "CANCELLED";
  offchainInvestment.cancelledAt = event.block.timestamp;
  offchainInvestment.cancelledTx = event.transaction.hash;
  offchainInvestment.cancelledBy = event.params.cancelledBy;
  offchainInvestment.save();
  
  // Update offering totals: remove from pending
  ensureOffchainFieldsInitialized(offering);
  offering.totalOffchainPending = offering.totalOffchainPending!.minus(offchainInvestment.amount);
  offering.save();
  
  // Create activity
  createActivity(
    "offchain-cancelled-" + offchainInvestment.id,
    "OFFCHAIN_INVESTMENT_CANCELLED",
    event.params.cancelledBy,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  ).save();
}

// ============ COMPLIANCE HANDLERS ============

export { 
  handleKYCStatusUpdated,
  handleKYCRevoked,
  handleClassificationUpdated,
  handleClassificationRevoked
} from "./compliance";

// ============ ACCESS CONTROL HANDLERS ============

/**
 * Handle UserRoleUpdated events for offerings
 */
export function handleOfferingUserRoleUpdated(event: UserRoleUpdated): void {
  const diamondAddress = event.address.toHexString();
  const userAddress = event.params.user.toHexString();
  const role = event.params.role;
  const enabled = event.params.enabled;

  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Create diamond entry if it doesn't exist (for offerings)
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "OFFERING";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    
    // Link to offering if it exists
    const offering = Offering.load(diamondAddress);
    if (offering) {
      diamond.offering = diamondAddress;
    }
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

/**
 * Handle FunctionAccessChanged event for offerings
 */
export function handleOfferingFunctionAccessChanged(event: FunctionAccessChanged): void {
  const diamondAddress = event.address.toHexString();
  const functionSelector = event.params.functionSig;
  const role = event.params.role;
  const hasAccess = event.params.enabled;
  
  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Create diamond entry if it doesn't exist
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "OFFERING";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    
    // Link to offering if it exists
    const offering = Offering.load(diamondAddress);
    if (offering) {
      diamond.offering = diamondAddress;
    }
    diamond.save();
  }
  
  // Create or update FunctionAccess entity
  const functionAccessId = `${diamondAddress}-${functionSelector.toHexString()}-${role.toString()}`;
  let functionAccess = FunctionAccess.load(functionAccessId);
  
  if (!functionAccess) {
    functionAccess = new FunctionAccess(functionAccessId);
    functionAccess.diamond = diamondAddress;
    functionAccess.functionSelector = functionSelector;
    functionAccess.role = role;
    functionAccess.grantedAt = event.block.timestamp;
    functionAccess.grantedTx = event.transaction.hash;
  }
  
  functionAccess.hasAccess = hasAccess;
  functionAccess.lastUpdatedAt = event.block.timestamp;
  functionAccess.lastUpdatedTx = event.transaction.hash;
  
  functionAccess.save();
}

/**
 * Handle AuthorityUpdated events for offerings
 * Event: AuthorityUpdated(address indexed oldAuthority, address indexed newAuthority)
 *
 * Tracks when an offering delegates its access control to a wallet (AccessManager)
 */
export function handleOfferingAuthorityUpdated(event: AuthorityUpdated): void {
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
      
      delegation.save();
    }
  }
}

/**
 * Handle document requirement added
 */
export function handleDocumentRequirementAdded(event: DocumentRequirementAdded): void {
  const offeringAddress = event.address.toHexString();
  const requirementIndex = event.params.requirementIndex;
  const requirementId = `${offeringAddress}-${requirementIndex.toString()}`;
  
  // Ensure offering exists (it should, but check to avoid foreign key constraint failures)
  let offering = Offering.load(offeringAddress);
  if (!offering) {
    log.warning('[DocumentRequirement] Offering {} not found when adding requirement {}', [offeringAddress, requirementIndex.toString()]);
    return;
  }
  
  // Get requirement data from contract
  const contract = OfferingDocuments.bind(event.address);
  const requirementData = contract.try_getDocumentRequirement(requirementIndex);
  
  if (!requirementData.reverted) {
    const req = requirementData.value;
    const requirement = new DocumentRequirement(requirementId);
    requirement.offering = offeringAddress;
    requirement.index = requirementIndex.toI32();
    requirement.label = event.params.label;
    requirement.allowedTemplateIds = req.allowedTemplateIds;
    requirement.isRequired = req.isRequired;
    requirement.minRequired = event.params.minRequired;
    requirement.maxRequired = event.params.maxRequired;
    requirement.priority = req.priority;
    requirement.addedAt = event.block.timestamp;
    requirement.addedTx = event.transaction.hash;
    requirement.save();
  }
}

/**
 * Handle document requirement updated
 */
export function handleDocumentRequirementUpdated(event: DocumentRequirementUpdated): void {
  const offeringAddress = event.address.toHexString();
  const requirementIndex = event.params.requirementIndex;
  const requirementId = `${offeringAddress}-${requirementIndex.toString()}`;
  
  const requirement = DocumentRequirement.load(requirementId);
  if (requirement) {
    requirement.label = event.params.label;
    requirement.minRequired = event.params.minRequired;
    requirement.maxRequired = event.params.maxRequired;
    requirement.priority = event.params.priority;
    requirement.save();
  }
}

/**
 * Handle document requirement removed
 */
export function handleDocumentRequirementRemoved(event: DocumentRequirementRemoved): void {
  const offeringAddress = event.address.toHexString();
  const requirementIndex = event.params.requirementIndex;
  const requirementId = `${offeringAddress}-${requirementIndex.toString()}`;
  
  // Note: Due to swap-and-pop removal, the requirement at this index might now be a different one
  // We need to reload all requirements and renumber them
  const offering = Offering.load(offeringAddress);
  if (offering) {
    const contract = OfferingDocuments.bind(event.address);
    const requirementsResult = contract.try_getDocumentRequirements();
    
    if (!requirementsResult.reverted) {
      // Remove old requirement
      const oldRequirement = DocumentRequirement.load(requirementId);
      if (oldRequirement) {
        // We can't actually delete the entity in The Graph, so we just leave it
        // The frontend should only query by offering, which will return the current list
      }
    }
  }
}

/**
 * Handle document eligibility mode set
 */
export function handleDocumentEligibilityModeSet(event: DocumentEligibilityModeSet): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (offering) {
    offering.documentEligibilityMode = event.params.mode;
    offering.save();
  }
}

/**
 * Handle custom eligibility module set
 */
export function handleCustomEligibilityModuleSet(event: CustomEligibilityModuleSet): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (offering) {
    offering.customEligibilityModule = event.params.module;
    offering.save();
  }
}

/**
 * Handle required signers set for a template (replaces all signers)
 */
export function handleRequiredSignersSet(event: RequiredSignersSet): void {
  const templateId = event.params.templateId.toHexString();
  const signers = event.params.signers;
  
  // First, mark all existing signers as inactive
  // Note: In The Graph, we can't efficiently query and update, so we rely on isActive flag
  // The UI should query by isActive=true
  
  // Add new signers
  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    const requiredSignerId = `${templateId}-${signer.toHexString()}`;
    
    let requiredSigner = RequiredSigner.load(requiredSignerId);
    if (!requiredSigner) {
      requiredSigner = new RequiredSigner(requiredSignerId);
      requiredSigner.template = templateId;
      requiredSigner.signer = signer;
      requiredSigner.addedAt = event.block.timestamp;
      requiredSigner.addedTx = event.transaction.hash;
    }
    
    requiredSigner.isActive = true;
    requiredSigner.lastUpdatedAt = event.block.timestamp;
    requiredSigner.lastUpdatedTx = event.transaction.hash;
    requiredSigner.save();
  }
}

/**
 * Handle single required signer added
 */
export function handleRequiredSignerAdded(event: RequiredSignerAdded): void {
  const templateId = event.params.templateId.toHexString();
  const signer = event.params.signer;
  const requiredSignerId = `${templateId}-${signer.toHexString()}`;
  
  let requiredSigner = RequiredSigner.load(requiredSignerId);
  if (!requiredSigner) {
    requiredSigner = new RequiredSigner(requiredSignerId);
    requiredSigner.template = templateId;
    requiredSigner.signer = signer;
    requiredSigner.addedAt = event.block.timestamp;
    requiredSigner.addedTx = event.transaction.hash;
  }
  
  requiredSigner.isActive = true;
  requiredSigner.lastUpdatedAt = event.block.timestamp;
  requiredSigner.lastUpdatedTx = event.transaction.hash;
  requiredSigner.save();
}

/**
 * Handle required signer removed
 */
export function handleRequiredSignerRemoved(event: RequiredSignerRemoved): void {
  const templateId = event.params.templateId.toHexString();
  const signer = event.params.signer;
  const requiredSignerId = `${templateId}-${signer.toHexString()}`;
  
  const requiredSigner = RequiredSigner.load(requiredSignerId);
  if (requiredSigner) {
    requiredSigner.isActive = false;
    requiredSigner.lastUpdatedAt = event.block.timestamp;
    requiredSigner.lastUpdatedTx = event.transaction.hash;
    requiredSigner.save();
  }
}

// ============ Offering Configuration Event Handlers ============

/**
 * Handle offering URI updated
 */
export function handleOfferingURIUpdated(event: OfferingURIUpdated): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    log.warning("[OfferingURIUpdated] Offering {} not found", [offeringAddress]);
    return;
  }
  
  offering.uri = event.params.newURI;
  offering.save();
  
  const activity = createActivity(
    "offering-uri-updated-" + offeringAddress + "-" + event.logIndex.toString(),
    "OFFERING_URI_UPDATED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.offering = offeringAddress;
  activity.save();
}

/**
 * Handle payment recipient updated
 */
export function handlePaymentRecipientUpdated(event: PaymentRecipientUpdated): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    log.warning("[PaymentRecipientUpdated] Offering {} not found", [offeringAddress]);
    return;
  }
  
  offering.paymentRecipient = event.params.newRecipient;
  offering.save();
  
  const activity = createActivity(
    "payment-recipient-updated-" + offeringAddress + "-" + event.logIndex.toString(),
    "PAYMENT_RECIPIENT_UPDATED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.offering = offeringAddress;
  activity.save();
}

/**
 * Handle price per token updated
 */
export function handlePricePerTokenUpdated(event: PricePerTokenUpdated): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    log.warning("[PricePerTokenUpdated] Offering {} not found", [offeringAddress]);
    return;
  }
  
  offering.pricePerToken = event.params.newPrice;
  offering.save();
  
  const activity = createActivity(
    "price-per-token-updated-" + offeringAddress + "-" + event.logIndex.toString(),
    "PRICE_PER_TOKEN_UPDATED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.offering = offeringAddress;
  activity.save();
}

/**
 * Handle deadline extended
 */
export function handleDeadlineExtended(event: DeadlineExtended): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    log.warning("[DeadlineExtended] Offering {} not found", [offeringAddress]);
    return;
  }
  
  offering.deadline = event.params.newDeadline;
  offering.save();
  
  const activity = createActivity(
    "deadline-extended-" + offeringAddress + "-" + event.logIndex.toString(),
    "DEADLINE_EXTENDED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.offering = offeringAddress;
  activity.save();
}

/**
 * Handle min/max investment updated
 */
export function handleMinMaxInvestmentUpdated(event: MinMaxInvestmentUpdated): void {
  const offeringAddress = event.address.toHexString();
  const offering = Offering.load(offeringAddress);
  
  if (!offering) {
    log.warning("[MinMaxInvestmentUpdated] Offering {} not found", [offeringAddress]);
    return;
  }
  
  offering.minInvestment = event.params.newMin;
  offering.maxAmount = event.params.newMax;
  offering.save();
  
  const activity = createActivity(
    "min-max-investment-updated-" + offeringAddress + "-" + event.logIndex.toString(),
    "MIN_MAX_INVESTMENT_UPDATED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.offering = offeringAddress;
  activity.save();
}
