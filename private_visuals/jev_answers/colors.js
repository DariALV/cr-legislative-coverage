// Color helpers of the Jev answers viewer. Every color is a token of the shared theme (../theme/theme.css),
// resolved at render time through LC.css (../theme/theme.js); the views redraw on "themechange".
// Colors written as var(--token) in inline styles follow the theme by themselves; the helpers below are for the
// ones computed in JS (ramps, blends and text picked for contrast).
window.JEV_COLORS = (() => {
  // Resolved tokens, cached until the theme changes. This file loads before app.js and analysis.js, so its
  // listener runs first and their redraws read fresh values.
  let cache = {};
  document.addEventListener("themechange", () => { cache = {}; });

  const toHex = (s) => {
    const v = String(s || "").trim();
    if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + [1, 2, 3].map((i) => v[i] + v[i]).join("");
    return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  };
  // Hex value of a theme token, e.g. tok("--div-neg").
  const tok = (name) => (cache[name] ??= toHex(window.LC.css(name)) || toHex(window.LC.css("--ink-3")));
  const mix = (a, b, t) => window.LC.mix(a, b, Math.max(0, Math.min(1, t)));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // WCAG relative luminance and contrast ratio.
  const lum = (hex) => {
    const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // Background and text for a colored cell or label with at least 4.5:1 (WCAG AA). Text is --ink or --surface,
  // whichever reads better; when neither reaches 4.5:1 (mid-ramp colors), the background is faded toward --surface
  // until --ink does.
  function onColor(bg) {
    const ink = tok("--ink"), surface = tok("--surface");
    const cs = contrast(bg, surface), ci = contrast(bg, ink);
    if (cs >= 4.5 && cs >= ci) return { bg, fg: surface };
    if (ci >= 4.5) return { bg, fg: ink };
    for (let t = 0.1; t < 1; t += 0.1) {
      const b = mix(bg, surface, t);
      if (contrast(b, ink) >= 4.5) return { bg: b, fg: ink };
    }
    return { bg: surface, fg: ink };
  }
  const cellStyle = (bg) => { const c = onColor(bg); return `background:${c.bg};color:${c.fg}`; };

  // Diverging ramp for a value in -1..1: --div-mid at 0, through the soft tone, to --div-neg / --div-pos.
  function div(v) {
    if (v == null || Number.isNaN(v)) return tok("--soft");
    const t = clamp(v, -1, 1);
    const k = Math.min(1, Math.abs(t) * 1.6);
    const [soft, strong] = t < 0 ? [tok("--div-neg-soft"), tok("--div-neg")] : [tok("--div-pos-soft"), tok("--div-pos")];
    return k < 0.5 ? mix(tok("--div-mid"), soft, k * 2) : mix(soft, strong, k * 2 - 1);
  }
  // Text color for a signed value on the card: the ends of the ramp (both meet AA on --surface), --ink-2 near 0.
  const divText = (v) => (v == null || Number.isNaN(v) || Math.abs(v) < 0.05 ? "var(--ink-2)" : v < 0 ? "var(--div-neg-text)" : "var(--div-pos-text)");
  // Sequential ramp for 0..1.
  const seq = (v) => (v == null || Number.isNaN(v) ? tok("--soft") : mix(tok("--seq-low"), tok("--seq-high"), clamp(v, 0, 1)));

  return { tok, mix, contrast, onColor, cellStyle, div, divText, seq };
})();
