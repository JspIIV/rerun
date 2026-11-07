// Independent check that the EVM contracts on GenLayer Chain run exactly the source in this repository.
//
//   node scripts/verify_evm.mjs
//
// GenLayer Chain's explorer has no source verification service yet, so this does what one would: it compiles each
// source in evm/ with the recorded compiler and settings, reads the deployed code from the chain, and compares them
// byte for byte. Immutable values are set by the constructor, so their slots are taken from the chain and printed.
// For a proxy it also reads the EIP-1967 implementation slot and checks the implementation the same way.
import solc from 'solc';
import { JsonRpcProvider, getAddress } from 'ethers';
import fs from 'fs'; import path from 'path'; import url from 'url';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const chain = new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221);
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8'));
const TARGETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'evm', 'targets.json'), 'utf8'));
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

function findImport(p) {
  for (const base of [path.join(ROOT, 'node_modules'), path.join(ROOT, 'evm')]) {
    const f = path.join(base, p);
    if (fs.existsSync(f)) return { contents: fs.readFileSync(f, 'utf8') };
  }
  return { error: 'not found: ' + p };
}
function compile(file, name) {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { [file]: { content: fs.readFileSync(path.join(ROOT, 'evm', file), 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } },
  }), { import: findImport }));
  const c = out.contracts[file]?.[name] || Object.values(out.contracts).find((m) => m[name])[name];
  return { code: c.evm.deployedBytecode.object.toLowerCase(), refs: c.evm.deployedBytecode.immutableReferences || {} };
}
async function check(label, address, file, name) {
  const { code, refs } = compile(file, name);
  const live = (await chain.getCode(address)).slice(2).toLowerCase();
  const filled = code.split('');
  const immutables = [];
  for (const spots of Object.values(refs)) {
    for (const { start, length } of spots) {
      for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i];
      immutables.push('0x' + live.slice(start * 2, (start + length) * 2));
    }
  }
  const same = filled.join('') === live;
  console.log(`${same ? 'MATCH    ' : 'DIFFERENT'} ${label.padEnd(26)} ${address}  ${file}:${name}${immutables.length ? '  immutables ' + [...new Set(immutables)].join(', ') : ''}`);
  return same;
}

console.log('solc', solc.version(), '| optimizer 200 runs, evm paris | chain 4221 via https://rpc.testnet-chain.genlayer.com');
let all = true;
for (const t of TARGETS) {
  const address = dep[t.key].address;
  if (t.proxy) {
    all = (await check(t.label + ' (proxy)', address, 'Proxy.sol', 'ERC1967Proxy')) && all;
    const impl = getAddress('0x' + (await chain.getStorage(address, IMPL_SLOT)).slice(26));
    console.log(`          implementation slot -> ${impl}`);
    all = (await check(t.label + ' (implementation)', impl, t.file, t.name)) && all;
  } else {
    all = (await check(t.label, address, t.file, t.name)) && all;
  }
}
console.log(all ? 'every contract on chain is the source in this repository' : 'at least one contract differs');
process.exit(all ? 0 : 1);
