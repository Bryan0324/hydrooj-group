'use strict';

const crypto = require('node:crypto');
const {
  db,
  Handler,
  PRIV,
  PermissionError,
  NotFoundError,
  BadRequestError,
} = require('hydrooj');
const core = require('./src/group-core');

const teamsColl = db.collection('group_teams');
const invitationsColl = db.collection('group_invitations');
const contestEntriesColl = db.collection('group_contest_entries');

function genId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function pickParam(handler, key) {
  const params = (handler.request && handler.request.params) || {};
  const body = (handler.request && handler.request.body) || {};
  if (params[key] !== undefined) return params[key];
  return body[key];
}

function requireParam(handler, key) {
  const value = pickParam(handler, key);
  if (value === undefined || value === null || value === '') {
    throw new BadRequestError(`${key} is required`);
  }
  return value;
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function createTeam(ownerId, name) {
  const team = core.createTeamRecord({
    id: genId(),
    ownerId,
    name,
  });
  await teamsColl.insertOne(team);
  return team;
}

async function getTeam(teamId) {
  return teamsColl.findOne({ _id: teamId });
}

async function inviteMember(teamId, inviterId, inviteeId) {
  const team = await getTeam(teamId);
  if (!team) throw new NotFoundError(teamId);
  if (!core.canInvite(team, inviterId, inviteeId)) throw new PermissionError('No permission to invite');
  const existing = await invitationsColl.findOne({
    teamId,
    inviteeId,
    status: core.INVITATION_STATUS.PENDING,
  });
  if (existing) throw new BadRequestError('Invitation already pending');
  const invitation = core.createInvitationRecord({
    id: genId(),
    teamId,
    inviterId,
    inviteeId,
  });
  await invitationsColl.insertOne(invitation);
  return invitation;
}

async function respondInvitation(invitationId, userId, accept) {
  const invitation = await invitationsColl.findOne({ _id: invitationId });
  if (!invitation) throw new NotFoundError(invitationId);
  const updated = core.applyInvitationDecision(invitation, userId, accept);
  await invitationsColl.updateOne(
    { _id: invitationId },
    { $set: { status: updated.status, updatedAt: updated.updatedAt } },
  );
  if (updated.status === core.INVITATION_STATUS.ACCEPTED) {
    await teamsColl.updateOne(
      { _id: updated.teamId },
      { $addToSet: { members: userId }, $set: { updatedAt: new Date() } },
    );
  }
  return updated;
}

async function registerContestAsTeam(contestId, teamId, operatorId) {
  const team = await getTeam(teamId);
  if (!team) throw new NotFoundError(teamId);
  if (!team.members.includes(operatorId)) throw new PermissionError('Not a team member');
  const identity = core.createTeamIdentity(team);
  const participants = core.resolveIdentity(identity);
  const entry = {
    contestId,
    teamId,
    identity,
    participants,
    updatedAt: new Date(),
  };
  await contestEntriesColl.updateOne(
    { contestId, teamId },
    { $set: entry, $setOnInsert: { _id: genId(), createdAt: new Date() } },
    { upsert: true },
  );
  return entry;
}

const groupModel = {
  createTeam,
  inviteMember,
  respondInvitation,
  registerContestAsTeam,
  getTeamIdentity: async (teamId) => {
    const team = await getTeam(teamId);
    if (!team) throw new NotFoundError(teamId);
    return core.createTeamIdentity(team);
  },
  getUserIdentity: (userId) => core.createUserIdentity(userId),
  resolveIdentity: core.resolveIdentity,
};

if (global.Hydro && global.Hydro.model) {
  global.Hydro.model.group = groupModel;
}

class TeamCreateHandler extends Handler {
  async post() {
    const name = requireParam(this, 'name');
    const team = await groupModel.createTeam(this.user._id, name);
    this.response.body = { team };
  }
}

class TeamInviteHandler extends Handler {
  async post() {
    const teamId = requireParam(this, 'teamId');
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
  async post() {
    const invitationId = requireParam(this, 'invitationId');
    const accept = pickParam(this, 'accept');
    const invitation = await groupModel.respondInvitation(invitationId, this.user._id, parseBoolean(accept));
    this.response.body = { invitation };
  }
}

class ContestTeamRegisterHandler extends Handler {
  async post() {
    const contestId = requireParam(this, 'contestId');
    const teamId = requireParam(this, 'teamId');
    const entry = await groupModel.registerContestAsTeam(contestId, teamId, this.user._id);
    this.response.body = { entry };
  }
}

function apply(ctx) {
  ctx.Route('group_team_create', '/group/team/create', TeamCreateHandler, PRIV.PRIV_USER_PROFILE);
  ctx.Route('group_team_invite', '/group/team/:teamId/invite', TeamInviteHandler, PRIV.PRIV_USER_PROFILE);
  ctx.Route('group_invitation_respond', '/group/invitation/:invitationId/respond', InvitationRespondHandler, PRIV.PRIV_USER_PROFILE);
  ctx.Route('group_contest_register', '/group/contest/:contestId/team/:teamId/register', ContestTeamRegisterHandler, PRIV.PRIV_USER_PROFILE);
}

module.exports = {
  apply,
  groupModel,
  ...core,
};
