const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const yaml = (() => { try { return require('../server/node_modules/js-yaml'); } catch { return require('../web/node_modules/js-yaml'); } })();

const contractPath = 'docs/integration/integration-v1.openapi.yaml';
const frozenCommit = 'e2e3486300250b75d08295bcba6b8bd09a8e4774';
const frozenSha = '7798eb621795e8dc405ff56c0fdfb806622ec5a6144d85d6e839ee85d9061679';
const frozenBytes = execFileSync('git', ['show', frozenCommit + ':' + contractPath]);
assert.equal(createHash('sha256').update(frozenBytes).digest('hex'), frozenSha,
  'Frozen source must still match the original published SHA');
const parse = (text) => yaml.load(text, { schema: yaml.JSON_SCHEMA });
const frozen = parse(frozenBytes.toString('utf8'));
const candidate = parse(readFileSync(contractPath, 'utf8'));
const c1Bytes = readFileSync('docs/integration/snapshots/globalsite-c1.json');
assert.equal(createHash('sha256').update(c1Bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex'), '53b8132d3a7fcd354f38b71787fd439ba05895e9aec2da39a78816e371b2f4cd', 'C1 frozen snapshot drift');
const c1 = JSON.parse(c1Bytes);
const routes = {
  '/globalsite/capabilities': ['get', 'C1', 'globalsite:read'],
  '/globalsite/products': ['get', 'C2', 'products:read'],
  '/globalsite/products/{productId}': ['get', 'C2', 'products:read'],
  '/globalsite/materials': ['get', 'C3', 'materials:read'],
  '/globalsite/materials/{materialId}': ['get', 'C3', 'materials:read'],
  '/globalsite/inquiries': ['post', 'C4', 'inquiries:write'],
};
const has = (object, key) => Object.hasOwn(object, key);
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function validate(document) {
  document = structuredClone(document);
if (document['x-globalsite-c1']) {
  assert.deepEqual(document['x-globalsite-c1'], { status:'stable', implemented:true, task:'C1-read-api', description:'新任务批准的 /products 等 C1 路径；S1 /globalsite/* 草案仍未实现，不能当别名调用。' });
  delete document['x-globalsite-c1'];
  for (const [path, operation] of Object.entries(c1.paths)) {
    assert.deepEqual(document.paths[path], operation, 'C1 operation frozen: ' + path);
    delete document.paths[path];
  }
  for (const category of ['schemas','parameters','responses']) for (const [name, value] of Object.entries(c1[category])) {
    assert.deepEqual(document.components[category][name], value, 'C1 component frozen: ' + name);
    delete document.components[category][name];
  }
}
const projected = structuredClone(document);
  let draftCount = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    if (has(frozen.paths, path)) continue;
    const route = routes[path];
    assert(route, 'Unapproved new path: ' + path);
    const [method, phase, scope] = route;
    assert.deepEqual(Object.keys(item), [method], 'Unexpected path-level override: ' + path);
    const operation = item[method];
    assert.equal(operation['x-status'], 'draft', 'New operations must remain drafts');
    assert.equal(operation['x-implementation-phase'], phase, 'Unexpected implementation phase');
    assert.equal(operation['x-required-scope'], scope, 'Unexpected draft scope');
    assert.deepEqual(operation.security, [{ serviceToken: [] }], 'Draft must require bearer auth');
    assert(operation.parameters.some((p) => p.$ref === '#/components/parameters/ProjectId'),
      'Draft must require the existing project binding header');
    assert(operation.summary.startsWith('[草案，尚未实现]'), 'Draft must be clearly labeled');
    delete projected.paths[path];
    draftCount += 1;
  }
  for (const [category, entries] of Object.entries(document.components)) {
    assert(has(frozen.components, category), 'Unapproved component category: ' + category);
    for (const name of Object.keys(entries)) {
      if (has(frozen.components[category], name)) continue;
      assert(!name.startsWith('GlobalSiteC1'), 'Unapproved C1 component: ' + name);
      assert(['schemas', 'parameters', 'responses'].includes(category)
        && /^GlobalSite[A-Za-z0-9]+$/.test(name), 'Unapproved new component: ' + name);
      delete projected.components[category][name];
    }
  }
  if (has(document, 'x-globalsite-draft')) {
    const metadata = document['x-globalsite-draft'];
    assert.equal(metadata.status, 'draft');
    assert.equal(metadata.implemented, false, 'Draft cannot claim to be implemented');
    assert.deepEqual(metadata.phases, ['C1', 'C2', 'C3', 'C4']);
    delete projected['x-globalsite-draft'];
  } else {
    assert.equal(draftCount, 0, 'Draft operations require explicit unimplemented metadata');
    assert.deepEqual(document, frozen, 'Additions require explicit draft metadata');
  }
  // Only the allowlisted additions were removed. Any change to the old contract,
  // its shared components, or any other top-level field fails this comparison.
  assert.deepEqual(projected, frozen, 'Previously frozen contract definitions changed');

  const operationIds = new Set();
  for (const item of Object.values(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      assert(typeof operation.operationId === 'string' && operation.operationId.length > 0);
      assert(!operationIds.has(operation.operationId), 'Duplicate operationId');
      operationIds.add(operation.operationId);
    }
  }
  let refCount = 0;
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (has(value, '$ref')) {
      assert(typeof value.$ref === 'string' && value.$ref.startsWith('#/'),
        'Only local contract references are allowed');
      let target = document;
      for (const part of value.$ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        assert(target && typeof target === 'object' && has(target, key),
          'Unresolved reference: ' + value.$ref);
        target = target[key];
      }
      refCount += 1;
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(document);
  return { draftCount, refCount };
}

// Guard regressions run with the exact validator used on the real document.
validate(frozen);
const result = validate(candidate);
assert.equal(result.draftCount, 6, 'S1 must include all six reviewed draft operations');
const cases = [
  ['unknown C1 component', d => {d.components.schemas.GlobalSiteC1Unexpected={type:'string'}}],
  ['C1 scope changed', d => {d.paths['/products'].get['x-required-scope']='stats:read'}],
  ['C1 removed', d => {delete d.paths['/playbook']}],
  ['C1 schema changed', d => {d.components.schemas.GlobalSiteC1Product.required=[]}],
  ['C1 project binding removed', d => {d.paths['/company-profile'].get.parameters=[]}],
  ['C1 metadata removed', d => {delete d['x-globalsite-c1']}],
  ['old endpoint changed', (d) => { d.paths['/health'].get.summary += ' changed'; }],
  ['old endpoint removed', (d) => { delete d.paths['/outcomes']; }],
  ['old shared schema changed', (d) => { d.components.schemas.Error.required = []; }],
  ['version changed', (d) => { d.info.version = '2.0.0'; }],
  ['draft published', (d) => { d.paths['/globalsite/inquiries'].post['x-status'] = 'stable'; }],
  ['draft claims implemented', (d) => { d['x-globalsite-draft'].implemented = true; }],
  ['project header removed', (d) => { d.paths['/globalsite/capabilities'].get.parameters = []; }],
  ['bearer auth removed', (d) => { d.paths['/globalsite/capabilities'].get.security = []; }],
  ['scope changed', (d) => { d.paths['/globalsite/products'].get['x-required-scope'] = 'stats:read'; }],
  ['phase changed', (d) => { d.paths['/globalsite/products'].get['x-implementation-phase'] = 'C4'; }],
  ['unapproved path', (d) => { d.paths['/other'] = d.paths['/globalsite/products']; }],
  ['path server override', (d) => { d.paths['/globalsite/products'].servers = []; }],
  ['duplicate operation ID', (d) => {
    d.paths['/globalsite/capabilities'].get.operationId = d.paths['/health'].get.operationId;
  }],
  ['broken reference', (d) => {
    d.components.schemas.GlobalSiteAsset.properties.id = { $ref: '#/components/schemas/Missing' };
  }],
  ['unapproved component', (d) => { d.components.schemas.Other = { type: 'string' }; }],
  ['unapproved top-level field', (d) => { d.security = []; }],
];
for (const [name, mutate] of cases) {
  const changed = structuredClone(candidate);
  mutate(changed);
  assert.throws(() => validate(changed), undefined, 'Gate accepted invalid mutation: ' + name);
}
assert.throws(() => parse('openapi: 3.0.3\nopenapi: 3.0.3\n'), 'Duplicate YAML keys must fail');
console.log('PASS: original frozen SHA verified; original definitions unchanged; '
  + result.draftCount + ' unimplemented drafts; ' + result.refCount + ' references; '
  + (cases.length + 1) + ' rejection regressions.');

const seen=new Set();function refs(v){if(!v||typeof v!=='object')return;if(v.$ref){let t=candidate;for(const k of v.$ref.slice(2).split('/')){t=t[k.replace(/~1/g,'/').replace(/~0/g,'~')];assert(t,'Unresolved C1 ref '+v.$ref)}}for(const x of Object.values(v))refs(x)}refs(candidate);for(const item of Object.values(candidate.paths))for(const op of Object.values(item)){if(!op.operationId)continue;assert(!seen.has(op.operationId));seen.add(op.operationId)}
