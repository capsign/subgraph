import {
  WalletInitialized,
} from "../../generated/templates/WalletDiamond/WalletCore";
import { Wallet, Owner, Diamond } from "../../generated/schema";

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
