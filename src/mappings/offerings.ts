import {
  OfferingInitialized,
  InvestmentMade,
  InvestmentCountersigned,
  InvestmentRejected,
  OfferingStatusChanged,
} from "../../generated/templates/OfferingDiamond/OfferingCore";
import { Offering, Investment, Diamond } from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

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
  }

  // Update offering with initialization data
  offering.issuer = event.params.issuer;
  offering.token = event.params.token.toHexString();
  offering.pricePerToken = event.params.pricePerToken;
  offering.maxAmount = event.params.maxAmount;
  
  // Initialize payment fields with defaults if not set
  const zeroAddress = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
  if (!offering.paymentToken || offering.paymentToken.equals(zeroAddress)) {
    offering.paymentToken = event.params.issuer; // Placeholder
  }
  if (!offering.paymentRecipient || offering.paymentRecipient.equals(zeroAddress)) {
    offering.paymentRecipient = event.params.issuer; // Placeholder
  }
  if (!offering.minInvestment || offering.minInvestment.equals(BigInt.fromI32(0))) {
    offering.minInvestment = BigInt.fromI32(0);
  }
  if (!offering.deadline || offering.deadline.equals(BigInt.fromI32(0))) {
    offering.deadline = BigInt.fromI32(0);
  }
  
  offering.totalInvested = BigInt.fromI32(0);
  offering.investorCount = BigInt.fromI32(0);
  offering.status = "ACTIVE";
  offering.uri = ""; // TODO: Add URI support when available
  offering.save();
  
  // Update diamond type
  const diamond = Diamond.load(offeringAddress);
  if (diamond) {
    diamond.diamondType = "OFFERING";
    diamond.offering = offeringAddress;
    diamond.save();
  }
}

export function handleInvestmentMade(event: InvestmentMade): void {
  const offering = Offering.load(event.address.toHexString());
  if (!offering) return;

  const investmentId = event.address.toHexString() + "-" + event.params.investmentId.toString();
  const investment = new Investment(investmentId);
  investment.offering = offering.id;
  investment.investor = event.params.investor.toHexString();
  investment.investmentId = event.params.investmentId;
  investment.amount = event.params.amount;
  investment.tokenQuantity = BigInt.fromI32(0); // Will be set after countersigning
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

export function handleInvestmentCountersigned(
  event: InvestmentCountersigned
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
