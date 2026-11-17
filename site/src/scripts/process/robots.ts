// The robots of the evolution step by step (tournament.ts), after the user's reference drawing: a wide head with
// big round eyes, a small antenna, a framed torso with a screen, thin arms at the sides and two legs. One SVG group
// per robot, drawn in a unit box of 80 x 137. The body is one color; the details (eyes, mouth, screen) are holes of
// the stage's background color, so they follow the mode and the style. Three genes change the proportions: arm
// length, eye size and leg length (the torso grows by what the legs lose, so every robot keeps the same height).

export const UNIT_W = 80, UNIT_H = 137;

/** smile: the default. worried and sideways: scared (slanted lids, straight mouth; sideways looks down and to the
 * side). tired: after the purge (bags under the eyes, straight mouth). */
export type Face = 'smile' | 'worried' | 'sideways' | 'tired';

export interface RobotLook {
  /** CSS color of the body. */
  color: string;
  /** Arm length factor: 1 is the standard robot. */
  arm?: number;
  /** Eye size factor. */
  eye?: number;
  /** Units the torso grows and the legs shrink (negative: longer legs). */
  torso?: number;
  face?: Face;
  /** Text on the screen of the torso (the fitness). */
  screen?: string;
  /** Double outline: the stage color inside, a contrasting ring outside (picked in a tournament). */
  ring?: boolean;
  /** Eliminated: darkened silhouette under a pastel red X. */
  dead?: boolean;
  /** Half faded (how the robot looked before a mutation). */
  faded?: boolean;
  /** Faded (not part of what the step is about). */
  dim?: boolean;
  /** A letter in a badge next to the head (the parents A and B). */
  badge?: string;
}

const f = (value: number): string => (Math.round(value * 100) / 100).toString();
const rect = (x: number, y: number, w: number, h: number, r: number): string =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}"/>`;
const circle = (cx: number, cy: number, r: number): string => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
const polygon = (points: [number, number][]): string => `<polygon points="${points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>`;

const HEAD_Y = 12, HEAD_H = 58, TORSO_Y = HEAD_Y + HEAD_H + 2;
const EYE_Y = HEAD_Y + 29, EYES = [20.5, 59.5];

interface Geometry { arm: number; eye: number; torso: number; legs: number; legTop: number }

function geometry(look: RobotLook): Geometry {
  const torso = 39 + (look.torso ?? 0);
  return { arm: 32 * (look.arm ?? 1), eye: 10 * (look.eye ?? 1), torso, legs: 23 - (look.torso ?? 0), legTop: TORSO_Y + torso + 2.5 };
}

/** The body as plain shapes, so the same list can be stroked (outlines) and filled. */
function silhouette(g: Geometry): string {
  return [
    rect(38.8, 3, 2.4, HEAD_Y - 2, 1.2), circle(40, 4, 3.8),          // antenna
    rect(0, HEAD_Y, 80, HEAD_H, 7),                                     // head
    rect(9, TORSO_Y, 62, g.torso, 5),                                   // torso (its screen is a hole)
    rect(0.5, TORSO_Y + 0.5, 7, g.arm, 3.5), rect(72.5, TORSO_Y + 0.5, 7, g.arm, 3.5),   // arms
    rect(17, g.legTop, 7.5, g.legs, 3.75), rect(55.5, g.legTop, 7.5, g.legs, 3.75),      // legs
  ].join('');
}

/** Eyes, mouth and screen: holes of the stage color, plus the bits in the body color (lids, sparkles). */
function face(g: Geometry, look: RobotLook): string {
  const hole: string[] = [], body: string[] = [];
  const mood = look.face ?? 'smile';
  const r = g.eye;
  if (mood === 'worried' || mood === 'sideways') {
    // Lids slanted down toward the outer corners; sideways moves the eyes down and to the side.
    const dx = mood === 'sideways' ? 5 : 0, dy = mood === 'sideways' ? 4 : 1;
    EYES.forEach((x, index) => {
      const cx = x + dx, cy = EYE_Y + dy, outer = index === 0 ? -1 : 1;
      hole.push(circle(cx, cy, r));
      const low = cy + r * 0.08, high = cy - r * 0.62;   // the lid's edge: low at the outer corner, high inside
      const left = cx - r - 1.5, right = cx + r + 1.5, top = cy - r - 1.5;
      body.push(polygon([[left, top], [right, top], [right, outer < 0 ? high : low], [left, outer < 0 ? low : high]]));
    });
    hole.push(`<path class="rb-line thick" d="M 26 ${HEAD_Y + 50} H 54"/>`);
  } else {
    EYES.forEach((cx) => {
      hole.push(circle(cx, EYE_Y, r));
      if (mood === 'smile') body.push(circle(cx + r * 0.36, EYE_Y - r * 0.38, r * 0.22));   // a little sparkle
    });
    if (mood === 'tired') {
      hole.push(`<path class="rb-line thin" d="${EYES.map((cx) =>
        `M ${f(cx - r - 1.5)} ${f(EYE_Y + r * 0.55)} Q ${f(cx)} ${f(EYE_Y + r + 4.5)} ${f(cx + r + 1.5)} ${f(EYE_Y + r * 0.55)}`).join(' ')}"/>`);
      hole.push(`<path class="rb-line thick" d="M 26 ${HEAD_Y + 50} H 54"/>`);
    } else {
      hole.push(`<path class="rb-line thick" d="M 26 ${HEAD_Y + 45} Q 40 ${HEAD_Y + 57} 54 ${HEAD_Y + 45}"/>`);
    }
  }
  const screenH = Math.max(14, g.torso - 11);
  hole.push(rect(15, TORSO_Y + 6, 50, screenH, 2));
  const screen = look.screen && !look.dead
    ? `<text class="rb-screen" x="40" y="${f(TORSO_Y + 6 + screenH / 2 + 5)}" text-anchor="middle" style="fill:${look.color}">${look.screen}</text>`
    : '';
  return `<g class="rb-hole">${hole.join('')}</g><g class="rb-lid" style="fill:${look.color}">${body.join('')}</g>${screen}`;
}

/** One robot, its unit box placed at (x, y) and scaled by scale. */
export function robot(look: RobotLook, x: number, y: number, scale = 1): string {
  const g = geometry(look);
  const shape = silhouette(g);
  const classes = ['rb', look.dead && 'dead', look.dim && 'dim', look.faded && 'faded'].filter(Boolean).join(' ');
  const transform = `translate(${f(x)} ${f(y)}) scale(${f(scale)})`;
  const parts: string[] = [];
  if (look.ring) parts.push(`<g class="rb-ring-out">${shape}</g><g class="rb-ring-in">${shape}</g>`);
  parts.push(`<g class="rb-body" style="fill:${look.color}">${shape}</g>`);
  parts.push(face(g, look));
  if (look.dead) parts.push('<path class="rb-x" d="M 8 18 L 72 128 M 72 18 L 8 128"/>');
  if (look.badge) parts.push(`<g class="rb-badge">${circle(0, 12, 11)}<text x="0" y="16.6" text-anchor="middle">${look.badge}</text></g>`);
  return `<g class="${classes}" transform="${transform}">${parts.join('')}</g>`;
}

/** A pink heart centered on (x, y), size wide. */
export function heart(x: number, y: number, size: number): string {
  const s = size / 24;
  return `<path class="rb-heart" transform="translate(${f(x - 12 * s)} ${f(y - 11 * s)}) scale(${f(s)})" d="M12 21.4 L10.6 20.1 C5.4 15.4 2 12.3 2 8.5 C2 5.4 4.4 3 7.5 3 C9.2 3 10.9 3.8 12 5.1 C13.1 3.8 14.8 3 16.5 3 C19.6 3 22 5.4 22 8.5 C22 12.3 18.6 15.4 13.4 20.1 Z"/>`;
}
