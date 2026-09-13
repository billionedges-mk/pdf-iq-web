/**
 * Make the key pair that signs Pro entitlement tokens, for one environment.
 *
 *   npm run entitlement:keys -- sandbox
 *   npm run entitlement:keys -- production
 *
 * Run it yourself, in your own terminal. The private key is printed once, to be pasted into
 * Cloudflare as the encrypted variable PDFIQ_ENTITLEMENT_PRIVATE_KEY for that environment (Preview
 * for sandbox, Production for production). It is never written to disk by this script, and it
 * should not be pasted into a chat, a commit or a ticket: whoever holds it can mint Pro for anyone.
 *
 * The public key is written to src/pro/entitlement-public-keys.json under the environment's name.
 * It is public by design: every Pro build carries it so a browser can check a token offline.
 * Commit that file.
 *
 * Two environments, two pairs. A token signed with the sandbox key does not verify under the
 * production key, so a purchase made with a sandbox test card cannot unlock pdf-iq.com. Running
 * this again for an environment replaces its pair, which invalidates every token already issued
 * there: buyers' browsers fetch a new one on their next online visit to /account/.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENVIRONMENTS = ['sandbox', 'production'];
const env = process.argv[2];
if (!ENVIRONMENTS.includes(env)) {
  console.error(`Say which environment: npm run entitlement:keys -- ${ENVIRONMENTS.join(' | ')}`);
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'src/pro/entitlement-public-keys.json');

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);

const keys = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const replacing = Boolean(keys[env]);
keys[env] = { kty, crv, x, y };
writeFileSync(FILE, `${JSON.stringify(keys, null, 2)}\n`);

console.log(`\nPublic key for ${env} written to src/pro/entitlement-public-keys.json${replacing ? ' (replacing the previous one)' : ''}.`);
console.log(`\nPaste this into Cloudflare → pdf-iq-web → Settings → Variables and Secrets,`);
console.log(`environment ${env === 'sandbox' ? 'Preview' : 'Production'}, as an ENCRYPTED variable named PDFIQ_ENTITLEMENT_PRIVATE_KEY:\n`);
console.log(JSON.stringify(privateJwk));
console.log('\nIt is not saved anywhere. If you lose it, run this again and commit the new public key.\n');
