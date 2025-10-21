import { json, Bytes, BigInt, log, dataSource } from "@graphprotocol/graph-ts";

/**
 * Fetch and parse offering metadata from URI
 * Returns null if fetch fails or JSON is invalid
 */
export function fetchOfferingMetadata(uri: string): OfferingMetadata | null {
  if (!uri || uri.length == 0) {
    return null;
  }

  // Convert IPFS URIs to HTTP gateway
  let httpUri = uri;
  if (uri.startsWith("ipfs://")) {
    httpUri = uri.replace("ipfs://", "https://ipfs.io/ipfs/");
  } else if (uri.startsWith("ipfs/")) {
    httpUri = "https://ipfs.io/ipfs/" + uri.substring(5);
  }

  log.info("Fetching offering metadata from: {}", [httpUri]);

  // Fetch the metadata using dataSource.stringValue()
  // Note: In subgraph, we use ipfs.cat for IPFS or http fetch
  let data: Bytes;
  
  // For HTTP URLs, we need to handle them differently
  // The Graph doesn't support arbitrary HTTP fetches in mappings
  // We can only fetch from IPFS or use the data in events
  // For now, return null for non-IPFS URIs
  if (!httpUri.startsWith("https://ipfs.io/ipfs/") && !httpUri.startsWith("ipfs://")) {
    log.warning("Cannot fetch non-IPFS URI in subgraph: {}", [httpUri]);
    return null;
  }

  // For IPFS, extract the hash
  let ipfsHash: string;
  if (httpUri.startsWith("https://ipfs.io/ipfs/")) {
    ipfsHash = httpUri.substring(22); // Remove "https://ipfs.io/ipfs/"
  } else {
    ipfsHash = httpUri.substring(7); // Remove "ipfs://"
  }

  // Try to fetch from IPFS
  // Note: ipfs.cat is not available in all Graph deployments
  // For Goldsky and other providers, metadata fetching may need to be done client-side
  log.warning("IPFS fetch not implemented in this subgraph version. Metadata will be fetched client-side: {}", [httpUri]);
  return null;

  // TODO: Implement IPFS fetching when supported by the Graph provider
  // const ipfsData = ipfs.cat(ipfsHash);
  // if (ipfsData === null) {
  //   return null;
  // }
  // Parse and return metadata
}

/**
 * Convert offering type string to enum value
 */
export function getOfferingTypeEnum(typeStr: string | null): string {
  if (typeStr === null) return "UNKNOWN";
  
  if (typeStr == "506b") return "TYPE_506B";
  if (typeStr == "506c") return "TYPE_506C";
  if (typeStr == "reg_a") return "REG_A";
  if (typeStr == "reg_cf") return "REG_CF";
  if (typeStr == "custom") return "CUSTOM";
  
  return "UNKNOWN";
}

/**
 * Metadata class to hold parsed data
 */
class OfferingMetadata {
  name: string | null;
  description: string | null;
  image: string | null;
  offeringType: string | null;
  issuerName: string | null;
  issuerJurisdiction: string | null;
  issuerWebsite: string | null;
  issuerLogo: string | null;
  generalSolicitation: boolean;
  investorLimit: BigInt | null;

  constructor() {
    this.name = null;
    this.description = null;
    this.image = null;
    this.offeringType = null;
    this.issuerName = null;
    this.issuerJurisdiction = null;
    this.issuerWebsite = null;
    this.issuerLogo = null;
    this.generalSolicitation = false;
    this.investorLimit = null;
  }
}

