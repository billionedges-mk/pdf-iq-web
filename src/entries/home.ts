/**
 * The homepage's grid trail: the cell under the mouse lights, warms from amber to gold, and fades.
 *
 * Nothing here is decoration for its own sake — it is the one page that has to say "this runs in your browser"
 * before a reader has touched a tool, and a lattice that answers the pointer says it without a sentence. It is also
 * the only page that gets it: every other page is someone doing a job.
 *
 * WHAT IT MUST NOT DO, and why each one is load-bearing on this site:
 *
 *  - No request. The script is served from this origin because `script-src 'self'` would refuse anything else, and
 *    the footer counts third-party requests on every page. A library here would be visible in the readout.
 *  - No storage, no identifiers, nothing recorded.
 *  - Nothing on touch, nothing under reduced motion, nothing for a pen — `(hover: hover)` and `(pointer: fine)`
 *    together, and `pointerType === 'mouse'` on the event, because a laptop with a touchscreen matches the media
 *    queries and still sends touch pointers.
 *  - No frame requested when nothing is fading. The loop ends itself; a scroll while squares are alive restarts it.
 *  - No layout shift: the canvas is fixed and inset 0, outside flow, before the page has drawn anything.
 *
 * THE ALIGNMENT, which is the whole difficulty. The lattice is a CSS background on the root element, positioned
 * `center top`, so its first vertical line sits at ((width - 28) / 2) % 28 and its rows start at the top of the
 * DOCUMENT, not the viewport. Two consequences:
 *
 *   1. The width is `document.body.clientWidth`, never `innerWidth`. CSS centres the background on the root box,
 *      which excludes the scrollbar; innerWidth includes it. On a desktop with a 15px scrollbar that is 7.5px —
 *      a quarter of a cell — and every square would sit visibly off its line.
 *   2. Rows are stored in page coordinates and converted at draw time, so a lit square stays on its cell while the
 *      page scrolls under it rather than following the viewport.
 *
 * Colours come from the stylesheet rather than from constants here, so the mark's amber and Pro's gold cannot
 * drift from the two values this draws.
 */

const CELL = 28;
const PEAK = 0.3;
const WARM_AT = 280;
const GONE_AT = 900;
const RADIUS = 4;
const INSET = 2;

const canvas = document.querySelector<HTMLCanvasElement>('[data-gridtrail]');

const wanted =
  canvas !== null &&
  matchMedia('(hover: hover)').matches &&
  matchMedia('(pointer: fine)').matches &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

if (wanted && canvas) {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const ink = getComputedStyle(document.documentElement);
    const AMBER = ink.getPropertyValue('--amber').trim() || '#C87A1E';
    const GOLD = ink.getPropertyValue('--gold').trim() || '#8A6A24';

    /** col is a viewport-relative column; row is absolute in the document, so scrolling does not move a square. */
    const lit = new Map<string, { col: number; row: number; born: number }>();
    let frame = 0;

    const originX = () => (((document.body.clientWidth - CELL) / 2) % CELL + CELL) % CELL;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      // clientWidth/Height of the canvas itself: it is fixed and inset 0, so this is the viewport without the
      // scrollbar, which is also what the lattice is centred on.
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      frame = 0;
      const now = performance.now();
      const ox = originX();
      const top = window.scrollY;
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      for (const [key, cell] of lit) {
        const age = now - cell.born;
        if (age >= GONE_AT) { lit.delete(key); continue; }
        const left = 1 - age / GONE_AT;
        ctx.globalAlpha = PEAK * left * left;
        ctx.fillStyle = age < WARM_AT ? AMBER : GOLD;
        ctx.beginPath();
        ctx.roundRect(
          ox + cell.col * CELL + INSET,
          cell.row * CELL - top + INSET,
          CELL - INSET * 2,
          CELL - INSET * 2,
          RADIUS,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (lit.size) frame = requestAnimationFrame(draw);
    };

    const wake = () => { if (!frame && lit.size) frame = requestAnimationFrame(draw); };

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const col = Math.floor((e.clientX - originX()) / CELL);
      const row = Math.floor((e.clientY + window.scrollY) / CELL);
      const key = `${col},${row}`;
      const was = lit.get(key);
      // Re-entering a square restarts it rather than stacking a second one on top of the first.
      if (was) was.born = performance.now();
      else lit.set(key, { col, row, born: performance.now() });
      wake();
    }, { passive: true });

    // A square is pinned to the document, so scrolling moves it on screen while it is still alive.
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', () => { resize(); wake(); });

    resize();
  }
}
