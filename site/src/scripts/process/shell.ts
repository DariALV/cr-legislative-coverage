// Frame of the process page: mode (shared with the rest of the site through localStorage.theme), style (this
// page only, localStorage["process-style"]), the Settings dialog, the folded sidebar and the scroll-spy.
// html[data-theme] and html[data-style] are first set by the inline script in the layout's <head>.
import { h, readData } from './core';

interface StyleChoice { id: string; name: string; description: string; light: string[]; dark: string[] }
type Mode = 'system' | 'light' | 'dark';

const MODE_KEY = 'theme', STYLE_KEY = 'process-style', SIDE_KEY = 'process-side';
const DEFAULT_STYLE = 'sitio';   // the main site's look, for consistency
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
const styles = readData<StyleChoice[]>('process-styles');

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null): void => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private window: not remembered */ }
};

function currentMode(): Mode {
  const stored = read(MODE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function currentStyle(): string {
  const stored = read(STYLE_KEY);
  return styles.some((style) => style.id === stored) ? (stored as string) : DEFAULT_STYLE;
}

function apply(): void {
  const mode = currentMode(), style = currentStyle();
  const theme = mode === 'dark' || (mode === 'system' && media.matches) ? 'dark' : 'light';
  const changed = root.dataset.theme !== theme || (root.dataset.style ?? 'oficial') !== style;
  root.dataset.theme = theme;
  if (style === 'oficial') delete root.dataset.style; else root.dataset.style = style;
  document.querySelectorAll<HTMLElement>('[data-theme-choice]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === mode)));
  document.querySelectorAll<HTMLElement>('[data-style-choice]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.styleChoice === style)));
  if (changed) document.dispatchEvent(new CustomEvent('themechange', { detail: { theme, style } }));
}

document.addEventListener('click', (event) => {
  const target = event.target as Element;
  const mode = target.closest<HTMLElement>('[data-theme-choice]');
  const style = target.closest<HTMLElement>('[data-style-choice]');
  if (mode) write(MODE_KEY, mode.dataset.themeChoice === 'system' ? null : mode.dataset.themeChoice ?? null);
  if (style) write(STYLE_KEY, style.dataset.styleChoice ?? null);
  if (target.closest('[data-theme-toggle]')) write(MODE_KEY, root.dataset.theme === 'dark' ? 'light' : 'dark');
  if (mode || style || target.closest('[data-theme-toggle]')) apply();
});
media.addEventListener('change', apply);
addEventListener('storage', (event) => { if (event.key === MODE_KEY || event.key === STYLE_KEY) apply(); });
apply();

// ---------- Settings dialog ----------
const dialog = document.querySelector<HTMLDialogElement>('dialog.settings');
const grid = dialog?.querySelector<HTMLElement>('.style-grid');

function renderStyles(): void {
  if (!grid) return;
  const dark = root.dataset.theme === 'dark', current = currentStyle();
  grid.replaceChildren(...styles.map((style) => {
    const [background, surface, accent, ...tiles] = dark ? style.dark : style.light;
    return h('button', { type: 'button', class: 'style-card', 'data-style-choice': style.id, 'aria-pressed': String(style.id === current) },
      h('span', { class: 'style-preview', style: `background:${background}` },
        h('span', { class: 'style-surface', style: `background:${surface}` },
          h('i', { style: `background:${accent}` }),
          ...tiles.map((tile) => h('b', { style: `background:${tile}` })))),
      h('span', { class: 'style-name' }, style.name, style.id === DEFAULT_STYLE && h('em', { class: 'style-tag' }, 'por defecto')),
      h('span', { class: 'style-desc' }, style.description));
  }));
}

document.querySelector('.settings-btn')?.addEventListener('click', () => { renderStyles(); apply(); dialog?.showModal(); });
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog || (event.target as Element).closest('.settings-close')) dialog.close();
});
document.addEventListener('themechange', () => { if (dialog?.open) renderStyles(); });

// ---------- Folded sidebar (icons only) ----------
const collapse = document.querySelector<HTMLButtonElement>('.collapse-btn');
function setCompact(on: boolean): void {
  if (on) root.dataset.side = 'compact'; else delete root.dataset.side;
  collapse?.setAttribute('aria-pressed', String(on));
  dispatchEvent(new Event('resize'));   // charts and canvases refit to the new width
}
setCompact(read(SIDE_KEY) === '1');
collapse?.addEventListener('click', () => {
  const on = root.dataset.side !== 'compact';
  write(SIDE_KEY, on ? '1' : '0');
  setCompact(on);
});

// ---------- Scroll-spy: the chapter around the upper third of the window is the current one ----------
const links = new Map<string, HTMLElement>();
document.querySelectorAll<HTMLElement>('[data-spy]').forEach((link) => links.set(link.dataset.spy ?? '', link));
const chapters = [...links.keys()].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);

function spy(): void {
  const line = innerHeight * 0.35;
  let current = chapters[0];
  for (const chapter of chapters) if (chapter.getBoundingClientRect().top <= line) current = chapter;
  links.forEach((link, id) => {
    if (id === current?.id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}
let queued = false;
addEventListener('scroll', () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; spy(); });
}, { passive: true });
addEventListener('resize', spy);
spy();

// ---------- Cards that fade in the first time they scroll into view ----------
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.reveal').forEach((element) => {
    element.classList.add('is-armed');
    reveal.observe(element);
  });
}
