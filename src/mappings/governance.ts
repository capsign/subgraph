import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ProposalCreated,
  ProposalCanceled,
  VoteCast,
  ProposalTypeRegistered,
  ProposalTypeUpdated,
  ProposalVetoed,
  SecondTierProposalCreated,
} from "../../generated/templates/WalletDiamond/GovernanceCoreFacet";
import {
  ProposalQueued,
  ProposalExecuted,
} from "../../generated/templates/WalletDiamond/GovernanceExecuteFacet";
import {
  GovernanceConfig,
  ProposalType,
  Proposal,
  Vote,
} from "../../generated/schema";
import { createActivity } from "./activity";

// ============ HELPER FUNCTIONS ============

function getOrCreateGovernanceConfig(walletAddress: string, timestamp: BigInt, tx: Bytes): GovernanceConfig {
  let config = GovernanceConfig.load(walletAddress);
  if (!config) {
    config = new GovernanceConfig(walletAddress);
    config.wallet = walletAddress;
    config.defaultVotingDelay = BigInt.fromI32(0);
    config.defaultVotingPeriod = BigInt.fromI32(0);
    config.defaultProposalThreshold = BigInt.fromI32(0);
    config.defaultVotingToken = Bytes.fromHexString("0x0000000000000000000000000000000000000000");
    config.proposalCount = BigInt.fromI32(0);
    config.createdAt = timestamp;
    config.createdTx = tx;
    config.lastUpdatedAt = timestamp;
    config.lastUpdatedTx = tx;
  }
  return config;
}

function voteTypeToString(support: i32): string {
  if (support === 0) return "AGAINST";
  if (support === 1) return "FOR";
  return "ABSTAIN";
}

// ============ PROPOSAL TYPE HANDLERS ============

/**
 * Handle ProposalTypeRegistered event
 * Event: ProposalTypeRegistered(bytes32 indexed typeId, string name)
 */
export function handleProposalTypeRegistered(event: ProposalTypeRegistered): void {
  const walletAddress = event.address.toHexString();
  const typeId = event.params.typeId.toHexString();
  const entityId = `${walletAddress}-${typeId}`;

  // Ensure governance config exists
  const config = getOrCreateGovernanceConfig(walletAddress, event.block.timestamp, event.transaction.hash);
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;
  config.save();

  let proposalType = new ProposalType(entityId);
  proposalType.governanceConfig = walletAddress;
  proposalType.typeId = event.params.typeId;
  proposalType.name = event.params.name;
  proposalType.quorumBps = event.params.quorumBps;
  proposalType.approvalThresholdBps = event.params.approvalThresholdBps;
  proposalType.votingDelay = BigInt.fromI32(0);
  proposalType.votingPeriod = BigInt.fromI32(0);
  proposalType.timelockDelay = BigInt.fromI32(0);
  proposalType.requiredRoleToPropose = 0;
  proposalType.requiredRoleToVote = 0;
  proposalType.requiresUnanimity = false;
  proposalType.isOptimistic = false;
  proposalType.requiresTwoTierApproval = false;
  proposalType.secondTierTypeId = null;
  proposalType.isActive = true;
  proposalType.createdAt = event.block.timestamp;
  proposalType.createdTx = event.transaction.hash;
  proposalType.lastUpdatedAt = event.block.timestamp;
  proposalType.lastUpdatedTx = event.transaction.hash;
  proposalType.save();
}

/**
 * Handle ProposalTypeUpdated event
 * Event: ProposalTypeUpdated(bytes32 indexed typeId)
 */
export function handleProposalTypeUpdated(event: ProposalTypeUpdated): void {
  const walletAddress = event.address.toHexString();
  const typeId = event.params.typeId.toHexString();
  const entityId = `${walletAddress}-${typeId}`;

  let proposalType = ProposalType.load(entityId);
  if (proposalType) {
    proposalType.lastUpdatedAt = event.block.timestamp;
    proposalType.lastUpdatedTx = event.transaction.hash;
    proposalType.save();
  }
}

// ============ PROPOSAL LIFECYCLE HANDLERS ============

/**
 * Handle ProposalCreated event
 * Event: ProposalCreated(uint256 indexed proposalId, bytes32 indexed proposalType, address indexed proposer,
 *                        address[] targets, uint256[] values, bytes[] calldatas,
 *                        uint256 voteStart, uint256 voteEnd, string description)
 */
export function handleProposalCreated(event: ProposalCreated): void {
  const walletAddress = event.address.toHexString();
  const proposalId = event.params.proposalId;
  const entityId = `${walletAddress}-${proposalId.toString()}`;

  // Update governance config
  const config = getOrCreateGovernanceConfig(walletAddress, event.block.timestamp, event.transaction.hash);
  config.proposalCount = config.proposalCount.plus(BigInt.fromI32(1));
  config.lastUpdatedAt = event.block.timestamp;
  config.lastUpdatedTx = event.transaction.hash;
  config.save();

  // Resolve proposal type name
  const typeEntityId = `${walletAddress}-${event.params.proposalType.toHexString()}`;
  let typeName: string | null = null;
  const proposalType = ProposalType.load(typeEntityId);
  if (proposalType) {
    typeName = proposalType.name;
  }

  // Create proposal entity
  let proposal = new Proposal(entityId);
  proposal.governanceConfig = walletAddress;
  proposal.wallet = walletAddress;
  proposal.proposalId = proposalId;
  proposal.proposalType = event.params.proposalType;
  proposal.proposalTypeName = typeName;
  proposal.proposer = event.params.proposer;
  proposal.description = event.params.description;

  // Execution data
  proposal.targets = event.params.targets.map<Bytes>((addr) => addr as Bytes);
  proposal.values = event.params.values;
  proposal.calldatas = event.params.calldatas;

  // Timing
  proposal.voteStart = event.params.voteStart;
  proposal.voteEnd = event.params.voteEnd;
  proposal.executionETA = null;

  // Vote tallies
  proposal.forVotes = BigInt.fromI32(0);
  proposal.againstVotes = BigInt.fromI32(0);
  proposal.abstainVotes = BigInt.fromI32(0);
  proposal.voterCount = 0;

  // State flags
  proposal.canceled = false;
  proposal.executed = false;
  proposal.vetoed = false;
  proposal.vetoedBy = null;

  // Two-tier (default to single-tier, updated if SecondTierProposalCreated fires)
  proposal.tier = 0;
  proposal.parentProposal = null;
  proposal.childProposal = null;

  // Initial state
  proposal.currentState = "PENDING";

  proposal.createdAt = event.block.timestamp;
  proposal.createdTx = event.transaction.hash;
  proposal.blockNumber = event.block.number;
  proposal.save();

  // Create activity
  const activity = createActivity(
    `proposal-created-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
    "PROPOSAL_CREATED",
    event.params.proposer,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = entityId;
  activity.save();
}

/**
 * Handle ProposalCanceled event
 * Event: ProposalCanceled(uint256 indexed proposalId, address indexed canceledBy)
 */
export function handleProposalCanceled(event: ProposalCanceled): void {
  const walletAddress = event.address.toHexString();
  const entityId = `${walletAddress}-${event.params.proposalId.toString()}`;

  let proposal = Proposal.load(entityId);
  if (proposal) {
    proposal.canceled = true;
    proposal.currentState = "CANCELED";
    proposal.save();
  }

  // Create activity
  const activity = createActivity(
    `proposal-canceled-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
    "PROPOSAL_CANCELED",
    event.params.canceledBy,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = entityId;
  activity.save();
}

/**
 * Handle VoteCast event
 * Event: VoteCast(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 weight, string reason)
 */
export function handleVoteCast(event: VoteCast): void {
  const walletAddress = event.address.toHexString();
  const proposalEntityId = `${walletAddress}-${event.params.proposalId.toString()}`;
  const voteId = `${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`;

  // Create vote entity
  let vote = new Vote(voteId);
  vote.proposal = proposalEntityId;
  vote.voter = event.params.voter;
  vote.support = voteTypeToString(event.params.support);
  vote.weight = event.params.weight;
  vote.reason = event.params.reason;
  vote.timestamp = event.block.timestamp;
  vote.tx = event.transaction.hash;
  vote.blockNumber = event.block.number;
  vote.save();

  // Update proposal vote tallies
  let proposal = Proposal.load(proposalEntityId);
  if (proposal) {
    if (event.params.support === 0) {
      proposal.againstVotes = proposal.againstVotes.plus(event.params.weight);
    } else if (event.params.support === 1) {
      proposal.forVotes = proposal.forVotes.plus(event.params.weight);
    } else {
      proposal.abstainVotes = proposal.abstainVotes.plus(event.params.weight);
    }
    proposal.voterCount = proposal.voterCount + 1;
    proposal.currentState = "ACTIVE";
    proposal.save();
  }

  // Create activity
  const activity = createActivity(
    `vote-cast-${voteId}`,
    "VOTE_CAST",
    event.params.voter,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = proposalEntityId;
  activity.vote = voteId;
  activity.save();
}

/**
 * Handle ProposalQueued event
 * Event: ProposalQueued(uint256 indexed proposalId, uint256 eta)
 */
export function handleProposalQueued(event: ProposalQueued): void {
  const walletAddress = event.address.toHexString();
  const entityId = `${walletAddress}-${event.params.proposalId.toString()}`;

  let proposal = Proposal.load(entityId);
  if (proposal) {
    proposal.executionETA = event.params.eta;
    proposal.currentState = "QUEUED";
    proposal.save();
  }

  // Create activity
  const activity = createActivity(
    `proposal-queued-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
    "PROPOSAL_QUEUED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = entityId;
  activity.save();
}

/**
 * Handle ProposalExecuted event
 * Event: ProposalExecuted(uint256 indexed proposalId)
 */
export function handleProposalExecuted(event: ProposalExecuted): void {
  const walletAddress = event.address.toHexString();
  const entityId = `${walletAddress}-${event.params.proposalId.toString()}`;

  let proposal = Proposal.load(entityId);
  if (proposal) {
    proposal.executed = true;
    proposal.currentState = "EXECUTED";
    proposal.save();

    // If this is a tier-2 execution, also mark the parent as executed
    if (proposal.tier == 2 && proposal.parentProposal != null) {
      let parent = Proposal.load(proposal.parentProposal!);
      if (parent) {
        parent.executed = true;
        parent.currentState = "EXECUTED";
        parent.save();
      }
    }
  }

  // Create activity
  const activity = createActivity(
    `proposal-executed-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
    "PROPOSAL_EXECUTED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = entityId;
  activity.save();
}

/**
 * Handle ProposalVetoed event
 * Event: ProposalVetoed(uint256 indexed proposalId, address indexed vetoedBy)
 */
export function handleProposalVetoed(event: ProposalVetoed): void {
  const walletAddress = event.address.toHexString();
  const entityId = `${walletAddress}-${event.params.proposalId.toString()}`;

  let proposal = Proposal.load(entityId);
  if (proposal) {
    proposal.vetoed = true;
    proposal.vetoedBy = event.params.vetoedBy;
    proposal.currentState = "CANCELED";
    proposal.save();
  }

  // Create activity
  const activity = createActivity(
    `proposal-vetoed-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
    "PROPOSAL_VETOED",
    event.params.vetoedBy,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = entityId;
  activity.save();
}

// ============ TWO-TIER GOVERNANCE HANDLERS ============

/**
 * Handle SecondTierProposalCreated event
 * Event: SecondTierProposalCreated(uint256 indexed parentProposalId, uint256 indexed childProposalId, bytes32 indexed secondTierTypeId)
 */
export function handleSecondTierProposalCreated(event: SecondTierProposalCreated): void {
  const walletAddress = event.address.toHexString();
  const parentEntityId = `${walletAddress}-${event.params.parentProposalId.toString()}`;
  const childEntityId = `${walletAddress}-${event.params.childProposalId.toString()}`;

  // Update parent to be tier 1 and link to child
  let parent = Proposal.load(parentEntityId);
  if (parent) {
    parent.tier = 1;
    parent.childProposal = childEntityId;
    parent.save();
  }

  // Update child to be tier 2 and link to parent
  let child = Proposal.load(childEntityId);
  if (child) {
    child.tier = 2;
    child.parentProposal = parentEntityId;
    child.save();
  }

  // Create activity
  const activity = createActivity(
    `second-tier-created-${event.transaction.hash.toHexString()}-${event.logIndex.toString()}`,
    "SECOND_TIER_PROPOSAL_CREATED",
    event.transaction.from,
    event.block.timestamp,
    event.transaction.hash,
    event.block.number,
    event.address
  );
  activity.proposal = childEntityId;
  activity.save();
}
