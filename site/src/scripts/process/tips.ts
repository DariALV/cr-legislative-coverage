// Floating tooltip of the diagrams. Any element with data-tip="<id>" shows the content of the element with that
// id (rendered by Astro at build time, formulas included) while the pointer or the keyboard focus is on it.
const tip = document.querySelector<HTMLElement>('.tip');
let owner: Element | null = null;

function place(x: number, y: number): void {
  if (!tip) return;
  const margin = 12, { width, height } = tip.getBoundingClientRect();
  const left = Math.min(Math.max(margin, x + 16), innerWidth - width - margin);
  const top = y + 18 + height > innerHeight - margin ? Math.max(margin, y - height - 14) : y + 18;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function show(target: Element, x: number, y: number): void {
  const source = document.getElementById(target.getAttribute('data-tip') ?? '');
  if (!tip || !source) return;
  if (owner !== target) {
    tip.innerHTML = source.innerHTML;
    owner = target;
  }
  tip.hidden = false;
  place(x, y);
}

function hide(target: Element | null): void {
  if (!tip || (target && target !== owner)) return;
  tip.hidden = true;
  owner = null;
}

const tipTarget = (event: Event): Element | null => (event.target as Element).closest?.('[data-tip]') ?? null;

document.addEventListener('pointermove', (event) => {
  const target = tipTarget(event);
  if (target) show(target, event.clientX, event.clientY);
  else if (owner && !owner.matches(':focus')) hide(null);
});
document.addEventListener('focusin', (event) => {
  const target = tipTarget(event);
  if (!target) return;
  const box = target.getBoundingClientRect();
  show(target, box.left + Math.min(box.width, 260) / 2, box.bottom - 10);
});
document.addEventListener('focusout', (event) => hide(tipTarget(event)));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(null); });
addEventListener('scroll', () => hide(null), { passive: true });
