import { 
  TokenCreated,
  PaymentModuleInitialized,
  PaymentTokenConfigured,
  PaymentCollected,
  FeeRecipientUpdated,
  PaymentsStatusChanged,
  DiscountSet,
  UserRoleUpdated
} from "../../generated/TokenFactory/TokenFactory";
import { Diamond, EquityToken, Safe, PromissoryNote, UserRole } from "../../generated/schema";
import { TokenDiamond } from "../../generated/templates";
import { TokenMetadata } from "../../generated/TokenFactory/TokenMetadata";
import { DiamondInspect } from "../../generated/TokenFactory/DiamondInspect";
import { TokenTypeFacet } from "../../generated/TokenFactory/TokenTypeFacet";
import { TokenSAFEFacet } from "../../generated/TokenFactory/TokenSAFEFacet";
import { ERC20 } from "../../generated/TokenFactory/ERC20";
import { BigInt, Bytes, Address, log } from "@graphprotocol/graph-ts";
import {
  FactoryPaymentConfig,
  FactoryPaymentTokenConfig,
  PaymentToken,
  FactoryPayment,
  FactoryPaymentDiscount,
} from "../../generated/schema";

/**
 * Handle token creation from TokenFactory
 * Detects token type by checking installed facets and creates appropriate entity
 */
export function handleTokenCreated(event: TokenCreated): void {
  const tokenAddress = event.params.tokenDiamond.toHexString();
  const factoryAddress = event.address;

  // Get or create FactoryPaymentConfig and increment deployment count
  let config = getOrCreateFactoryPaymentConfig(
    factoryAddress,
    event.block.timestamp,
    event.transaction.hash
  );
  config.deploymentCount = config.deploymentCount.plus(BigInt.fromI32(1));
  config.save();

  // Create or update Diamond entity
  let diamond = Diamond.load(tokenAddress);
  if (!diamond) {
    diamond = new Diamond(tokenAddress);
    diamond.creator = event.params.admin; // User who deployed
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
    // Create bilateral Safe entity
    let safe = new Safe(tokenAddress);
    safe.name = event.params.name;
    safe.symbol = event.params.symbol;
    safe.decimals = decimals;
    safe.totalSupply = BigInt.fromI32(0);
    safe.creator = event.params.admin;
    safe.admin = event.params.admin;
    safe.deployer = event.params.admin;
    safe.createdAt = event.block.timestamp;
    safe.createdTx = event.transaction.hash;
    safe.assetType = "Safe";
    safe.tokenCategory = "CONVERTIBLE";
    
    // Read baseURI for metadata
    let safeBaseURIResult = tokenContract.try_baseURI();
    safe.baseURI = safeBaseURIResult.reverted ? null : safeBaseURIResult.value;
    
    // Initialize compliance
    safe.complianceConditions = new Array<Bytes>();
    
    // Initialize admin state
    safe.paused = false;
    safe.frozenAccounts = new Array<Bytes>();
    safe.frozenLots = new Array<Bytes>();
    safe.retired = false;
    safe.retiredAt = null;
    safe.transferController = null;
    safe.hasTransferConditions = false;
    
    // Read bilateral SAFE data from on-chain via getSAFE()
    const zeroAddr = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    const safeFacet = TokenSAFEFacet.bind(event.params.tokenDiamond);
    const safeResult = safeFacet.try_getSAFE();
    
    if (!safeResult.reverted) {
      safe.issuer = safeResult.value.getIssuer();
      safe.investor = safeResult.value.getInvestor();
      safe.investmentAmount = safeResult.value.getInvestmentAmount();
      safe.paymentToken = safeResult.value.getPaymentToken();
      
      const terms = safeResult.value.getTerms();
      safe.valuationCap = terms.valuationCap;
      safe.discountBasisPoints = terms.discountBasisPoints;
      safe.hasMFN = terms.hasMFN;
      safe.hasProRata = terms.hasProRata;
      
      safe.targetEquityToken = safeResult.value.getTargetEquityToken();
      safe.sharesReceived = safeResult.value.getSharesReceived();
      
      // Map status enum: 0=INITIALIZED, 1=ACTIVE, 2=CONVERTED, 3=CANCELLED
      const statusVal = safeResult.value.getStatus();
      if (statusVal == 0) {
        safe.status = "INITIALIZED";
      } else if (statusVal == 1) {
        safe.status = "ACTIVE";
      } else if (statusVal == 2) {
        safe.status = "CONVERTED";
      } else {
        safe.status = "CANCELLED";
      }
    } else {
      log.warning("Failed to read getSAFE() for token {}", [tokenAddress]);
      // Initialize with safe defaults
      safe.issuer = zeroAddr;
      safe.investor = zeroAddr;
      safe.investmentAmount = BigInt.fromI32(0);
      safe.paymentToken = zeroAddr;
      safe.valuationCap = BigInt.fromI32(0);
      safe.discountBasisPoints = 0;
      safe.hasMFN = false;
      safe.hasProRata = false;
      safe.targetEquityToken = zeroAddr;
      safe.sharesReceived = null;
      safe.status = "INITIALIZED";
    }
    
    // Lifecycle fields (set via events)
    safe.isTransferable = false;
    safe.agreementDocumentId = null;
    safe.activatedAt = null;
    safe.activatedTx = null;
    safe.conversionPrice = null;
    safe.convertedAt = null;
    safe.convertedTx = null;
    safe.refundAmount = null;
    safe.cancelledAt = null;
    safe.cancelledTx = null;
    
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
    note.tokenCategory = "DEBT"; // Promissory notes are debt instruments
    
    // Read baseURI for metadata/legal document
    let baseURIResult = tokenContract.try_baseURI();
    note.baseURI = baseURIResult.reverted ? null : baseURIResult.value;
    note.uri = baseURIResult.reverted ? null : baseURIResult.value; // Keep for backwards compat
    
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
    note.gracePeriodDays = 0;
    note.debtor = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    note.creditor = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    note.totalPaid = BigInt.fromI32(0);
    note.interestPaid = BigInt.fromI32(0);
    note.principalPaid = BigInt.fromI32(0);
    note.outstandingBalance = BigInt.fromI32(0);
    note.status = "ACTIVE";
    note.isMatured = false;
    note.isDefaulted = false;
    note.defaultedAt = null;
    
    note.save();
    
    // Link token to diamond
    diamond.token = tokenAddress;
    diamond.save();
  } else {
    // Create EquityToken entity (default for equity tokens)
    let equityToken = new EquityToken(tokenAddress);
    equityToken.name = event.params.name;
    equityToken.symbol = event.params.symbol;
    equityToken.admin = event.params.admin;
    equityToken.createdAt = event.block.timestamp;
  equityToken.createdTx = event.transaction.hash;
  equityToken.decimals = decimals;
  equityToken.totalSupply = BigInt.fromI32(0);
  equityToken.assetType = "ShareClass";
  equityToken.tokenCategory = "EQUITY"; // Share classes are equity instruments
  
  // Read baseURI for metadata
  let equityTokenBaseURIResult = tokenContract.try_baseURI();
  equityToken.baseURI = equityTokenBaseURIResult.reverted ? null : equityTokenBaseURIResult.value;
  
  // Initialize compliance
  equityToken.complianceConditions = new Array<Bytes>();
  
  // Initialize admin state
  equityToken.paused = false;
    equityToken.frozenAccounts = new Array<Bytes>();
    equityToken.frozenLots = new Array<Bytes>();
    equityToken.retired = false;
    equityToken.retiredAt = null;
  equityToken.transferController = null;
  equityToken.hasTransferConditions = false;
  
  // Initialize EquityToken-specific fields
    equityToken.maxSupply = BigInt.fromI32(0); // 0 = unlimited
  equityToken.splitNum = BigInt.fromI32(1);
  equityToken.splitDen = BigInt.fromI32(1);
  equityToken.divNum = BigInt.fromI32(1);
  equityToken.divDen = BigInt.fromI32(1);
  equityToken.totalSplits = 0;
  equityToken.totalDividends = 0;
  equityToken.isPublic = false;

  equityToken.save();

  // Link token to diamond
  diamond.token = tokenAddress;
  diamond.save();
  }

  // Start tracking token diamond for events
  TokenDiamond.create(event.params.tokenDiamond);
}

/**
 * Detect token type using TokenTypeFacet.getAssetType() which returns the
 * human-readable type directly (e.g. "ShareClass", "Safe", "PromissoryNote").
 * Falls back to selector-sniffing for legacy tokens deployed before TokenTypeFacet existed.
 *
 * @param tokenAddress - Address of the token diamond
 * @returns Token type string ("Safe", "PromissoryNote", or "ShareClass")
 */
function detectTokenType(tokenAddress: Address): string {
  // Primary: query TokenTypeFacet.getAssetType() directly
  let typeFacet = TokenTypeFacet.bind(tokenAddress);
  let assetTypeResult = typeFacet.try_getAssetType();
  if (!assetTypeResult.reverted && assetTypeResult.value.length > 0) {
    let rawType = assetTypeResult.value;
    log.info("Token {} type from TokenTypeFacet: {}", [
      tokenAddress.toHexString(),
      rawType,
    ]);
    return rawType;
  }

  // Fallback: selector-sniffing for legacy tokens without TokenTypeFacet
  log.info("Token {} has no TokenTypeFacet, falling back to selector detection", [
    tokenAddress.toHexString(),
  ]);
  let inspect = DiamondInspect.bind(tokenAddress);
  let ZERO_ADDRESS = Address.fromString("0x0000000000000000000000000000000000000000");

  // TokenSAFEFacet: getSAFE() = 0x18795539
  let safeFacetResult = inspect.try_facetAddress(Bytes.fromHexString("0x18795539"));
  if (!safeFacetResult.reverted && !safeFacetResult.value.equals(ZERO_ADDRESS)) {
    return "Safe";
  }

  // TokenNoteFacet: getNote() = 0xdf3ac476
  let noteFacetResult = inspect.try_facetAddress(Bytes.fromHexString("0xdf3ac476"));
  if (!noteFacetResult.reverted && !noteFacetResult.value.equals(ZERO_ADDRESS)) {
    return "PromissoryNote";
  }

  // Default to ShareClass (most common equity type)
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
    // Magic value for USD (off-chain currency) - ISO 4217 numeric code 840 = 0x348
    const usdMagicAddress = Address.fromString("0x0000000000000000000000000000000000000348");
    if (tokenAddress.equals(zeroAddress)) {
      token.symbol = "ETH";
      token.decimals = 18;
      token.name = "Ether";
    } else if (tokenAddress.equals(usdMagicAddress)) {
      token.symbol = "USD";
      token.decimals = 2;
      token.name = "US Dollar";
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

export function handleDiscountSet(event: DiscountSet): void {
  let factoryAddress = event.address;
  let userAddress = event.params.user;
  let discountBasisPoints = event.params.discountBasisPoints;

  // Create or update discount entity
  let discountId = factoryAddress
    .toHexString()
    .concat("-")
    .concat(userAddress.toHexString());
  
  let discount = FactoryPaymentDiscount.load(discountId);
  if (!discount) {
    discount = new FactoryPaymentDiscount(discountId);
    discount.factory = factoryAddress;
    discount.user = userAddress;
    discount.setAt = event.block.timestamp;
    discount.setTx = event.transaction.hash;
  }

  discount.discountBasisPoints = discountBasisPoints;
  discount.lastUpdatedAt = event.block.timestamp;
  discount.lastUpdatedTx = event.transaction.hash;
  discount.save();
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
