import { Bytes } from "@graphprotocol/graph-ts";
import { Attested, Revoked } from "../../generated/EAS/EAS";
import { Attestation, Wallet } from "../../generated/schema";

export function handleAttested(event: Attested): void {
  const attestation = new Attestation(event.params.uid.toHexString());
  
  // Ensure Wallet entity exists for the recipient
  const walletId = event.params.recipient.toHexString();
  let wallet = Wallet.load(walletId);
  if (!wallet) {
    // Create placeholder wallet if it doesn't exist yet
    // This will be properly initialized when the wallet diamond is actually deployed
    wallet = new Wallet(walletId);
    wallet.type = "EOA"; // Default fallback
    wallet.deployer = event.params.attester;
    wallet.createdAt = event.block.timestamp;
    wallet.createdTx = event.transaction.hash;
    wallet.save();
  }
  
  attestation.schema = event.params.schemaUID;
  attestation.attester = event.params.attester;
  attestation.wallet = walletId;
  attestation.data = Bytes.fromHexString("0x");
  attestation.createdAt = event.block.timestamp;
  attestation.revoked = false;
  attestation.expiresAt = null;
  attestation.revokedAt = null;
  
  // Simplified attestation - just tracks verification status
  // In production, you would decode the attestation data to get the offering address
  attestation.offering = null; // TODO: Decode from attestation data
  attestation.isVerified = true; // Simplified - existence of attestation means verified
  
  attestation.save();
}

export function handleRevoked(event: Revoked): void {
  const attestation = Attestation.load(event.params.uid.toHexString());
  if (!attestation) return;

  attestation.revoked = true;
  attestation.revokedAt = event.block.timestamp;
  attestation.save();
}
