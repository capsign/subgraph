import {
  WalletInitialized,
} from "../../generated/templates/WalletDiamond/WalletCore";
import {
  DocumentUploaded,
  DocumentSigned,
  DocumentCreated,
} from "../../generated/templates/WalletDiamond/WalletDocuments";
import {
  AttestationAdded,
  AttestationRevoked,
  SignerAdded,
  SignerRemoved,
  SignerRoleUpdated,
  SignerExpiryUpdated,
  SignerSuspended,
  SignerReinstated,
  UserOperationExecuted,
} from "../../generated/templates/WalletDiamond/WalletDiamond";
import {
  WalletTargetFunctionRoleSet,
} from "../../generated/templates/WalletDiamond/WalletAccessManager";
import {
  UserRoleUpdated as UserRoleUpdatedEvent,
  FunctionAccessChanged as FunctionAccessChangedEvent,
} from "../../generated/templates/WalletDiamond/AccessControl";
import {
  EquityTokenRegistered,
  EquityTokenUnregistered,
  CompanyMetricsUpdated,
  Rule701GrantRegistered,
  DisclosureProvided,
} from "../../generated/templates/WalletDiamond/WalletRule701Facet";
import { WalletDocuments } from "../../generated/templates/WalletDiamond/WalletDocuments";
import { Wallet, Owner, Diamond, Document, DocumentSignature, Attestation, TargetFunctionPermission, UserRole, UserRoleHistory, FunctionAccess, AuthorizedSigner, UserOperationExecution, Rule701Status, Rule701EquityToken, Rule701Grant } from "../../generated/schema";

// Re-export DiamondCut handler for this template
export { handleDiamondFunctionAdded, handleDiamondFunctionRemoved, handleDiamondFunctionReplaced } from "./diamond-upgrade";
import { Bytes, BigInt } from "@graphprotocol/graph-ts";
import { createActivity } from "./activity";

// Re-export entity classification handlers
export {
  handleEntityTypeSet,
  handleLEISet,
} from "./vehicles";

// Re-export vehicle config handlers
export {
  handleVehicleConfigInitialized,
  handleFundingModeSet,
  handleOpenEndedSet,
} from "./vehicles";

// Re-export capital call handlers
export {
  handleCapitalCallCreated,
  handleContributionReceived,
  handleCapitalCallCancelled,
  handleCapitalCallFunded,
  handleCommitmentCalculated,
  handleCommitmentsTransferred,
} from "./vehicles";

// Re-export token distribution handlers
export {
  handleTokenDistributionCreated,
  handleTokenDistributionClaimed,
  handleTokenDistributionCancelled,
} from "./vehicles";

// Re-export investment handlers
export {
  handleInvestmentCreated,
  handleInvestmentExecuted,
  handleValuationUpdated,
  handleInvestmentExited,
} from "./vehicles";

// Re-export DeFi integration handlers (Treasury/Yield)
export {
  handleVaultRegistered,
  handleVaultUnregistered,
  handleVaultDeposit,
  handleVaultWithdrawal,
  handleVaultValuationUpdated,
} from "./defi";

// Re-export Redemption control handlers (Gates/Suspension/Side Pockets)
export {
  handleRedemptionRequested,
  handleRedemptionProcessed,
  handleRedemptionCancelled,
  handleRedemptionsSuspended,
  handleRedemptionsResumed,
  handleSidePocketCreated,
  handleSidePocketDistributed,
  handleGatePeriodReset,
} from "./redemption";

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
    wallet.isFrozen = false;

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
    // parentDocument defaults to null
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
  
  // Handle parent document relationship (value7 is parentDocumentId)
  const parentDocId = docDetails.value.value7 as Bytes;
  if (parentDocId.toHexString() != "0x0000000000000000000000000000000000000000000000000000000000000000") {
    document.parentDocument = parentDocId.toHexString();
  }
  
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
  
  // Direct signature (not delegated)
  signature.actualSigner = signer;
  signature.onBehalfOf = null;
  signature.isDelegated = false;
  
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

export function handleDocumentCreated(event: DocumentCreated): void {
  const walletAddress = event.address;
  const documentId = event.params.documentId.toHexString();

  // Create document entity
  let document = new Document(documentId);
  document.wallet = walletAddress.toHexString();
  document.creator = event.params.creator;
  document.createdAt = event.block.timestamp;
  document.createdTx = event.transaction.hash;
  document.title = event.params.title;
  document.requiredSigners = event.params.requiredSigners.map<Bytes>((addr) => addr as Bytes);
  document.category = event.params.category;
  document.contentHash = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
  document.storageURI = "";
  
  // Fetch full details to get parentDocumentId
  const walletContract = WalletDocuments.bind(walletAddress);
  const docDetails = walletContract.try_getDocument(event.params.documentId);
  if (!docDetails.reverted) {
    document.contentHash = docDetails.value.value0;
    document.storageURI = docDetails.value.value1;
    const parentDocId = docDetails.value.value7 as Bytes;
    if (parentDocId.toHexString() != "0x0000000000000000000000000000000000000000000000000000000000000000") {
      document.parentDocument = parentDocId.toHexString();
    }
  }
  
  document.save();
  
  // Create activity
  const activity = createActivity(
    "document-created-" + documentId,
    "DOCUMENT_CREATED",
    event.params.creator,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.document = documentId;
  activity.save();
}

export function handleAttestationAdded(event: AttestationAdded): void {
  const walletAddress = event.address.toHexString();
  const attestationId = event.params.attestationUID.toHexString();
  
  // Create attestation entity
  const attestation = new Attestation(attestationId);
  attestation.wallet = walletAddress;
  attestation.schema = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000"); // Default, would need to fetch from EAS
  attestation.attester = Bytes.fromHexString("0x0000000000000000000000000000000000000000"); // Default, would need to fetch from EAS
  attestation.data = Bytes.fromHexString("0x"); // Default
  attestation.createdAt = event.params.timestamp;
  attestation.expiresAt = null;
  attestation.revoked = false;
  attestation.revokedAt = null;
  attestation.save();
}

export function handleAttestationRevoked(event: AttestationRevoked): void {
  const attestationId = event.params.attestationUID.toHexString();
  
  // Update attestation entity
  const attestation = Attestation.load(attestationId);
  if (attestation) {
    attestation.revoked = true;
    attestation.revokedAt = event.params.timestamp;
    attestation.save();
  }
}

/**
 * Handle WalletTargetFunctionRoleSet events from WalletAccessManagerFacet
 * Event: WalletTargetFunctionRoleSet(address indexed target, bytes4 indexed selector, uint8 roleId)
 * 
 * Tracks permission configurations set by wallet diamonds for managed contracts
 */
export function handleWalletTargetFunctionRoleSet(event: WalletTargetFunctionRoleSet): void {
  const managerWallet = event.address;
  const targetContract = event.params.target;
  const functionSelector = event.params.selector;
  const requiredRole = event.params.roleId;

  // Create unique ID for this permission
  const permissionId = `${managerWallet.toHexString()}-${targetContract.toHexString()}-${functionSelector.toHexString()}`;

  let permission = TargetFunctionPermission.load(permissionId);
  if (!permission) {
    permission = new TargetFunctionPermission(permissionId);
    permission.managerWallet = managerWallet.toHexString();
    permission.targetContract = targetContract;
    permission.functionSelector = functionSelector;
    permission.setAt = event.block.timestamp;
    permission.setTx = event.transaction.hash;
  }

  permission.requiredRole = requiredRole;
  permission.lastUpdatedAt = event.block.timestamp;
  permission.lastUpdatedTx = event.transaction.hash;

  permission.save();
}

/**
 * Handle UserRoleUpdated events from wallet diamonds
 * Event: UserRoleUpdated(address indexed user, uint8 indexed role, bool enabled)
 * 
 * Tracks role grants/revocations for individual wallets on entity wallets
 */
export function handleUserRoleUpdated(event: UserRoleUpdatedEvent): void {
  const walletAddress = event.address.toHexString();
  const userAddress = event.params.user.toHexString();
  const role = event.params.role;
  const enabled = event.params.enabled;

  // Ensure Diamond entity exists for this wallet
  let diamond = Diamond.load(walletAddress);
  if (!diamond) {
    // Create minimal diamond entry if it doesn't exist
    diamond = new Diamond(walletAddress);
    diamond.diamondType = "WALLET";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    diamond.save();
  }

  // Create or update UserRole entity
  const userRoleId = `${walletAddress}-${userAddress}-${role}`;
  let userRole = UserRole.load(userRoleId);

  if (!userRole) {
    userRole = new UserRole(userRoleId);
    userRole.diamond = walletAddress;
    userRole.user = event.params.user;
    userRole.role = role;
    userRole.grantedAt = event.block.timestamp;
    userRole.grantedTx = event.transaction.hash;
  }

  userRole.enabled = enabled;
  userRole.lastUpdatedAt = event.block.timestamp;
  userRole.lastUpdatedTx = event.transaction.hash;
  
  userRole.save();

  // Create history entry for this role change
  const historyId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  const history = new UserRoleHistory(historyId);
  history.diamond = walletAddress;
  history.user = event.params.user;
  history.role = role;
  history.enabled = enabled;
  history.changedBy = event.transaction.from;
  history.timestamp = event.block.timestamp;
  history.tx = event.transaction.hash;
  history.blockNumber = event.block.number;
  history.save();
}

/**
 * Handle FunctionAccessChanged event for wallet diamonds
 */
export function handleWalletFunctionAccessChanged(event: FunctionAccessChangedEvent): void {
  const diamondAddress = event.address.toHexString();
  const functionSelector = event.params.functionSig;
  const role = event.params.role;
  const hasAccess = event.params.enabled;
  
  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Create diamond entry if it doesn't exist
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "WALLET";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
    diamond.save();
  }
  
  // Create or update FunctionAccess entity
  const functionAccessId = diamondAddress + "-" + functionSelector.toHexString() + "-" + role.toString();
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

// ============ AUTHORIZED SIGNER HANDLERS ============

/**
 * Handle SignerAdded event
 * Event: SignerAdded(bytes32 indexed signerId, uint8 indexed signerType, uint8 roleId, uint48 validUntil, string label)
 */
export function handleSignerAdded(event: SignerAdded): void {
  const walletAddress = event.address.toHexString();
  const signerId = event.params.signerId.toHexString();
  const entityId = `${walletAddress}-${signerId}`;

  let signer = new AuthorizedSigner(entityId);
  signer.wallet = walletAddress;
  signer.signerId = event.params.signerId;
  signer.signerType = event.params.signerType === 0 ? "EOA" : "Passkey";
  signer.roleId = event.params.roleId;
  signer.validUntil = event.params.validUntil;
  signer.isActive = true;
  signer.label = event.params.label;
  signer.addedAt = event.block.timestamp;
  signer.addedTx = event.transaction.hash;
  signer.removedAt = null;
  signer.removedTx = null;
  
  // Note: address and publicKey fields would need to be fetched from contract
  // For now, we leave them null and could add a contract call if needed
  signer.address = null;
  signer.publicKeyX = null;
  signer.publicKeyY = null;
  
  signer.save();

  // Create activity
  const activity = createActivity(
    "signer-added-" + entityId,
    "SIGNER_ADDED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle SignerRemoved event
 * Event: SignerRemoved(bytes32 indexed signerId, address indexed removedBy)
 */
export function handleSignerRemoved(event: SignerRemoved): void {
  const walletAddress = event.address.toHexString();
  const signerId = event.params.signerId.toHexString();
  const entityId = `${walletAddress}-${signerId}`;

  let signer = AuthorizedSigner.load(entityId);
  if (signer) {
    signer.isActive = false;
    signer.removedAt = event.block.timestamp;
    signer.removedTx = event.transaction.hash;
    signer.save();
  }

  // Create activity
  const activity = createActivity(
    "signer-removed-" + event.transaction.hash.toHexString() + "-" + event.logIndex.toString(),
    "SIGNER_REMOVED",
    event.params.removedBy,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}

/**
 * Handle SignerRoleUpdated event
 * Event: SignerRoleUpdated(bytes32 indexed signerId, uint8 oldRole, uint8 newRole)
 */
export function handleSignerRoleUpdated(event: SignerRoleUpdated): void {
  const walletAddress = event.address.toHexString();
  const signerId = event.params.signerId.toHexString();
  const entityId = `${walletAddress}-${signerId}`;

  let signer = AuthorizedSigner.load(entityId);
  if (signer) {
    signer.roleId = event.params.newRole;
    signer.save();
  }
}

/**
 * Handle SignerExpiryUpdated event
 * Event: SignerExpiryUpdated(bytes32 indexed signerId, uint48 oldExpiry, uint48 newExpiry)
 */
export function handleSignerExpiryUpdated(event: SignerExpiryUpdated): void {
  const walletAddress = event.address.toHexString();
  const signerId = event.params.signerId.toHexString();
  const entityId = `${walletAddress}-${signerId}`;

  let signer = AuthorizedSigner.load(entityId);
  if (signer) {
    signer.validUntil = event.params.newExpiry;
    signer.save();
  }
}

/**
 * Handle SignerSuspended event
 * Event: SignerSuspended(bytes32 indexed signerId, address indexed suspendedBy)
 */
export function handleSignerSuspended(event: SignerSuspended): void {
  const walletAddress = event.address.toHexString();
  const signerId = event.params.signerId.toHexString();
  const entityId = `${walletAddress}-${signerId}`;

  let signer = AuthorizedSigner.load(entityId);
  if (signer) {
    signer.isActive = false;
    signer.save();
  }
}

/**
 * Handle SignerReinstated event
 * Event: SignerReinstated(bytes32 indexed signerId, address indexed reinstatedBy)
 */
export function handleSignerReinstated(event: SignerReinstated): void {
  const walletAddress = event.address.toHexString();
  const signerId = event.params.signerId.toHexString();
  const entityId = `${walletAddress}-${signerId}`;

  let signer = AuthorizedSigner.load(entityId);
  if (signer) {
    signer.isActive = true;
    signer.save();
  }
}

/**
 * Handle UserOperationExecuted event (audit trail)
 * Event: UserOperationExecuted(bytes32 indexed userOpHash, bytes32 indexed signerId, uint8 signerRole, address target, bytes4 selector, bool success)
 */
export function handleUserOperationExecuted(event: UserOperationExecuted): void {
  const walletAddress = event.address.toHexString();
  const executionId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;

  let execution = new UserOperationExecution(executionId);
  execution.wallet = walletAddress;
  execution.userOpHash = event.params.userOpHash;
  execution.signerId = event.params.signerId;
  execution.signerRole = event.params.signerRole;
  execution.target = event.params.target;
  execution.functionSelector = event.params.selector;
  execution.success = event.params.success;
  execution.timestamp = event.block.timestamp;
  execution.tx = event.transaction.hash;
  execution.blockNumber = event.block.number;
  execution.logIndex = event.logIndex;

  // Link to signer entity if not an owner (owner signerId is a special constant)
  const ownerSignerId = Bytes.fromHexString("0x" + "d19f51c8a3f26a67be3d96ee6c9f1b0e9f56d8a6c5b8e1f4a7d0c3b6e9f2a5d8"); // keccak256("OWNER")
  if (event.params.signerId.notEqual(ownerSignerId)) {
    const signerEntityId = `${walletAddress}-${event.params.signerId.toHexString()}`;
    execution.signer = signerEntityId;
  }

  execution.save();
}

// Re-export paymaster handlers from paymaster.ts
export {
  handlePaymasterEnabled,
  handleDailyBudgetSet,
  handlePaymasterAddressSet,
  handleRolePolicySet,
  handleSpendingRecorded,
} from "./paymaster";

// Re-export native transfer handlers
export { handleTransactionExecuted, handleEtherReceived } from "./native-transfers";

// ============ RULE 701 HANDLERS ============

/**
 * Handle EquityTokenRegistered event
 * Event: EquityTokenRegistered(address indexed tokenAddress, string tokenClass)
 */
export function handleEquityTokenRegistered(event: EquityTokenRegistered): void {
  const walletAddress = event.address.toHexString();
  const tokenAddress = event.params.tokenAddress.toHexString();
  const id = `${walletAddress}-${tokenAddress}`;

  // Initialize Rule701Status if first equity token registration
  let status = Rule701Status.load(walletAddress);
  if (!status) {
    status = new Rule701Status(walletAddress);
    status.companyWallet = walletAddress;
    status.totalAssets = BigInt.fromI32(0);
    status.assetReportHash = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
    status.aggregate12MonthValue = BigInt.fromI32(0);
    status.currentLimit = BigInt.fromI64(1000000000000); // $1M minimum in 6 decimals
    status.remainingCapacity = status.currentLimit;
    status.disclosureRequired = false;
    status.lastUpdatedAt = event.block.timestamp;
    status.lastUpdatedTx = event.transaction.hash;
    status.save();
  }

  let equityToken = new Rule701EquityToken(id);
  equityToken.rule701Status = walletAddress;
  equityToken.token = tokenAddress;
  equityToken.registeredAt = event.block.timestamp;
  equityToken.registeredTx = event.transaction.hash;

  equityToken.save();
}

/**
 * Handle EquityTokenUnregistered event
 * Event: EquityTokenUnregistered(address indexed token)
 */
export function handleEquityTokenUnregistered(event: EquityTokenUnregistered): void {
  // Graph Protocol doesn't support entity deletion
  // Simply logged for audit
}

/**
 * Handle CompanyMetricsUpdated event
 * Event: CompanyMetricsUpdated(uint256 totalAssets, uint256 asOfDate, bytes32 reportHash)
 */
export function handleCompanyMetricsUpdated(event: CompanyMetricsUpdated): void {
  const walletAddress = event.address.toHexString();

  let status = Rule701Status.load(walletAddress);
  if (!status) {
    return;
  }

  status.totalAssets = event.params.totalAssets;
  status.assetReportHash = event.params.reportHash;

  // Recalculate limit: max($1M, 15% of assets)
  const fifteenPercent = event.params.totalAssets.times(BigInt.fromI32(15)).div(BigInt.fromI32(100));
  const oneMillionUSDC = BigInt.fromI64(1000000000000); // $1M in 6 decimals
  status.currentLimit = fifteenPercent.gt(oneMillionUSDC) ? fifteenPercent : oneMillionUSDC;
  status.remainingCapacity = status.currentLimit.minus(status.aggregate12MonthValue);
  status.lastUpdatedAt = event.block.timestamp;
  status.lastUpdatedTx = event.transaction.hash;

  status.save();
}

/**
 * Handle Rule701GrantRegistered event
 * Event: Rule701GrantRegistered(uint256 indexed grantId, address indexed tokenAddress, address indexed planAddress, address recipient, uint256 grantValue, string grantType, uint256 newAggregateValue)
 */
export function handleRule701GrantRegistered(event: Rule701GrantRegistered): void {
  const walletAddress = event.address.toHexString();
  const grantId = event.params.grantId;
  const id = `${walletAddress}-${grantId.toString()}`;

  let grant = new Rule701Grant(id);
  grant.rule701Status = walletAddress;
  grant.internalGrantId = grantId;
  grant.equityToken = event.params.tokenAddress.toHexString();
  grant.grantValue = event.params.grantValue;
  grant.grantType = event.params.grantType;
  grant.recipient = event.params.recipient;
  grant.sourcePlan = event.params.planAddress;
  grant.grantDate = event.block.timestamp; // Use block timestamp since grantDate is not in event
  grant.grantTx = event.transaction.hash;

  grant.save();

  // Update aggregate value from event (already calculated on-chain)
  let status = Rule701Status.load(walletAddress);
  if (status) {
    status.aggregate12MonthValue = event.params.newAggregateValue;
    status.remainingCapacity = status.currentLimit.minus(status.aggregate12MonthValue);

    // Check if disclosure is required ($5M threshold)
    const fiveMillionUSDC = BigInt.fromI64(5000000000000); // $5M in 6 decimals
    status.disclosureRequired = status.aggregate12MonthValue.gt(fiveMillionUSDC);
    status.lastUpdatedAt = event.block.timestamp;
    status.lastUpdatedTx = event.transaction.hash;

    status.save();
  }
}

/**
 * Handle DisclosureProvided event
 * Event: DisclosureProvided(bytes32 disclosureHash)
 */
export function handleDisclosureProvided(event: DisclosureProvided): void {
  const walletAddress = event.address.toHexString();

  let status = Rule701Status.load(walletAddress);
  if (!status) {
    return;
  }

  status.disclosureHash = event.params.disclosureHash;
  status.disclosureProvidedAt = event.block.timestamp;
  status.lastUpdatedAt = event.block.timestamp;
  status.lastUpdatedTx = event.transaction.hash;

  status.save();
}

// Re-export governance handlers
export {
  handleProposalCreated,
  handleProposalCanceled,
  handleVoteCast,
  handleProposalQueued,
  handleProposalExecuted,
  handleProposalVetoed,
  handleProposalTypeRegistered,
  handleProposalTypeUpdated,
  handleSecondTierProposalCreated,
} from "./governance";

// Re-export asset disposal handler
export { handleAssetDisposed, handleWashSaleDetected } from "./asset-disposal";

// Re-export income receivable handlers
export { handleIncomeReceived } from "./income-receivable";

// Re-export lien handlers
export {
  handleLienGranted,
  handleLienReleased,
  handleLienRevoked,
  handleWalletFrozen,
  handleWalletUnfrozen,
  handleAssetsSeized,
} from "./liens";
