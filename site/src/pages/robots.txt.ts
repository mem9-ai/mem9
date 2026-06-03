import type { APIRoute } from 'astro';

export const prerender = true;

const fallbackSiteUrl = 'https://mem9.ai';

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL(fallbackSiteUrl);
  const robotsText = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${new URL('/sitemap.xml', siteUrl).toString()}`,
  ].join('\n');

  return new Response(robotsText, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
