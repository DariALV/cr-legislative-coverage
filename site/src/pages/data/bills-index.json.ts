/** Compact bill index for the browser (/expedientes listing and search). */
import { getBillIndexRows } from '../../lib/data';

export function GET() {
  return new Response(JSON.stringify(getBillIndexRows()), {
    headers: { 'Content-Type': 'application/json' },
  });
}
