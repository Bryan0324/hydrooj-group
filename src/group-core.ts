export const TEAM_STATE = Object.freeze({
  ACTIVE: 'active',
} as const);

export const INVITATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELED: 'canceled',
} as const);

export type TeamState = typeof TEAM_STATE[keyof typeof TEAM_STATE];
export type InvitationStatus = typeof INVITATION_STATUS[keyof typeof INVITATION_STATUS];

/** Persisted team document stored in `group_teams` collection. */
export interface TeamDoc {
  _id: string;
  ownerId: number;
  name: string;
  state: TeamState;
  /** All member user IDs, always includes ownerId. */
  members: number[];
  createdAt: Date;
  updatedAt: Date;
}

/** Persisted invitation document stored in `group_invitations` collection. */
export interface InvitationDoc {
  _id: string;
  teamId: string;
  inviterId: number;
  inviteeId: number;
  status: InvitationStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Abstraction layer for contest participation identity.
 *
 * A `TeamIdentity` maps a team entry to all its member user IDs, while
 * a `UserIdentity` wraps a single user in the same interface so that
 * contest logic can treat both cases uniformly via `resolveIdentity()`.
 */
export interface TeamIdentity {
  kind: 'team';
  id: string;
  ownerId: number;
  memberIds: number[];
}

export interface UserIdentity {
  kind: 'user';
  id: number;
  ownerId: number;
  memberIds: number[];
}

export type Identity = TeamIdentity | UserIdentity;

/** Contest entry document stored in `group_contest_entries` collection. */
export interface ContestEntryDoc {
  contestId: string;
  teamId: string;
  identity: Identity;
  /** Resolved flat list of participant user IDs. */
  participants: number[];
  updatedAt: Date;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

function ensureNonEmptyName(name: string): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Team name must be a non-empty string');
  }
  return name.trim();
}

function now(): Date {
  return new Date();
}

function normalizeMembers(ownerId: number, members: number[] = []): number[] {
  return Array.from(new Set([ownerId, ...members]));
}

// ----------------------------------------------------------------
// Public factory functions
// ----------------------------------------------------------------

export interface CreateTeamInput {
  id: string;
  ownerId: number;
  name: string;
  members?: number[];
}

export function createTeamRecord({ id, ownerId, name, members = [] }: CreateTeamInput): TeamDoc {
  return {
    _id: id,
    ownerId,
    name: ensureNonEmptyName(name),
    state: TEAM_STATE.ACTIVE,
    members: normalizeMembers(ownerId, members),
    createdAt: now(),
    updatedAt: now(),
  };
}

export interface CreateInvitationInput {
  id: string;
  teamId: string;
  inviterId: number;
  inviteeId: number;
}

export function createInvitationRecord({ id, teamId, inviterId, inviteeId }: CreateInvitationInput): InvitationDoc {
  if (!teamId) throw new Error('teamId is required');
  if (!inviterId) throw new Error('inviterId is required');
  if (!inviteeId) throw new Error('inviteeId is required');
  return {
    _id: id,
    teamId,
    inviterId,
    inviteeId,
    status: INVITATION_STATUS.PENDING,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function canInvite(team: TeamDoc, inviterId: number, inviteeId: number): boolean {
  if (!team || team.state !== TEAM_STATE.ACTIVE) return false;
  if (team.ownerId !== inviterId) return false;
  if (team.members.includes(inviteeId)) return false;
  return true;
}

export function applyInvitationDecision(
  invitation: InvitationDoc,
  userId: number,
  accept: boolean,
): InvitationDoc {
  if (!invitation) throw new Error('Invitation not found');
  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw new Error(`Invitation ${invitation._id} is not pending`);
  }
  if (invitation.inviteeId !== userId) {
    throw new Error(`Only invitee ${invitation.inviteeId} can respond`);
  }
  return {
    ...invitation,
    status: accept ? INVITATION_STATUS.ACCEPTED : INVITATION_STATUS.DECLINED,
    updatedAt: now(),
  };
}

export function createTeamIdentity(team: TeamDoc): TeamIdentity {
  if (!team) throw new Error('Team not found');
  return {
    kind: 'team',
    id: team._id,
    ownerId: team.ownerId,
    memberIds: [...team.members],
  };
}

export function createUserIdentity(userId: number): UserIdentity {
  return {
    kind: 'user',
    id: userId,
    ownerId: userId,
    memberIds: [userId],
  };
}

/** Returns the deduplicated flat list of participant user IDs for a given identity. */
export function resolveIdentity(identity: Identity): number[] {
  if (!identity || !Array.isArray(identity.memberIds)) throw new Error('Invalid identity');
  return [...new Set(identity.memberIds)];
}
