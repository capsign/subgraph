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
} from "../../generated/templates/OfferingDiamond/OfferingDiamond";
import {
  CustomTermsSet,
} from "../../generated/templates/OfferingDiamond/OfferingTerms";
import { Offering, Investment, Diamond, DocumentSignature, Document, InvestmentLookup, SafePreApprovedTerms, OffchainInvestment, UserRole, FunctionAccess } from "../../generated/schema";
import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

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
  ensureOffchainFieldsInitialized(offering);
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
    ensureOffchainFieldsInitialized(offering);
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
  ensureOffchainFieldsInitialized(offering);
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
  
  // Check if this is the investor's first confirmed investment for this offering
  const investorId = offchainInvestment.investor;
  let hasOtherInvestments = false;
  
  // Check onchain investments for this offering
  const onchainInvestments = offering.investments.load();
  for (let i = 0; i < onchainInvestments.length; i++) {
    if (onchainInvestments[i].investor == investorId &&
        (onchainInvestments[i].status == "ACCEPTED" || onchainInvestments[i].status == "COUNTERSIGNED")) {
      hasOtherInvestments = true;
      break;
    }
  }
  
  // Check offchain investments for this offering (excluding this one)
  if (!hasOtherInvestments) {
    const offchainInvestments = offering.offchainInvestments.load();
    for (let i = 0; i < offchainInvestments.length; i++) {
      if (offchainInvestments[i].investor == investorId &&
          offchainInvestments[i].status == "CONFIRMED" &&
          offchainInvestments[i].id != compositeId) {
        hasOtherInvestments = true;
        break;
      }
    }
  }
  
  // Increment investor count if this is their first confirmed investment for this offering
  if (!hasOtherInvestments) {
    offering.investorCount = offering.investorCount.plus(BigInt.fromI32(1));
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
  const functionSelector = event.params.selector;
  const role = event.params.role;
  const hasAccess = event.params.hasAccess;
  
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
