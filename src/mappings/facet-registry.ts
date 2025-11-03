import {
  FacetRegistered,
  FacetRemoved
} from "../../generated/FacetRegistry/RegistryCoreFacet";
import { Facet, FacetRegistryEvent } from "../../generated/schema";
import { RegistryCoreFacet } from "../../generated/FacetRegistry/RegistryCoreFacet";

export function handleFacetRegistered(event: FacetRegistered): void {
  const facetAddress = event.params.facetAddress.toHexString();
  const registry = RegistryCoreFacet.bind(event.address);
  
  // Get all facet names to find the one that matches this address
  const allNamesResult = registry.try_getAllFacetNames();
  if (allNamesResult.reverted) {
    // Fallback: use hashes as IDs
    const facetName = event.params.name.toHexString() + "@" + event.params.version.toHexString();
    let facet = Facet.load(facetAddress);
    if (!facet) {
      facet = new Facet(facetAddress);
      facet.createdAt = event.block.timestamp;
      facet.createdTx = event.transaction.hash;
    }
    facet.name = facetName;
    facet.removed = false;
    facet.selectors = [];
    facet.save();
    return;
  }
  
  // Iterate through all facet names to find the one with this address
  let matchedName: string | null = null;
  let matchedVersion: string | null = null;
  
  for (let i = 0; i < allNamesResult.value.length; i++) {
    const name = allNamesResult.value[i];
    const versionsResult = registry.try_getFacetVersions(name);
    
    if (!versionsResult.reverted) {
      for (let j = 0; j < versionsResult.value.length; j++) {
        const version = versionsResult.value[j];
        const addressResult = registry.try_getFacetAddress(name, version);
        
        if (!addressResult.reverted && addressResult.value.toHexString() === facetAddress) {
          matchedName = name;
          matchedVersion = version;
          break;
        }
      }
    }
    
    if (matchedName !== null) break;
  }
  
  // If we found a match, use the real name and version
  const facetName = matchedName !== null && matchedVersion !== null
    ? (matchedName as string) + "@" + (matchedVersion as string)
    : event.params.name.toHexString() + "@" + event.params.version.toHexString();
  
  // Create or update Facet entity
  let facet = Facet.load(facetAddress);
  if (!facet) {
    facet = new Facet(facetAddress);
    facet.createdAt = event.block.timestamp;
    facet.createdTx = event.transaction.hash;
  }
  
  facet.name = facetName;
  facet.removed = false;
  
  // Query the selectors from the contract using the matched name/version
  if (matchedName !== null && matchedVersion !== null) {
    const selectorsResult = registry.try_getFacetSelectors(matchedName, matchedVersion);
    
    if (!selectorsResult.reverted) {
      facet.selectors = selectorsResult.value.map<string>((selector) => selector.toHexString());
    } else {
      facet.selectors = [];
    }
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

