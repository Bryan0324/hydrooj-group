import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITATION_STATUS,
  createTeamRecord,
  createInvitationRecord,
  canInvite,
  applyInvitationDecision,
  createTeamIdentity,
  resolveIdentity,
} from '../src/group-core';

test('team owner is included in normalized members', () => {
  const team = createTeamRecord({
    id: 't1',
    ownerId: 1001,
    name: 'Alpha',
    members: [1002, 1001, 1003],
  });
  const members = [...team.members].sort((a, b) => a - b);
  assert.deepEqual(members, [1001, 1002, 1003]);
});

test('owner can invite non-member', () => {
  const team = createTeamRecord({
    id: 't1',
    ownerId: 1001,
    name: 'Alpha',
    members: [1002],
  });
  assert.equal(canInvite(team, 1001, 1003), true);
  assert.equal(canInvite(team, 1002, 1003), false);
  assert.equal(canInvite(team, 1001, 1002), false);
});

test('invitee can accept invitation once', () => {
  const invitation = createInvitationRecord({
    id: 'i1',
    teamId: 't1',
    inviterId: 1001,
    inviteeId: 1002,
  });
  const accepted = applyInvitationDecision(invitation, 1002, true);
  assert.equal(accepted.status, INVITATION_STATUS.ACCEPTED);
  assert.throws(() => applyInvitationDecision(accepted, 1002, true), /not pending/);
});

test('team identity resolves all members for contest compatibility', () => {
  const team = createTeamRecord({
    id: 't1',
    ownerId: 1001,
    name: 'Alpha',
    members: [1002, 1003],
  });
  const identity = createTeamIdentity(team);
  const participants = resolveIdentity(identity).sort((a, b) => a - b);
  assert.deepEqual(participants, [1001, 1002, 1003]);
});

test('resolveIdentity works for user identity', () => {
  const { createUserIdentity } = require('../src/group-core') as typeof import('../src/group-core');
  const identity = createUserIdentity(42);
  assert.deepEqual(resolveIdentity(identity), [42]);
});

test('createTeamRecord rejects blank name', () => {
  assert.throws(
    () => createTeamRecord({ id: 't1', ownerId: 1, name: '   ' }),
    /non-empty/,
  );
});

test('only invitee can respond to invitation', () => {
  const invitation = createInvitationRecord({
    id: 'i2',
    teamId: 't1',
    inviterId: 1001,
    inviteeId: 1002,
  });
  assert.throws(() => applyInvitationDecision(invitation, 9999, true), /Only invitee/);
});
