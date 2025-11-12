import {
  FacetRegistered,
  FacetRemoved
} from "../../generated/FacetRegistry/RegistryCoreFacet";
import { Facet, FacetRegistryEvent } from "../../generated/schema";
import { RegistryCoreFacet } from "../../generated/FacetRegistry/RegistryCoreFacet";

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facetAddress.toHexString();
  const registry = RegistryCoreFacet.bind(event.address);
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.block.timestamp;
    facet.createdTx = event.transaction.hash;
  }
  
  // Convert indexed string to string
  const facetName = event.params.name.toString();
  
  facet.name = facetName;
  facet.version = event.params.version;
  facet.removed = false;
  
  // Query the selectors from the contract
  const selectorsResult = registry.try_getFacetSelectors(
    facetName,
    event.params.version
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
  registryEvent.facetName = facetName + "@" + event.params.version.toString();
  registryEvent.timestamp = event.block.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.selectors = facet.selectors;
  registryEvent.save();
}

export function handleFacetRemoved(event: FacetRemoved): void {
  const facetName = event.params.name.toString() + "@" + event.params.version.toString();
  
  // Note: We can't easily update a specific Facet entity here because the event
  // doesn't include the facet address. We would need to track name->address
  // mapping or query the registry contract. For now, just log the event.
  
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

