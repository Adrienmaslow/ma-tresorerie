/**
 * Sécurité locale.
 * - Le code PIN n'est jamais stocké : seul un dérivé PBKDF2-SHA256 (sel aléatoire,
 *   210 000 itérations) est conservé et comparé en temps constant.
 * - Le déverrouillage biométrique utilise WebAuthn avec un authentificateur de
 *   plateforme (Face ID / Touch ID / Windows Hello), vérification utilisateur exigée.
 */

const ITERATIONS = 210_000;
const enc = new TextEncoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toB64url(buf: ArrayBuffer): string {
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<{ pinHash: string; pinSalt: string; pinIterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await derive(pin, salt, ITERATIONS);
  return { pinHash: toB64(h), pinSalt: toB64(salt), pinIterations: ITERATIONS };
}

export async function verifyPin(pin: string, hash: string, salt: string, iterations = ITERATIONS): Promise<boolean> {
  const h = await derive(pin, fromB64(salt), iterations);
  const expected = fromB64(hash);
  if (h.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h[i] ^ expected[i];
  return diff === 0;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

// ---------- Biométrie (WebAuthn) ----------

export async function biometricAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerBiometric(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Solde', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'ma-tresorerie', displayName: 'Solde' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Enregistrement annulé.');
  return toB64url(cred.rawId);
}

/**
 * Demande une vérification biométrique. Renvoie true si l'authentificateur
 * confirme la vérification de l'utilisateur (drapeau UV des données d'authentification).
 */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return false;
  const resp = assertion.response as AuthenticatorAssertionResponse;
  const authData = new Uint8Array(resp.authenticatorData);
  const flags = authData[32];
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  return userPresent && userVerified && toB64url(assertion.rawId) === credentialId;
}
