import { TokenCreated } from "../../generated/TokenFactory/TokenFactory";
import { Diamond, ShareClass } from "../../generated/schema";
import { TokenDiamond } from "../../generated/templates";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

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

  // Store compliance conditions
  const conditions: Bytes[] = [];
  for (let i = 0; i < event.params.complianceConditions.length; i++) {
    conditions.push(event.params.complianceConditions[i]);
  }
  shareClass.complianceConditions = conditions;

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
