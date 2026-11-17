/**
 * Schematic thumbnails of the local graph views, as the inner markup of a 240 x 150 SVG. They are drawn from
 * made-up points (seeded), not from the data: they show what kind of picture each view is. Colors are theme
 * tokens, so they follow the mode and the style without any script.
 */
import { seededRandom } from './random';

const W = 240, H = 150;
const fixed = (value: number) => value.toFixed(1);
type Point = { x: number; y: number; color: string; r: number };

function cluster(random: () => number, cx: number, cy: number, count: number, spread: number, color: string, r: number): Point[] {
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * spread;
    return { x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance * 0.8, color, r };
  });
}

const dot = (p: Point) => `<circle cx="${fixed(p.x)}" cy="${fixed(p.y)}" r="${p.r}" style="fill:var(${p.color})"/>`;
const line = (a: Point, b: Point, style = 'stroke:var(--line-strong);stroke-width:.8;opacity:.55') =>
  `<line x1="${fixed(a.x)}" y1="${fixed(a.y)}" x2="${fixed(b.x)}" y2="${fixed(b.y)}" style="${style}"/>`;

/** Links from every point to its nearest neighbors inside the same list. */
function nearest(points: Point[], each: number): string {
  return points.map((point, index) => points
    .map((other, otherIndex) => ({ other, otherIndex, d: (other.x - point.x) ** 2 + (other.y - point.y) ** 2 }))
    .filter((item) => item.otherIndex > index).sort((a, b) => a.d - b.d).slice(0, each)
    .map((item) => line(point, item.other)).join('')).join('');
}

function bills(): string {
  const random = seededRandom(11);
  const groups = [
    cluster(random, 62, 52, 16, 30, '--cat-1', 3), cluster(random, 168, 46, 14, 28, '--cat-3', 3),
    cluster(random, 120, 108, 15, 30, '--cat-2', 3), cluster(random, 205, 112, 8, 16, '--cat-7', 3),
  ];
  const loose = cluster(random, 120, 75, 22, 110, '--data-none', 1.8).filter((p) => p.x > 6 && p.x < W - 6 && p.y > 6 && p.y < H - 6);
  return loose.map(dot).join('') + groups.map((group) => nearest(group, 2)).join('') + groups.flat().map(dot).join('');
}

function deputies(): string {
  const random = seededRandom(5);
  const a = cluster(random, 70, 76, 14, 34, '--party-ppso', 5.5), b = cluster(random, 168, 58, 9, 26, '--party-pln', 5.5);
  const c = cluster(random, 186, 112, 5, 16, '--party-fa', 5.5), d = cluster(random, 128, 118, 4, 12, '--party-pusc', 5.5);
  const bridges = [line(b[0], c[0]), line(b[1], d[0]), line(c[1], d[1]), line(a[0], d[2], 'stroke:var(--line-strong);stroke-width:.6;opacity:.35')];
  const ring = (p: Point) => `<circle cx="${fixed(p.x)}" cy="${fixed(p.y)}" r="${p.r}" style="fill:var(${p.color});stroke:var(--surface);stroke-width:1.2"/>`;
  return [a, b, c, d].map((group) => nearest(group, 3)).join('') + bridges.join('') + [a, b, c, d].flat().map(ring).join('');
}

function news(): string {
  const random = seededRandom(23);
  const outlets = ['--crhoy', '--nacion', '--delfino', '--elmundo', '--semanario'];
  const centers = [[60, 50], [150, 40], [200, 95], [95, 110], [140, 80], [40, 100], [185, 50]];
  return centers.flatMap(([cx, cy], index) => {
    const main = outlets[index % outlets.length];
    return cluster(random, cx, cy, 46, 30, main, 1.3).map((point) => (random() < 0.4 ? { ...point, color: outlets[Math.floor(random() * outlets.length)] } : point));
  }).map(dot).join('');
}

function parties(): string {
  const partyColors = ['--party-ppso', '--party-pln', '--party-fa', '--party-pusc', '--party-cac'];
  const left = partyColors.map((color, index) => ({ x: 46, y: 22 + index * 26.5, color, r: 8 }));
  const right = Array.from({ length: 6 }, (_, index) => ({ x: 194, y: 18 + index * 22.8, color: '--data-neutral', r: 6 }));
  const random = seededRandom(3);
  const links = left.flatMap((party, index) => right.filter(() => random() < 0.62).map((topic) => {
    const against = index === 2 && random() < 0.45;
    const path = `M ${party.x} ${fixed(party.y)} C 110 ${fixed(party.y)}, 130 ${fixed(topic.y)}, ${topic.x} ${fixed(topic.y)}`;
    return `<path d="${path}" style="fill:none;stroke:var(${against ? '--div-neg' : '--div-pos'});stroke-width:${fixed(1 + random() * 2.4)};opacity:.7"/>`;
  }));
  return links.join('') + [...left, ...right].map(dot).join('');
}

function comentions(): string {
  const random = seededRandom(41);
  const points = cluster(random, 120, 75, 13, 86, '--cat-6', 5).map((point, index) => ({ ...point, r: 4 + (index % 4) * 1.4 }));
  const links = points.flatMap((point, index) => points
    .map((other, otherIndex) => ({ other, otherIndex, d: Math.hypot(other.x - point.x, other.y - point.y) }))
    .filter((item) => item.otherIndex > index && item.d < 74)
    .map((item) => line(point, item.other, `stroke:var(--ink-3);stroke-width:${fixed(0.8 + random() * 3.2)};opacity:.5;stroke-linecap:round`)));
  return links.join('') + points.map(dot).join('');
}

export const THUMBS = { bills: bills(), deputies: deputies(), news: news(), parties: parties(), comentions: comentions() };
export type ThumbName = keyof typeof THUMBS;
export const THUMB_BOX = `0 0 ${W} ${H}`;
