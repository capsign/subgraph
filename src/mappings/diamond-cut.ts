/**
 * @fileoverview DiamondCut Event Handler
 * 
 * Tracks all facet installations, replacements, and removals on diamonds.
 * This provides a complete audit trail of diamond configuration changes.
 */

import { BigInt, Bytes, ethereum, dataSource } from "@graphprotocol/graph-ts";
import { DiamondCut } from "../../generated/templates/WalletDiamond/WalletDiamond";
import { Diamond, InstalledFacet, DiamondCutEvent, Facet } from "../../generated/schema";

// FacetCutAction enum values from the contract
const FACET_CUT_ACTION_ADD: i32 = 0;
const FACET_CUT_ACTION_REPLACE: i32 = 1;
const FACET_CUT_ACTION_REMOVE: i32 = 2;

/**
 * Convert FacetCutAction number to string enum
 */
function actionToString(action: i32): string {
  if (action == FACET_CUT_ACTION_ADD) return "ADD";
  if (action == FACET_CUT_ACTION_REPLACE) return "REPLACE";
  if (action == FACET_CUT_ACTION_REMOVE) return "REMOVE";
  return "ADD"; // Default fallback
}

/**
 * Convert bytes4 selector to hex string
 */
function selectorToHex(selector: Bytes): string {
  return selector.toHexString();
}

/**
 * Try to resolve facet name from registry by looking up the Facet entity
 */
function resolveFacetName(facetAddress: Bytes): string | null {
  let facet = Facet.load(facetAddress.toHexString());
  if (facet) {
    return facet.name;
  }
  return null;
}

/**
 * Try to resolve facet version from registry
 */
function resolveFacetVersion(facetAddress: Bytes): BigInt | null {
  let facet = Facet.load(facetAddress.toHexString());
  if (facet) {
    return facet.version;
  }
  return null;
}

/**
 * Handle DiamondCut events from all diamond types (Wallet, Token, Offering)
 * 
 * This handler:
 * 1. Creates/updates InstalledFacet entities for each facet in the cut
 * 2. Creates DiamondCutEvent entities for the historical audit trail
 */
export function handleDiamondCut(event: DiamondCut): void {
  let diamondAddress = event.address;
  let diamondId = diamondAddress.toHexString();
  let timestamp = event.block.timestamp;
  let txHash = event.transaction.hash;
  let blockNumber = event.block.number;
  
  // Load or create the Diamond entity
  let diamond = Diamond.load(diamondId);
  if (!diamond) {
    // Diamond should already exist from creation events, but create if needed
    diamond = new Diamond(diamondId);
    diamond.diamondType = "UNKNOWN";
    diamond.creator = event.transaction.from;
    diamond.createdAt = timestamp;
    diamond.createdTx = txHash;
    diamond.save();
  }
  
  // Process each facet cut in the array
  let diamondCuts = event.params.diamondCut;
  let initAddress = event.params.init;
  let initData = event.params.data;
  
  for (let i = 0; i < diamondCuts.length; i++) {
    let cut = diamondCuts[i];
    let facetAddress = cut.facetAddress;
    let action = cut.action;
    let selectors = cut.functionSelectors;
    
    // Convert selectors to string array
    let selectorStrings: string[] = [];
    for (let j = 0; j < selectors.length; j++) {
      selectorStrings.push(selectorToHex(selectors[j]));
    }
    
    // Create unique ID for the DiamondCutEvent
    let eventId = txHash.toHexString() + "-" + event.logIndex.toString() + "-" + i.toString();
    
    // Create DiamondCutEvent entity (historical record)
    let cutEvent = new DiamondCutEvent(eventId);
    cutEvent.diamond = diamondId;
    cutEvent.timestamp = timestamp;
    cutEvent.tx = txHash;
    cutEvent.blockNumber = blockNumber;
    cutEvent.facetAddress = facetAddress;
    cutEvent.action = actionToString(action);
    cutEvent.selectors = selectorStrings;
    cutEvent.initAddress = initAddress;
    cutEvent.initCalldata = initData;
    cutEvent.save();
    
    // Create/update InstalledFacet entity
    let installedFacetId = diamondId + "-" + facetAddress.toHexString();
    let installedFacet = InstalledFacet.load(installedFacetId);
    
    if (action == FACET_CUT_ACTION_REMOVE) {
      // Mark as removed if exists
      if (installedFacet) {
        installedFacet.isActive = false;
        installedFacet.removedAt = timestamp;
        installedFacet.removedTx = txHash;
        // Clear selectors on removal
        installedFacet.selectors = [];
        installedFacet.save();
      }
    } else {
      // ADD or REPLACE
      if (!installedFacet) {
        installedFacet = new InstalledFacet(installedFacetId);
        installedFacet.diamond = diamondId;
        installedFacet.facetAddress = facetAddress;
        installedFacet.installedAt = timestamp;
        installedFacet.installedTx = txHash;
        installedFacet.installedBlock = blockNumber;
        installedFacet.isActive = true;
      }
      
      // Update with current state
      installedFacet.selectors = selectorStrings;
      installedFacet.action = actionToString(action);
      installedFacet.isActive = true;
      installedFacet.removedAt = null;
      installedFacet.removedTx = null;
      
      // Try to resolve facet metadata from registry
      let facetName = resolveFacetName(facetAddress);
      if (facetName) {
        installedFacet.facetName = facetName;
      }
      
      let facetVersion = resolveFacetVersion(facetAddress);
      if (facetVersion) {
        installedFacet.version = facetVersion;
      }
      
      installedFacet.save();
    }
  }
}

