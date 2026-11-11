/**
 * Internal URL builders. Always go through these so that the GitHub Pages
 * base path (import.meta.env.BASE_URL) is respected.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Join the base path with a site-relative path ("expedientes/" -> "/base/expedientes/"). */
export function href(path = ''): string {
  const clean = path.replace(/^\/+/, '');
  return `${BASE}/${clean}`;
}

export const billHref = (n: number) => href(`expediente/${n}/`);
export const newsHref = (id: string) => href(`noticia/${id}/`);
export const dataHref = (file: string) => href(`data/${file}`);
