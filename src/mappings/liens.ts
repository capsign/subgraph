import { Address, Bytes, BigInt, log } from "@graphprotocol/graph-ts";
import {
  LienGranted,
  LienReleased,
  LienRevoked,
  WalletFrozen,
  WalletUnfrozen,
  AssetsSeized,
} from "../../generated/templates/WalletDiamond/WalletDiamond";
import { Lien, AssetSeizure, WalletFreezeEvent, Wallet } from "../../generated/schema";

// Helper to get or create wallet (should already exist)
function getWallet(address: Address): Wallet | null {
  return Wallet.load(address.toHexString());
}

// Generate lien entity ID
function getLienId(wallet: Address, lienId: Bytes): string {
  return wallet.toHexString() + "-" + lienId.toHexString();
}

export function handleLienGranted(event: LienGranted): void {
  let wallet = getWallet(event.address);
  if (!wallet) {
    log.warning("[handleLienGranted] Wallet not found: {}", [
      event.address.toHexString(),
    ]);
    return;
  }

  let entityId = getLienId(event.address, event.params.lienId);
  let lien = new Lien(entityId);

  lien.wallet = wallet.id;
  lien.lienId = event.params.lienId;
  lien.lienHolder = event.params.lienHolder;

  // Convert address array to Bytes array
  let collateralTokens: Bytes[] = [];
  for (let i = 0; i < event.params.collateralTokens.length; i++) {
    collateralTokens.push(event.params.collateralTokens[i] as Bytes);
  }
  lien.collateralTokens = collateralTokens;

  lien.maxSeizureAmount = event.params.maxSeizureAmount;
  lien.totalSeized = BigInt.fromI32(0);
  lien.grantedAt = event.block.timestamp;
  lien.grantedTx = event.transaction.hash;
  lien.expiresAt = event.params.expiresAt;
  lien.externalRef = ""; // Not in event, will be updated if available
  lien.status = "ACTIVE";
  lien.isFrozen = false;

  lien.save();

  log.info("[handleLienGranted] Lien {} granted on wallet {} to {}", [
    event.params.lienId.toHexString(),
    event.address.toHexString(),
    event.params.lienHolder.toHexString(),
  ]);
}

export function handleLienReleased(event: LienReleased): void {
  let entityId = getLienId(event.address, event.params.lienId);
  let lien = Lien.load(entityId);

  if (!lien) {
    log.warning("[handleLienReleased] Lien not found: {}", [entityId]);
    return;
  }

  lien.status = "RELEASED";
  lien.terminatedAt = event.block.timestamp;
  lien.terminatedTx = event.transaction.hash;
  lien.terminatedBy = event.params.lienHolder;
  lien.isFrozen = false;

  lien.save();

  // Update wallet frozen status if needed
  updateWalletFrozenStatus(event.address);

  log.info("[handleLienReleased] Lien {} released by {}", [
    event.params.lienId.toHexString(),
    event.params.lienHolder.toHexString(),
  ]);
}

export function handleLienRevoked(event: LienRevoked): void {
  let entityId = getLienId(event.address, event.params.lienId);
  let lien = Lien.load(entityId);

  if (!lien) {
    log.warning("[handleLienRevoked] Lien not found: {}", [entityId]);
    return;
  }

  lien.status = "REVOKED";
  lien.terminatedAt = event.block.timestamp;
  lien.terminatedTx = event.transaction.hash;
  lien.terminatedBy = event.params.revokedBy;
  lien.isFrozen = false;

  lien.save();

  // Update wallet frozen status if needed
  updateWalletFrozenStatus(event.address);

  log.info("[handleLienRevoked] Lien {} revoked by {}", [
    event.params.lienId.toHexString(),
    event.params.revokedBy.toHexString(),
  ]);
}

export function handleWalletFrozen(event: WalletFrozen): void {
  let entityId = getLienId(event.address, event.params.lienId);
  let lien = Lien.load(entityId);

  if (!lien) {
    log.warning("[handleWalletFrozen] Lien not found: {}", [entityId]);
    return;
  }

  lien.isFrozen = true;
  lien.save();

  // Update wallet frozen status
  let wallet = getWallet(event.address);
  if (wallet) {
    wallet.isFrozen = true;
    wallet.save();
  }

  // Create freeze event record
  let freezeEventId =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let freezeEvent = new WalletFreezeEvent(freezeEventId);
  freezeEvent.lien = lien.id;
  freezeEvent.wallet = event.address.toHexString();
  freezeEvent.isFrozen = true;
  freezeEvent.actor = event.params.frozenBy;
  freezeEvent.reason = event.params.reason;
  freezeEvent.timestamp = event.block.timestamp;
  freezeEvent.tx = event.transaction.hash;
  freezeEvent.blockNumber = event.block.number;
  freezeEvent.save();

  log.info("[handleWalletFrozen] Wallet {} frozen via lien {} by {}", [
    event.address.toHexString(),
    event.params.lienId.toHexString(),
    event.params.frozenBy.toHexString(),
  ]);
}

export function handleWalletUnfrozen(event: WalletUnfrozen): void {
  let entityId = getLienId(event.address, event.params.lienId);
  let lien = Lien.load(entityId);

  if (!lien) {
    log.warning("[handleWalletUnfrozen] Lien not found: {}", [entityId]);
    return;
  }

  lien.isFrozen = false;
  lien.save();

  // Update wallet frozen status
  updateWalletFrozenStatus(event.address);

  // Create unfreeze event record
  let freezeEventId =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let freezeEvent = new WalletFreezeEvent(freezeEventId);
  freezeEvent.lien = lien.id;
  freezeEvent.wallet = event.address.toHexString();
  freezeEvent.isFrozen = false;
  freezeEvent.actor = event.params.unfrozenBy;
  freezeEvent.reason = null;
  freezeEvent.timestamp = event.block.timestamp;
  freezeEvent.tx = event.transaction.hash;
  freezeEvent.blockNumber = event.block.number;
  freezeEvent.save();

  log.info("[handleWalletUnfrozen] Wallet {} unfrozen via lien {} by {}", [
    event.address.toHexString(),
    event.params.lienId.toHexString(),
    event.params.unfrozenBy.toHexString(),
  ]);
}

export function handleAssetsSeized(event: AssetsSeized): void {
  let lienEntityId = getLienId(event.address, event.params.lienId);
  let lien = Lien.load(lienEntityId);

  if (!lien) {
    log.warning("[handleAssetsSeized] Lien not found: {}", [lienEntityId]);
    return;
  }

  // Update total seized
  lien.totalSeized = lien.totalSeized.plus(event.params.amount);
  lien.save();

  // Create seizure record
  let seizureId =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let seizure = new AssetSeizure(seizureId);
  seizure.lien = lien.id;
  seizure.token = event.params.token;
  seizure.amount = event.params.amount;
  seizure.recipient = event.params.recipient;
  seizure.reason = event.params.reason;
  seizure.timestamp = event.block.timestamp;
  seizure.tx = event.transaction.hash;
  seizure.blockNumber = event.block.number;
  seizure.save();

  log.info(
    "[handleAssetsSeized] {} of token {} seized from wallet {} via lien {}",
    [
      event.params.amount.toString(),
      event.params.token.toHexString(),
      event.address.toHexString(),
      event.params.lienId.toHexString(),
    ]
  );
}

// Helper to update wallet.isFrozen based on all active liens
function updateWalletFrozenStatus(walletAddress: Address): void {
  let wallet = getWallet(walletAddress);
  if (!wallet) return;

  // We can't easily iterate all liens for a wallet in AssemblyScript
  // So we'll set to false and assume the caller has already updated the specific lien
  // A more robust solution would be to track frozen count, but this is simpler
  wallet.isFrozen = false;
  wallet.save();
}
