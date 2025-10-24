import { Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Attested, Revoked, EAS } from "../../generated/EAS/EAS";
import { Attestation, Wallet } from "../../generated/schema";
import { createActivity } from "./activity";

// Schema UIDs for separate KYC and Classification attestations
const KYC_SCHEMA = Bytes.fromHexString("0x0be8952e2dd74ffd63a02f4d55b20b603fe7a60130cb9d70de31feb9c52fdd37");
const CLASSIFICATION_SCHEMA = Bytes.fromHexString("0x6af555d90093e6c697d8d9ab8ec3c865189c1af9320798c2ac7d5f3ea9365087");

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
  attestation.createdAt = event.block.timestamp;
  attestation.revoked = false;
  attestation.expiresAt = null;
  attestation.revokedAt = null;
  
  // Call EAS contract to get the full attestation data
  const easContract = EAS.bind(event.address);
  const attestationData = easContract.try_getAttestation(event.params.uid);
  
  if (!attestationData.reverted) {
    const attData = attestationData.value;
    attestation.data = attData.data;
    
    // Decode based on schema type
    if (event.params.schemaUID.equals(KYC_SCHEMA)) {
      // KYC schema: bool isVerified
      const decoded = ethereum.decode("bool", attData.data);
      
      if (decoded) {
        attestation.offering = null; // KYC is universal
        attestation.isVerified = decoded.toBoolean();
        attestation.classifications = new Array<Bytes>(0);
      } else {
        attestation.offering = null;
        attestation.isVerified = false;
        attestation.classifications = new Array<Bytes>(0);
      }
    } else if (event.params.schemaUID.equals(CLASSIFICATION_SCHEMA)) {
      // Classification schema: bytes32[] classifications
      const decoded = ethereum.decode("bytes32[]", attData.data);
      
      if (decoded) {
        attestation.offering = null; // Classification is universal
        attestation.isVerified = false;
        attestation.classifications = decoded.toBytesArray();
      } else {
        attestation.offering = null;
        attestation.isVerified = false;
        attestation.classifications = new Array<Bytes>(0);
      }
    } else {
      // Unknown schema - store raw data but don't decode
      attestation.offering = null;
      attestation.isVerified = false;
      attestation.classifications = new Array<Bytes>(0);
    }
  } else {
    // Fallback if contract call fails
    attestation.data = Bytes.fromHexString("0x");
    attestation.offering = null;
    attestation.isVerified = false;
    attestation.classifications = new Array<Bytes>(0);
  }
  
  attestation.save();
  
  // Create activity for attestation received
  const activity = createActivity(
    "attestation-received-" + event.params.uid.toHexString(),
    "ATTESTATION_RECEIVED",
    event.params.recipient,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.attestation = event.params.uid.toHexString();
  activity.save();
}

export function handleRevoked(event: Revoked): void {
  const attestation = Attestation.load(event.params.uid.toHexString());
  if (!attestation) return;

  attestation.revoked = true;
  attestation.revokedAt = event.block.timestamp;
  attestation.save();
}
