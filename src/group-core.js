'use strict';

const TEAM_STATE = Object.freeze({
  ACTIVE: 'active',
});

const INVITATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELED: 'canceled',
});

function ensureNonEmptyName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Team name must be a non-empty string');
  return name.trim();
}

function now() {
  return new Date();
}

function normalizeMembers(ownerId, members = []) {
  const set = new Set([ownerId, ...members]);
  return Array.from(set);
}

function createTeamRecord({ id, ownerId, name, members = [] }) {
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

function createInvitationRecord({ id, teamId, inviterId, inviteeId }) {
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

function canInvite(team, inviterId, inviteeId) {
  if (!team || team.state !== TEAM_STATE.ACTIVE) return false;
  if (team.ownerId !== inviterId) return false;
  if (team.members.includes(inviteeId)) return false;
  return true;
}

function applyInvitationDecision(invitation, userId, accept) {
  if (!invitation) throw new Error('Invitation not found');
  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw new Error(`Invitation ${invitation._id || ''} is not pending`);
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

function createTeamIdentity(team) {
  if (!team) throw new Error('Team not found');
  return {
    kind: 'team',
    id: team._id,
    ownerId: team.ownerId,
    memberIds: [...team.members],
  };
}

function createUserIdentity(userId) {
  return {
    kind: 'user',
    id: userId,
    ownerId: userId,
    memberIds: [userId],
  };
}

function resolveIdentity(identity) {
  if (!identity || !Array.isArray(identity.memberIds)) throw new Error('Invalid identity');
  return [...new Set(identity.memberIds)];
}

module.exports = {
  TEAM_STATE,
  INVITATION_STATUS,
  createTeamRecord,
  createInvitationRecord,
  canInvite,
  applyInvitationDecision,
  createTeamIdentity,
  createUserIdentity,
  resolveIdentity,
};
