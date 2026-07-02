import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleKnowledgeContext } from '../js/mona/knowledge.js';

test('empty facts → empty string', () => {
  assert.equal(assembleKnowledgeContext([]), '');
  assert.equal(assembleKnowledgeContext(null), '');
});

test('formats approved facts, ignores pending', () => {
  const out = assembleKnowledgeContext([
    { fact: 'El Durif fermenta más caliente aquí', status: 'approved' },
    { fact: 'ignorar esto', status: 'pending' },
  ]);
  assert.ok(out.includes('Durif'));
  assert.ok(!out.includes('ignorar'));
});

test('caps at 100 facts', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ fact: `hecho ${i}`, status: 'approved' }));
  const out = assembleKnowledgeContext(many);
  assert.ok(out.split('\n').filter(l => l.startsWith('- ')).length <= 100);
});
