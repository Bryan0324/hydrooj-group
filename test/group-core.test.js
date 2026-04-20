'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/group-core');

test('team owner is included in normalized members', () => {
  const team = core.createTeamRecord({
    id: 't1',
    ownerId: 1001,
    name: 'Alpha',
    members: [1002, 1001, 1003],
  });
  assert.deepEqual(team.members.sort((a, b) => a - b), [1001, 1002, 1003]);
});

test('owner can invite non-member', () => {
  const team = core.createTeamRecord({
    id: 't1',
    ownerId: 1001,
    name: 'Alpha',
    members: [1002],
  });
  assert.equal(core.canInvite(team, 1001, 1003), true);
  assert.equal(core.canInvite(team, 1002, 1003), false);
  assert.equal(core.canInvite(team, 1001, 1002), false);
});

test('invitee can accept invitation once', () => {
  const invitation = core.createInvitationRecord({
    id: 'i1',
    teamId: 't1',
    inviterId: 1001,
    inviteeId: 1002,
  });
  const accepted = core.applyInvitationDecision(invitation, 1002, true);
  assert.equal(accepted.status, core.INVITATION_STATUS.ACCEPTED);
  assert.throws(() => core.applyInvitationDecision(accepted, 1002, true), /not pending/);
});

test('team identity resolves all members for contest compatibility', () => {
  const team = core.createTeamRecord({
    id: 't1',
    ownerId: 1001,
    name: 'Alpha',
    members: [1002, 1003],
  });
  const identity = core.createTeamIdentity(team);
  assert.deepEqual(core.resolveIdentity(identity).sort((a, b) => a - b), [1001, 1002, 1003]);
});
