import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import {
  IncomeReceived,
} from "../../generated/templates/WalletDiamond/IncomeReceivableFacet";
import {
  IncomeEvent,
  Vehicle,
} from "../../generated/schema";
import { createActivity } from "./activity";
import { getOrCreateFundTaxYearSummary, getTaxYear } from "./asset-disposal";

/**
 * Map income type enum from contract to string
 */
// @ts-ignore: i32 is a valid AssemblyScript type
function mapIncomeType(incomeType: i32): string {
  if (incomeType == 0) return "DIVIDEND";
  if (incomeType == 1) return "INTEREST";
  if (incomeType == 2) return "RENTAL";
  if (incomeType == 3) return "ROYALTY";
  return "OTHER";
}

/**
 * Get payment token symbol (simplified - assumes common stablecoins)
 */
function getPaymentTokenSymbol(tokenAddress: string): string {
  const lowerAddress = tokenAddress.toLowerCase();
  // Base USDC
  if (lowerAddress == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") return "USDC";
  // Base Sepolia USDC
  if (lowerAddress == "0x036cbd53842c5426634e7929541ec2318f3dcf7e") return "USDC";
  // ETH
  if (lowerAddress == "0x0000000000000000000000000000000000000000") return "ETH";
  // Default: truncated address
  return tokenAddress.slice(0, 10);
}

/**
 * Handle IncomeReceived event (IncomeReceivableFacet)
 * Tracks income for tax reporting (dividends, interest, rental, royalties)
 */
export function handleIncomeReceived(event: IncomeReceived): void {
  const fundWalletAddress = event.params.wallet.toHexString();
  const incomeId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;
  
  // Load or create vehicle (fund wallet)
  let vehicle = Vehicle.load(fundWalletAddress);
  if (!vehicle) {
    // Create minimal vehicle if it doesn't exist
    vehicle = new Vehicle(fundWalletAddress);
    vehicle.wallet = fundWalletAddress;
    vehicle.vehicleType = "FUND";
    vehicle.fundingMode = "COMMITMENT";
    vehicle.isOpenEnded = false;
    vehicle.totalCapitalCommitted = BigInt.fromI32(0);
    vehicle.totalCapitalCalled = BigInt.fromI32(0);
    vehicle.totalCapitalContributed = BigInt.fromI32(0);
    vehicle.totalDistributionsExecuted = BigInt.fromI32(0);
    vehicle.totalDistributionsClaimed = BigInt.fromI32(0);
    vehicle.accruedManagementFees = BigInt.fromI32(0);
    vehicle.totalManagementFeesPaid = BigInt.fromI32(0);
    vehicle.createdAt = event.block.timestamp;
    vehicle.createdTx = event.transaction.hash;
    vehicle.save();
  }
  
  // Get tax year
  const taxYear = getTaxYear(event.block.timestamp);
  
  // Get or create tax year summary
  let summary = getOrCreateFundTaxYearSummary(fundWalletAddress, event.block.timestamp);
  
  // Parse income amount
  const amount = event.params.amount.toBigDecimal();
  const incomeTypeStr = mapIncomeType(event.params.incomeType);
  
  // Get payment token symbol
  const paymentTokenSymbol = getPaymentTokenSymbol(event.params.paymentToken.toHexString());
  
  // Create IncomeEvent entity
  let incomeEvent = new IncomeEvent(incomeId);
  incomeEvent.fundWallet = fundWalletAddress;
  incomeEvent.taxYearSummary = summary.id;
  incomeEvent.incomeType = incomeTypeStr;
  incomeEvent.amount = amount;
  incomeEvent.paymentToken = event.params.paymentToken;
  incomeEvent.paymentTokenSymbol = paymentTokenSymbol;
  incomeEvent.sourceAsset = event.params.sourceAsset;
  incomeEvent.sourceDescription = event.params.description;
  incomeEvent.payer = event.params.sourceAsset; // Source asset is often the payer
  incomeEvent.receivedAt = event.params.timestamp;
  incomeEvent.taxYear = taxYear;
  incomeEvent.txHash = event.transaction.hash;
  incomeEvent.blockNumber = event.block.number;
  incomeEvent.save();
  
  // Update tax year summary income totals
  summary.ordinaryIncome = summary.ordinaryIncome.plus(amount);
  
  // Also update specific income category
  if (incomeTypeStr == "INTEREST") {
    summary.interestIncome = summary.interestIncome.plus(amount);
  } else if (incomeTypeStr == "DIVIDEND") {
    summary.dividendIncome = summary.dividendIncome.plus(amount);
  } else if (incomeTypeStr == "RENTAL") {
    summary.rentalIncome = summary.rentalIncome.plus(amount);
  } else {
    summary.otherIncome = summary.otherIncome.plus(amount);
  }
  
  summary.lastUpdated = event.block.timestamp;
  summary.save();
  
  // Create activity
  const activityId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}-income`;
  let activity = createActivity(
    activityId,
    "INCOME_RECEIVED",
    event.address,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number
  );
  activity.save();
}
