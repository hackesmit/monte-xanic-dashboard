// MT.16 — Upload controller: startUpload → preview state, Confirm → writes,
// Cancel → clears state, single-flight guard.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { UploadManager } from '../js/upload.js';
import { Auth } from '../js/auth.js';

// Stub Auth to bypass token / role checks in tests
Auth.canUpload = () => true;
Auth.getToken = () => 'test-token';

function makeFakeFile(name = 'x.csv') {
  return { name, size: 10, async arrayBuffer() { return new ArrayBuffer(10); } };
}

function makeFakeParser(targets = [{ table: 't', rows: [{ x: 1 }], conflictKey: 'x' }]) {
  return {
    id: 'fake',
    label: 'Fake',
    acceptedExtensions: ['.csv'],
    async parse() {
      await Promise.resolve();
      return { targets, excluded: {}, rejected: [], meta: { totalRows: 1, filename: 'x.csv' } };
    },
  };
}

beforeEach(() => {
  UploadManager._pendingUpload = null;
  UploadManager._uploading = false;
});

describe('MT.16 — Upload controller state machine', () => {
  it('startUpload stores parse result in _pendingUpload and does not write', async () => {
    const parser = makeFakeParser();
    let upsertCalled = 0;
    UploadManager.upsertRows = async () => { upsertCalled++; return { count: 0, error: null }; };
    UploadManager._countNew = async () => 1;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());

    assert.ok(UploadManager._pendingUpload, 'pendingUpload should be set');
    assert.equal(upsertCalled, 0, 'upsertRows must NOT run during preview');
  });

  it('confirmPendingUpload upserts each target sequentially and clears state', async () => {
    const parser = makeFakeParser([
      { table: 'a', rows: [{ x: 1 }], conflictKey: 'x' },
      { table: 'b', rows: [{ y: 2 }], conflictKey: 'y' },
    ]);
    const calls = [];
    UploadManager.upsertRows = async (table, rows) => {
      calls.push(table);
      return { count: rows.length, error: null };
    };
    UploadManager._countNew = async () => 0;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());
    await UploadManager.confirmPendingUpload();

    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(UploadManager._pendingUpload, null);
    assert.equal(UploadManager._uploading, false);
  });

  it('confirm stops at first failure, remaining targets not attempted', async () => {
    const parser = makeFakeParser([
      { table: 'a', rows: [{ x: 1 }], conflictKey: 'x' },
      { table: 'b', rows: [{ y: 2 }], conflictKey: 'y' },
      { table: 'c', rows: [{ z: 3 }], conflictKey: 'z' },
    ]);
    const calls = [];
    UploadManager.upsertRows = async (table) => {
      calls.push(table);
      return table === 'b'
        ? { count: 0, error: 'boom' }
        : { count: 1, error: null };
    };
    UploadManager._countNew = async () => 0;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());
    const summary = await UploadManager.confirmPendingUpload();

    assert.deepEqual(calls, ['a', 'b']);
    assert.ok(summary.some(r => r.error === 'boom'));
  });

  it('cancelPendingUpload clears state without side effects', async () => {
    const parser = makeFakeParser();
    UploadManager.upsertRows = async () => { throw new Error('should not be called'); };
    UploadManager._countNew = async () => 0;

    await UploadManager._startUploadWithParser(parser, makeFakeFile());
    UploadManager.cancelPendingUpload();

    assert.equal(UploadManager._pendingUpload, null);
    assert.equal(UploadManager._uploading, false);
  });

  it('single-flight: second startUpload while uploading is ignored', async () => {
    const parser = makeFakeParser();
    UploadManager.upsertRows = async () => { await new Promise(r => setTimeout(r, 10)); return { count: 1, error: null }; };
    UploadManager._countNew = async () => 0;

    const p1 = UploadManager._startUploadWithParser(parser, makeFakeFile('one.csv'));
    await UploadManager._startUploadWithParser(parser, makeFakeFile('two.csv'));
    await p1;

    assert.equal(UploadManager._pendingUpload?.file?.name, 'one.csv');
  });
});
