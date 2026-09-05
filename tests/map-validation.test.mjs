import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMapSourceFiles } from '../../wulfram-mapeditor/lib/map-source.ts';
import { readMapArchive } from '../../wulfram-mapeditor/lib/map-package.ts';
import { DEFAULT_SKYBOX, SKYBOX_NAMES } from '../../wulfram-mapeditor/lib/sky-settings.ts';
import {
  createBlankProject,
  serializeState,
  synchronizeActiveBaseLayout,
} from '../../wulfram-mapeditor/lib/wulfram.ts';
import { buildValidatedRelease } from '../tools/build-release.mjs';
import { validateMapFiles, validateRepository } from '../tools/map-validation.mjs';

function unit(id, token, team, x, y = 200) {
  return { id, token, team, position: [x, y, 4], rotation: [0, 0, 0], active: 1 };
}

function fixture() {
  const project = createBlankProject('Validation fixture', 3);
  project.updatedAt = '2000-01-01T00:00:00.000Z';
  // Valid fixtures are painted explicitly; newer editor builds initialize
  // blank terrain with backface instead of a gameplay texture.
  project.terrain.tagmap = ['0:10martian001'];
  project.terrain.tagmap2 = ['10martian001'];
  project.entities = [
    unit('cell-1', 'e', 1, 200),
    unit('repair-1', 'r', 1, 300),
    unit('uplink-1', 'u', 1, 200, 400),
    unit('cell-2', 'e', 2, 1200),
    unit('repair-2', 'r', 2, 1300),
    unit('uplink-2', 'u', 2, 1200, 400),
  ];
  synchronizeActiveBaseLayout(project);
  return project;
}

function errors(result) {
  return result.issues.filter((issue) => issue.severity === 'error');
}

function check(project) {
  return validateMapFiles(createMapSourceFiles(project), 'fixture');
}

function addLayout(project) {
  const layout = {
    ...structuredClone(project.baseLayouts[0]),
    id: 'alternate', name: 'Alternative', metadata: { sourceFile: 'state2' },
  };
  project.baseLayouts.push(layout);
  return layout;
}

function repositoryFixture(context) {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'wulfram-map-ci-'));
  // Only remove the exact temporary directory allocated by this test.
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repository, '.git'));
  fs.mkdirSync(path.join(repository, 'maps'));
  return repository;
}

function writeMap(repository, slug, files = createMapSourceFiles(fixture())) {
  const directory = path.join(repository, 'maps', slug);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), text);
  }
}

test('valid maps pass with or without the optional layout collection', () => {
  const files = createMapSourceFiles(fixture());
  const multiple = validateMapFiles(files, 'fixture');
  assert.deepEqual(errors(multiple), []);
  assert.equal(multiple.statesChecked, 2);
  delete files['base-layouts.json'];
  const legacy = validateMapFiles(files, 'fixture');
  assert.deepEqual(errors(legacy), []);
  assert.equal(legacy.statesChecked, 1);
});

test('both teams must independently have an uplink and powered repair pad', async (context) => {
  for (const team of [1, 2]) {
    for (const [missing, code] of [
      ['uplink', 'state-uplink'],
      ['repair', 'state-powered-repair'],
      ['cell', 'state-powered-repair'],
    ]) {
      await context.test(`team ${team}, missing ${missing}`, () => {
        const project = fixture();
        project.entities = project.entities.filter((entity) => entity.id !== `${missing}-${team}`);
        const issues = errors(check(project));
        assert.ok(issues.some((issue) => issue.code === code && issue.message.startsWith(`Team ${team} `)));
        assert.ok(!issues.some((issue) => issue.message.startsWith(`Team ${team === 1 ? 2 : 1} `)));
      });
    }
  }
});

test('power uses the editor serviceRadius minus 10 and same-team deployed cells', async (context) => {
  await context.test('inclusive distance boundary', () => {
    const project = fixture();
    project.entities.find((entity) => entity.id === 'repair-1').position[0] = 490;
    assert.deepEqual(errors(check(project)), []);
    project.entities.find((entity) => entity.id === 'repair-1').position[0] = 490.01;
    assert.ok(errors(check(project)).some((issue) => issue.code === 'state-powered-repair'));
  });
  for (const replacement of [
    { team: 0 }, { team: 2 }, { token: 'c', subtype: 'e' },
  ]) {
    await context.test(JSON.stringify(replacement), () => {
      const project = fixture();
      Object.assign(project.entities.find((entity) => entity.id === 'cell-1'), replacement);
      assert.ok(errors(check(project)).some((issue) => issue.code === 'state-powered-repair' && issue.message.startsWith('Team 1 ')));
    });
  }
});

test('neutral uplinks and repair cargo do not satisfy team requirements', () => {
  const project = fixture();
  project.entities.find((entity) => entity.id === 'uplink-1').team = 0;
  Object.assign(project.entities.find((entity) => entity.id === 'repair-2'), { token: 'c', subtype: 'r' });
  const issues = errors(check(project));
  assert.ok(issues.some((issue) => issue.code === 'state-uplink' && issue.message.startsWith('Team 1 ')));
  assert.ok(issues.some((issue) => issue.code === 'state-powered-repair' && issue.message.startsWith('Team 2 ')));
});

test('inactive layouts are validated and identify the original state filename', () => {
  const project = fixture();
  addLayout(project).entities = [];
  const result = check(project);
  assert.equal(result.statesChecked, 3);
  assert.equal(errors(result).length, 4);
  assert.ok(errors(result).every((issue) => issue.file === 'maps/fixture/base-layouts.json' && issue.state.includes('alternate, state2')));
});

test('every layout uses its own validation settings', () => {
  const project = fixture();
  addLayout(project).validation.serviceRadius = 100;
  const issues = errors(check(project));
  assert.ok(issues.some((issue) => issue.code === 'state-powered-repair'));
  assert.ok(issues.every((issue) => issue.state.includes('alternate')));
});

test('entities.jsonl is checked even when a valid collection overrides it', () => {
  const files = createMapSourceFiles(fixture());
  files['entities.jsonl'] = '';
  const issues = errors(validateMapFiles(files, 'fixture'));
  assert.ok(issues.some((issue) => issue.code === 'state-projection'));
  assert.equal(issues.filter((issue) => issue.code.startsWith('state-') && issue.code !== 'state-projection').length, 4);
});

test('base-only saves use active layout settings for the compatibility state', () => {
  const files = createMapSourceFiles(fixture());
  const manifest = JSON.parse(files['map.json']);
  manifest.validation.serviceRadius = 20;
  files['map.json'] = JSON.stringify(manifest);
  assert.deepEqual(errors(validateMapFiles(files, 'fixture')), []);
});

test('all original state filename variants are checked independently', () => {
  const files = createMapSourceFiles(fixture());
  for (const filename of ['state', 'state1', 'state23', 'db_state', 'bigstate', 'custom.state', 'STATE2']) {
    files[filename] = '';
  }
  const result = validateMapFiles(files, 'fixture');
  assert.equal(result.statesChecked, 9);
  for (const filename of Object.keys(files).slice(6)) {
    assert.equal(errors(result).filter((issue) => issue.file === `maps/fixture/${filename}`).length, 4);
  }
});

test('valid original records and decorations pass but skipped malformed records fail', () => {
  const files = createMapSourceFiles(fixture());
  files.state = `${serializeState(fixture().entities)}\n* original decoration\n`;
  assert.deepEqual(errors(validateMapFiles(files, 'fixture')), []);
  files.state += 'r 1 100 broken\n';
  const issues = errors(validateMapFiles(files, 'fixture'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].file, 'maps/fixture/state');
  assert.equal(issues[0].code, 'source');
  assert.ok(issues[0].line > 1);
});

test('units outside the map boundary block approval', () => {
  const project = fixture();
  project.entities[0].position[0] = 5601;
  assert.ok(errors(check(project)).some((issue) => issue.code === 'bounds'));
});

test('editor placement heuristics are advisory for existing map states', async (context) => {
  const cases = [
    ['slope', (project) => { project.terrain.heights = [0, 20000, 40000, 0, 20000, 40000, 0, 20000, 40000]; }],
    ['overlap', (project) => { project.entities[1].position = [...project.entities[0].position]; }],
    ['power', (project) => { project.entities.push(unit('gun-1', 'g', 1, 900)); }],
    ['cell-overlap', (project) => { project.entities.push(unit('extra-cell', 'e', 1, 500)); }],
  ];
  for (const [code, mutate] of cases) {
    await context.test(code, () => {
      const project = fixture();
      mutate(project);
      const result = check(project);
      assert.deepEqual(errors(result), []);
      assert.ok(result.issues.some((issue) => issue.code === code && issue.severity === 'warning'));
    });
  }
});

test('editor warnings and backup-cell information do not block approval', () => {
  const project = fixture();
  project.entities[1].position[2] = -5;
  project.entities.push(unit('backup-cell', 'e', 1, 250));
  const result = check(project);
  assert.deepEqual(errors(result), []);
  assert.ok(result.issues.some((issue) => issue.code === 'buried' && issue.severity === 'warning'));
  assert.ok(result.issues.some((issue) => issue.code === 'backup' && issue.severity === 'info'));
});

test('backface terrain produces one advisory warning with a count and source location', (context) => {
  const project = fixture();
  project.terrain.tagmap2.push('backface');
  project.terrain.textureIds[2] = 1;
  project.terrain.textureIds[3] = 1;
  addLayout(project);
  const repository = repositoryFixture(context);
  writeMap(repository, 'fixture', createMapSourceFiles(project));

  const report = validateRepository(repository);
  assert.equal(report.valid, true);
  assert.equal(report.warnings, 1, 'Shared terrain is checked once across all layouts.');
  const [warning] = report.maps[0].issues;
  assert.equal(warning.code, 'unpainted-terrain');
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.file, 'maps/fixture/terrain.tsv');
  assert.equal(warning.line, 4);
  assert.match(warning.message, /2 terrain cells.*backface/);
  assert.match(warning.message, /\(0, 1\)/, 'Cell coordinates use width - 1 as the stride.');
});

test('backface detection respects exact names and transition-layer coverage', async (context) => {
  for (const [tag, expected] of [
    ['backface', true],
    ['  BackFace  ', true],
    ['+0template 10martian001 14 0template backface 1 ', true],
    ['+0template backface 15 0template 10martian001 0 ', false],
    ['backface001', false],
    ['painted-backface', false],
    ['+backface 10martian001 0 ', false],
    ['+0template backface nope', false],
  ]) {
    await context.test(tag, () => {
      const project = fixture();
      project.terrain.tagmap2[0] = tag;
      assert.equal(check(project).issues.some((issue) => issue.code === 'unpainted-terrain'), expected);
    });
  }
});

test('unused backface tags and texture padding do not warn about unpainted terrain', () => {
  const project = fixture();
  project.terrain.tagmap.push('0:backface');
  project.terrain.tagmap2.push('backface');
  assert.ok(!check(project).issues.some((issue) => issue.code === 'unpainted-terrain'));
  project.terrain.textureIds.fill(1, 4);
  assert.ok(!check(project).issues.some((issue) => issue.code === 'unpainted-terrain'));
});

test('backface warnings appear as GitHub annotations without failing the CLI', (context) => {
  const repository = repositoryFixture(context);
  const project = fixture();
  project.terrain.tagmap2[0] = 'backface';
  writeMap(repository, 'fixture', createMapSourceFiles(project));
  const run = spawnSync(process.execPath, [
    '--experimental-strip-types', 'tools/validate-maps.mjs', '--repo', repository,
  ], {
    cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true' },
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /::warning file=maps\/fixture\/terrain.tsv,line=2::\[unpainted-terrain\]/);
  assert.doesNotMatch(run.stdout, /::error/);
});

test('malformed map, terrain, entity, and layout sources fail validation', async (context) => {
  function editJson(files, name, mutate) {
    const value = JSON.parse(files[name]);
    mutate(value);
    files[name] = JSON.stringify(value);
  }
  const cases = [
    ['missing source', (files) => { delete files['tagmap2.txt']; }],
    ['bad JSON', (files) => { files['map.json'] = '{'; }],
    ['unsupported format', (files) => editJson(files, 'map.json', (map) => { map.version = 99; })],
    ['bad dimensions', (files) => editJson(files, 'map.json', (map) => { map.terrain.worldWidth = 0; })],
    ['unknown sky', (files) => editJson(files, 'map.json', (map) => { map.terrain.skyName = 'missing-sky'; })],
    ['empty name', (files) => editJson(files, 'map.json', (map) => { map.name = ' '; })],
    ['negative settings', (files) => editJson(files, 'map.json', (map) => { map.validation.minSpacing = -1; })],
    ['bad slope limit', (files) => editJson(files, 'base-layouts.json', (value) => { value.layouts[0].validation.maxSlopeDegrees = 91; })],
    ['missing terrain rows', (files) => { files['terrain.tsv'] = 'x\ty\ttexture\theight\n'; }],
    ['out-of-order terrain', (files) => { files['terrain.tsv'] = files['terrain.tsv'].replace('0\t0\t0\t0', '1\t0\t0\t0'); }],
    ['nonfinite heights', (files) => { files['terrain.tsv'] = files['terrain.tsv'].replace('0\t0\t0\t0', '0\t0\t0\tNaN'); }],
    ['invalid entity JSON', (files) => { files['entities.jsonl'] += '{\n'; }],
    ['duplicate entity IDs', (files) => { files['entities.jsonl'] += `${files['entities.jsonl'].split('\n')[0]}\n`; }],
    ['bad vector', (files) => editJson(files, 'base-layouts.json', (value) => { value.layouts[0].entities[0].position = [1, 2]; })],
    ['empty layouts', (files) => editJson(files, 'base-layouts.json', (value) => { value.layouts = []; })],
    ['unknown active layout', (files) => editJson(files, 'base-layouts.json', (value) => { value.activeLayoutId = 'missing'; })],
    ['duplicate layouts', (files) => editJson(files, 'base-layouts.json', (value) => { value.layouts.push(value.layouts[0]); })],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, () => {
      const files = createMapSourceFiles(fixture());
      mutate(files);
      assert.ok(errors(validateMapFiles(files, 'fixture')).length > 0);
    });
  }
});

test('repository validation includes invalid slugs and continues after broken maps', (context) => {
  const repository = repositoryFixture(context);
  writeMap(repository, 'good');
  writeMap(repository, 'bad-map', { 'map.json': '{}' });
  writeMap(repository, 'UPPERCASE');
  writeMap(repository, 'raw-states', { ...createMapSourceFiles(fixture()), state2: '' });
  const report = validateRepository(repository);
  assert.equal(report.valid, false);
  assert.equal(report.mapsChecked, 4);
  assert.deepEqual(report.maps.filter((map) => errors(map).length).map((map) => map.slug).sort(), ['UPPERCASE', 'bad-map', 'raw-states']);
});

test('an empty map repository cannot pass', (context) => {
  assert.throws(() => validateRepository(repositoryFixture(context)), /does not contain any map sources/);
});

test('CLI exit status and JSON report reflect all-map validation', (context) => {
  const repository = repositoryFixture(context);
  const reportPath = path.join(repository, 'report.json');
  writeMap(repository, 'fixture');
  const run = () => spawnSync(process.execPath, [
    '--experimental-strip-types', 'tools/validate-maps.mjs', '--repo', repository, '--report', reportPath,
  ], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(JSON.parse(fs.readFileSync(reportPath)).valid, true);
  writeMap(repository, 'fixture', { state2: '' });
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /maps\/fixture\/state2/);
  assert.equal(JSON.parse(fs.readFileSync(reportPath)).valid, false);
});

test('release artifacts are created only after every state passes', async (context) => {
  const repository = repositoryFixture(context);
  const output = path.join(repository, 'release');
  const project = fixture();
  const alternate = addLayout(project);
  alternate.entities = [];
  writeMap(repository, 'fixture', createMapSourceFiles(project));
  await assert.rejects(buildValidatedRelease(repository, 'v1.0.0', output), /Release blocked/);
  assert.equal(fs.existsSync(output), false);

  alternate.entities = structuredClone(project.entities);
  writeMap(repository, 'fixture', createMapSourceFiles(project));
  const artifacts = await buildValidatedRelease(repository, 'v1.0.0', output);
  assert.equal(artifacts.compiled.length, 1);
  assert.ok(fs.existsSync(artifacts.collectionPath));
  assert.match(fs.readFileSync(artifacts.checksumPath, 'utf8'), /fixture\.zip/);
  const entries = await readMapArchive(fs.readFileSync(artifacts.compiled[0].output));
  const layouts = entries.find((entry) => entry.name.endsWith('/base-layouts.json'));
  assert.equal(JSON.parse(layouts.text).layouts.length, 2);
});

test('release packages preserve every allowed sky and the legacy default', async (context) => {
  const repository = repositoryFixture(context);
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/wulfram-map-source-v1.schema.json', import.meta.url)));
  assert.deepEqual(schema.properties.terrain.properties.skyName.enum, [...SKYBOX_NAMES]);
  for (const skyName of SKYBOX_NAMES) {
    const project = fixture();
    project.terrain.skyName = skyName;
    writeMap(repository, skyName, createMapSourceFiles(project));
  }
  const legacy = fixture();
  delete legacy.terrain.skyName;
  writeMap(repository, 'legacy-default', createMapSourceFiles(legacy));

  const artifacts = await buildValidatedRelease(repository, 'v1.0.0', path.join(repository, 'release'));
  assert.equal(artifacts.compiled.length, SKYBOX_NAMES.length + 1);
  for (const artifact of artifacts.compiled) {
    const entries = await readMapArchive(fs.readFileSync(artifact.output));
    const startup = entries.find((entry) => entry.name.endsWith('/start_script'));
    const expected = artifact.slug === 'legacy-default' ? DEFAULT_SKYBOX : artifact.slug;
    assert.ok(startup, `${artifact.slug} needs a game startup script`);
    assert.equal(startup.text.split('\n')[0], `sky_names "${expected}"`);
    const project = JSON.parse(entries.find((entry) => entry.name.endsWith('/wulfram-project.json')).text);
    assert.equal(project.terrain.skyName, artifact.slug === 'legacy-default' ? undefined : expected);
  }
});
