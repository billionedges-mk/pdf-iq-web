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

interface Row {
  key: string;
  name: string;
  bytes: ArrayBuffer;
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
export async function stash(bytes: Uint8Array, name: string): Promise<string | null> {
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
    const copy = bytes.slice().buffer;
    store.put({ key, name, bytes: copy, at: Date.now() } satisfies Row);
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
 * Wire the "next" links on a result panel so they carry the finished file across.
 * `current` is called at click time, so it always hands over the latest result rather
 * than whatever existed when the panel was first shown.
 */
export function wireNextLinks(root: ParentNode, current: () => Handoff | null): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('.nextup a[href^="/"]'))) {
    if (link.dataset.handoffWired) continue;
    link.dataset.handoffWired = '1';
    link.addEventListener('click', (event) => {
      const result = current();
      if (!result) return; // nothing to carry: behave as an ordinary link
      event.preventDefault();
      const href = link.getAttribute('href')!;
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
  const handed = await claim(key);
  if (!handed) return null;
  return new File([handed.bytes as BlobPart], handed.name, { type: 'application/pdf' });
}
