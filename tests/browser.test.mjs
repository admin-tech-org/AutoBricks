import assert from 'node:assert/strict';
import test from 'node:test';
import {waitFor, waitUntil} from '../src/browser.mjs';

test('wait observes a delayed state and awaits Promise results', async () => {
  let ready = false;
  const timer = setTimeout(() => { ready = true; }, 30);
  try {
    const result = await waitFor({evaluate: async () => ready}, 'page state', 1000);
    assert.equal(result.ready, true);
    assert.ok(result.elapsedMs >= 30);
  } finally { clearTimeout(timer); }
});

test('only boolean true confirms completion, timeout includes the last value', async () => {
  await assert.rejects(waitUntil(() => ({ready: false}), 30, 'import result'),
    /waiting for import result; last result: \{"ready":false\}/);
});

test('a Promise that never resolves cannot exceed the waiting deadline', async () => {
  await assert.rejects(waitFor({evaluate: () => new Promise(() => {})}, 'hung promise', 30),
    /Timed out after 30ms/);
});

test('navigation context errors can recover within the same deadline', async () => {
  let calls = 0;
  const navigationErrors = [
    'Execution context was destroyed.',
    'Cannot find context with specified id',
    'Inspected target navigated or closed'
  ];
  const client = {evaluate: async () => {
    const message = navigationErrors[calls++];
    if (message) {
      throw Object.assign(new Error(message), {cdpCode: -32000});
    }
    return true;
  }};
  assert.equal((await waitFor(client, 'read-only predicate', 1000)).ready, true);
  assert.equal(calls, 4);
});

test('script errors and disconnects fail immediately without retrying', async () => {
  for (const error of [new SyntaxError('Unexpected token'), new Error('CDP disconnected')]) {
    let calls = 0;
    await assert.rejects(waitUntil(() => { calls++; throw error; }), error);
    assert.equal(calls, 1);
  }
});

test('invalid timeouts are rejected before evaluating page code', async () => {
  for (const timeout of [0, -1, NaN, Infinity, 2147483648]) {
    await assert.rejects(waitUntil(() => assert.fail('must not evaluate'), timeout), /Timeout must/);
  }
});
