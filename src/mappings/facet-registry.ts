import {
  FacetRegistered,
  FacetRemoved
} from "../../generated/FacetRegistry/FacetRegistry";
import { Facet, FacetRegistryEvent } from "../../generated/schema";

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facetAddress.toHexString();
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.block.timestamp;
    facet.createdTx = event.transaction.hash;
  }
  
  facet.name = event.params.name;
  facet.version = event.params.version;
  facet.removed = false;
  
  // Selectors are discovered via packedSelectors() on each facet,
  // not stored on the registry. They'll be populated when
  // DiamondFunctionAdded events fire during diamond upgrades.
  if (!facet.selectors) {
    facet.selectors = [];
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
  registryEvent.selectors = facet.selectors;
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

