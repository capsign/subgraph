/**
 * Paymaster Mappings
 * Handles events from CapSignPaymaster and WalletPaymasterPolicyFacet
 */

import {
  PaymasterPolicy,
  PaymasterPolicyConfiguration,
  RolePolicy,
  SponsoredTransaction,
  PaymasterDeposit,
  PaymasterWithdrawal,
  PolicyCheckFailure,
  Wallet,
} from "../../generated/schema";

import {
  Deposited as DepositedEvent,
  Withdrawn as WithdrawnEvent,
  Sponsored as SponsoredEvent,
  PolicyCheckFailed as PolicyCheckFailedEvent,
} from "../../generated/templates/CapSignPaymaster/CapSignPaymasterFacet";

import {
  PaymasterEnabled as PaymasterEnabledEvent,
  DailyBudgetSet as DailyBudgetSetEvent,
  PaymasterAddressSet as PaymasterAddressSetEvent,
  RolePolicySet as RolePolicySetEvent,
  SpendingRecorded as SpendingRecordedEvent,
} from "../../generated/templates/WalletDiamond/WalletPaymasterPolicyFacet";

import { log } from "@graphprotocol/graph-ts";

// ============================================
// CAPSIGN PAYMASTER EVENTS
// ============================================

export function handleDeposited(event: DepositedEvent): void {
  const entityAddress = event.params.entity;
  const amount = event.params.amount;

  log.info("💰 Paymaster deposit: entity={}, amount={}", [
    entityAddress.toHexString(),
    amount.toString(),
  ]);

  // Create deposit record
  const depositId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const deposit = new PaymasterDeposit(depositId);
  deposit.entity = entityAddress;
  deposit.amount = amount;
  deposit.timestamp = event.block.timestamp;
  deposit.tx = event.transaction.hash;
  deposit.blockNumber = event.block.number;
  deposit.save();
}

export function handleWithdrawn(event: WithdrawnEvent): void {
  const entityAddress = event.params.entity;
  const recipient = event.params.recipient;
  const amount = event.params.amount;

  log.info("💸 Paymaster withdrawal: entity={}, recipient={}, amount={}", [
    entityAddress.toHexString(),
    recipient.toHexString(),
    amount.toString(),
  ]);

  // Create withdrawal record
  const withdrawalId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const withdrawal = new PaymasterWithdrawal(withdrawalId);
  withdrawal.entity = entityAddress;
  withdrawal.recipient = recipient;
  withdrawal.amount = amount;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.tx = event.transaction.hash;
  withdrawal.blockNumber = event.block.number;
  withdrawal.save();
}

export function handleSponsored(event: SponsoredEvent): void {
  const entityAddress = event.params.entity;
  const user = event.params.user;
  const actualCost = event.params.actualCost;
  const refunded = event.params.refunded;

  log.info("⛽ Transaction sponsored: entity={}, user={}, cost={}, refunded={}", [
    entityAddress.toHexString(),
    user.toHexString(),
    actualCost.toString(),
    refunded.toString(),
  ]);

  // Get or create policy
  let policy = PaymasterPolicy.load(entityAddress.toHexString());
  if (!policy) {
    log.warning("PaymasterPolicy not found for entity: {}", [entityAddress.toHexString()]);
    return;
  }

  // Create sponsored transaction record
  const txId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const sponsoredTx = new SponsoredTransaction(txId);
  sponsoredTx.entityPolicy = policy.id;
  sponsoredTx.entity = entityAddress;
  sponsoredTx.user = user;
  sponsoredTx.actualCost = actualCost;
  sponsoredTx.refunded = refunded;
  sponsoredTx.timestamp = event.block.timestamp;
  sponsoredTx.tx = event.transaction.hash;
  sponsoredTx.blockNumber = event.block.number;
  sponsoredTx.save();

  // Update total sponsored
  policy.totalSponsored = policy.totalSponsored.plus(actualCost);
  policy.save();
}

export function handlePolicyCheckFailed(event: PolicyCheckFailedEvent): void {
  const entityAddress = event.params.entity;
  const user = event.params.user;
  const reason = event.params.reason;

  log.warning("❌ Policy check failed: entity={}, user={}, reason={}", [
    entityAddress.toHexString(),
    user.toHexString(),
    reason,
  ]);

  // Create failure record
  const failureId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const failure = new PolicyCheckFailure(failureId);
  failure.entity = entityAddress;
  failure.user = user;
  failure.reason = reason;
  failure.timestamp = event.block.timestamp;
  failure.tx = event.transaction.hash;
  failure.blockNumber = event.block.number;
  failure.save();
}

// ============================================
// WALLET PAYMASTER POLICY EVENTS
// ============================================

export function handlePaymasterEnabled(event: PaymasterEnabledEvent): void {
  const walletAddress = event.address;
  const enabled = event.params.enabled;

  log.info("🔧 Paymaster enabled: wallet={}, enabled={}", [
    walletAddress.toHexString(),
    enabled ? "true" : "false",
  ]);

  // Get or create policy
  let policy = PaymasterPolicy.load(walletAddress.toHexString());
  if (!policy) {
    policy = new PaymasterPolicy(walletAddress.toHexString());
    policy.wallet = walletAddress.toHexString();
    policy.dailyBudget = BigInt.fromI32(0);
    policy.paymasterAddress = event.transaction.to!; // Default to the contract being called
    policy.totalSponsored = BigInt.fromI32(0);
  }

  policy.enabled = enabled;
  policy.updatedAt = event.block.timestamp;
  policy.updatedTx = event.transaction.hash;
  policy.save();

  // Record configuration change
  const configId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const config = new PaymasterPolicyConfiguration(configId);
  config.policy = policy.id;
  config.enabled = enabled;
  config.dailyBudget = policy.dailyBudget;
  config.paymasterAddress = policy.paymasterAddress;
  config.timestamp = event.block.timestamp;
  config.tx = event.transaction.hash;
  config.save();
}

export function handleDailyBudgetSet(event: DailyBudgetSetEvent): void {
  const walletAddress = event.address;
  const budget = event.params.budget;

  log.info("💵 Daily budget set: wallet={}, budget={}", [
    walletAddress.toHexString(),
    budget.toString(),
  ]);

  // Get or create policy
  let policy = PaymasterPolicy.load(walletAddress.toHexString());
  if (!policy) {
    policy = new PaymasterPolicy(walletAddress.toHexString());
    policy.wallet = walletAddress.toHexString();
    policy.enabled = false;
    policy.paymasterAddress = event.transaction.to!;
    policy.totalSponsored = BigInt.fromI32(0);
  }

  policy.dailyBudget = budget;
  policy.updatedAt = event.block.timestamp;
  policy.updatedTx = event.transaction.hash;
  policy.save();

  // Record configuration change
  const configId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const config = new PaymasterPolicyConfiguration(configId);
  config.policy = policy.id;
  config.enabled = policy.enabled;
  config.dailyBudget = budget;
  config.paymasterAddress = policy.paymasterAddress;
  config.timestamp = event.block.timestamp;
  config.tx = event.transaction.hash;
  config.save();
}

export function handlePaymasterAddressSet(event: PaymasterAddressSetEvent): void {
  const walletAddress = event.address;
  const paymasterAddress = event.params.paymaster;

  log.info("🔗 Paymaster address set: wallet={}, paymaster={}", [
    walletAddress.toHexString(),
    paymasterAddress.toHexString(),
  ]);

  // Get or create policy
  let policy = PaymasterPolicy.load(walletAddress.toHexString());
  if (!policy) {
    policy = new PaymasterPolicy(walletAddress.toHexString());
    policy.wallet = walletAddress.toHexString();
    policy.enabled = false;
    policy.dailyBudget = BigInt.fromI32(0);
    policy.totalSponsored = BigInt.fromI32(0);
  }

  policy.paymasterAddress = paymasterAddress;
  policy.updatedAt = event.block.timestamp;
  policy.updatedTx = event.transaction.hash;
  policy.save();

  // Record configuration change
  const configId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const config = new PaymasterPolicyConfiguration(configId);
  config.policy = policy.id;
  config.enabled = policy.enabled;
  config.dailyBudget = policy.dailyBudget;
  config.paymasterAddress = paymasterAddress;
  config.timestamp = event.block.timestamp;
  config.tx = event.transaction.hash;
  config.save();
}

export function handleRolePolicySet(event: RolePolicySetEvent): void {
  const walletAddress = event.address;
  const role = event.params.role;
  const canBeSponsored = event.params.canBeSponsored;
  const dailyLimit = event.params.dailyLimit;

  log.info("👥 Role policy set: wallet={}, role={}, canBeSponsored={}, dailyLimit={}", [
    walletAddress.toHexString(),
    role.toString(),
    canBeSponsored ? "true" : "false",
    dailyLimit.toString(),
  ]);

  // Ensure policy exists
  let policy = PaymasterPolicy.load(walletAddress.toHexString());
  if (!policy) {
    policy = new PaymasterPolicy(walletAddress.toHexString());
    policy.wallet = walletAddress.toHexString();
    policy.enabled = false;
    policy.dailyBudget = BigInt.fromI32(0);
    policy.paymasterAddress = event.transaction.to!;
    policy.totalSponsored = BigInt.fromI32(0);
    policy.updatedAt = event.block.timestamp;
    policy.updatedTx = event.transaction.hash;
    policy.save();
  }

  // Get or create role policy
  const rolePolicyId = walletAddress.toHexString() + "-" + role.toString();
  let rolePolicy = RolePolicy.load(rolePolicyId);
  if (!rolePolicy) {
    rolePolicy = new RolePolicy(rolePolicyId);
    rolePolicy.policy = policy.id;
    rolePolicy.role = role;
    rolePolicy.allowedOperations = [];
  }

  rolePolicy.canBeSponsored = canBeSponsored;
  rolePolicy.dailyLimit = dailyLimit;
  rolePolicy.updatedAt = event.block.timestamp;
  rolePolicy.updatedTx = event.transaction.hash;
  rolePolicy.save();
}

export function handleSpendingRecorded(event: SpendingRecordedEvent): void {
  const user = event.params.user;
  const amount = event.params.amount;

  log.info("📊 Spending recorded: user={}, amount={}", [
    user.toHexString(),
    amount.toString(),
  ]);

  // Note: This event is emitted from the wallet, so we just log it
  // The actual spending is tracked via the Sponsored event from the paymaster
}

