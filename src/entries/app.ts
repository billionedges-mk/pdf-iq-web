/**
 * /app/: the hero's screen switcher.
 *
 * Three real screenshots, one shown at a time. The markup ships the first panel visible, the rest
 * `hidden`, and the whole tab list `hidden` — so a reader without JavaScript gets one screenshot and
 * nothing that looks clickable and is not. This script is the only thing that reveals the controls,
 * which means the enhanced state cannot exist without the code that makes it work.
 *
 * Keyboard follows the tabs pattern: arrows move and select, Home and End jump to the ends, and only
 * the selected tab is in the tab order.
 */
const root = document.querySelector<HTMLElement>('[data-screens]');
const tabs = root ? [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')] : [];
const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''));

// Every tab must have found its panel. A switcher with one dead tab is worse than no switcher, and a
// missing id is exactly the kind of thing a rename does silently.
if (root && tabs.length > 1 && panels.every((p): p is HTMLElement => p !== null)) {
  const show = (i: number, moveFocus: boolean) => {
    tabs.forEach((tab, n) => {
      const on = n === i;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      (panels[n] as HTMLElement).hidden = !on;
    });
    if (moveFocus) tabs[i].focus();
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => show(i, false));
    tab.addEventListener('keydown', (e) => {
      const step =
        e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 :
        e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 :
        e.key === 'Home' ? 0 :
        e.key === 'End' ? tabs.length - 1 : null;
      if (step === null) return;
      e.preventDefault();
      show((step + tabs.length) % tabs.length, true);
    });
  });

  show(0, false);
  root.hidden = false;
}
