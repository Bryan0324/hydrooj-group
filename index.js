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
  await invitationsColl.updateOne({ _id: invitationId }, { $set: updated });
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
    _id: `${contestId}:${teamId}`,
    contestId,
    teamId,
    identity,
    participants,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await contestEntriesColl.updateOne({ _id: entry._id }, { $set: entry }, { upsert: true });
  return entry;
}

const groupModel = {
  createTeam,
  inviteMember,
  respondInvitation,
  registerContestAsTeam,
  getTeamIdentity: async (teamId) => core.createTeamIdentity(await getTeam(teamId)),
  getUserIdentity: (userId) => core.createUserIdentity(userId),
  resolveIdentity: core.resolveIdentity,
};

if (global.Hydro && global.Hydro.model) {
  global.Hydro.model.group = groupModel;
}

class TeamCreateHandler extends Handler {
  async post() {
    const { name } = this.request.body || {};
    const team = await groupModel.createTeam(this.user._id, name);
    this.response.body = { team };
  }
}

class TeamInviteHandler extends Handler {
  async post() {
    const { teamId, inviteeId } = this.request.body || {};
    const invitation = await groupModel.inviteMember(teamId, this.user._id, inviteeId);
    this.response.body = { invitation };
  }
}

class InvitationRespondHandler extends Handler {
  async post() {
    const { invitationId, accept = false } = this.request.body || {};
    const invitation = await groupModel.respondInvitation(invitationId, this.user._id, !!accept);
    this.response.body = { invitation };
  }
}

class ContestTeamRegisterHandler extends Handler {
  async post() {
    const { contestId, teamId } = this.request.body || {};
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
