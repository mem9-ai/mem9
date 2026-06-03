import type { APIRoute } from 'astro';

export const prerender = true;

const fallbackSiteUrl = 'https://mem9.ai';
const publicPages = ['/', '/api', '/docs', '/openclaw-memory', '/pricing'];

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL(fallbackSiteUrl);
  const lastModified = new Date().toISOString();
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${publicPages
  .map(
    (path) => `  <url>
    <loc>${new URL(path, siteUrl).toString()}</loc>
    <lastmod>${lastModified}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(sitemapXml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
