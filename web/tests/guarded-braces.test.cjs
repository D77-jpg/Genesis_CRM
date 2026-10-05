const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const braces = require('braces');

test('every build consumer and lock entry resolves the guarded fork', () => {
  const consumers = ['micromatch', 'chokidar'];
  const tailwindRequire = createRequire(require.resolve('tailwindcss'));
  const globRequire = createRequire(tailwindRequire.resolve('fast-glob'));
  consumers.forEach(name => {
    const consumer = createRequire(require.resolve(name));
    assert.equal(consumer('braces/package.json').name, '@autoforce/guarded-braces');
    assert.equal(consumer.resolve('braces'), require.resolve('braces'));
  });
  const matchRequire = createRequire(globRequire.resolve('micromatch'));
  assert.equal(matchRequire.resolve('braces'), require.resolve('braces'));
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages).filter(([key]) => /(?:^|\/)node_modules\/braces$/.test(key));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1].name, '@autoforce/guarded-braces');
  assert.equal(entries[0][1].resolved, 'file:vendor/guarded-braces');
  // Installation must copy the source, so fill-range resolves from the lockfile.
  assert.equal(entries[0][1].link, undefined);
});

for (const [pattern, expected] of [
  ['a/{b,c}/d', ['a/b/d', 'a/c/d']],
  ['x/{1..3}', ['x/1', 'x/2', 'x/3']],
  ['x/{a..c}', ['x/a', 'x/b', 'x/c']],
  ['{a,{b,c}}', ['a', 'b', 'c']],
  ['{01..03}', ['01', '02', '03']],
  ['{3..1}', ['3', '2', '1']],
  ['{a,b}-{1,2}', ['a-1', 'a-2', 'b-1', 'b-2']],
  ['*.{js,ts,jsx,tsx,mdx}', ['*.js', '*.ts', '*.jsx', '*.tsx', '*.mdx']],
  ['a/\\{b,c\\}', ['a/{b,c}']],
  ['a/{b,c', ['a/{b,c']],
]) {
  test(`compatible expansion: ${pattern}`, () => assert.deepEqual(braces.expand(pattern), expected));
}

test('normal regex compilation and caller options remain compatible', () => {
  assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d');
  assert.deepEqual(braces('{a,a,b}', { expand: true, nodupes: true }), ['a', 'b']);
  assert.deepEqual(braces.expand('{1..9..2}'), ['1', '3', '5', '7', '9']);
  assert.throws(() => braces.expand('{1..10000}'), /range limit/);
});

for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  test(`${method} bounds balanced, malformed, paren and mixed nesting before stack exhaustion`, () => {
    for (const [open, close] of [['{', '}'], ['(', ')'], ['{(', ')}']]) {
      const count = open.length === 2 ? 1750 : 3500;
      for (const suffix of [close.repeat(count), '']) {
        assert.throws(() => braces[method](open.repeat(count) + 'a,b' + suffix),
          error => error instanceof SyntaxError && /maximum nesting depth/.test(error.message));
      }
    }
    // Consumers cannot opt out of the security ceiling.
    assert.throws(() => braces[method]('{'.repeat(3500) + 'a,b' + '}'.repeat(3500), { maxDepth: Infinity }), /maximum nesting depth/);
  });
}

test('prebuilt ASTs cannot bypass recursive walker bounds', () => {
  for (const method of ['compile', 'expand', 'stringify']) {
    let node = { type: 'text', value: 'x' };
    for (let i = 0; i < 3500; i++) node = { type: 'root', nodes: [node] };
    assert.throws(() => braces[method](node), /maximum nesting depth/);
  }
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const method of ['compile', 'expand', 'stringify']) assert.throws(() => braces[method](cycle), /maximum nesting depth/);
});

test('flatten rejects nested and cyclic arrays without exhausting the stack', () => {
  const utils = require('braces/lib/utils');
  let nested = 'x';
  for (let i = 0; i < 3500; i++) nested = [nested];
  assert.throws(() => utils.flatten(nested), /maximum nesting depth/);
  const cycle = []; cycle.push(cycle);
  assert.throws(() => utils.flatten(cycle), /maximum nesting depth/);
  assert.deepEqual(utils.flatten(['a', ['b', undefined, ['c']]]), ['a', 'b', 'c']);
});

test('the real fast-glob consumer still enumerates frontend test files', () => {
  const tailwindRequire = createRequire(require.resolve('tailwindcss'));
  const glob = tailwindRequire('fast-glob');
  const files = glob.sync('tests/**/*.{cjs,js}', { cwd: path.join(__dirname, '..') });
  assert.ok(files.includes('tests/guarded-braces.test.cjs'));
  assert.ok(glob.sync('src/**/*.{ts,tsx}', { cwd: path.join(__dirname, '..') }).length > 0);
});

test('the real chokidar consumer discovers a newly created file through a brace glob', { timeout: 10000 }, async () => {
  const os = require('node:os');
  const { once } = require('node:events');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-braces-watch-'));
  const watcher = require('chokidar').watch(path.join(directory, '*.{cjs,ts}').replaceAll('\\', '/'), { ignoreInitial: true });
  try {
    await once(watcher, 'ready');
    const added = once(watcher, 'add');
    const file = path.join(directory, 'new-test.cjs');
    fs.writeFileSync(file, '/* synthetic watcher check */');
    const [found] = await added;
    assert.equal(path.resolve(found), path.resolve(file));
  } finally {
    await watcher.close();
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('genesis-braces-watch-')) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
