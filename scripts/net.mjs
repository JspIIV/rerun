// GenLayer Bradbury Phase 2, as the scripts reach it.
//
// RPC is a node that serves gen_call. The SDK's default chain RPC does not.
// The SDK quotes fees with an eth_call that names a gas price but no sender, and the node refuses that
// from the zero address, so a sender is filled in on calls that have none. It changes no call's result.
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

export const RPC = 'https://rpc-bradbury.genlayer.com';
export const EXPLORER = 'https://scan.bradbury.genlayer.com';

let caller = null;
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The public endpoints drop connections and answer with gateway pages now and then. A read is retried; a request
// that sends a transaction is not, so a dropped answer can never make the same write go out twice.
async function patient(url, init) {
  const sends = init && typeof init.body === 'string' && /eth_sendRawTransaction|eth_sendTransaction/.test(init.body);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await realFetch(url, init);
      const html = (res.headers.get('content-type') || '').includes('text/html');
      if (sends || attempt >= 8 || (res.status < 500 && !html)) return res;
    } catch (e) {
      if (sends || attempt >= 8) throw e;
    }
    await sleep(Math.min(2000 * attempt, 15000));
  }
}
globalThis.fetch = async (url, init) => {
  if (caller && init && typeof init.body === 'string' && init.body.includes('"eth_call"')) {
    const body = JSON.parse(init.body);
    for (const req of Array.isArray(body) ? body : [body]) {
      if (req.method === 'eth_call' && req.params?.[0] && !req.params[0].from) req.params[0].from = caller;
    }
    return patient(url, { ...init, body: JSON.stringify(body) });
  }
  return patient(url, init);
};

export function client(privateKey) {
  const account = createAccount(privateKey);
  caller = caller || account.address;
  return createClient({ chain: testnetBradbury, endpoint: RPC, account });
}
export const reader = () => createClient({ chain: testnetBradbury, endpoint: RPC });

// The quote for a deploy or a write: enough for every rotation the chain allows.
export async function fees(c, opts = {}) {
  const e = await c.estimateTransactionFees(opts);
  return { distribution: e.distribution, feeValue: e.feeValue };
}
