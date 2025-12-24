import { 
  OfferingCreated,
  PaymentModuleInitialized,
  PaymentTokenConfigured,
  PaymentCollected,
  FeeRecipientUpdated,
  PaymentsStatusChanged,
  DiscountSet,
  UserRoleUpdated
} from "../../generated/OfferingFactory/OfferingFactory";
import { Diamond, Offering, UserRole } from "../../generated/schema";
import { OfferingDiamond } from "../../generated/templates";
import { ERC20 } from "../../generated/OfferingFactory/ERC20";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  FactoryPaymentConfig,
  FactoryPaymentTokenConfig,
  PaymentToken,
  FactoryPayment,
  FactoryPaymentDiscount,
} from "../../generated/schema";

/**
 * Handle offering creation from OfferingFactory
 * This event provides immediate type information and configuration
 */
export function handleOfferingCreated(event: OfferingCreated): void {
  const offeringAddress = event.params.offeringDiamond.toHexString();

  // Ensure FactoryPaymentConfig exists for this factory
  getOrCreateFactoryPaymentConfig(
    event.address,
    event.block.timestamp,
    event.transaction.hash
  );

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
  offering.complianceModules = []; // Initialize empty array for non-nullable field
  
  // Don't initialize compliance fields here - let ComplianceInitialized event set them
  // offering.generalSolicitation and offering.allowsSelfCertification will be null by default

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
    config.feeRecipient = Address.fromString("0x0000000000000000000000000000000000000000");
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
 * Handle UserRoleUpdated events from OfferingFactory
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
