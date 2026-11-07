// Deploy Rerun end to end on GenLayer Bradbury. On GenLayer Chain (the EVM side, chain 4221): the official ERC-8004
// IdentityRegistryUpgradeable and ValidationRegistryUpgradeable (evm/official, unmodified, from
// github.com/erc-8004/erc-8004-contracts at the commit in evm/official/SOURCE_COMMIT), each behind an ERC1967 proxy
// with the same two step bootstrap the 8004 team uses. Then the Rerun Intelligent Contract, pointed at the registry.
//   PCHG=<pw> node scripts/deploy.mjs
import solc from 'solc';
import { Wallet, JsonRpcProvider, ContractFactory, Contract, Interface } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path'; import url from 'url';
import { client, fees, EXPLORER } from './net.mjs';

const PW = process.env.PCHG || '';
if (!PW) { console.error('set PCHG'); process.exit(1); }
const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const KS = path.join(os.homedir(), '.genlayer', 'keystores');
const w = await Wallet.fromEncryptedJson(fs.readFileSync(path.join(KS, 'pchg.json'), 'utf8'), PW);
const evm = w.connect(new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221));
const OUT = path.join(ROOT, 'deployment.json');
const dep = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { network: 'genlayer testnet bradbury phase 2', chain_id: 4221 };
const save = () => fs.writeFileSync(OUT, JSON.stringify(dep, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: findImport }));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) { for (const e of errs) console.error(e.formattedMessage); process.exit(1); }
  const c = out.contracts[file]?.[name] || Object.values(out.contracts).find((m) => m[name])[name];
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'evm', 'abi', name + '.json'), JSON.stringify(c.abi, null, 2));
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}
async function deploy(key, file, name, args = []) {
  if (dep[key]) return dep[key].address;
  const c = compile(file, name);
  const contract = await new ContractFactory(c.abi, c.bytecode, evm).deploy(...args);
  await contract.waitForDeployment();
  dep[key] = { address: await contract.getAddress(), tx: contract.deploymentTransaction().hash };
  save();
  console.log('deployed', key, dep[key].address);
  return dep[key].address;
}

fs.writeFileSync(path.join(ROOT, 'evm', 'Proxy.sol'),
  '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\nimport "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";\n');
console.log('deployer', w.address, 'solc', solc.version());
dep.compiler = solc.version(); save();
const boot = await deploy('bootstrap_impl', 'Bootstrap.sol', 'Bootstrap');
const idImpl = await deploy('identity_impl', 'official/IdentityRegistryUpgradeable.sol', 'IdentityRegistryUpgradeable');
const valImpl = await deploy('validation_impl', 'official/ValidationRegistryUpgradeable.sol', 'ValidationRegistryUpgradeable');
const bootIface = new Interface(compile('Bootstrap.sol', 'Bootstrap').abi);
const identity = await deploy('identity', 'Proxy.sol', 'ERC1967Proxy', [boot, bootIface.encodeFunctionData('initialize', [w.address, '0x0000000000000000000000000000000000000000'])]);
const validation = await deploy('validation', 'Proxy.sol', 'ERC1967Proxy', [boot, bootIface.encodeFunctionData('initialize', [w.address, identity])]);
const idAbi = compile('official/IdentityRegistryUpgradeable.sol', 'IdentityRegistryUpgradeable').abi;
const valAbi = compile('official/ValidationRegistryUpgradeable.sol', 'ValidationRegistryUpgradeable').abi;
if (!dep.identity_upgraded) {
  const p = new Contract(identity, idAbi, evm);
  await (await p.upgradeToAndCall(idImpl, new Interface(idAbi).encodeFunctionData('initialize', []))).wait();
  dep.identity_upgraded = true; save();
}
if (!dep.validation_upgraded) {
  const p = new Contract(validation, valAbi, evm);
  await (await p.upgradeToAndCall(valImpl, new Interface(valAbi).encodeFunctionData('initialize', [identity]))).wait();
  dep.validation_upgraded = true; save();
}
const vr = new Contract(validation, valAbi, evm);
const ir = new Contract(identity, idAbi, evm);
console.log('identity', identity, await ir.getVersion(), await ir.name(), '| validation', validation, await vr.getVersion(), 'identity set:', await vr.getIdentityRegistry());
if (!dep.rerun) {
  const c = client(w.privateKey);
  const code = fs.readFileSync(path.join(ROOT, 'contracts', 'rerun.py'), 'utf8');
  const hash = await c.deployContract({ code, args: [validation], fees: await fees(c) });
  console.log('rerun tx', hash);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const tx = await c.getTransaction({ hash });
    if (['ACCEPTED', 'FINALIZED'].includes(tx.statusName)) {
      if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') { console.error('deploy failed', tx.txExecutionResultName); process.exit(1); }
      dep.rerun = { address: tx.txDataDecoded?.contractAddress || tx.recipient, tx: hash };
      dep.address = dep.rerun.address; dep.tx = hash; dep.deployed_at = new Date().toISOString();
      save();
      break;
    }
  }
}
console.log('RERUN', dep.rerun?.address, EXPLORER + '/address/' + dep.rerun?.address);
process.exit(0);
