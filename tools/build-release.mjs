import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReleaseArtifacts } from '../../wulfram-mapeditor/tools/map-repository-lib.mjs';
import { DEFAULT_REPOSITORY, validateRepository } from './map-validation.mjs';
import { printValidationReport } from './validate-maps.mjs';

export async function buildValidatedRelease(repository, tag, outputDirectory) {
  if (!tag || !/^v[a-z0-9._-]+$/i.test(tag)) {
    throw new Error('A release tag beginning with v is required, such as v1.0.0.');
  }
  const report = validateRepository(repository);
  if (!report.valid) {
    const error = new Error('Release blocked: every map and state must pass validation.');
    error.report = report;
    throw error;
  }
  return buildReleaseArtifacts(repository, tag, outputDirectory);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [tag, output, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('Usage: npm run release:build -- <tag> [output-directory]');
    const artifacts = await buildValidatedRelease(
      DEFAULT_REPOSITORY, tag, path.resolve(output ?? path.join(DEFAULT_REPOSITORY, 'dist', 'release')),
    );
    console.log(`Built ${artifacts.compiled.length} validated maps in ${path.dirname(artifacts.collectionPath)}.`);
  } catch (error) {
    if (error.report) printValidationReport(error.report);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
