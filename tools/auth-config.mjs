/**
 * Web sign-in configuration: the one source for the code that signs in AND for what /privacy
 * and /account/ say about it.
 *
 * The storage key names, the fields stored, and the Google hosts contacted are read from here
 * by src/pro/session.ts (through esbuild's define) and by the page tokens in site.mjs. The
 * session module refuses to store an object whose fields differ from `sessionFields`, and the
 * Pro gate fails if /privacy does not name every key, field and host below. So the privacy page
 * cannot describe storage the code does not do, or miss storage it does — which matters because
 * a description of storage is the claim most likely to go stale: it describes a shape, not a
 * behaviour, and a shape changes without anyone deciding it should.
 */
export const AUTH = {
  // The OAuth web client the Android app requests its Google ID token for
  // (GetGoogleIdOption.setServerClientId(default_web_client_id), project pdfiq-b14cc). Using the
  // same client is what makes a web sign-in and an app sign-in the same Firebase account, with no
  // account linking on either side. A client ID is public by design.
  clientId: '340733500005-e6guq4vuc37drr1sor6uvqcop4kplpdo.apps.googleusercontent.com',

  // A browser key for the Firebase project, restricted to the Identity Toolkit and Token Service
  // APIs. Public by design — every browser that signs in receives it. Supplied by environment so a
  // preview can be built before one exists; without it /account/ says sign-in is not set up and
  // makes no request.
  apiKey: process.env.PDFIQ_FIREBASE_WEB_KEY ?? '',

  // Email address and account identifier, nothing more: no name, no photo.
  scope: 'openid email',

  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  identityToolkit: 'https://identitytoolkit.googleapis.com',
  secureToken: 'https://securetoken.googleapis.com',

  // localStorage: the signed-in session, until the user signs out on this device.
  sessionKey: 'pdfiq.session',
  sessionFields: ['uid', 'email', 'idToken', 'idTokenExpiresAt', 'refreshToken'],

  // sessionStorage: only between leaving for Google and coming back, then deleted.
  pendingKey: 'pdfiq.signin',
  pendingFields: ['state', 'nonce', 'startedAt'],
};

/** The hosts the account page's code may contact; its CSP override is generated from this. */
AUTH.hosts = [AUTH.identityToolkit, AUTH.secureToken];
