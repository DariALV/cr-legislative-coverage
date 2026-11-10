/** Compact news index for the browser (/noticias listing and search). */
import { getNewsIndexRows } from '../../lib/data';

export function GET() {
  return new Response(JSON.stringify(getNewsIndexRows()), {
    headers: { 'Content-Type': 'application/json' },
  });
}
