// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages: the site lives under /cr-legislative-coverage-site.
// SITE_URL can be overridden in CI (e.g. https://<user>.github.io).
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://example.github.io',
  base: '/cr-legislative-coverage-site',
  output: 'static',
  trailingSlash: 'always',
});
