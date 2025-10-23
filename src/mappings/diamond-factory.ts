import { DiamondCreated } from "../../generated/DiamondFactory/DiamondFactory";
import { Diamond, Wallet, Offering } from "../../generated/schema";
import {
  OfferingDiamond,
  TokenDiamond,
  WalletDiamond,
} from "../../generated/templates";

export function handleDiamondCreated(event: DiamondCreated): void {
  const diamond = new Diamond(event.params.diamond.toHexString());
  diamond.diamondType = "UNKNOWN"; // Type will be determined by initialization events
  diamond.creator = event.params.deployer;
  diamond.createdAt = event.block.timestamp;
  diamond.createdTx = event.transaction.hash;
  diamond.save();

  // Start tracking all diamond types
  // The actual type will be determined by the initialization event (WalletInitialized, OfferingInitialized, TokenInitialized)
  WalletDiamond.create(event.params.diamond);
  OfferingDiamond.create(event.params.diamond);
  TokenDiamond.create(event.params.diamond);
}

