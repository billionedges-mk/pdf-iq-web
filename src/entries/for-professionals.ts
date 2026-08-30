/**
 * The one form on the site.
 *
 * Everything here is about the button being honest. A control that thanks you and drops
 * what you typed is the defect this project has removed four times, and it would be at its
 * worst here: the whole page is a test of whether the demand exists, so an address that is
 * accepted and discarded destroys the only thing the page is for.
 *
 * So: the submission is awaited, the server's answer decides what is shown, and every
 * failure says what failed. "Something went wrong" is not in this file.
 *
 * It posts same-origin. The site's CSP is `connect-src 'self'`, which would block a hosted
 * form service, and the footer readout counts the bytes — the page says so before you press
 * anything, and the counter moving is the point rather than an embarrassment.
 */

import { $ } from '../lib/ui.js';

const form = $<HTMLFormElement>('[data-interest-form]');
const status = $<HTMLElement>('[data-interest-status]');
const button = $<HTMLButtonElement>('[data-interest-submit]');

/** Why it failed, in the reader's terms. Never a shrug. */
const MESSAGES: Record<string, string> = {
  'bad-email': 'That address does not look like an address — check it and try again.',
  'bad-profession': 'The second field is the one that matters here, so it cannot be left empty.',
  'not-configured':
    'Registering interest is not switched on yet — the store behind this button is not connected. ' +
    'Nothing was recorded, so please try again later rather than assuming we have your address.',
  'store-failed':
    'The address reached us but could not be written down, so treat it as not recorded. ' +
    'Writing to support@pdf-iq.com will work while this does not.',
  'method-not-allowed': 'That request was refused by the server.',
  'bad-request': 'The browser sent something the server could not read.',
};

const say = (text: string, tone: 'ok' | 'bad') => {
  if (!status) return;
  status.textContent = text;
  status.style.color = tone === 'ok' ? 'var(--ink)' : 'var(--amber-text)';
};

if (form && status && button) {
  form.addEventListener('submit', (event) => {
    // Always: the CSP sets form-action 'none', so a native submit goes nowhere at all.
    event.preventDefault();
    void submit();
  });
}

async function submit(): Promise<void> {
  if (!form || !button) return;

  const data = new FormData(form);
  const email = String(data.get('email') ?? '').trim();
  const profession = String(data.get('profession') ?? '').trim();
  const company = String(data.get('company') ?? '');

  if (!email) return say('An email address is needed, or there is no way to come back to you.', 'bad');
  if (!profession) return say(MESSAGES['bad-profession'], 'bad');

  const label = button.textContent ?? 'Register interest';
  button.disabled = true;
  button.textContent = 'Sending…';
  say('Sending — watch the counter at the foot of the page.', 'ok');

  let response: Response;
  try {
    response = await fetch('/api/interest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, profession, company }),
    });
  } catch {
    button.disabled = false;
    button.textContent = label;
    return say(
      'That did not reach us — the request never completed, so nothing was recorded. ' +
      'If you are offline, that would explain it: this is the one thing on the site that needs a connection.',
      'bad'
    );
  }

  let body: { ok?: boolean; error?: string; recorded?: boolean } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Fall through: the status code still tells us whether it worked.
  }

  button.disabled = false;
  button.textContent = label;

  if (response.ok && body.ok) {
    // `recorded: false` is the honeypot answer. It looks like success on purpose, and it
    // is never reached by a person.
    form.hidden = true;
    return say(
      `Recorded — ${email} against "${profession}", and nothing else. ` +
      'We will write when there is something real to show you, and not otherwise. ' +
      'Ask at support@pdf-iq.com any time to have it deleted.',
      'ok'
    );
  }

  const reason = body.error ?? String(response.status);
  say(MESSAGES[reason] ?? `That was refused, and the reason given was "${reason}". Nothing was recorded.`, 'bad');
}
