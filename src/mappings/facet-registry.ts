import {
  FacetRegistered,
  FacetRemoved
} from "../../generated/FacetRegistry/RegistryCoreFacet";
import { Facet, FacetRegistryEvent } from "../../generated/schema";
import { RegistryCoreFacet } from "../../generated/FacetRegistry/RegistryCoreFacet";

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facetAddress.toHexString();
  const facetName = event.params.name.toHexString() + "@" + event.params.version.toHexString();
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.block.timestamp;
    facet.createdTx = event.transaction.hash;
  }
  
  facet.name = facetName;
  facet.removed = false;
  
  // Query the selectors from the contract
  // Note: event.params.name and event.params.version are indexed (Bytes), 
  // but the contract call needs them as strings. We need to convert them.
  const registry = RegistryCoreFacet.bind(event.address);
  const selectorsResult = registry.try_getFacetSelectors(
    event.params.name.toHexString(),
    event.params.version.toHexString()
  );
  
  if (!selectorsResult.reverted) {
    facet.selectors = selectorsResult.value.map<string>((selector) => selector.toHexString());
  } else {
    facet.selectors = [];
  }
  
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
  registryEvent.selectors = facet.selectors;
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

