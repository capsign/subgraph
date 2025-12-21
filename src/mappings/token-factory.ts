import { 
  TokenCreated,
  PaymentModuleInitialized,
  PaymentTokenConfigured,
  PaymentCollected,
  FeeRecipientUpdated,
  PaymentsStatusChanged,
  UserRoleUpdated
} from "../../generated/TokenFactory/TokenFactory";
import { Diamond, ShareClass, Safe, PromissoryNote, UserRole } from "../../generated/schema";
import { TokenDiamond } from "../../generated/templates";
import { TokenMetadata } from "../../generated/TokenFactory/TokenMetadata";
import { DiamondLoupe } from "../../generated/TokenFactory/DiamondLoupe";
import { ERC20 } from "../../generated/TokenFactory/ERC20";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  FactoryPaymentConfig,
  FactoryPaymentTokenConfig,
  PaymentToken,
  FactoryPayment,
} from "../../generated/schema";

/**
 * Handle token creation from TokenFactory
 * Detects token type by checking installed facets and creates appropriate entity
 */
export function handleTokenCreated(event: TokenCreated): void {
  const tokenAddress = event.params.tokenDiamond.toHexString();

  // Create or update Diamond entity
  let diamond = Diamond.load(tokenAddress);
  if (!diamond) {
    diamond = new Diamond(tokenAddress);
    diamond.creator = event.params.admin;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
  }
  diamond.diamondType = "TOKEN";
  diamond.save();

  // Detect token type by checking installed facets
  const tokenType = detectTokenType(event.params.tokenDiamond);

  // Read common metadata
  let tokenContract = TokenMetadata.bind(event.params.tokenDiamond);
  let decimalsResult = tokenContract.try_decimals();
  const decimals = decimalsResult.reverted ? 18 : decimalsResult.value;

  if (tokenType === "Safe") {
    // Create Safe entity
    let safe = new Safe(tokenAddress);
    safe.name = event.params.name;
    safe.symbol = event.params.symbol;
    safe.decimals = decimals;
    safe.totalSupply = BigInt.fromI32(0);
    safe.creator = event.params.admin; // Kept for backwards compatibility
    safe.admin = event.params.admin;
    safe.deployer = event.params.admin;
    safe.createdAt = event.block.timestamp;
    safe.createdTx = event.transaction.hash;
    safe.assetType = "Safe";
    
    // Initialize compliance (AssemblyScript empty array)
    safe.complianceConditions = new Array<Bytes>();
    
    // Initialize admin state
    safe.paused = false;
    safe.frozenAccounts = new Array<Bytes>();
    safe.frozenLots = new Array<Bytes>();
    safe.retired = false;
    safe.retiredAt = null;
    safe.transferController = null;
    safe.hasTransferConditions = false;
    
    // Initialize SAFE-specific fields with defaults
    // These will be updated when DefaultTermsSet event is emitted
    safe.defaultValuationCap = BigInt.fromI32(0);
    safe.defaultDiscountRate = 0;
    safe.defaultTargetEquityToken = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    safe.defaultProRataRight = false;
    safe.defaultHasMFN = false;
    safe.totalInvested = BigInt.fromI32(0);
    safe.totalConverted = BigInt.fromI32(0);
    safe.lotsConverted = 0;
    
    safe.save();
    
    // Link token to diamond
    diamond.token = tokenAddress;
    diamond.save();
  } else if (tokenType === "PromissoryNote") {
    // Create PromissoryNote entity
    let note = new PromissoryNote(tokenAddress);
    note.name = event.params.name;
    note.symbol = event.params.symbol;
    note.decimals = decimals;
    note.totalSupply = BigInt.fromI32(0);
    note.creator = event.params.admin;
    note.admin = event.params.admin;
    note.deployer = event.params.admin;
    note.createdAt = event.block.timestamp;
    note.createdTx = event.transaction.hash;
    note.assetType = "PromissoryNote";
    
    // Initialize compliance
    note.complianceConditions = new Array<Bytes>();
    
    // Initialize admin state
    note.paused = false;
    note.frozenAccounts = new Array<Bytes>();
    note.frozenLots = new Array<Bytes>();
    note.retired = false;
    note.retiredAt = null;
    note.transferController = null;
    note.hasTransferConditions = false;
    
    // Initialize PromissoryNote-specific fields with defaults
    // These will be updated when debt terms are set
    note.principalAmount = BigInt.fromI32(0);
    note.interestRate = 0;
    note.issuanceDate = event.block.timestamp;
    note.maturityDate = event.block.timestamp;
    note.paymentCurrency = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    note.paymentType = "BULLET";
    note.isSubordinated = false;
    note.debtor = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    note.creditor = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    note.totalPaid = BigInt.fromI32(0);
    note.interestPaid = BigInt.fromI32(0);
    note.principalPaid = BigInt.fromI32(0);
    note.outstandingBalance = BigInt.fromI32(0);
    note.isMatured = false;
    note.isDefaulted = false;
    note.isPaidOff = false;
    
    note.save();
    
    // Link token to diamond
    diamond.token = tokenAddress;
    diamond.save();
  } else {
    // Create ShareClass entity (default for equity tokens)
    let shareClass = new ShareClass(tokenAddress);
    shareClass.name = event.params.name;
    shareClass.symbol = event.params.symbol;
    shareClass.admin = event.params.admin;
    shareClass.createdAt = event.block.timestamp;
    shareClass.createdTx = event.transaction.hash;
    shareClass.decimals = decimals;
  shareClass.totalSupply = BigInt.fromI32(0);
  shareClass.assetType = "ShareClass";
  
  // Initialize compliance
    shareClass.complianceConditions = new Array<Bytes>();
  
  // Initialize admin state
  shareClass.paused = false;
    shareClass.frozenAccounts = new Array<Bytes>();
    shareClass.frozenLots = new Array<Bytes>();
    shareClass.retired = false;
    shareClass.retiredAt = null;
  shareClass.transferController = null;
  shareClass.hasTransferConditions = false;
  
  // Initialize ShareClass-specific fields
    shareClass.maxSupply = BigInt.fromI32(0); // 0 = unlimited
  shareClass.splitNum = BigInt.fromI32(1);
  shareClass.splitDen = BigInt.fromI32(1);
  shareClass.divNum = BigInt.fromI32(1);
  shareClass.divDen = BigInt.fromI32(1);
  shareClass.totalSplits = 0;
  shareClass.totalDividends = 0;
  shareClass.isPublic = false;

  shareClass.save();

  // Link token to diamond
  diamond.token = tokenAddress;
  diamond.save();
  }

  // Start tracking token diamond for events
  TokenDiamond.create(event.params.tokenDiamond);
}

/**
 * Detect token type by checking which facets are installed
 * @param tokenAddress - Address of the token diamond
 * @returns Token type string ("Safe", "PromissoryNote", or "ShareClass")
 */
function detectTokenType(tokenAddress: Address): string {
  // Create a DiamondLoupe binding to query facets
  let loupe = DiamondLoupe.bind(tokenAddress);
  
  // Get all facet addresses
  let facetsResult = loupe.try_facets();
  if (facetsResult.reverted) {
    // If we can't query facets, default to ShareClass
    return "ShareClass";
  }
  
  let facets = facetsResult.value;
  
  // Check each facet for type-specific function selectors
  // TokenSAFEFacet implements: defaultTerms(): 0x43e30c7f
  const SAFE_FACET_SELECTOR = Bytes.fromHexString("0x43e30c7f");
  // TokenDebtFacet implements: getDebtRecord(uint256): 0x5f3d80bb
  const DEBT_FACET_SELECTOR = Bytes.fromHexString("0x5f3d80bb");
  
  for (let i = 0; i < facets.length; i++) {
    let facetSelectors = facets[i].functionSelectors;
    for (let j = 0; j < facetSelectors.length; j++) {
      // Check for SAFE facet
      if (facetSelectors[j].equals(SAFE_FACET_SELECTOR)) {
        return "Safe";
      }
      // Check for Debt facet (Promissory Note)
      if (facetSelectors[j].equals(DEBT_FACET_SELECTOR)) {
        return "PromissoryNote";
      }
    }
  }
  
  // Default to ShareClass if no specific facet found
  return "ShareClass";
}

// Helper to get or create factory payment config
function getOrCreateFactoryPaymentConfig(
  factoryAddress: Address,
  timestamp: BigInt,
  tx: Bytes
): FactoryPaymentConfig {
  let id = factoryAddress.toHexString();
  let config = FactoryPaymentConfig.load(id);

  if (!config) {
    config = new FactoryPaymentConfig(id);
    config.factory = factoryAddress;
    config.factoryType = "TOKEN";
    config.feeRecipient = Address.fromString("0x0000000000000000000000000000000000000000");
    config.paymentsEnabled = true;
    config.deploymentCount = BigInt.zero();
    config.createdAt = timestamp;
    config.createdTx = tx;
    config.save();
  }

  return config;
}

// Payment event handlers for TokenFactory
export function handlePaymentModuleInitialized(event: PaymentModuleInitialized): void {
  let factoryAddress = event.address;

  let config = getOrCreateFactoryPaymentConfig(
    factoryAddress,
    event.block.timestamp,
    event.transaction.hash
  );

  config.feeRecipient = event.params.feeRecipient;
  config.paymentsEnabled = true;
  config.save();
}

export function handlePaymentTokenConfigured(event: PaymentTokenConfigured): void {
  let factoryAddress = event.address;
  let tokenAddress = event.params.paymentToken;
  let id = factoryAddress
    .toHexString()
    .concat("-")
    .concat(tokenAddress.toHexString());

  let factoryConfig = getOrCreateFactoryPaymentConfig(
    factoryAddress,
    event.block.timestamp,
    event.transaction.hash
  );

  // Get or create the PaymentToken entity
  let paymentToken = getOrCreatePaymentToken(
    tokenAddress,
    event.block.timestamp,
    event.transaction.hash
  );

  // Get or create the factory-specific config
  let tokenConfig = FactoryPaymentTokenConfig.load(id);
  if (!tokenConfig) {
    tokenConfig = new FactoryPaymentTokenConfig(id);
    tokenConfig.factoryConfig = factoryConfig.id;
    tokenConfig.paymentToken = paymentToken.id;
    tokenConfig.totalCollected = BigInt.zero();
    tokenConfig.configuredAt = event.block.timestamp;
    tokenConfig.configuredTx = event.transaction.hash;
  }

  tokenConfig.feeAmount = event.params.feeAmount;
  tokenConfig.isActive = event.params.isActive;
  tokenConfig.lastUpdatedAt = event.block.timestamp;
  tokenConfig.lastUpdatedTx = event.transaction.hash;
  tokenConfig.save();
}

// Helper to get or create PaymentToken entity
function getOrCreatePaymentToken(
  tokenAddress: Address,
  timestamp: BigInt,
  tx: Bytes
): PaymentToken {
  let id = tokenAddress.toHexString();
  let token = PaymentToken.load(id);

  if (!token) {
    token = new PaymentToken(id);
    token.address = tokenAddress;
    token.createdAt = timestamp;
    token.createdTx = tx;

    // Fetch ERC20 metadata
    // Handle zero address (ETH) as special case
    const zeroAddress = Address.fromString("0x0000000000000000000000000000000000000000");
    if (tokenAddress.equals(zeroAddress)) {
      token.symbol = "ETH";
      token.decimals = 18;
      token.name = "Ether";
    } else {
      let tokenContract = ERC20.bind(tokenAddress);
      
      // Try fetching symbol
      let symbolResult = tokenContract.try_symbol();
      token.symbol = symbolResult.reverted ? "UNKNOWN" : symbolResult.value;
      
      // Try fetching decimals
      let decimalsResult = tokenContract.try_decimals();
      token.decimals = decimalsResult.reverted ? 18 : decimalsResult.value;
      
      // Try fetching name
      let nameResult = tokenContract.try_name();
      token.name = nameResult.reverted ? "Unknown Token" : nameResult.value;
    }
    
    token.save();
  }

  return token;
}

export function handlePaymentCollected(event: PaymentCollected): void {
  let factoryAddress = event.address;
  let id = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.logIndex.toString());

  let factoryConfig = getOrCreateFactoryPaymentConfig(
    factoryAddress,
    event.block.timestamp,
    event.transaction.hash
  );

  // Create payment record
  let payment = new FactoryPayment(id);
  payment.factory = factoryConfig.id;
  payment.payer = event.params.payer;
  payment.paymentToken = event.params.paymentToken;
  payment.amount = event.params.amount;
  payment.deploymentType = event.params.deploymentType;
  payment.timestamp = event.block.timestamp;
  payment.tx = event.transaction.hash;
  payment.blockNumber = event.block.number;
  payment.save();

  // Update factory config deployment count
  factoryConfig.deploymentCount = factoryConfig.deploymentCount.plus(
    BigInt.fromI32(1)
  );
  factoryConfig.save();

  // Update payment token config total collected
  let tokenConfigId = factoryAddress
    .toHexString()
    .concat("-")
    .concat(event.params.paymentToken.toHexString());
  let tokenConfig = FactoryPaymentTokenConfig.load(tokenConfigId);
  if (tokenConfig) {
    tokenConfig.totalCollected = tokenConfig.totalCollected.plus(
      event.params.amount
    );
    tokenConfig.save();
  }
}

export function handleFeeRecipientUpdated(event: FeeRecipientUpdated): void {
  let factoryAddress = event.address;

  let factoryConfig = getOrCreateFactoryPaymentConfig(
    factoryAddress,
    event.block.timestamp,
    event.transaction.hash
  );

  factoryConfig.feeRecipient = event.params.feeRecipient;
  factoryConfig.save();
}

export function handlePaymentsStatusChanged(event: PaymentsStatusChanged): void {
  let factoryAddress = event.address;

  let factoryConfig = getOrCreateFactoryPaymentConfig(
    factoryAddress,
    event.block.timestamp,
    event.transaction.hash
  );

  factoryConfig.paymentsEnabled = event.params.enabled;
  factoryConfig.save();
}

/**
 * Handle UserRoleUpdated events from TokenFactory
 * Tracks admin role changes for the factory diamond itself
 */
export function handleUserRoleUpdated(event: UserRoleUpdated): void {
  const diamondAddress = event.address.toHexString();
  const userAddress = event.params.user.toHexString();
  const role = event.params.role;
  const enabled = event.params.enabled;

  // Ensure diamond entity exists
  let diamond = Diamond.load(diamondAddress);
  if (!diamond) {
    // Factory doesn't exist in our system, create a minimal entry
    diamond = new Diamond(diamondAddress);
    diamond.diamondType = "FACTORY";
    diamond.creator = event.transaction.from;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
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
