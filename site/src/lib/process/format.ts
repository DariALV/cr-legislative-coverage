/**
 * Number formatting of the process page, in the Costa Rican convention (29.875 and 0,80).
 * Pure functions: used at build time and by the client scripts.
 */

/** 29875 -> "29.875" */
export function int(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 0.8045 -> "0,80" */
export function dec(value: number, digits = 2): string {
  const [whole, fraction] = Math.abs(value).toFixed(digits).split('.');
  const sign = value < 0 ? '−' : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

/** 0.8045 -> "80,5 %" */
export function pct(share: number, digits = 1): string {
  return `${dec(share * 100, digits)} %`;
}

/** 13.0536 -> "$13,05" */
export function usd(value: number, digits = 2): string {
  return `$${dec(value, digits)}`;
}

/** Weight with an explicit sign: 1.18 -> "+1,18" */
export function signed(value: number, digits = 2): string {
  return value > 0 ? `+${dec(value, digits)}` : dec(value, digits);
}

/** JSON safe to place inside a <script type="application/json"> element. */
export function jsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
