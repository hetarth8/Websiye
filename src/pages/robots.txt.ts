import type { APIRoute } from 'astro';

/**
 * robots.txt, generated rather than kept as a static file.
 *
 * The sitemap line has to carry an absolute URL, so a hardcoded file silently
 * points at the wrong host the moment a real domain is attached. Building it
 * from `Astro.site` — which itself resolves from the deploy environment in
 * astro.config.mjs — keeps the two permanently in step.
 */
export const GET: APIRoute = ({ site }) => {
  const origin = site?.href.replace(/\/$/, '') ?? '';

  const body = [
    'User-agent: *',
    'Allow: /',
    // The CMS holds write access to the repository and must never be indexed.
    'Disallow: /admin/',
    // A form destination has no standalone value in search results.
    'Disallow: /thank-you',
    '',
    `Sitemap: ${origin}/sitemap-index.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
