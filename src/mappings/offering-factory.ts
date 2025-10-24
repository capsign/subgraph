import { 
  OfferingCreated,
  PaymentModuleInitialized,
  PaymentTokenConfigured,
  PaymentCollected,
  FeeRecipientUpdated,
  PaymentsStatusChanged
} from "../../generated/OfferingFactory/OfferingFactory";
import { Diamond, Offering } from "../../generated/schema";
import { OfferingDiamond } from "../../generated/templates";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  FactoryPaymentConfig,
  FactoryPaymentToken,
  FactoryPayment,
} from "../../generated/schema";

/**
 * Handle offering creation from OfferingFactory
 * This event provides immediate type information and configuration
 */
export function handleOfferingCreated(event: OfferingCreated): void {
  const offeringAddress = event.params.offeringDiamond.toHexString();

  // Create or update Diamond entity
  let diamond = Diamond.load(offeringAddress);
  if (!diamond) {
    diamond = new Diamond(offeringAddress);
    diamond.creator = event.params.issuer;
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
  }
  diamond.diamondType = "OFFERING";
  diamond.save();

  // Create Offering entity with factory data
  let offering = new Offering(offeringAddress);
  offering.issuer = event.params.issuer;
  offering.admin = event.params.admin;
  offering.deployer = event.transaction.from;
  offering.createdAt = event.block.timestamp;
  offering.createdTx = event.transaction.hash;

  // Store compliance modules
  const modules: Bytes[] = [];
  for (let i = 0; i < event.params.complianceModules.length; i++) {
    modules.push(event.params.complianceModules[i]);
  }
  offering.complianceModules = modules;

  // Initialize with default values (will be updated by OfferingInitialized event)
  offering.token = "0x0000000000000000000000000000000000000000"; // Placeholder
  offering.paymentToken = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
  offering.paymentRecipient = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
  offering.pricePerToken = BigInt.fromI32(0);
  offering.minInvestment = BigInt.fromI32(0);
  offering.maxAmount = BigInt.fromI32(0);
  offering.deadline = BigInt.fromI32(0);
  offering.totalInvested = BigInt.fromI32(0);
  offering.investorCount = BigInt.fromI32(0);
  offering.status = "ACTIVE";
  offering.uri = null;

  offering.save();

  // Link offering to diamond
  diamond.offering = offeringAddress;
  diamond.save();

  // Start tracking offering diamond for events
  OfferingDiamond.create(event.params.offeringDiamond);
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
    config.factoryType = "OFFERING";
    config.feeRecipient = Address.zero();
    config.paymentsEnabled = true;
    config.deploymentCount = BigInt.zero();
    config.createdAt = timestamp;
    config.createdTx = tx;
    config.save();
  }

  return config;
}

// Payment event handlers for OfferingFactory
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
