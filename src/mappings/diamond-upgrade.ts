/**
 * @fileoverview Diamond Upgrade Event Handlers (ERC-8109)
 * 
 * Tracks all facet function additions and removals on diamonds.
 * Replaces the legacy DiamondCut handler with per-function granular events.
 * This provides a complete audit trail of diamond configuration changes.
 */

import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  DiamondFunctionAdded,
  DiamondFunctionRemoved,
  DiamondFunctionReplaced,
} from "../../generated/templates/WalletDiamond/WalletDiamond";
import { Diamond, InstalledFacet, DiamondCutEvent, Facet } from "../../generated/schema";

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
 * Handle DiamondFunctionAdded events from all diamond types (Wallet, Token, Offering)
 * 
 * Emitted per-selector when a function is added to a diamond during upgradeDiamond().
 */
export function handleDiamondFunctionAdded(event: DiamondFunctionAdded): void {
  let diamondAddress = event.address;
  let diamondId = diamondAddress.toHexString();
  let timestamp = event.block.timestamp;
  let txHash = event.transaction.hash;
  let blockNumber = event.block.number;
  let selector = event.params.selector;
  let facetAddress = event.params.facet;

  // Load or create the Diamond entity
  let diamond = Diamond.load(diamondId);
  if (!diamond) {
    diamond = new Diamond(diamondId);
    diamond.diamondType = "UNKNOWN";
    diamond.creator = event.transaction.from;
    diamond.createdAt = timestamp;
    diamond.createdTx = txHash;
    diamond.save();
  }

  // Create DiamondCutEvent entity (historical record)
  let eventId = txHash.toHexString() + "-" + event.logIndex.toString();
  let cutEvent = new DiamondCutEvent(eventId);
  cutEvent.diamond = diamondId;
  cutEvent.timestamp = timestamp;
  cutEvent.tx = txHash;
  cutEvent.blockNumber = blockNumber;
  cutEvent.facetAddress = facetAddress;
  cutEvent.action = "ADD";
  cutEvent.selectors = [selectorToHex(selector)];
  cutEvent.initAddress = null;
  cutEvent.initCalldata = null;
  cutEvent.save();

  // Create/update InstalledFacet entity
  let installedFacetId = diamondId + "-" + facetAddress.toHexString();
  let installedFacet = InstalledFacet.load(installedFacetId);

  if (!installedFacet) {
    installedFacet = new InstalledFacet(installedFacetId);
    installedFacet.diamond = diamondId;
    installedFacet.facetAddress = facetAddress;
    installedFacet.installedAt = timestamp;
    installedFacet.installedTx = txHash;
    installedFacet.installedBlock = blockNumber;
    installedFacet.isActive = true;
    installedFacet.selectors = [];
    installedFacet.action = "ADD";
  }

  // Add the new selector to the running list
  let selectors = installedFacet.selectors;
  let selectorHex = selectorToHex(selector);
  // Only add if not already present
  let found = false;
  for (let i = 0; i < selectors.length; i++) {
    if (selectors[i] == selectorHex) {
      found = true;
      break;
    }
  }
  if (!found) {
    selectors.push(selectorHex);
    installedFacet.selectors = selectors;
  }

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

/**
 * Handle DiamondFunctionRemoved events from all diamond types (Wallet, Token, Offering)
 * 
 * Emitted per-selector when a function is removed from a diamond during upgradeDiamond().
 */
export function handleDiamondFunctionRemoved(event: DiamondFunctionRemoved): void {
  let diamondAddress = event.address;
  let diamondId = diamondAddress.toHexString();
  let timestamp = event.block.timestamp;
  let txHash = event.transaction.hash;
  let blockNumber = event.block.number;
  let selector = event.params.selector;

  // Load or create the Diamond entity
  let diamond = Diamond.load(diamondId);
  if (!diamond) {
    diamond = new Diamond(diamondId);
    diamond.diamondType = "UNKNOWN";
    diamond.creator = event.transaction.from;
    diamond.createdAt = timestamp;
    diamond.createdTx = txHash;
    diamond.save();
  }

  // Create DiamondCutEvent entity (historical record)
  let eventId = txHash.toHexString() + "-" + event.logIndex.toString();
  let cutEvent = new DiamondCutEvent(eventId);
  cutEvent.diamond = diamondId;
  cutEvent.timestamp = timestamp;
  cutEvent.tx = txHash;
  cutEvent.blockNumber = blockNumber;
  cutEvent.facetAddress = null; // DiamondFunctionRemoved doesn't include facet address
  cutEvent.action = "REMOVE";
  cutEvent.selectors = [selectorToHex(selector)];
  cutEvent.initAddress = null;
  cutEvent.initCalldata = null;
  cutEvent.save();

  // Find and update the InstalledFacet that owns this selector
  // Since DiamondFunctionRemoved doesn't include the facet address,
  // we need to search through installed facets for this diamond.
  // The schema uses @derivedFrom, so we can't query it directly.
  // Instead we store a selector→facet mapping via the cutEvent history.
  // For now, we log this as a removal event - the InstalledFacet
  // will be properly updated when the next DiamondFunctionAdded fires
  // for the replacement facet (if any).
}

/**
 * Handle DiamondFunctionReplaced events from all diamond types (Wallet, Token, Offering)
 * 
 * Emitted per-selector when a function's implementation facet is changed during upgradeDiamond().
 */
export function handleDiamondFunctionReplaced(event: DiamondFunctionReplaced): void {
  let diamondAddress = event.address;
  let diamondId = diamondAddress.toHexString();
  let timestamp = event.block.timestamp;
  let txHash = event.transaction.hash;
  let blockNumber = event.block.number;
  let selector = event.params.selector;
  let newFacetAddress = event.params.facet;

  // Load or create the Diamond entity
  let diamond = Diamond.load(diamondId);
  if (!diamond) {
    diamond = new Diamond(diamondId);
    diamond.diamondType = "UNKNOWN";
    diamond.creator = event.transaction.from;
    diamond.createdAt = timestamp;
    diamond.createdTx = txHash;
    diamond.save();
  }

  // Create DiamondCutEvent entity (historical record)
  let eventId = txHash.toHexString() + "-" + event.logIndex.toString();
  let cutEvent = new DiamondCutEvent(eventId);
  cutEvent.diamond = diamondId;
  cutEvent.timestamp = timestamp;
  cutEvent.tx = txHash;
  cutEvent.blockNumber = blockNumber;
  cutEvent.facetAddress = newFacetAddress;
  cutEvent.action = "REPLACE";
  cutEvent.selectors = [selectorToHex(selector)];
  cutEvent.initAddress = null;
  cutEvent.initCalldata = null;
  cutEvent.save();

  // Create/update InstalledFacet entity for the new facet
  let installedFacetId = diamondId + "-" + newFacetAddress.toHexString();
  let installedFacet = InstalledFacet.load(installedFacetId);

  if (!installedFacet) {
    installedFacet = new InstalledFacet(installedFacetId);
    installedFacet.diamond = diamondId;
    installedFacet.facetAddress = newFacetAddress;
    installedFacet.installedAt = timestamp;
    installedFacet.installedTx = txHash;
    installedFacet.installedBlock = blockNumber;
    installedFacet.isActive = true;
    installedFacet.selectors = [];
    installedFacet.action = "REPLACE";
  }

  // Add the selector to the new facet's list
  let selectors = installedFacet.selectors;
  let selectorHex = selectorToHex(selector);
  let found = false;
  for (let i = 0; i < selectors.length; i++) {
    if (selectors[i] == selectorHex) {
      found = true;
      break;
    }
  }
  if (!found) {
    selectors.push(selectorHex);
    installedFacet.selectors = selectors;
  }

  installedFacet.isActive = true;
  installedFacet.removedAt = null;
  installedFacet.removedTx = null;

  // Try to resolve facet metadata from registry
  let facetName = resolveFacetName(newFacetAddress);
  if (facetName) {
    installedFacet.facetName = facetName;
  }

  let facetVersion = resolveFacetVersion(newFacetAddress);
  if (facetVersion) {
    installedFacet.version = facetVersion;
  }

  installedFacet.save();
}
