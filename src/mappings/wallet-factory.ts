import { WalletCreated, UserRoleUpdated } from "../../generated/WalletFactory/WalletFactory";
import { Diamond, Wallet, Owner, UserRole, FactoryPaymentConfig } from "../../generated/schema";
import { WalletDiamond } from "../../generated/templates";
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";

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
    config.factoryType = "WALLET";
    config.feeRecipient = Address.fromString("0x0000000000000000000000000000000000000000");
    config.paymentsEnabled = true;
    config.deploymentCount = BigInt.zero();
    config.createdAt = timestamp;
    config.createdTx = tx;
    config.save();
  }

  return config;
}

/**
 * Handle wallet creation from WalletFactory
 * This event provides immediate type information and owner details
 */
export function handleWalletCreated(event: WalletCreated): void {
  const walletAddress = event.params.walletDiamond.toHexString();
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
  let diamond = Diamond.load(walletAddress);
  if (!diamond) {
    diamond = new Diamond(walletAddress);
    diamond.creator = factoryAddress; // Set to factory address for proper querying
    diamond.createdAt = event.block.timestamp;
    diamond.createdTx = event.transaction.hash;
  }
  diamond.diamondType = "WALLET";
  diamond.save();

  // Create Wallet entity with full information from factory event
  let wallet = new Wallet(walletAddress);
  wallet.deployer = event.params.deployer;
  wallet.createdAt = event.block.timestamp;
  wallet.createdTx = event.transaction.hash;

  // Map ownerType enum (0=EOA, 1=Passkey)
  const ownerTypeValue = event.params.ownerType;
  if (ownerTypeValue === 0) {
    wallet.type = "EOA";
  } else if (ownerTypeValue === 1) {
    wallet.type = "Passkey";
  } else {
    wallet.type = "EOA"; // Fallback
  }

  wallet.save();

  // Create initial Owner entity
  // For Passkey: owner param is address(0), use wallet address as unique ID
  // For EOA: owner param is the actual EOA address
  const ownerTypeStr = wallet.type;
  let ownerId: string;
  
  if (ownerTypeStr === "Passkey") {
    // For Passkey, owner param is 0x0, so use salt for uniqueness
    ownerId = walletAddress + "-passkey-" + event.params.salt.toHexString();
  } else {
    // For EOA, use the owner address
    ownerId = walletAddress + "-" + event.params.owner.toHexString();
  }

  let owner = new Owner(ownerId);
  owner.wallet = walletAddress;
  owner.addedAt = event.block.timestamp;
  owner.addedTx = event.transaction.hash;

  if (ownerTypeStr === "EOA") {
    owner.ownerType = "EOA";
    owner.address = event.params.owner;
    owner.publicKey = null;
    owner.publicKeyHash = null;
  } else if (ownerTypeStr === "Passkey") {
    owner.ownerType = "Passkey";
    owner.address = null; // Passkey owners have address(0) in the event
    owner.publicKey = null; // Public key must be fetched from contract via ownerAtIndex()
    owner.publicKeyHash = null;
  }

  owner.save();

  // Link wallet to diamond
  diamond.wallet = walletAddress;
  diamond.save();

  // Start tracking wallet diamond for document events
  WalletDiamond.create(event.params.walletDiamond);
}

/**
 * Handle UserRoleUpdated events from WalletFactory
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
