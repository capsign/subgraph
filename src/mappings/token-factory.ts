import { TokenCreated } from "../../generated/TokenFactory/TokenFactory";
import { Diamond, Token } from "../../generated/schema";
import { TokenDiamond } from "../../generated/templates";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

/**
 * Handle token creation from TokenFactory
 * This event provides immediate type information and configuration
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

  // Create Token entity with factory data
  let token = new Token(tokenAddress);
  token.name = event.params.name;
  token.symbol = event.params.symbol;
  token.admin = event.params.admin;
  token.creator = event.params.admin; // For backwards compatibility
  token.deployer = event.transaction.from;
  token.createdAt = event.block.timestamp;
  token.createdTx = event.transaction.hash;

  // Store compliance conditions
  const conditions: Bytes[] = [];
  for (let i = 0; i < event.params.complianceConditions.length; i++) {
    conditions.push(event.params.complianceConditions[i]);
  }
  token.complianceConditions = conditions;

  // Initialize with default values (will be updated by TokenInitialized event)
  token.decimals = 18;
  token.totalSupply = BigInt.fromI32(0);
  token.assetType = "SHARE"; // Default

  token.save();

  // Link token to diamond
  diamond.token = tokenAddress;
  diamond.save();

  // Start tracking token diamond for events
  TokenDiamond.create(event.params.tokenDiamond);
}
