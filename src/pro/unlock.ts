/**
 * The Unlock button on a locked Pro feature (sale builds, signed in, no purchase pending).
 *
 * Pressing it puts the file open on this page aside, with the feature and the page, in the same IndexedDB
 * handoff the "next" links use (src/lib/handoff.ts: on this device, one shot, ten minutes), and opens
 * /pro/buy/ with its key. /pro/buy/ opens Paddle's checkout at once, and after the purchase is confirmed brings
 * the buyer back to this page with the file.
 *
 * The file carried is the one the person chose, as chosen: never a decrypted or processed copy.
 */
import { stash } from '../lib/handoff.js';

export const UNLOCK_SENTINEL = 'pdfiq-pro:unlock';

export function unlockButton(feature: string, carry?: () => File | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--sm';
  button.dataset.pdfiqUnlock = UNLOCK_SENTINEL;
  button.textContent = `Unlock with Pro — ${__PDFIQ_PRO_PRICE__} once`;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const file = carry?.() ?? null;
    button.textContent = file ? `Taking ${file.name} to the checkout…` : 'Opening the checkout…';
    let bytes: Uint8Array | null = null;
    try {
      bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
    } catch {
      // The file could not be read again (moved or deleted on disk): go without it, and /pro/buy/ says so.
    }
    const key = await stash(bytes, file?.name ?? '', { feature, path: location.pathname });
    location.href = key ? `/pro/buy/?unlock=${encodeURIComponent(key)}` : '/pro/buy/';
  });
  return button;
}
