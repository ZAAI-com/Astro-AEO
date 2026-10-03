// @ts-check
import { parseArgs } from 'node:util';
import { resolve, join, relative, sep } from 'node:path';
import { ReportInvocationError, readText, readJson, readStream, readBaseline, writeOutput, optionalJson } from './reports/io.js';
import { trafficReport } from './reports/traffic.js';
import { changesReport, changesFail } from './reports/changes.js';
import { inspectReport, checkManifestEvidence } from './reports/inspect.js';
import { graphReport } from './reports/graph.js';
import { ragReport } from './reports/rag.js';
import { assertContract } from './reports/contracts.js';
import { renderDataReport } from './reports/formats.js';
export { formatReport, formatJson } from './validate-report.js';
export { ReportInvocationError } from './reports/io.js';

/** Read-only inspection unless --output is explicit. Never execute a consumer configuration.
 * @param {string[]} args @param {{cwd?:string;stdin?:AsyncIterable<Uint8Array|string>;fetch?:typeof fetch}} [environment] */
export async function runReport(args, environment = {}) {
  const kind = args[0], cwd = resolve(environment.cwd ?? process.cwd());
  if (!['traffic','changes','inspect','graph','rag'].includes(kind)) throw new ReportInvocationError('report requires traffic, changes, inspect, graph or rag.');
  const common = {format:{type:/** @type {const} */ ('string')},output:{type:/** @type {const} */ ('string')}};
  /** @type {Record<string, {type:'string'|'boolean';multiple?:boolean;default?:string|boolean}>} */
  const specific = kind === 'traffic' ? {from:{type:'string'},to:{type:'string'},weighted:{type:'boolean'},bucket:{type:'string'}} :
    kind === 'changes' ? {baseline:{type:'string'},'fail-on':{type:'string',default:'none'}} :
    kind === 'inspect' ? {dist:{type:'string'},manifest:{type:'string'},page:{type:'string',multiple:true}} :
    kind === 'graph' ? {type:{type:'string'},node:{type:'string'},depth:{type:'string'}} :
    {dist:{type:'string'},manifest:{type:'string'},origin:{type:'string'},base:{type:'string'},'max-tokens':{type:'string'},page:{type:'string',multiple:true}};
  let parsed;
  try { parsed = parseArgs({args:args.slice(1),allowPositionals:true,options:{...common,...specific}}); }
  catch { throw new ReportInvocationError('Invalid report options. See astro-aeo --help.'); }
  if (parsed.positionals.length > 1) throw new ReportInvocationError('report accepts at most one input or project directory.');
  const values = /** @type {Record<string,any>} */ (parsed.values);
  const format = values.format ?? (kind === 'graph' ? 'html' : kind === 'rag' ? 'jsonl' : 'terminal');
  if (!['terminal','json','markdown','html',...(kind === 'rag' ? ['jsonl'] : [])].includes(format)) throw new ReportInvocationError('Unsupported report format.');
  const path = (/** @type {string} */ value) => resolve(cwd,value);
  const input = parsed.positionals[0];
  /** @type {import('../src/index.js').AeoDataReportV1} */
  let report;
  let exitCode = 0;
  if (kind === 'traffic') {
    if (values.bucket && !['day','minute'].includes(values.bucket)) throw new ReportInvocationError('--bucket must be day or minute.');
    const text = !input || input === '-' ? await readStream(environment.stdin ?? process.stdin) : await readText(path(input));
    report = trafficReport(text,{from:values.from,to:values.to,weighted:values.weighted,bucket:values.bucket});
  } else if (kind === 'changes') {
    if (!values.baseline) throw new ReportInvocationError('changes requires --baseline <snapshot file or URL>.');
    if (!['none','added','changed','removed','any'].includes(values['fail-on'])) throw new ReportInvocationError('Unsupported --fail-on policy.');
    const current = await readJson(path(input ?? '.astro/aeo-cache/pages-v1.json'),input ? undefined : cwd);
    const baseline = await readBaseline(/^https?:\/\//i.test(values.baseline) ? values.baseline : path(values.baseline),environment.fetch);
    report = changesReport(baseline,current);
    exitCode = changesFail(report,values['fail-on']) ? 1 : 0;
  } else if (kind === 'inspect') {
    const root = path(input ?? '.');
    let manifest = values.manifest ? path(values.manifest) : undefined;
    const dist = values.dist ? path(values.dist) : join(root,'dist');
    if (!manifest && await optionalJson(join(dist,'llms','manifest.json'))) manifest = join(dist,'llms','manifest.json');
    report = await inspectReport(root,{manifest,pages:values.page,dist});
    if (manifest) await checkManifestEvidence(manifest,root,report);
  } else if (kind === 'graph') {
    const depth = integerOption(values.depth,1,0,3,'--depth');
    report = graphReport(await readJson(path(input ?? 'dist/schema/graph.jsonld')),{type:values.type,node:values.node,depth});
  } else {
    const root = path(input ?? '.');
    const dist = path(values.dist ?? join(input ?? '.','dist'));
    let manifest = values.manifest ? path(values.manifest) : undefined;
    const maxTokens = values['max-tokens'] === undefined ? undefined : integerOption(values['max-tokens'],512,1,1000000,'--max-tokens');
    report = await ragReport(root,{dist,manifest,origin:values.origin,base:values.base,maxTokens,pages:values.page});
  }
  assertContract(report,kind === 'traffic' ? 'analytics-report-v1' : kind + '-report-v1');
  const output = renderDataReport(report,format);
  if (values.output) {
    const target = path(values.output);
    const project = ['inspect','rag'].includes(kind) ? path(input ?? '.') : cwd;
    const cache = join(project,'.astro','aeo-cache');
    const within = relative(cache,target);
    const consumed = [
      ...(input && !['inspect','rag'].includes(kind) && input !== '-' ? [path(input)] : []),
      ...(kind === 'changes' ? [path(input ?? '.astro/aeo-cache/pages-v1.json'), ...(/^https?:\/\//i.test(values.baseline) ? [] : [path(values.baseline)])] : []),
      ...(kind === 'graph' ? [path(input ?? 'dist/schema/graph.jsonld')] : []),
      ...(values.manifest ? [path(values.manifest)] : []),
      ...(['inspect','rag'].includes(kind) ? [join(values.dist ? path(values.dist) : join(project,'dist'),'llms','manifest.json')] : []),
    ];
    if (within !== '..' && !within.startsWith('..' + sep) && !within.startsWith(sep) || consumed.includes(target))
      throw new ReportInvocationError('Report output must not overwrite input or private build evidence.');
    // Companion discovery reads Markdown under this output root; do not replace an input companion.
    if (kind === 'rag' && target.endsWith('.md')) {
      const dist = values.dist ? path(values.dist) : join(project,'dist');
      const part = relative(dist,target);
      if (part !== '..' && !part.startsWith('..' + sep) && !part.startsWith(sep)) throw new ReportInvocationError('Report output must not overwrite build companions.');
    }
    await writeOutput(target,output);
    return {output:'',exitCode,warnings:report.warnings,written:values.output,report};
  }
  return {output,exitCode,warnings:report.warnings,report};
}
/** @param {string|undefined} value @param {number} fallback @param {number} min @param {number} max @param {string} flag */
function integerOption(value,fallback,min,max,flag) {
  const parsed = value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ReportInvocationError(flag + ' is outside its supported integer range.');
  return parsed;
}
