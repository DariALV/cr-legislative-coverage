import { getBills } from '../../../lib/data';
import { toCsv } from '../../../lib/csv';

export function GET() {
  return toCsv(
    ['number', 'name', 'file_type', 'date_proposed', 'status', 'law_number', 'subjects', 'news_count', 'votes_count'],
    getBills().map((b) => [b.number, b.name, b.file_type, b.date_proposed, b.status, b.law_number, b.subjects.join('; '), b.news_count, b.votes_count]),
  );
}
