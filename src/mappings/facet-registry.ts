import {
  FacetRegistered,
  FacetRemoved,
  FacetRegistry
} from "../../generated/FacetRegistry/FacetRegistry";
import { Facet, FacetRegistryEvent } from "../../generated/schema";
import { Bytes } from "@graphprotocol/graph-ts";

/**
 * Parse packedSelectors bytes into an array of hex selector strings.
 * Each selector is 4 bytes (8 hex chars) packed sequentially.
 */
function parsePackedSelectors(packed: Bytes): string[] {
  const selectors: string[] = [];
  const hex = packed.toHexString().slice(2); // strip "0x"
  for (let i = 0; i < hex.length; i += 8) {
    if (i + 8 <= hex.length) {
      selectors.push("0x" + hex.slice(i, i + 8));
    }
  }
  return selectors;
}

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facetAddress.toHexString();
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.block.timestamp;
    facet.createdTx = event.transaction.hash;
    facet.selectors = [];
  }
  
  facet.name = event.params.name;
  facet.version = event.params.version;
  facet.removed = false;

  // Fetch selectors from the facet contract's packedSelectors() function
  const facetContract = FacetRegistry.bind(event.params.facetAddress);
  const selectorsResult = facetContract.try_packedSelectors();
  if (!selectorsResult.reverted && selectorsResult.value.length > 0) {
    facet.selectors = parsePackedSelectors(selectorsResult.value);
  }
  
  facet.save();
  
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "REGISTERED";
  registryEvent.facet = event.params.facetAddress;
  registryEvent.facetName = event.params.name + "@" + event.params.version.toString();
  registryEvent.timestamp = event.block.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.selectors = facet.selectors.length > 0 ? facet.selectors : null;
  registryEvent.save();
}

export function handleFacetRemoved(event: FacetRemoved): void {
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "REMOVED";
  registryEvent.facet = event.address; // Registry address as placeholder
  registryEvent.facetName = event.params.name + "@" + event.params.version.toString();
  registryEvent.timestamp = event.block.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.save();
}

