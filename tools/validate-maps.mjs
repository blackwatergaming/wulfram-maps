import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_REPOSITORY, validateRepository } from './map-validation.mjs';

function escapeAnnotation(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C');
}

export function printValidationReport(report) {
  for (const map of report.maps) {
    for (const issue of map.issues) {
      if (issue.severity === 'info') continue;
      const context = [issue.state, issue.entityId].filter(Boolean).join(' / ');
      const message = `[${issue.code}] ${context ? `${context}: ` : ''}${issue.message}`;
      console.log(`${issue.severity.toUpperCase()} ${issue.file}: ${message}`.replace(/[\r\n]/g, ' '));
      if (process.env.GITHUB_ACTIONS === 'true') {
        const line = issue.line ? `,line=${issue.line}` : '';
        console.log(`::${issue.severity} file=${escapeAnnotation(issue.file)}${line}::${escapeAnnotation(message)}`);
      }
    }
  }
  const failedMaps = report.maps.filter((map) => map.issues.some((issue) => issue.severity === 'error')).length;
  console.log(`Checked ${report.mapsChecked} maps and ${report.statesChecked} states: ${report.errors} errors, ${report.warnings} warnings; ${failedMaps} maps failed.`);
}

function main() {
  const args = process.argv.slice(2);
  let repository = DEFAULT_REPOSITORY;
  let reportPath;
  while (args.length) {
    const option = args.shift();
    if (option === '--help') {
      console.log('Usage: npm run validate -- [--repo <directory>] [--report <file.json>]');
      return;
    }
    if (!['--repo', '--report'].includes(option) || !args[0] || args[0].startsWith('--')) {
      throw new Error(`Invalid option or missing value: ${option}`);
    }
    const value = path.resolve(args.shift());
    if (option === '--repo') repository = value;
    else reportPath = value;
  }
  const report = validateRepository(repository);
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  printValidationReport(report);
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
