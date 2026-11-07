// Independent check of the proof, with no keys. Anyone can run it from a fresh clone:
//
//   node scripts/verify.mjs
//
// It trusts nothing this repository says about the outcome. For each transaction id in
// results/proved.json it asks the network for the status and execution result, and it asks the network
// for the deployed code and compares it with contracts/ byte for byte.
import crypto from 'crypto'; import fs from 'fs'; import path from 'path'; import url from 'url';
import { reader, EXPLORER } from './net.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const name = path.basename(ROOT).toLowerCase();
const proof = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'proved.json'), 'utf8'));
const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8'));
const c = reader();
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const local = fs.readFileSync(path.join(ROOT, 'contracts', name + '.py'), 'utf8').replace(/\r\n/g, '\n');
const raw = await c.getContractCode(proof.contract);
const chain = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
const matches = chain.replace(/\r\n/g, '\n') === local;
console.log('contract', proof.contract, EXPLORER + '/address/' + proof.contract);
console.log('source   local sha256', sha(local));
console.log('source   chain sha256', sha(chain.replace(/\r\n/g, '\n')), matches ? 'MATCH' : 'DIFFERENT');

const rows = [{ label: 'deploy', hash: deployment.tx }, ...proof.txs];
let finalized = 0, accepted = 0, other = 0;
for (const row of rows) {
  const tx = await c.getTransaction({ hash: row.hash });
  const state = `${tx.statusName} ${tx.txExecutionResultName || ''}`;
  if (tx.statusName === 'FINALIZED') finalized++; else if (tx.statusName === 'ACCEPTED') accepted++; else other++;
  console.log(`  ${state.padEnd(38)} ${row.hash}  ${row.label}`);
}
console.log(`${rows.length} transactions: ${finalized} finalized, ${accepted} accepted and not yet final, ${other} neither (a retried send)`);
fs.writeFileSync(path.join(ROOT, 'results', 'finality.json'), JSON.stringify({
  checked_at: new Date().toISOString(), contract: proof.contract, source_sha256: sha(local), source_matches_chain: matches,
  finalized, accepted, other, total: rows.length,
}, null, 2));
process.exit(matches ? 0 : 1);
