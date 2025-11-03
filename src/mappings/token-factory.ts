import { 
  TokenCreated,
  PaymentModuleInitialized,
  PaymentTokenConfigured,
  PaymentCollected,
  FeeRecipientUpdated,
  PaymentsStatusChanged
} from "../../generated/TokenFactory/TokenFactory";
import { Diamond, ShareClass } from "../../generated/schema";
import { TokenDiamond } from "../../generated/templates";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  FactoryPaymentConfig,
  FactoryPaymentToken,
  FactoryPayment,
} from "../../generated/schema";

/**
 * Handle token creation from TokenFactory
 * This event provides immediate type information and configuration
 * 
 * For now, we only support ShareClass tokens.
 * Future: Detect token type by checking installed facets and create appropriate entity type.
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

  // Create ShareClass entity (for now, all tokens are ShareClass)
  // TODO: Add type detection when we support multiple token types
  let shareClass = new ShareClass(tokenAddress);
  shareClass.name = event.params.name;
  shareClass.symbol = event.params.symbol;
  shareClass.admin = event.params.admin; // The issuer (company's smart account)
  shareClass.createdAt = event.block.timestamp;
  shareClass.createdTx = event.transaction.hash;

  // Initialize with default values (will be updated by TokenInitialized event)
  shareClass.decimals = 18;
  shareClass.totalSupply = BigInt.fromI32(0);
  shareClass.assetType = "ShareClass";
  
  // Initialize admin state
  shareClass.paused = false;
  shareClass.frozenAccounts = [];
  shareClass.frozenLots = [];
  
  // Initialize transfer conditions
  shareClass.transferController = null;
  shareClass.hasTransferConditions = false;
  
  // Initialize ShareClass-specific fields
  shareClass.maxSupply = BigInt.fromI32(0); // 0 = unlimited, will be set via setMaxSupply()

  // Initialize corporate actions (1:1 ratios)
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

  // Start tracking token diamond for events
  TokenDiamond.create(event.params.tokenDiamond);
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
