/**
 * A visible answer to "am I in a Pro session?" — local builds only.
 *
 * The preview banner says this *build* has the Pro flag on. It says nothing about whether this
 * *browser* is signed in, and with the local stub that is a per-browser switch which is easy to
 * leave off. Someone using the preview then reads every absent Pro control as a missing feature,
 * and is right to: nothing on the screen distinguishes "you are not signed in" from "this was
 * never built". That happened on 12 September 2026 — three observations, one cause.
 *
 * So the banner carries the session state on every page, and links to where it is changed.
 *
 * `__PDFIQ_LOCAL__` is false in every deployed build: esbuild drops what follows, and build.mjs
 * does not emit the script tag at all. tools/verify-pro-gate.mjs proves the absence.
 */
import { localStub } from './gate.js';
import { readSession } from './session.js';

export const LOCAL_BADGE_SENTINEL = 'pdfiq-pro:local-badge';

function describe(): { on: boolean; words: string } {
  let session = null;
  try {
    session = readSession();
  } catch {
    session = null;
  }
  if (session) return { on: true, words: 'Pro session: on — signed in' };
  if (localStub()) return { on: true, words: 'Pro session: on — local stub' };
  return { on: false, words: 'Pro session: off — Pro controls will ask you to sign in' };
}

function mount(): void {
  const banner = document.querySelector<HTMLElement>('[data-pdfiq-pro]');
  if (!banner) return;

  const badge = document.createElement('span');
  badge.dataset.pdfiqLocalBadge = LOCAL_BADGE_SENTINEL;
  badge.style.cssText = 'margin-left: 10px; padding: 2px 8px; border-radius: 999px; font-weight: 700;';

  const link = document.createElement('a');
  link.href = '/account/';
  link.style.cssText = 'color: inherit; margin-left: 8px; text-decoration: underline;';
  link.textContent = 'change';

  const paint = (): void => {
    const { on, words } = describe();
    badge.textContent = words;
    badge.style.background = on ? '#1F7A4D' : '#7A2E1F';
    badge.style.color = '#FAF8F4';
  };
  paint();
  // Another tab toggling the stub changes this one too, and a stale badge is worse than none.
  window.addEventListener('storage', paint);

  banner.append(badge, link);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
