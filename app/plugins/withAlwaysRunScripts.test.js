// Run with `pnpm --filter @orbit/app test`.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { addAlwaysRunBlock } = require('./withAlwaysRunScripts');

// The shape of Expo SDK 58's generated Podfile around the anchor.
const PODFILE = [
  "target 'Orbit' do",
  '  use_expo_modules!',
  '',
  '  post_install do |installer|',
  '    react_native_post_install(installer)',
  '  end',
  'end',
  '',
].join('\n');

const count = (s, sub) => s.split(sub).length - 1;

test('inserts the block once, just before post_install', () => {
  const out = addAlwaysRunBlock(PODFILE);
  assert.equal(count(out, '# orbit-always-run-scripts'), 1);
  assert.equal(count(out, 'post_integrate do |installer|'), 1);
  assert.ok(out.indexOf('post_integrate') < out.indexOf('post_install'), 'before post_install');
  assert.ok(out.startsWith("target 'Orbit' do\n  use_expo_modules!\n"), 'the rest of the Podfile is untouched');
});

test('running it again changes nothing', () => {
  const once = addAlwaysRunBlock(PODFILE);
  assert.equal(addAlwaysRunBlock(once), once);
});

test('a block from an older version of the plugin is replaced, not duplicated', () => {
  const older = PODFILE.replace(
    '  post_install do |installer|',
    [
      '  # orbit-always-run-scripts',
      '  post_integrate do |installer|',
      '    installer.aggregate_targets.map(&:user_project).uniq.each do |project|',
      '      project.save',
      '    end',
      '  end',
      '  post_install do |installer|',
    ].join('\n'),
  );
  const out = addAlwaysRunBlock(older);
  assert.equal(out, addAlwaysRunBlock(PODFILE));
});

test('a Podfile without post_install fails loudly', () => {
  assert.throws(() => addAlwaysRunBlock("target 'Orbit' do\nend\n"), /no "post_install do \|installer\|"/);
});
