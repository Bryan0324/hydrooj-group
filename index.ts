import crypto from 'node:crypto';
import {
  Context,
  db,
  Handler,
  PRIV,
  PermissionError,
  NotFoundError,
  BadRequestError,
} from 'hydrooj';
import type { Filter, UpdateFilter, WithId } from 'mongodb';
import {
  type TeamDoc,
  type InvitationDoc,
  type ContestEntryDoc,
  type Identity,
  INVITATION_STATUS,
  createTeamRecord,
  createInvitationRecord,
  canInvite,
  applyInvitationDecision,
  createTeamIdentity,
  createUserIdentity,
  resolveIdentity,
} from './src/group-core';

// ----------------------------------------------------------------
// Extend Hydro's Collections and Model interfaces for type-safety
// across the entire HydroOJ plugin ecosystem.
// ----------------------------------------------------------------
declare module 'hydrooj' {
  interface Collections {
    group_teams: TeamDoc;
    group_invitations: InvitationDoc;
    group_contest_entries: ContestEntryDoc;
  }

  interface Model {
    group: typeof groupModel;
  }
}

// ----------------------------------------------------------------
// MongoDB collections — typed via augmented Collections interface.
// TypeScript resolves db.collection('group_teams') to Collection<TeamDoc>.
// ----------------------------------------------------------------
const teamsColl = db.collection('group_teams');
const invitationsColl = db.collection('group_invitations');
const contestEntriesColl = db.collection('group_contest_entries');

// ----------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------

function genId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Reads a parameter first from `request.params` (URL path params),
 * falling back to `request.body` (POST body).
 */
function pickParam(handler: Handler, key: string): unknown {
  const params = handler.request.params ?? {};
  const body = (handler.request.body ?? {}) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
  return body[key];
}

/**
 * Like `pickParam` but throws `BadRequestError` when the value is absent.
 */
function requireParam(handler: Handler, key: string): unknown {
  const value = pickParam(handler, key);
  if (value === undefined || value === null || value === '') {
    throw new BadRequestError(`${key} is required`);
  }
  return value;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

// ----------------------------------------------------------------
// Domain logic
// ----------------------------------------------------------------

async function createTeam(ownerId: number, name: string): Promise<TeamDoc> {
  const team = createTeamRecord({ id: genId(), ownerId, name });
  await teamsColl.insertOne(team);
  return team;
}

async function getTeam(teamId: string): Promise<TeamDoc | null> {
  const filter: Filter<TeamDoc> = { _id: teamId };
  const doc = await teamsColl.findOne(filter);
  return doc as TeamDoc | null;
}

async function inviteMember(
  teamId: string,
  inviterId: number,
  inviteeId: number,
): Promise<InvitationDoc> {
  const team = await getTeam(teamId);
  if (!team) throw new NotFoundError(teamId);
  if (!canInvite(team, inviterId, inviteeId)) throw new PermissionError('No permission to invite');
  const pendingFilter: Filter<InvitationDoc> = {
    teamId,
    inviteeId,
    status: INVITATION_STATUS.PENDING,
  };
  const existing = await invitationsColl.findOne(pendingFilter);
  if (existing) throw new BadRequestError('Invitation already pending');
  const invitation = createInvitationRecord({ id: genId(), teamId, inviterId, inviteeId });
  await invitationsColl.insertOne(invitation);
  return invitation;
}

async function respondInvitation(
  invitationId: string,
  userId: number,
  accept: boolean,
): Promise<InvitationDoc> {
  const filter: Filter<InvitationDoc> = { _id: invitationId };
  const raw = await invitationsColl.findOne(filter);
  if (!raw) throw new NotFoundError(invitationId);
  const invitation = raw as InvitationDoc;
  const updated = applyInvitationDecision(invitation, userId, accept);
  const invUpdate: UpdateFilter<InvitationDoc> = {
    $set: { status: updated.status, updatedAt: updated.updatedAt },
  };
  await invitationsColl.updateOne(filter, invUpdate);
  if (updated.status === INVITATION_STATUS.ACCEPTED) {
    const teamFilter: Filter<TeamDoc> = { _id: updated.teamId };
    const teamUpdate: UpdateFilter<TeamDoc> = {
      $addToSet: { members: userId },
      $set: { updatedAt: new Date() },
    };
    await teamsColl.updateOne(teamFilter, teamUpdate);
  }
  return updated;
}

async function registerContestAsTeam(
  contestId: string,
  teamId: string,
  operatorId: number,
): Promise<ContestEntryDoc> {
  const team = await getTeam(teamId);
  if (!team) throw new NotFoundError(teamId);
  if (!team.members.includes(operatorId)) throw new PermissionError('Not a team member');
  const identity: Identity = createTeamIdentity(team);
  const participants = resolveIdentity(identity);
  const entry: ContestEntryDoc = {
    contestId,
    teamId,
    identity,
    participants,
    updatedAt: new Date(),
  };
  const entryFilter: Filter<ContestEntryDoc> = { contestId, teamId };
  const entryUpdate: UpdateFilter<ContestEntryDoc> = {
    $set: entry,
    $setOnInsert: { _id: genId(), createdAt: new Date() } as Partial<ContestEntryDoc>,
  };
  await contestEntriesColl.updateOne(entryFilter, entryUpdate, { upsert: true });
  return entry;
}

// ----------------------------------------------------------------
// Public model (exposed on global.Hydro.model.group)
// ----------------------------------------------------------------

const groupModel = {
  createTeam,
  inviteMember,
  respondInvitation,
  registerContestAsTeam,
  getTeamIdentity: async (teamId: string) => {
    const team = await getTeam(teamId);
    if (!team) throw new NotFoundError(teamId);
    return createTeamIdentity(team);
  },
  getUserIdentity: (userId: number) => createUserIdentity(userId),
  resolveIdentity,
};

// Register model on the global Hydro namespace when running inside Hydro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = global as any;
if (g?.Hydro?.model) {
  g.Hydro.model.group = groupModel;
}

// ----------------------------------------------------------------
// HTTP Handlers
// ----------------------------------------------------------------

class TeamCreateHandler extends Handler {
  async post(_domainId?: string): Promise<void> {
    const name = String(requireParam(this, 'name'));
    const team = await groupModel.createTeam(this.user._id, name);
    this.response.body = { team };
  }
}

class TeamInviteHandler extends Handler {
  async post(_domainId?: string): Promise<void> {
    const teamId = String(requireParam(this, 'teamId'));
    const rawInviteeId = requireParam(this, 'inviteeId');
    const inviteeId = Number.parseInt(String(rawInviteeId), 10);
    if (Number.isNaN(inviteeId) || inviteeId <= 0 || String(inviteeId) !== String(rawInviteeId).trim()) {
      throw new BadRequestError('inviteeId must be a valid positive integer');
    }
    const invitation = await groupModel.inviteMember(teamId, this.user._id, inviteeId);
    this.response.body = { invitation };
  }
}

class InvitationRespondHandler extends Handler {
  async post(_domainId?: string): Promise<void> {
    const invitationId = String(requireParam(this, 'invitationId'));
    const accept = pickParam(this, 'accept');
    const invitation = await groupModel.respondInvitation(
      invitationId,
      this.user._id,
      parseBoolean(accept),
    );
    this.response.body = { invitation };
  }
}

class ContestTeamRegisterHandler extends Handler {
  async post(_domainId?: string): Promise<void> {
    const contestId = String(requireParam(this, 'contestId'));
    const teamId = String(requireParam(this, 'teamId'));
    const entry = await groupModel.registerContestAsTeam(contestId, teamId, this.user._id);
    this.response.body = { entry };
  }
}

// ----------------------------------------------------------------
// Plugin entry point — called by Hydro's plugin loader.
// ----------------------------------------------------------------

export function apply(ctx: Context): void {
  ctx.Route('group_team_create', '/group/team/create', TeamCreateHandler, PRIV.PRIV_USER_PROFILE);
  ctx.Route('group_team_invite', '/group/team/:teamId/invite', TeamInviteHandler, PRIV.PRIV_USER_PROFILE);
  ctx.Route('group_invitation_respond', '/group/invitation/:invitationId/respond', InvitationRespondHandler, PRIV.PRIV_USER_PROFILE);
  ctx.Route('group_contest_register', '/group/contest/:contestId/team/:teamId/register', ContestTeamRegisterHandler, PRIV.PRIV_USER_PROFILE);
}

export { groupModel };
export * from './src/group-core';
