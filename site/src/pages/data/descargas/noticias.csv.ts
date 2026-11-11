import { getNews } from '../../../lib/data';
import { toCsv } from '../../../lib/csv';

export function GET() {
  return toCsv(
    ['id', 'title', 'organization', 'outlet_type', 'section', 'date_published', 'url'],
    getNews().map((n) => [n.id, n.title, n.organization, n.outlet_type, n.section, n.date_published, n.url]),
  );
}
