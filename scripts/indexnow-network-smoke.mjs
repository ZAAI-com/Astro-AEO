#!/usr/bin/env node
// Drives the unmodified IndexNow transport against a real origin. This is the only check that
// exercises createSafeHttpsTransport with real DNS, a real TLS handshake, and Node's default
// happy-eyeballs connect path. Every unit test injects a lookup or a request; none of them can
// catch a regression in how the vetted address is handed back to Node.
import { MAX_INDEXNOW_STATE_BYTES, createSafeHttpsTransport } from '../cli/indexnow-submit.js';

/** Ordinary connectivity failures. They mean the gate ran offline, not that the transport broke. */
const OFFLINE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT',
]);

const args = process.argv.slice(2);
const originIndex = args.indexOf('--origin');
const origin = originIndex >= 0 ? args[originIndex + 1] : 'https://zaai.com/';

if (originIndex >= 0 && !origin) {
  console.error('indexnow-network-smoke: --origin requires a URL.');
  process.exit(2);
}

if (process.env.NODE_OPTIONS?.includes('network-family-autoselection')) {
  console.error(
    'indexnow-network-smoke: NODE_OPTIONS tampers with family autoselection, which is exactly '
    + 'what this check must exercise. Unset it and run again.',
  );
  process.exit(2);
}

console.log(`Requesting ${origin} through createSafeHttpsTransport() with no injected dependencies.`);

let result;
try {
  // The same ceiling the deployed-state fetch uses, so an ordinary homepage does not trip it.
  result = await createSafeHttpsTransport().request(origin, {
    method: 'GET',
    maxBytes: MAX_INDEXNOW_STATE_BYTES,
  });
} catch (error) {
  const code = error?.code;
  if (code === 'ERR_INVALID_IP_ADDRESS') {
    console.error(
      'indexnow-network-smoke: the pinned DNS lookup answered a shape Node rejects. IndexNow '
      + 'submission is broken on every supported Node version. See createSafeHttpsTransport in '
      + 'cli/indexnow-submit.js.',
    );
    console.error(error);
    process.exit(1);
  }
  if (OFFLINE_CODES.has(code)) {
    console.log(`indexnow-network-smoke: skipped, ${origin} is unreachable (${code}).`);
    process.exit(0);
  }
  console.error(`indexnow-network-smoke: ${origin} failed for a reason the transport must not produce.`);
  console.error(error);
  process.exit(1);
}

if (typeof result.status !== 'number' || result.status === 0) {
  console.error(`indexnow-network-smoke: ${origin} returned no usable status.`);
  process.exit(1);
}

console.log(`indexnow-network-smoke: ${origin} answered ${result.status}.`);
