/**
 * The grid of real page thumbnails used by rotate, reorder and split.
 *
 * Thumbnails are rendered by pdf.js into canvases that live only in this tab's memory.
 * Rendering is lazy and driven by an IntersectionObserver: a 600-page document would
 * otherwise spend a minute rendering pages nobody has scrolled to, and on a phone it
 * would run the tab out of memory before showing anything.
 */

import { openDocument, renderPage, type PDFDocumentProxy, type OpenedDoc } from './pdfjs.js';

export interface PageCell {
  index: number;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  label: HTMLElement;
}

export interface GridOptions {
  /** Called when a cell is activated (click or Enter). */
  onActivate?: (index: number, cell: PageCell) => void;
  /** Extra controls to place under each thumbnail. */
  controls?: (index: number, cell: PageCell) => HTMLElement | null;
  thumbWidth?: number;
}

export class PageGrid {
  readonly cells: PageCell[] = [];
  private observer: IntersectionObserver | null = null;
  private rendered = new Set<number>();
  private opened: OpenedDoc | null = null;
  private doc: PDFDocumentProxy | null = null;
  private queue: number[] = [];
  private working = false;

  constructor(private host: HTMLElement, private options: GridOptions = {}) {}

  async load(bytes: Uint8Array, pageCount: number): Promise<void> {
    this.destroy();
    this.opened = await openDocument(bytes);
    this.doc = this.opened.doc;
    this.host.textContent = '';

    for (let i = 0; i < pageCount; i++) this.cells.push(this.makeCell(i));

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.page);
          this.enqueue(index);
        }
      },
      { root: null, rootMargin: '400px 0px' }
    );
    for (const cell of this.cells) this.observer.observe(cell.root);
  }

  private makeCell(index: number): PageCell {
    const root = document.createElement('div');
    root.className = 'pagecell';
    root.dataset.page = String(index);
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', `Page ${index + 1}`);

    const canvas = document.createElement('canvas');
    canvas.className = 'pagecell__canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'pagecell__n';
    label.textContent = String(index + 1);

    root.append(canvas, label);
    const cell: PageCell = { index, root, canvas, label };

    const extra = this.options.controls?.(index, cell);
    if (extra) root.appendChild(extra);

    if (this.options.onActivate) {
      root.tabIndex = 0;
      root.addEventListener('click', (e) => {
        // Let the per-cell buttons handle their own clicks.
        if ((e.target as HTMLElement).closest('button')) return;
        this.options.onActivate!(index, cell);
      });
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.options.onActivate!(index, cell);
        }
      });
    }

    this.host.appendChild(root);
    return cell;
  }

  private enqueue(index: number): void {
    if (this.rendered.has(index) || this.queue.includes(index)) return;
    this.queue.push(index);
    void this.drain();
  }

  /** One page at a time: parallel rendering just contends for the same worker. */
  private async drain(): Promise<void> {
    if (this.working || !this.doc) return;
    this.working = true;
    while (this.queue.length) {
      const index = this.queue.shift()!;
      if (this.rendered.has(index)) continue;
      this.rendered.add(index);
      const cell = this.cells[index];
      if (!cell) continue;
      try {
        const page = await this.doc.getPage(index + 1);
        await renderPage(page, this.options.thumbWidth ?? 150, cell.canvas);
        page.cleanup();
      } catch {
        // A page that will not render is not a reason to lose the grid; the cell
        // stays blank and every control on it still works.
        cell.root.classList.add('pagecell--blank');
      }
    }
    this.working = false;
  }

  /** Reorder the DOM to match a list of original page indices. */
  applyOrder(order: number[]): void {
    for (const index of order) {
      const cell = this.cells[index];
      if (cell) this.host.appendChild(cell.root);
    }
    order.forEach((index, position) => {
      const cell = this.cells[index];
      if (cell) {
        cell.label.textContent = `${position + 1}`;
        cell.root.setAttribute('aria-label', `Page ${position + 1}, originally page ${index + 1}`);
      }
    });
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    void this.opened?.close();
    this.opened = null;
    this.doc = null;
    this.cells.length = 0;
    this.rendered.clear();
    this.queue.length = 0;
    this.host.textContent = '';
  }
}

/** Page geometry, for the rotate tool's "these nine are sideways" detection. */
export interface PageShape {
  index: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  landscape: boolean;
}

export function readShapes(pages: Array<{ getSize(): { width: number; height: number }; getRotation(): { angle: number } }>): PageShape[] {
  return pages.map((page, index) => {
    const { width, height } = page.getSize();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    // A page turned 90 or 270 presents its height as its width.
    const swapped = rotation === 90 || rotation === 270;
    const w = swapped ? height : width;
    const h = swapped ? width : height;
    return { index, widthPt: w, heightPt: h, rotation, landscape: w > h };
  });
}
