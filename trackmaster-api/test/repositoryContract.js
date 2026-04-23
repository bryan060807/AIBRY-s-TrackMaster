import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDuplicateUserError } from '../src/repositories/errors.js';

export function runRepositoryContractTests({ backendName, createContext }) {
  test(`${backendName}: health repository checks backend reachability`, async () => {
    await withRepositoryContext(createContext, async ({ repositories }) => {
      assert.ok(await repositories.health.check());
    });
  });

  test(`${backendName}: users repository returns domain objects, missing users, and backend-neutral duplicate email errors`, async () => {
    await withRepositoryContext(createContext, async ({ repositories }) => {
      const user = await repositories.users.create({
        id: 'user-1',
        email: 'unit@example.com',
        passwordHash: 'hash-1',
      });

      assert.equal(user.id, 'user-1');
      assert.equal(user.email, 'unit@example.com');
      assert.equal(user.passwordHash, 'hash-1');
      assert.ok(user.createdAt);

      const byEmail = await repositories.users.findByEmailWithPassword('UNIT@example.com');
      assert.equal(byEmail.id, 'user-1');
      assert.equal(byEmail.passwordHash, 'hash-1');

      const publicUser = await repositories.users.findPublicById('user-1');
      assert.deepEqual(Object.keys(publicUser).sort(), ['createdAt', 'email', 'id']);
      assert.equal(await repositories.users.findPublicById('missing-user'), undefined);

      await assertThrowsOrRejects(
        () => repositories.users.create({
          id: 'user-2',
          email: 'UNIT@example.com',
          passwordHash: 'hash-2',
        }),
        (err) => isDuplicateUserError(err) && err.status === 409
      );
    });
  });

  test(`${backendName}: sessions repository finds active sessions, ignores expired sessions, and returns mutation outcomes`, async () => {
    await withRepositoryContext(createContext, async ({ repositories }) => {
      await repositories.users.create({
        id: 'session-user',
        email: 'session@example.com',
        passwordHash: 'hash',
      });

      const now = '2026-04-22T12:00:00.000Z';
      assert.deepEqual(
        await repositories.sessions.create({
          id: 'session-active',
          userId: 'session-user',
          tokenHash: 'token-active',
          userAgent: 'unit-test',
          clientKey: 'unit',
          expiresAt: '2026-04-22T13:00:00.000Z',
        }),
        { created: true }
      );
      assert.deepEqual(
        await repositories.sessions.create({
          id: 'session-expired',
          userId: 'session-user',
          tokenHash: 'token-expired',
          userAgent: 'unit-test',
          clientKey: 'unit',
          expiresAt: '2026-04-22T11:00:00.000Z',
        }),
        { created: true }
      );

      const active = await repositories.sessions.findActiveUserByTokenHash('token-active', now);
      assert.equal(active.id, 'session-user');
      assert.equal(active.sessionId, 'session-active');
      assert.equal(await repositories.sessions.findActiveUserByTokenHash('missing-token', now), undefined);
      assert.equal(await repositories.sessions.findActiveUserByTokenHash('token-expired', now), undefined);

      assert.deepEqual(await repositories.sessions.deleteExpired(now), {
        deleted: true,
        deletedCount: 1,
      });

      assert.deepEqual(await repositories.sessions.revokeByTokenHash('token-active', now), {
        changed: true,
      });
      assert.equal(await repositories.sessions.findActiveUserByTokenHash('token-active', now), undefined);

      assert.deepEqual(await repositories.sessions.revokeByTokenHash('missing-token', now), {
        changed: false,
      });
    });
  });

  test(`${backendName}: presets repository covers create, list, update, delete, and not-found behavior`, async () => {
    await withRepositoryContext(createContext, async ({ repositories }) => {
      await repositories.users.create({
        id: 'preset-user',
        email: 'preset@example.com',
        passwordHash: 'hash',
      });

      assert.deepEqual(await repositories.presets.listForUser('preset-user'), []);
      assert.equal(await repositories.presets.findForUser('missing-preset', 'preset-user'), undefined);

      const created = await repositories.presets.create({
        id: 'preset-1',
        userId: 'preset-user',
        name: 'Unit Preset',
        ...presetParams(),
      });
      assert.equal(created.id, 'preset-1');
      assert.equal(created.userId, 'preset-user');
      assert.equal(created.name, 'Unit Preset');
      assert.equal(created.params.eqLow, 1);
      assert.ok(created.createdAt);
      assert.ok(created.updatedAt);

      const listed = await repositories.presets.listForUser('preset-user');
      assert.equal(listed.length, 1);
      assert.equal(listed[0].id, 'preset-1');

      const updated = await repositories.presets.updateForUser('preset-1', 'preset-user', {
        name: 'Updated Preset',
        ...presetParams({ eqLow: 2 }),
      });
      assert.equal(updated.changed, true);
      assert.equal(updated.preset.name, 'Updated Preset');
      assert.equal(updated.preset.params.eqLow, 2);

      assert.deepEqual(
        await repositories.presets.updateForUser('missing-preset', 'preset-user', {
          name: 'Missing Preset',
          ...presetParams(),
        }),
        { changed: false, preset: undefined }
      );

      assert.deepEqual(await repositories.presets.deleteForUser('missing-preset', 'preset-user'), {
        deleted: false,
      });
      assert.deepEqual(await repositories.presets.deleteForUser('preset-1', 'preset-user'), {
        deleted: true,
      });
      assert.deepEqual(await repositories.presets.listForUser('preset-user'), []);
    });
  });

  test(`${backendName}: tracks repository covers create, list, delete, and not-found behavior`, async () => {
    await withRepositoryContext(createContext, async ({ repositories }) => {
      await repositories.users.create({
        id: 'track-user',
        email: 'track@example.com',
        passwordHash: 'hash',
      });

      assert.deepEqual(await repositories.tracks.listForUser('track-user'), []);
      assert.equal(await repositories.tracks.findForUser('missing-track', 'track-user'), undefined);

      const created = await repositories.tracks.create({
        id: 'track-1',
        userId: 'track-user',
        fileName: 'Unit Track.wav',
        storagePath: 'track-user/2026/04/track-1.wav',
        status: 'mastered',
        durationSeconds: 1.25,
        sizeBytes: 4,
        format: 'wav',
      });
      assert.equal(created.id, 'track-1');
      assert.equal(created.userId, 'track-user');
      assert.equal(created.fileName, 'Unit Track.wav');
      assert.equal(created.storagePath, 'track-user/2026/04/track-1.wav');
      assert.equal(created.durationSeconds, 1.25);
      assert.equal(created.sizeBytes, 4);
      assert.ok(created.createdAt);

      const listed = await repositories.tracks.listForUser('track-user');
      assert.equal(listed.length, 1);
      assert.equal(listed[0].id, 'track-1');

      assert.deepEqual(await repositories.tracks.deleteForUser('missing-track', 'track-user'), {
        deleted: false,
      });
      assert.deepEqual(await repositories.tracks.deleteForUser('track-1', 'track-user'), {
        deleted: true,
      });
      assert.equal(await repositories.tracks.findForUser('track-1', 'track-user'), undefined);
    });
  });
}

async function withRepositoryContext(createContext, callback) {
  const context = await createContext();
  try {
    return await callback(context);
  } finally {
    await context.close();
  }
}

function presetParams(overrides = {}) {
  return {
    eqLow: 1,
    eqMid: 0,
    eqHigh: -1,
    compThreshold: -14,
    compRatio: 2,
    makeupGain: 1,
    delayTime: 0.3,
    delayFeedback: 0.2,
    delayMix: 0,
    reverbDecay: 1.5,
    reverbMix: 0,
    saturationDrive: 1,
    saturationMix: 0,
    ...overrides,
  };
}

async function assertThrowsOrRejects(action, predicate) {
  try {
    await action();
  } catch (err) {
    assert.ok(predicate(err));
    return;
  }
  assert.fail('Expected repository operation to throw or reject.');
}
