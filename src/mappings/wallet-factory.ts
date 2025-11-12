import { WalletCreated } from "../../generated/WalletFactory/WalletFactoryCoreFacet";
import { Diamond, Wallet, Owner } from "../../generated/schema";
import { WalletDiamond } from "../../generated/templates";

/**
 * Handle wallet creation from WalletFactory
 * This event provides immediate type information and owner details
 */
export function handleWalletCreated(event: WalletCreated): void {
  const walletAddress = event.params.walletDiamond.toHexString();

  // Create or update Diamond entity
  let diamond = Diamond.load(walletAddress);
  if (!diamond) {
    diamond = new Diamond(walletAddress);
    diamond.creator = event.params.deployer;
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
