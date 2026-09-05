import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CI checks out the pinned editor beside this repository. Keep gameplay and
// source-format rules in the editor so the UI and approval checks agree.
import { parseMapSourceFiles } from '../../wulfram-mapeditor/lib/map-source.ts';
import { parseState, validateProject } from '../../wulfram-mapeditor/lib/wulfram.ts';
import {
  assertMapSlug,
  readMapSourceDirectory,
} from '../../wulfram-mapeditor/tools/map-repository-lib.mjs';

export const DEFAULT_REPOSITORY = fileURLToPath(new URL('../', import.meta.url));

// Original state variants recognized by the editor's maps:seed-original command,
// plus the .state files accepted by its archive importer.
const STATE_FILE = /^(?:state\d*|db_state|bigstate|.+\.state)$/i;

// These checks describe whether a new structure would be a good placement in
// the editor. Shipped states can intentionally have steep/overlapping or
// unpowered structures; those do not make the map format invalid.
const PLACEMENT_ADVICE = new Set(['slope', 'overlap', 'power', 'cell-overlap']);

function sourceError(slug, error, file = 'map.json') {
  const message = error instanceof Error ? error.message : String(error);
  const mentionedFile = message.match(/\b(map\.json|terrain\.tsv|entities\.jsonl|base-layouts\.json|tagmap2?\.txt)\b/);
  return {
    file: `maps/${slug}/${mentionedFile?.[1] ?? file}`,
    severity: 'error',
    code: 'source',
    message,
  };
}

function settingsIssues(validation) {
  const issues = [];
  for (const key of ['serviceRadius', 'backupRadius', 'maxSlopeDegrees', 'minSpacing']) {
    const value = validation[key];
    if (!Number.isFinite(value) || value < 0 || (key === 'maxSlopeDegrees' && value > 90)) {
      issues.push({
        severity: 'error',
        code: 'validation-settings',
        message: `validation.${key} must be ${key === 'maxSlopeDegrees' ? 'between 0 and 90' : 'a nonnegative finite number'}.`,
      });
    }
  }
  return issues;
}

function usesBackface(tag) {
  const value = tag?.trim().toLowerCase();
  if (!value?.startsWith('+')) return value === 'backface';

  // Match the editor's lib/terrain-textures.ts transition-tag format: each
  // layer is template/name/mask, and the stored mask is complemented
  // (15 means no occupied corners). Compare names case-insensitively here.
  const tokens = value.slice(1).trim().split(/\s+/);
  if (tokens.length % 3 !== 0 || tokens.length > 12) return false;
  let found = false;
  for (let index = 0; index < tokens.length; index += 3) {
    const mask = Number(tokens[index + 2]);
    if (!Number.isInteger(mask) || mask < 0 || mask > 15) return false;
    if (tokens[index + 1] === 'backface' && mask !== 15) found = true;
  }
  return found;
}

function unpaintedTerrainWarnings(terrain, slug) {
  const backfaceIds = new Set(terrain.tagmap2.flatMap((tag, id) => usesBackface(tag) ? [id] : []));
  if (!backfaceIds.size) return [];
  // Texture IDs form a packed cell grid; the remaining serialized values are
  // padding. Heights use a separate vertex grid with a different row stride.
  const columns = terrain.width - 1;
  const cellCount = columns * (terrain.height - 1);
  let count = 0;
  let firstIndex;
  for (let index = 0; index < cellCount; index += 1) {
    if (!backfaceIds.has(terrain.textureIds[index])) continue;
    firstIndex ??= index;
    count += 1;
  }
  if (!count) return [];
  const x = firstIndex % columns;
  const y = Math.floor(firstIndex / columns);
  return [{
    file: `maps/${slug}/terrain.tsv`,
    line: firstIndex + 2,
    severity: 'warning',
    code: 'unpainted-terrain',
    message: `Unpainted terrain: ${count} terrain cell${count === 1 ? ' uses' : 's use'} the "backface" texture. First affected cell: (${x}, ${y}) in the zero-based texture grid. Paint the affected terrain.`,
  }];
}

export function validateMapFiles(files, slug) {
  const result = { slug, statesChecked: 0, issues: [] };
  let projection;
  try {
    // Parse the compatibility state independently: the collection parser
    // otherwise replaces entities.jsonl with the active layout's entities.
    projection = parseMapSourceFiles({ ...files, 'base-layouts.json': undefined });
  } catch (error) {
    result.issues.push(sourceError(slug, error));
    return result;
  }

  if (!projection.name.trim()) {
    result.issues.push(sourceError(slug, new Error('map.json name cannot be empty.')));
  }
  result.issues.push(...settingsIssues(projection.validation).map((issue) => ({
    ...issue, file: `maps/${slug}/map.json`,
  })));
  result.issues.push(...unpaintedTerrainWarnings(projection.terrain, slug));

  let project = projection;
  if (files['base-layouts.json'] !== undefined) {
    try {
      project = parseMapSourceFiles(files);
      if (!isDeepStrictEqual(project.entities, projection.entities)) {
        result.issues.push({
          file: `maps/${slug}/entities.jsonl`,
          severity: 'error',
          code: 'state-projection',
          message: `entities.jsonl must match the active layout (${project.activeBaseLayoutId}) in base-layouts.json. Save the base layouts in the editor to synchronize them.`,
        });
      }
    } catch (error) {
      result.issues.push(sourceError(slug, error, 'base-layouts.json'));
    }
  }

  function checkState(file, state, entities, validation) {
    result.statesChecked += 1;
    const invalidSettings = settingsIssues(validation);
    const issues = invalidSettings.length
      ? invalidSettings
      : validateProject({ ...project, entities, validation });
    result.issues.push(...issues.map((issue) => ({
      ...issue, file: `maps/${slug}/${file}`, state,
      severity: PLACEMENT_ADVICE.has(issue.code) ? 'warning' : issue.severity,
    })));
  }

  // Base-only saves can leave older settings in map.json. The active layout's
  // settings are authoritative for its entities.jsonl compatibility projection.
  checkState('entities.jsonl', 'active state', projection.entities, project.validation);
  if (project !== projection) {
    for (const layout of project.baseLayouts) {
      const source = layout.metadata.sourceFile ? `, ${layout.metadata.sourceFile}` : '';
      checkState('base-layouts.json', `${layout.name} [${layout.id}${source}]`, layout.entities, layout.validation);
    }
  }

  for (const file of Object.keys(files).filter((name) => STATE_FILE.test(name)).sort()) {
    const text = files[file];
    // parseState preserves decorations but silently skips malformed records.
    // Reject those records in CI instead of validating only the surviving units.
    for (const [index, line] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
      if (line.trim() && parseState(line).length !== 1) {
        result.issues.push({
          file: `maps/${slug}/${file}`,
          line: index + 1,
          severity: 'error',
          code: 'source',
          message: `Invalid state record on line ${index + 1}.`,
        });
      }
    }
    checkState(file, file, parseState(text), project.validation);
  }
  return result;
}

export function validateRepository(repository = DEFAULT_REPOSITORY) {
  const mapsRoot = path.join(repository, 'maps');
  // Enumerate directories ourselves: the compiler's catalog silently omits
  // invalid slugs, which must fail an all-maps approval check.
  const entries = fs.readdirSync(mapsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!entries.length) throw new Error('The maps repository does not contain any map sources.');

  const maps = entries.map((entry) => {
    const slug = entry.name;
    try {
      assertMapSlug(slug);
      if (entry.isSymbolicLink()) throw new Error('Map directories must not be symbolic links.');
      const files = readMapSourceDirectory(repository, slug);
      for (const file of fs.readdirSync(path.join(mapsRoot, slug))) {
        if (STATE_FILE.test(file)) {
          files[file] = fs.readFileSync(path.join(mapsRoot, slug, file), 'utf8');
        }
      }
      return validateMapFiles(files, slug);
    } catch (error) {
      return { slug, statesChecked: 0, issues: [sourceError(slug, error)] };
    }
  });
  const issues = maps.flatMap((map) => map.issues);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    valid: errors === 0,
    mapsChecked: maps.length,
    statesChecked: maps.reduce((count, map) => count + map.statesChecked, 0),
    errors,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    maps,
  };
}
