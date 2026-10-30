/// <reference types="node" />
/**
 * Search-engine plumbing that needs the site's public address.
 *
 * Canonical links, Open Graph / Twitter image URLs, the JSON-LD `url` and the
 * sitemap must all be absolute, so index.html carries a `__SITE_URL__`
 * placeholder that this plugin replaces at build time, and the plugin emits
 * `robots.txt` and `sitemap.xml` next to the bundle.
 *
 * The address comes from, in order: `SITE_URL` (set it when the game has a
 * custom domain), Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (the production
 * domain, also present during Preview builds), then the default below. Preview
 * deployments are kept out of the index with `noindex` (see `isIndexable`).
 */
import { loadEnv, type Plugin } from "vite";

/** Used when neither variable is set (local builds). */
const DEFAULT_SITE_URL = "https://radar-command.vercel.app";

/** Origin without a trailing slash, from a bare host or a full URL. */
function normalise(raw: string): string {
  const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return url.replace(/\/+$/, "");
}

/** `emitFiles: false` skips robots.txt and sitemap.xml (the native app has no use for them). */
export function seo({ emitFiles = true }: { emitFiles?: boolean } = {}): Plugin {
  let siteUrl = DEFAULT_SITE_URL;
  // Only the production deployment (or a local build) may be indexed: a
  // Preview URL would compete with the real site as a duplicate.
  let isIndexable = true;

  return {
    name: "seo",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      const raw = process.env.SITE_URL ?? env.SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
      if (raw) siteUrl = normalise(raw);
      isIndexable = process.env.VERCEL_ENV !== "preview";
    },
    transformIndexHtml(html) {
      const robots = isIndexable
        ? "index, follow, max-image-preview:large, max-snippet:-1"
        : "noindex, nofollow";
      return html.replaceAll("__SITE_URL__", siteUrl).replaceAll("__ROBOTS__", robots);
    },
    generateBundle() {
      if (!emitFiles) return;
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: isIndexable
          ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
          : "User-agent: *\nDisallow: /\n",
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
      });
    },
  };
}
