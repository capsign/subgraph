import {
  TokenInitialized,
} from "../../generated/templates/TokenDiamond/TokenMetadata";
import { Token, Diamond } from "../../generated/schema";
import { BigInt, Address } from "@graphprotocol/graph-ts";

export function handleTokenInitialized(event: TokenInitialized): void {
  const tokenAddress = event.address.toHexString();

  // Load token entity (should already exist from TokenFactory event)
  let token = Token.load(tokenAddress);
  if (!token) {
    // Fallback for tokens created before factory was deployed
    token = new Token(tokenAddress);
    token.creator = Address.zero(); // Will be set from DiamondCreated
    token.admin = event.transaction.from; // Fallback to transaction sender
    token.deployer = event.transaction.from;
    token.createdAt = event.block.timestamp;
    token.createdTx = event.transaction.hash;
    token.complianceConditions = []; // Empty array fallback
  }

  token.name = event.params.name;
  token.symbol = event.params.symbol;
  token.decimals = i32(event.params.decimals); // Convert uint8 to i32
  token.totalSupply = BigInt.fromI32(0);
  
  // Determine asset type from symbol or name
  // This is a placeholder - you might want to store this in metadata or emit in an event
  token.assetType = "SHARE"; // Default
  
  token.save();
  
  // Update diamond type
  const diamond = Diamond.load(tokenAddress);
  if (diamond) {
    diamond.diamondType = "TOKEN";
    diamond.token = tokenAddress;
    diamond.save();
  }
}
