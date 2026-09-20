// @ts-check
import { isIP } from 'node:net';

/**
 * Whether a literal IP address is globally routable. Shared by config-time
 * origin validation and the CLI's DNS-pinning transport.
 * @param {string} address
 */
export function isPublicIp(address) {
  let value = address.toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  const family = isIP(value);
  if (family === 4) {
    const numeric = ipv4Number(value);
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, bits]) => ipv4InCidr(numeric, ipv4Number(/** @type {string} */ (network)), /** @type {number} */ (bits)));
  }
  if (family === 6) {
    const numeric = ipv6Number(value);
    if (numeric === null) return false;
    return ![
      ['::', 128],
      ['::1', 128],
      ['::', 96],
      ['64:ff9b::', 96],
      ['64:ff9b:1::', 48],
      ['100::', 64],
      ['2001::', 23],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['3fff::', 20],
      ['5f00::', 16],
      ['fc00::', 7],
      ['fe80::', 10],
      ['fec0::', 10],
      ['ff00::', 8],
    ].some(([network, bits]) => ipv6InCidr(numeric, /** @type {string} */ (network), /** @type {number} */ (bits)));
  }
  return false;
}

/** @param {string} value */
function ipv4Number(value) {
  return value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

/** @param {number} value @param {number} network @param {number} bits */
function ipv4InCidr(value, network, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}

/** @param {bigint} value @param {string} network @param {number} bits */
function ipv6InCidr(value, network, bits) {
  const parsed = ipv6Number(network);
  if (parsed === null) return true;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (parsed >> shift);
}

/** @param {string} address @returns {bigint | null} */
function ipv6Number(address) {
  let value = address;
  if (value.includes('.')) {
    const split = value.lastIndexOf(':');
    const ipv4 = value.slice(split + 1);
    if (isIP(ipv4) !== 4) return null;
    const numeric = ipv4Number(ipv4);
    value = `${value.slice(0, split)}:${(numeric >>> 16).toString(16)}:${(numeric & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[a-f0-9]{1,4}$/u.test(word))) return null;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}
