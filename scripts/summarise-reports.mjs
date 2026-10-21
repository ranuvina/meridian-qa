// Collapses JUnit + coverage output into reports/summary.json (machine-readable) and
// reports/summary.md (for the CI job summary).
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const reports = join(process.cwd(), 'reports');
const junitDir = join(reports, 'junit');
const suites = {};
if (existsSync(junitDir)) {
  for (const file of readdirSync(junitDir).filter((f) => f.endsWith('.xml'))) {
    const xml = readFileSync(join(junitDir, file), 'utf8');
    const root = xml.match(/<testsuites[^>]*>/)?.[0] ?? '';
    const attr = (n) => Number(root.match(new RegExp(`${n}="(\\d+)"`))?.[1] ?? 0);
    suites[file.replace('.xml', '')] = {
      tests: attr('tests'),
      failures: attr('failures'),
      errors: attr('errors'),
      skipped: attr('skipped'),
    };
  }
}
const covFile = join(reports, 'coverage', 'coverage-summary.json');
const coverage = existsSync(covFile) ? JSON.parse(readFileSync(covFile, 'utf8')).total : null;

const summary = { generatedAt: new Date().toISOString(), suites, coverage };
writeFileSync(join(reports, 'summary.json'), JSON.stringify(summary, null, 2));

const lines = ['## Test results', '', '| Suite | Tests | Failures | Errors | Skipped |', '| --- | --- | --- | --- | --- |'];
for (const [name, s] of Object.entries(suites)) lines.push(`| ${name} | ${s.tests} | ${s.failures} | ${s.errors} | ${s.skipped} |`);
if (coverage) {
  lines.push('', '## API coverage', '', '| Metric | % |', '| --- | --- |');
  for (const k of ['statements', 'branches', 'functions', 'lines']) lines.push(`| ${k} | ${coverage[k].pct} |`);
}
writeFileSync(join(reports, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
