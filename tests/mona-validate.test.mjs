import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChatRequest, MAX_MESSAGES } from '../api/lib/monaValidate.js';

test('accepts a well-formed request', () => {
  const r = validateChatRequest({ messages: [{ role: 'user', content: 'Hola Mona' }] });
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 1);
});

test('rejects empty messages', () => {
  assert.equal(validateChatRequest({ messages: [] }).ok, false);
  assert.equal(validateChatRequest({}).ok, false);
});

test('rejects too many messages', () => {
  const msgs = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
  assert.equal(validateChatRequest({ messages: msgs }).ok, false);
});

test('rejects bad role', () => {
  assert.equal(validateChatRequest({ messages: [{ role: 'system', content: 'x' }] }).ok, false);
});

test('rejects oversized body', () => {
  const big = 'a'.repeat(160_000);
  assert.equal(validateChatRequest({ messages: [{ role: 'user', content: big }] }).ok, false);
});
