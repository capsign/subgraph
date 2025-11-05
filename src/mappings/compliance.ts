import { Bytes } from "@graphprotocol/graph-ts";
import {
  KYCStatusUpdated,
  KYCRevoked,
  ClassificationUpdated,
  ClassificationRevoked,
} from "../../generated/templates/OfferingDiamond/ComplianceAdmin";
import {
  KYCStatus,
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
  let kycStatus = KYCStatus.load(kycId);
  
  if (!kycStatus) {
    kycStatus = new KYCStatus(kycId);
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
  
  const kycStatus = KYCStatus.load(kycId);
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
export function handleClassificationUpdated(event: ClassificationUpdated): void {
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

  // Create or update classification for each classification ID
  const classifications = event.params.classifications;
  for (let i = 0; i < classifications.length; i++) {
    const classificationBytes = Bytes.fromByteArray(classifications[i]);
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
      classification.addedBy = event.params.verifiedBy;
      classification.revoked = false;
      classification.revokedAt = null;
      classification.revokedTx = null;
      classification.revokedBy = null;
      classification.save();

      // Create activity for new classification
      const activity = createActivity(
        "classification-updated-" +
          event.transaction.hash.toHexString() +
          "-" +
          event.logIndex.toString() +
          "-" +
          i.toString(),
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
}

/**
 * Handle investor classification revocation from ComplianceAdminFacet
 */
export function handleClassificationRevoked(event: ClassificationRevoked): void {
  const walletId = event.params.investor.toHexString();
  
  // Mark all classifications for this investor in this offering as revoked
  // Note: We need to load all classifications for this investor-offering pair
  // This is a simplified approach - in production, you might want to track specific classifications
  const offering = event.address.toHexString();
  
  // Create activity
  const activity = createActivity(
    "classification-revoked-" + event.transaction.hash.toHexString() + "-" + event.logIndex.toString(),
    "CLASSIFICATION_REVOKED",
    event.params.investor,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
  
  // Note: To properly mark specific classifications as revoked, we'd need to query
  // all InvestorClassification entities for this offering-wallet pair and update them.
  // This requires additional subgraph query capabilities that aren't available in event handlers.
  // Consider adding a separate event that includes the specific classifications being revoked.
}

