import {
  FacetRegistered,
  FacetRemoved
} from "../../generated/FacetRegistry/RegistryCoreFacet";
import { Facet, FacetRegistryEvent } from "../../generated/schema";

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facetAddress.toHexString();
  const facetName = event.params.name.toHexString() + "@" + event.params.version.toHexString();
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.block.timestamp;
    facet.createdTx = event.transaction.hash;
    facet.selectors = []; // Will be populated later or via separate query
  }
  
  facet.name = facetName;
  facet.removed = false;
  facet.save();
  
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "REGISTERED";
  registryEvent.facet = event.params.facetAddress;
  registryEvent.facetName = facetName;
  registryEvent.timestamp = event.block.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.selectors = []; // Event doesn't include selectors
  registryEvent.save();
}

export function handleFacetRemoved(event: FacetRemoved): void {
  const facetName = event.params.name.toHexString() + "@" + event.params.version.toHexString();
  
  // Note: We can't update a specific Facet entity here because the event
  // doesn't include the facet address. We would need to track name->address
  // mapping or query the registry contract.
  
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "REMOVED";
  registryEvent.facet = event.address; // Registry address as placeholder
  registryEvent.facetName = facetName;
  registryEvent.timestamp = event.block.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.save();
}

