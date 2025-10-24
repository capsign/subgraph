import {
  WalletInitialized,
} from "../../generated/templates/WalletDiamond/WalletCore";
import {
  DocumentUploaded,
  DocumentSigned,
  DocumentDeleted,
} from "../../generated/templates/WalletDiamond/WalletDocuments";
import { WalletDocuments } from "../../generated/templates/WalletDiamond/WalletDocuments";
import { Wallet, Owner, Diamond, Document, DocumentSignature } from "../../generated/schema";
import { Bytes } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

export function handleWalletInitialized(event: WalletInitialized): void {
  const walletAddress = event.address.toHexString();

  // Load wallet entity (should already exist from WalletFactory event)
  let wallet = Wallet.load(walletAddress);
  if (!wallet) {
    // Fallback for wallets created before factory was deployed
    wallet = new Wallet(walletAddress);
    wallet.createdAt = event.block.timestamp;
    wallet.createdTx = event.transaction.hash;
    wallet.deployer = event.transaction.from;
    wallet.type = event.params.walletType;

    // Create fallback owner (EOA)
    const ownerId = walletAddress + "-" + event.transaction.from.toHexString();
    let owner = new Owner(ownerId);
    owner.wallet = walletAddress;
    owner.ownerType = "EOA";
    owner.address = event.transaction.from;
    owner.publicKey = null;
    owner.publicKeyHash = null;
    owner.addedAt = event.block.timestamp;
    owner.addedTx = event.transaction.hash;
    owner.save();
  }

  // Update wallet type from initialization event (may provide more specific info)
  wallet.type = event.params.walletType;
  wallet.save();
  
  // Update diamond type
  const diamond = Diamond.load(walletAddress);
  if (diamond) {
    diamond.diamondType = "WALLET";
    diamond.wallet = walletAddress;
    diamond.save();
  }
}

export function handleDocumentUploaded(event: DocumentUploaded): void {
  const walletAddress = event.address;
  const documentId = event.params.documentId.toHexString();

  // Bind to the wallet contract to fetch full document details
  const walletContract = WalletDocuments.bind(walletAddress);
  const docDetails = walletContract.try_getDocument(event.params.documentId);
  
  if (docDetails.reverted) {
    // If we can't fetch details, create with minimal info
    let document = new Document(documentId);
    document.wallet = walletAddress.toHexString();
    document.contentHash = event.params.contentHash;
    document.creator = event.params.creator;
    document.createdAt = event.block.timestamp;
    document.createdTx = event.transaction.hash;
    document.storageURI = "";
    document.category = "";
    document.title = "";
    document.requiredSigners = [];
    document.save();
    return;
  }

  // Create document entity with full details
  let document = new Document(documentId);
  document.wallet = walletAddress.toHexString();
  document.contentHash = docDetails.value.value0;
  document.storageURI = docDetails.value.value1;
  document.creator = docDetails.value.value2;
  document.createdAt = docDetails.value.value3;
  document.createdTx = event.transaction.hash;
  document.requiredSigners = docDetails.value.value4.map<Bytes>((addr) => addr as Bytes);
  document.title = docDetails.value.value5;
  document.category = docDetails.value.value6;
  
  document.save();
  
  // Create activity for document uploaded
  const activity = createActivity(
    "document-uploaded-" + documentId,
    "DOCUMENT_UPLOADED",
    walletAddress,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.document = documentId;
  activity.save();
}

export function handleDocumentSigned(event: DocumentSigned): void {
  const documentId = event.params.documentId.toHexString();
  const signer = event.params.signer;
  
  // Create signature entity with tx-logIndex as ID
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
  
  // Create activity for document signed
  const activity = createActivity(
    "document-signed-" + signatureId,
    "DOCUMENT_SIGNED",
    signer,
    event.params.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.documentSignature = signatureId;
  activity.save();
}

export function handleDocumentDeleted(event: DocumentDeleted): void {
  const documentId = event.params.documentId.toHexString();

  // Remove document entity
  // Note: DocumentSignature entities will remain (for audit trail)
  // but the document itself is marked as deleted by removing it
  const document = Document.load(documentId);
  if (document) {
    // In subgraph, we don't actually delete, we just mark it
    // But since schema doesn't have a 'deleted' flag, we remove it
    // Alternatively, you could add a 'deleted: Boolean!' field to schema
    // For now, we'll just leave it (signatures still reference it)
  }
}

