import {
  OfferingInitialized,
  FundsDeposited,
  InvestmentAccepted,
  InvestmentRejected,
  OfferingStatusChanged,
} from "../../generated/templates/OfferingDiamond/OfferingCore";
import { Offering, Investment, Diamond } from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { fetchOfferingMetadata, getOfferingTypeEnum } from "../utils/metadata";

export function handleOfferingInitialized(event: OfferingInitialized): void {
  const offeringAddress = event.address.toHexString();

  // Load offering entity (should already exist from OfferingFactory event)
  let offering = Offering.load(offeringAddress);
  if (!offering) {
    // Fallback for offerings created before factory was deployed
    offering = new Offering(offeringAddress);
    offering.createdAt = event.block.timestamp;
    offering.createdTx = event.transaction.hash;
    offering.admin = event.params.issuer; // Fallback to issuer
    offering.deployer = event.transaction.from;
    offering.complianceModules = []; // Empty array fallback
    offering.metadataFetched = false;
  }

  // Update offering with initialization data from event
  offering.issuer = event.params.issuer;
  offering.token = event.params.token.toHexString();
  offering.paymentToken = event.params.paymentToken;
  offering.paymentRecipient = event.params.paymentRecipient;
  offering.pricePerToken = event.params.pricePerToken;
  offering.minInvestment = event.params.minInvestment;
  offering.maxAmount = event.params.maxAmount;
  offering.deadline = event.params.deadline;
  offering.uri = event.params.uri; // Offering metadata URI
  
  offering.totalInvested = BigInt.fromI32(0);
  offering.investorCount = BigInt.fromI32(0);
  offering.status = "ACTIVE";

  // Fetch and parse metadata if URI is provided
  // Note: Metadata fetching is currently disabled for non-IPFS URIs
  // For Vercel Blob and other HTTP URLs, metadata will be fetched client-side
  if (event.params.uri && event.params.uri.length > 0) {
    // Store the URI for client-side fetching
    offering.metadataFetched = false;
    
    // TODO: Enable IPFS fetching when supported by Graph provider
    // const metadata = fetchOfferingMetadata(event.params.uri);
    // if (metadata !== null) {
    //   offering.name = metadata.name;
    //   offering.description = metadata.description;
    //   offering.image = metadata.image;
    //   offering.offeringType = getOfferingTypeEnum(metadata.offeringType);
    //   offering.issuerName = metadata.issuerName;
    //   offering.issuerJurisdiction = metadata.issuerJurisdiction;
    //   offering.issuerWebsite = metadata.issuerWebsite;
    //   offering.issuerLogo = metadata.issuerLogo;
    //   offering.generalSolicitation = metadata.generalSolicitation;
    //   offering.investorLimit = metadata.investorLimit;
    //   offering.metadataFetched = true;
    // }
  } else {
    offering.metadataFetched = false;
  }
  
  offering.save();
  
  // Update diamond type
  const diamond = Diamond.load(offeringAddress);
  if (diamond) {
    diamond.diamondType = "OFFERING";
    diamond.offering = offeringAddress;
    diamond.save();
  }
}

export function handleFundsDeposited(event: FundsDeposited): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  const investmentId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const investment = new Investment(investmentId);
  investment.offering = offering.id;
  investment.investor = event.params.investor.toHexString();
  investment.investmentId = event.params.investmentId;
  investment.amount = event.params.amount;
  investment.tokenQuantity = BigInt.fromI32(0); // Will be set after acceptance
  investment.investedAt = event.block.timestamp;
  investment.isCountersigned = false;
  investment.isRejected = false;
  investment.identityUID = event.params.identityUID;
  investment.qualificationUID = event.params.qualificationUID;
  investment.save();

  // Update offering totals
  offering.totalInvested = offering.totalInvested.plus(event.params.amount);
  offering.investorCount = offering.investorCount.plus(BigInt.fromI32(1));
  offering.save();
}

export function handleInvestmentAccepted(
  event: InvestmentAccepted
): void {
  const investmentId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const investment = Investment.load(investmentId);
  if (!investment) return;

  investment.isCountersigned = true;
  investment.countersignedAt = event.block.timestamp;
  investment.save();
}

export function handleInvestmentRejected(event: InvestmentRejected): void {
  const investmentId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const investment = Investment.load(investmentId);
  if (!investment) return;

  investment.isRejected = true;
  investment.rejectedAt = event.block.timestamp;
  investment.save();

  // Update offering totals
  const offering = Offering.load(event.address.toHexString());
  if (offering) {
    offering.totalInvested = offering.totalInvested.minus(investment.amount);
    offering.investorCount = offering.investorCount.minus(BigInt.fromI32(1));
    offering.save();
  }
}

export function handleOfferingStatusChanged(
  event: OfferingStatusChanged
): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  // Map uint8 to enum string
  const statusMap = ["ACTIVE", "PAUSED", "CLOSED", "FINALIZED"];
  offering.status = statusMap[event.params.newStatus];
  offering.save();
}
