import { Bytes } from "@graphprotocol/graph-ts";
import {
  KYCStatusUpdated,
  KYCRevoked,
  ClassificationAdded,
  ClassificationRevoked,
} from "../../generated/templates/OfferingDiamond/ComplianceAdmin";
import {
  InvestorKYC,
  InvestorClassification,
  Wallet,
  Offering,
} from "../../generated/schema";
import { createActivity } from "./activity";

/**
 * Handle KYC status updates from ComplianceAdminFacet
 */
export function handleKYCStatusUpdated(event: KYCStatusUpdated): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  const walletId = event.params.investor.toHexString();
  let wallet = Wallet.load(walletId);
  if (!wallet) {
    // Create placeholder wallet if it doesn't exist
    wallet = new Wallet(walletId);
    wallet.type = "EOA";
    wallet.deployer = event.params.verifiedBy;
    wallet.createdAt = event.block.timestamp;
    wallet.createdTx = event.transaction.hash;
    wallet.save();
  }

  // Create or update KYC status
  const kycId = event.address.toHexString() + "-" + walletId;
  let kycStatus = InvestorKYC.load(kycId);
  
  if (!kycStatus) {
    kycStatus = new InvestorKYC(kycId);
    kycStatus.offering = event.address.toHexString();
    kycStatus.wallet = walletId;
    kycStatus.revoked = false;
    kycStatus.revokedAt = null;
    kycStatus.revokedTx = null;
    kycStatus.revokedBy = null;
  }

  kycStatus.verified = event.params.verified;
  kycStatus.expirationTime = event.params.expirationTime;
  kycStatus.verifiedBy = event.params.verifiedBy;
  kycStatus.updatedAt = event.block.timestamp;
  kycStatus.updatedTx = event.transaction.hash;
  kycStatus.save();

  // Update wallet's KYC status reference (most recent for this offering)
  wallet.kycStatus = kycId;
  wallet.save();

  // Create activity
  const activity = createActivity(
    "kyc-updated-" + event.transaction.hash.toHexString() + "-" + event.logIndex.toString(),
    "KYC_STATUS_UPDATED",
    event.params.investor,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.kycStatus = kycId;
  activity.save();
}

/**
 * Handle KYC revocation from ComplianceAdminFacet
 */
export function handleKYCRevoked(event: KYCRevoked): void {
  const walletId = event.params.investor.toHexString();
  const kycId = event.address.toHexString() + "-" + walletId;
  
  const kycStatus = InvestorKYC.load(kycId);
  if (!kycStatus) return;

  kycStatus.revoked = true;
  kycStatus.revokedAt = event.block.timestamp;
  kycStatus.revokedTx = event.transaction.hash;
  kycStatus.revokedBy = event.params.revokedBy;
  kycStatus.save();

  // Create activity
  const activity = createActivity(
    "kyc-revoked-" + event.transaction.hash.toHexString() + "-" + event.logIndex.toString(),
    "KYC_REVOKED",
    event.params.investor,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.kycStatus = kycId;
  activity.save();
}

/**
 * Handle investor classification updates from ComplianceAdminFacet
 */
export function handleClassificationAdded(event: ClassificationAdded): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  const walletId = event.params.investor.toHexString();
  let wallet = Wallet.load(walletId);
  if (!wallet) {
    // Create placeholder wallet if it doesn't exist
    wallet = new Wallet(walletId);
    wallet.type = "EOA";
    wallet.deployer = event.params.addedBy;
    wallet.createdAt = event.block.timestamp;
    wallet.createdTx = event.transaction.hash;
    wallet.save();
  }

  // Create or update classification
  const classificationBytes = Bytes.fromByteArray(event.params.classification);
  const classificationId =
    event.address.toHexString() +
    "-" +
    walletId +
    "-" +
    classificationBytes.toHexString();

  let classification = InvestorClassification.load(classificationId);
  
  if (!classification) {
    classification = new InvestorClassification(classificationId);
    classification.offering = event.address.toHexString();
    classification.wallet = walletId;
    classification.classification = classificationBytes;
    classification.addedAt = event.block.timestamp;
    classification.addedTx = event.transaction.hash;
    classification.addedBy = event.params.addedBy;
    classification.revoked = false;
    classification.revokedAt = null;
    classification.revokedTx = null;
    classification.revokedBy = null;
    classification.save();

    // Create activity for new classification
    const activity = createActivity(
      "classification-added-" +
        event.transaction.hash.toHexString() +
        "-" +
        event.logIndex.toString(),
      "CLASSIFICATION_UPDATED",
      event.params.investor,
      event.block.timestamp,
      event.transaction.hash,
      event.block.number
    );
    activity.classification = classificationId;
    activity.save();
  }
}

/**
 * Handle investor classification revocation from ComplianceAdminFacet
 */
export function handleClassificationRevoked(event: ClassificationRevoked): void {
  const walletId = event.params.investor.toHexString();
  const classificationBytes = Bytes.fromByteArray(event.params.classification);
  const classificationId =
    event.address.toHexString() +
    "-" +
    walletId +
    "-" +
    classificationBytes.toHexString();
  
  // Load and mark the specific classification as revoked
  const classification = InvestorClassification.load(classificationId);
  if (classification) {
    classification.revoked = true;
    classification.revokedAt = event.block.timestamp;
    classification.revokedTx = event.transaction.hash;
    classification.revokedBy = event.params.revokedBy;
    classification.save();
  }
  
  // Create activity
  const activity = createActivity(
    "classification-revoked-" + event.transaction.hash.toHexString() + "-" + event.logIndex.toString(),
    "CLASSIFICATION_REVOKED",
    event.params.investor,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.classification = classificationId;
  activity.save();
}

