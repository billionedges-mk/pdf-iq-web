/**
 * Passing a finished file to the next tool.
 *
 * The result pages offer "Next, with this same file". They were plain links, so the next
 * tool opened empty and the file you had just made had to be found on disk and picked
 * again — the one thing the sentence promised would not happen.
 *
 * Every page here is a separate document, deliberately, because a search engine reading
 * them is the whole argument. That rules out keeping the bytes in memory across the
 * navigation, so they have to be handed over through storage the browser already owns.
 *
 * The rules this follows, because the file in question is the user's document:
 *
 *   - IndexedDB on this origin. It never leaves the device, and no request is made.
 *   - One shot. Claiming a handoff deletes it in the same transaction, so a document is
 *     not left sitting in storage after it has been used.
 *   - Short lived. Anything older than ten minutes is swept on the next open, so an
 *     abandoned navigation does not leave a document behind indefinitely.
 *   - Declared. The privacy page says this happens, in the same terms as the OCR model
 *     cache. Storing a document without saying so would be the exact failure this project
 *     keeps writing rules about.
 */

const DB_NAME = 'pdfiq-handoff';
const STORE = 'files';
const MAX_AGE_MS = 10 * 60 * 1000;

export interface Handoff {
  bytes: Uint8Array;
  name: string;
}

/**
 * Where an Unlock button was pressed (src/pro/unlock.ts): the Pro feature and the page, so /pro/buy/ can bring
 * the buyer back to it after paying. Held with the file, under the same one-shot, ten-minute rules.
 */
export interface UnlockIntent {
  feature: string;
  path: string;
}

interface Row {
  key: string;
  name: string;
  /** Absent for an Unlock pressed with no file open. */
  bytes?: ArrayBuffer;
  unlock?: UnlockIntent;
  at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB unavailable'));
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Put a finished file aside and return the key to fetch it with. */
export async function stash(bytes: Uint8Array | null, name: string, unlock?: UnlockIntent): Promise<string | null> {
  try {
    const db = await openDb();
    const key = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    // Sweep stale entries in the same transaction, so an abandoned navigation cannot
    // leave someone's document sitting in storage.
    const cutoff = Date.now() - MAX_AGE_MS;
    store.openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return;
      const row = cursor.value as Row;
      if (!row.at || row.at < cutoff) cursor.delete();
      cursor.continue();
    };

    // Copy into a plain ArrayBuffer: a view over a larger buffer would store the lot.
    const row: Row = { key, name, at: Date.now() };
    if (bytes) row.bytes = bytes.slice().buffer;
    if (unlock) row.unlock = { feature: unlock.feature, path: unlock.path };
    store.put(row);
    await done(tx);
    db.close();
    return key;
  } catch {
    // Private browsing and storage-blocked profiles both land here. The link still
    // navigates; the next tool simply opens empty, as it did before.
    return null;
  }
}

/** Take a handed-off file, removing it as we go. Returns null if there is nothing. */
export async function claim(key: string): Promise<Handoff | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    const row = await new Promise<Row | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as Row | undefined);
      req.onerror = () => reject(req.error);
    });
    // Delete whether or not it was found, and in the same transaction as the read.
    store.delete(key);
    await done(tx);
    db.close();

    if (!row || !row.bytes) return null;
    if (row.at && Date.now() - row.at > MAX_AGE_MS) return null;
    return { bytes: new Uint8Array(row.bytes), name: row.name };
  } catch {
    return null;
  }
}

/**
 * Read an Unlock intent without taking it: /pro/buy/ needs to know where to return, while the file stays put for
 * that page's own claim. `file` is false when no file was carried, or when it is older than the ten minutes a
 * handoff is kept (it is then deleted here rather than waiting for the next sweep).
 */
export async function peekUnlock(key: string): Promise<{ intent: UnlockIntent; name: string; file: boolean; expired: boolean } | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    const row = await new Promise<Row | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as Row | undefined);
      req.onerror = () => reject(req.error);
    });
    const stale = !row?.at || Date.now() - row.at > MAX_AGE_MS;
    if (row && stale) store.delete(key);
    await done(tx);
    db.close();
    if (!row?.unlock) return null;
    return { intent: row.unlock, name: row.name, file: Boolean(row.bytes) && !stale, expired: Boolean(row.bytes) && stale };
  } catch {
    return null;
  }
}

/**
 * Wire the "next" links on a result panel so they carry the finished file across.
 * `current` is called at click time, so it always hands over the latest result rather
 * than whatever existed when the panel was first shown.
 */
let carrying = false;

export function wireNextLinks(root: ParentNode, current: () => Handoff | null): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('.nextup a[href^="/"]'))) {
    if (link.dataset.handoffWired) continue;
    link.dataset.handoffWired = '1';
    link.addEventListener('click', (event) => {
      const result = current();
      if (!result) return; // nothing to carry: behave as an ordinary link
      event.preventDefault();
      // One handoff at a time. A second click used to start a second copy of the document into storage and a
      // second navigation: on the walk of 13 September 2026 a slow Compress-to-Protect handoff was clicked three
      // times, because nothing on the link itself changed.
      if (carrying) return;
      carrying = true;
      const row = link.closest('.nextup');
      for (const other of Array.from(row?.querySelectorAll<HTMLAnchorElement>('a') ?? [])) {
        other.setAttribute('aria-disabled', 'true');
        other.style.pointerEvents = 'none';
        if (other !== link) other.style.opacity = '0.45';
      }
      link.setAttribute('aria-busy', 'true');
      link.textContent = `${link.textContent?.trim() ?? ''} — opening…`;
      const href = link.getAttribute('href')!;
      // Say something before the navigation. Copying a large document into IndexedDB takes a
      // moment, and the page it happens on showed nothing at all: a reader clicked and watched
      // an unchanged screen, unable to tell a slow handoff from a broken link.
      const where = link.textContent?.replace(/ — opening…$/, '').trim() || 'the next tool';
      say(link.closest('.nextup') ?? link.parentElement, `Taking ${result.name} to ${where}…`);
      void stash(result.bytes, result.name).then((key) => {
        location.href = key ? `${href}?from=${encodeURIComponent(key)}` : href;
      });
    });
  }
}

/**
 * If this page was opened from another tool, return the file it handed over.
 * The query string is removed either way, so a reload does not try to re-claim a
 * handoff that has already been consumed.
 */
export async function claimIncoming(): Promise<File | null> {
  const key = new URLSearchParams(location.search).get('from');
  if (!key) return null;
  history.replaceState(null, '', location.pathname);
  // And say something on arrival. The file still has to be read out of storage and parsed by the
  // tool that receives it, which on a large document is seconds of a page that looks empty and
  // idle — the same silence, on the other side of the navigation.
  // Not "from the last tool": since Unlock (src/pro/unlock.ts) a file also arrives back from the purchase page.
  const note = say(document.querySelector('main'), 'Bringing your file over…', true);
  try {
    const handed = await claim(key);
    if (!handed) {
      note?.replaceChildren('That file was not there to collect. It may have been used already, or left too long — choose it from your device instead.');
      return null;
    }
    return new File([handed.bytes as BlobPart], handed.name, { type: 'application/pdf' });
  } finally {
    // The tool takes over from here: the note goes when it shows the file, or on its own if
    // nothing happens, so a stuck intake is never hidden by a message about it.
    if (note) untilFileShows(note);
  }
}

/** A plain line, inserted where the reader is already looking. */
function say(host: Element | null, words: string, first = false): HTMLElement | null {
  if (!host) return null;
  const p = document.createElement('p');
  p.className = 'hint';
  p.dataset.handoffNote = '1';
  p.setAttribute('role', 'status');
  p.textContent = words;
  if (first) host.prepend(p);
  else host.append(p);
  return p;
}

/** Remove the arrival note once the receiving tool has something on screen. */
function untilFileShows(note: HTMLElement): void {
  const shown = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-view]'))
      .some((v) => !v.hidden && v.dataset.view !== 'empty');
  const stop = (): void => {
    observer.disconnect();
    clearTimeout(timer);
    note.remove();
  };
  const observer = new MutationObserver(() => { if (shown()) stop(); });
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  const timer = setTimeout(stop, 60_000);
  if (shown()) stop();
}
