import { 
  TokenCreated,
  PaymentModuleInitialized,
  PaymentTokenConfigured,
  PaymentCollected,
  FeeRecipientUpdated,
  PaymentsStatusChanged
} from "../../generated/TokenFactory/TokenFactory";
import { Diamond, ShareClass, Safe } from "../../generated/schema";
import { TokenDiamond } from "../../generated/templates";
import { TokenMetadata } from "../../generated/TokenFactory/TokenMetadata";
import { DiamondLoupe } from "../../generated/TokenFactory/DiamondLoupe";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  FactoryPaymentConfig,
  FactoryPaymentToken,
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
 * @returns Token type string ("Safe" or "ShareClass")
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
  
  // Check each facet for SAFE-specific function selectors
  // TokenSAFEFacet implements: defaultTerms(), lotTerms(bytes32), etc.
  // Selector for defaultTerms(): 0x43e30c7f
  const SAFE_FACET_SELECTOR = Bytes.fromHexString("0x43e30c7f");
  
  for (let i = 0; i < facets.length; i++) {
    let facetSelectors = facets[i].functionSelectors;
    for (let j = 0; j < facetSelectors.length; j++) {
      // Use equals() method for Bytes comparison in AssemblyScript
      if (facetSelectors[j].equals(SAFE_FACET_SELECTOR)) {
        return "Safe";
      }
    }
  }
  
  // Default to ShareClass if no SAFE facet found
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
    config.feeRecipient = Address.zero();
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

  let paymentToken = FactoryPaymentToken.load(id);
  if (!paymentToken) {
    paymentToken = new FactoryPaymentToken(id);
    paymentToken.factoryConfig = factoryConfig.id;
    paymentToken.paymentToken = tokenAddress;
    paymentToken.totalCollected = BigInt.zero();
    paymentToken.configuredAt = event.block.timestamp;
    paymentToken.configuredTx = event.transaction.hash;
  }

  paymentToken.feeAmount = event.params.feeAmount;
  paymentToken.isActive = event.params.isActive;
  paymentToken.lastUpdatedAt = event.block.timestamp;
  paymentToken.lastUpdatedTx = event.transaction.hash;
  paymentToken.save();
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

  // Update payment token total collected
  let tokenId = factoryAddress
    .toHexString()
    .concat("-")
    .concat(event.params.paymentToken.toHexString());
  let paymentToken = FactoryPaymentToken.load(tokenId);
  if (paymentToken) {
    paymentToken.totalCollected = paymentToken.totalCollected.plus(
      event.params.amount
    );
    paymentToken.save();
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
