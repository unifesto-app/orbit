import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// @orbit/mobile resolves react, react-native and expo-glass-effect from its own node_modules, so they must be the
// people app's and the host apps' exact versions: a second React in a bundle crashes every hook at runtime, and no
// typecheck or test would notice. Bump all three package.json files together.
test("mobile/ pins the apps' react, react-native and glass", () => {
  const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const [app, host, mobile] = ['../../app/package.json', '../package.json', '../../mobile/package.json'].map(read);
  for (const dep of ['react', 'react-native', 'expo-glass-effect']) {
    assert.equal(mobile.devDependencies[dep], app.dependencies[dep], `${dep}: mobile vs app`);
    assert.equal(mobile.peerDependencies[dep], app.dependencies[dep], `${dep}: mobile's peer vs app`);
    assert.equal(host.dependencies[dep], app.dependencies[dep], `${dep}: host vs app`);
  }
});
