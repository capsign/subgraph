import { Activity } from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

/**
 * Create an activity entity.
 * 
 * @param id Unique activity ID (usually tx-hash-logIndex)
 * @param type Activity type (e.g., CAPITAL_CALL_CREATED)
 * @param wallet The wallet that initiated/owns this activity
 * @param timestamp Block timestamp
 * @param tx Transaction hash
 * @param blockNumber Block number
 * @param targetWallet Optional - the wallet that is the subject/target of this activity
 *                     (e.g., fund wallet for capital calls created by a GP)
 */
export function createActivity(
  id: string,
  type: string,
  wallet: Bytes,
  timestamp: BigInt,
  tx: Bytes,
  blockNumber: BigInt,
  targetWallet: Bytes | null = null
): Activity {
  let activity = new Activity(id);
  activity.type = type;
  activity.wallet = wallet;
  activity.targetWallet = targetWallet;
  activity.timestamp = timestamp;
  activity.tx = tx;
  activity.blockNumber = blockNumber;
  return activity;
}

