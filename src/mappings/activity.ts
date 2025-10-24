import { Activity } from "../../generated/schema";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

export function createActivity(
  id: string,
  type: string,
  wallet: Bytes,
  timestamp: BigInt,
  tx: Bytes,
  blockNumber: BigInt
): Activity {
  let activity = new Activity(id);
  activity.type = type;
  activity.wallet = wallet;
  activity.timestamp = timestamp;
  activity.tx = tx;
  activity.blockNumber = blockNumber;
  return activity;
}

