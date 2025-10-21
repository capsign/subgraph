import { Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Attested, Revoked, EAS } from "../../generated/EAS/EAS";
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
    
    // Try to decode the attestation data based on our unified schema
    // Schema: (address offering, bool isVerified, bytes32[] classifications)
    const decoded = ethereum.decode(
      "(address,bool,bytes32[])",
      attData.data
    );
    
    if (decoded) {
      const tuple = decoded.toTuple();
      attestation.offering = tuple[0].toAddress();
      attestation.isVerified = tuple[1].toBoolean();
      
      // Convert bytes32[] to Bytes[] for storage
      const classificationsBytes = tuple[2].toBytesArray();
      attestation.classifications = classificationsBytes;
    } else {
      // Fallback if decoding fails
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
}

export function handleRevoked(event: Revoked): void {
  const attestation = Attestation.load(event.params.uid.toHexString());
  if (!attestation) return;

  attestation.revoked = true;
  attestation.revokedAt = event.block.timestamp;
  attestation.save();
}
