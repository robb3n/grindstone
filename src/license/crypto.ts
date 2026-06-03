/**
 * Ed25519 verification, pure-JS. We deliberately AVOID `crypto.subtle`: Obsidian
 * rejects `crypto.subtle.importKey()` for ed25519 keys with "Algorithm:
 * Unrecognized name" (spec §8). @noble/ed25519 v2 needs a sync sha512 injected;
 * we wire it from @noble/hashes (also pure-JS).
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

/**
 * Verify a detached Ed25519 signature over `msg` against a hex public key.
 * Never throws — malformed input returns false.
 */
export function verifyEd25519(sig: Uint8Array, msg: Uint8Array, pubHex: string): boolean {
  try {
    return ed.verify(sig, msg, ed.etc.hexToBytes(pubHex));
  } catch {
    return false;
  }
}
