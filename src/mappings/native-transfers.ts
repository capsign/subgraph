import { Address, BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Transfer } from "../../generated/USDC/ERC20";
import { TransactionExecuted, EtherReceived } from "../../generated/templates/WalletDiamond/WalletDiamond";
import { AssetTransfer, Wallet } from "../../generated/schema";
import { createActivity } from "./activity";

// USDC contract addresses
const USDC_BASE_SEPOLIA = Address.fromString("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const USDC_BASE_MAINNET = Address.fromString("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");

// Decimals for formatting
const ETH_DECIMALS = 18;
const USDC_DECIMALS = 6;

// ERC20 transfer function selector: transfer(address,uint256)
const TRANSFER_SELECTOR = Bytes.fromHexString("0xa9059cbb");

/**
 * Converts BigInt to BigDecimal with specified decimals
 */
function toDecimal(value: BigInt, decimals: i32): BigDecimal {
  const divisor = BigInt.fromI32(10).pow(decimals as u8);
  return value.toBigDecimal().div(divisor.toBigDecimal());
}

/**
 * Checks if an address is a tracked CapSign wallet
 */
function isCapSignWallet(address: Address): boolean {
  const wallet = Wallet.load(address.toHexString());
  return wallet != null;
}

/**
 * Handles USDC Transfer events
 * Creates activities for:
 * - USDC_RECEIVED: When a CapSign wallet receives USDC
 * - USDC_SENT: When a CapSign wallet sends USDC (backup - also tracked via TransactionExecuted)
 */
export function handleUSDCTransfer(event: Transfer): void {
  const from = event.params.from;
  const to = event.params.to;
  const value = event.params.value;
  
  // Skip zero-value transfers
  if (value.equals(BigInt.zero())) {
    return;
  }
  
  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  const usdcAddress = event.address.toHexString();
  
  // Check if recipient is a CapSign wallet (USDC_RECEIVED)
  if (isCapSignWallet(to)) {
    const activityId = "usdc-received-" + txHash.toHexString() + "-" + logIndex.toString();
    
    // Create the activity
    const activity = createActivity(
      activityId,
      "USDC_RECEIVED",
      to,
      timestamp,
      txHash,
      blockNumber
    );
    
    // Create the asset transfer details
    const transfer = new AssetTransfer(activityId);
    transfer.asset = usdcAddress;
    transfer.assetSymbol = "USDC";
    transfer.amount = value;
    transfer.amountFormatted = toDecimal(value, USDC_DECIMALS);
    transfer.counterparty = from;
    transfer.direction = "IN";
    transfer.save();
    
    activity.assetTransfer = activityId;
    activity.save();
  }
  
  // Check if sender is a CapSign wallet (USDC_SENT)
  // Note: This may duplicate TransactionExecuted events, but provides a fallback
  // We use a different activity ID prefix to avoid conflicts
  if (isCapSignWallet(from)) {
    const activityId = "usdc-sent-transfer-" + txHash.toHexString() + "-" + logIndex.toString();
    
    // Check if we already have an activity for this tx from TransactionExecuted
    // The TransactionExecuted handler creates IDs with prefix "usdc-sent-"
    // We'll use a different prefix "usdc-sent-transfer-" to track Transfer events
    // The UI can deduplicate if needed, or we can skip if TransactionExecuted already handled it
    
    const activity = createActivity(
      activityId,
      "USDC_SENT",
      from,
      timestamp,
      txHash,
      blockNumber
    );
    
    const transfer = new AssetTransfer(activityId);
    transfer.asset = usdcAddress;
    transfer.assetSymbol = "USDC";
    transfer.amount = value;
    transfer.amountFormatted = toDecimal(value, USDC_DECIMALS);
    transfer.counterparty = to;
    transfer.direction = "OUT";
    transfer.save();
    
    activity.assetTransfer = activityId;
    activity.save();
  }
}

/**
 * Handles TransactionExecuted events from WalletDiamond
 * Creates activities for:
 * - ETH_SENT: When wallet sends ETH (value > 0)
 * - USDC_SENT: When wallet calls USDC.transfer() (detected via calldata)
 */
export function handleTransactionExecuted(event: TransactionExecuted): void {
  const walletAddress = event.address;
  const target = event.params.target;
  const value = event.params.value;
  const data = event.params.data;
  
  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  
  // Handle ETH transfers (when value > 0)
  if (value.gt(BigInt.zero())) {
    const activityId = "eth-sent-" + txHash.toHexString() + "-" + logIndex.toString();
    
    const activity = createActivity(
      activityId,
      "ETH_SENT",
      walletAddress,
      timestamp,
      txHash,
      blockNumber
    );
    
    const transfer = new AssetTransfer(activityId);
    transfer.asset = "ETH";
    transfer.assetSymbol = "ETH";
    transfer.amount = value;
    transfer.amountFormatted = toDecimal(value, ETH_DECIMALS);
    transfer.counterparty = target;
    transfer.direction = "OUT";
    transfer.save();
    
    activity.assetTransfer = activityId;
    activity.save();
  }
  
  // Handle USDC transfers via calldata
  // Check if target is USDC and data starts with transfer selector
  if (data.length >= 4) {
    const selector = Bytes.fromUint8Array(data.subarray(0, 4));
    
    if (selector.equals(TRANSFER_SELECTOR)) {
      // Check if target is USDC (either network)
      if (target.equals(USDC_BASE_SEPOLIA) || target.equals(USDC_BASE_MAINNET)) {
        // Decode the transfer calldata: transfer(address to, uint256 amount)
        // Data layout: 4 bytes selector + 32 bytes address + 32 bytes amount
        if (data.length >= 68) { // 4 + 32 + 32
          // Extract recipient address (bytes 4-36, padded to 32 bytes)
          const recipientBytes = data.subarray(16, 36); // Skip 4 selector + 12 padding bytes
          const recipient = Address.fromBytes(Bytes.fromUint8Array(recipientBytes));
          
          // Extract amount (bytes 36-68)
          const amountBytes = data.subarray(36, 68);
          // Convert bytes to BigInt
          let amount = BigInt.zero();
          for (let i = 0; i < 32; i++) {
            amount = amount.times(BigInt.fromI32(256)).plus(BigInt.fromI32(amountBytes[i]));
          }
          
          // Skip if amount is 0
          if (amount.gt(BigInt.zero())) {
            const activityId = "usdc-sent-" + txHash.toHexString() + "-" + logIndex.toString();
            
            const activity = createActivity(
              activityId,
              "USDC_SENT",
              walletAddress,
              timestamp,
              txHash,
              blockNumber
            );
            
            const transfer = new AssetTransfer(activityId);
            transfer.asset = target.toHexString();
            transfer.assetSymbol = "USDC";
            transfer.amount = amount;
            transfer.amountFormatted = toDecimal(amount, USDC_DECIMALS);
            transfer.counterparty = recipient;
            transfer.direction = "OUT";
            transfer.save();
            
            activity.assetTransfer = activityId;
            activity.save();
          }
        }
      }
    }
  }
}

/**
 * Handles EtherReceived events from WalletDiamond
 * Creates ETH_RECEIVED activity when wallet receives ETH
 */
export function handleEtherReceived(event: EtherReceived): void {
  const walletAddress = event.address;
  const from = event.params.from;
  const amount = event.params.amount;
  
  // Skip zero-value transfers
  if (amount.equals(BigInt.zero())) {
    return;
  }
  
  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;
  
  const activityId = "eth-received-" + txHash.toHexString() + "-" + logIndex.toString();
  
  const activity = createActivity(
    activityId,
    "ETH_RECEIVED",
    walletAddress,
    timestamp,
    txHash,
    blockNumber
  );
  
  const transfer = new AssetTransfer(activityId);
  transfer.asset = "ETH";
  transfer.assetSymbol = "ETH";
  transfer.amount = amount;
  transfer.amountFormatted = toDecimal(amount, ETH_DECIMALS);
  transfer.counterparty = from;
  transfer.direction = "IN";
  transfer.save();
  
  activity.assetTransfer = activityId;
  activity.save();
}

