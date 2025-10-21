import {
  FacetRegistered,
  FacetRemoved,
  FacetDeployed
} from "../../generated/FacetRegistry/FacetRegistry";
import { Facet, FacetRegistryEvent } from "../../generated/schema";

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facet.toHexString();
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.params.timestamp;
    facet.createdTx = event.transaction.hash;
  }
  
  facet.name = event.params.name;
  const selectors: string[] = [];
  for (let i = 0; i < event.params.selectors.length; i++) {
    selectors.push(event.params.selectors[i].toHexString());
  }
  facet.selectors = selectors;
  facet.removed = false;
  facet.save();
  
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "REGISTERED";
  registryEvent.facet = event.params.facet;
  registryEvent.facetName = event.params.name;
  registryEvent.timestamp = event.params.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  const eventSelectors: string[] = [];
  for (let i = 0; i < event.params.selectors.length; i++) {
    eventSelectors.push(event.params.selectors[i].toHexString());
  }
  registryEvent.selectors = eventSelectors;
  registryEvent.save();
}

export function handleFacetRemoved(event: FacetRemoved): void {
  const facetAddress = event.params.facet.toHexString();
  
  // Update Facet entity
  const facet = Facet.load(facetAddress);
  if (facet) {
    facet.removed = true;
    facet.removedAt = event.block.timestamp;
    facet.removedTx = event.transaction.hash;
    facet.save();
  }
  
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "REMOVED";
  registryEvent.facet = event.params.facet;
  registryEvent.facetName = event.params.name;
  registryEvent.timestamp = event.block.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.save();
}

export function handleFacetDeployed(event: FacetDeployed): void {
  const facetAddress = event.params.facet.toHexString();
  
  // Create Facet entity (FacetDeployed is always for new facets)
  const facet = new Facet(facetAddress);
  facet.name = event.params.name;
  const selectors: string[] = [];
  for (let i = 0; i < event.params.selectors.length; i++) {
    selectors.push(event.params.selectors[i].toHexString());
  }
  facet.selectors = selectors;
  facet.createdAt = event.params.timestamp;
  facet.createdTx = event.transaction.hash;
  facet.deploymentSalt = event.params.salt;
  facet.removed = false;
  facet.save();
  
  // Create event entity for history tracking
  const eventId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const registryEvent = new FacetRegistryEvent(eventId);
  registryEvent.eventType = "DEPLOYED";
  registryEvent.facet = event.params.facet;
  registryEvent.facetName = event.params.name;
  registryEvent.timestamp = event.params.timestamp;
  registryEvent.tx = event.transaction.hash;
  registryEvent.blockNumber = event.block.number;
  registryEvent.deploymentSalt = event.params.salt;
  const eventSelectors: string[] = [];
  for (let i = 0; i < event.params.selectors.length; i++) {
    eventSelectors.push(event.params.selectors[i].toHexString());
  }
  registryEvent.selectors = eventSelectors;
  registryEvent.save();
}

