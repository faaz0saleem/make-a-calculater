import { robotsText } from '@/lib/seo/crawlers';
export const dynamic = 'force-dynamic';
export function GET() {
  return new Response(robotsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
