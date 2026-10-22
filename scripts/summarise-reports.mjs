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
// Tests per layer, from the testcase file attribute in the Jest JUnit report.
const layers = {};
const apiXml = join(junitDir, 'api.xml');
if (existsSync(apiXml)) {
  for (const m of readFileSync(apiXml, 'utf8').matchAll(/<testcase[^>]*file="([^"]+)"/g)) {
    const f = m[1];
    const layer = /(^|\/)test\/integration\//.test(f) ? 'integration' : /(^|\/)test\/api\//.test(f) ? 'api' : 'unit';
    layers[layer] = (layers[layer] ?? 0) + 1;
  }
}
const covFile = join(reports, 'coverage', 'coverage-summary.json');
const coverage = existsSync(covFile) ? JSON.parse(readFileSync(covFile, 'utf8')).total : null;

const summary = { generatedAt: new Date().toISOString(), suites, layers, coverage };
writeFileSync(join(reports, 'summary.json'), JSON.stringify(summary, null, 2));

const lines = ['## Test results', '', '| Suite | Tests | Failures | Errors | Skipped |', '| --- | --- | --- | --- | --- |'];
for (const [name, s] of Object.entries(suites)) lines.push(`| ${name} | ${s.tests} | ${s.failures} | ${s.errors} | ${s.skipped} |`);
if (Object.keys(layers).length) {
  lines.push('', '## Jest tests per layer', '', '| Layer | Tests |', '| --- | --- |');
  for (const [k, v] of Object.entries(layers)) lines.push(`| Layer ${k} | ${v} |`);
}
if (coverage) {
  lines.push('', '## API coverage', '', '| Metric | % |', '| --- | --- |');
  for (const k of ['statements', 'branches', 'functions', 'lines']) lines.push(`| ${k} | ${coverage[k].pct} |`);
}
writeFileSync(join(reports, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
