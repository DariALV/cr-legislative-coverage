import { getNews } from '../../../lib/data';
import { toCsv } from '../../../lib/csv';

export function GET() {
  return toCsv(
    ['news_id', 'bill_number', 'link_source', 'confidence'],
    getNews().flatMap((n) => n.bills.map((b) => [n.id, b.number, b.link_source, b.confidence])),
  );
}
