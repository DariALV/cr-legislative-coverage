// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages: the site is published from the main repo, under /cr-legislative-coverage.
// SITE_URL can be overridden in CI (e.g. https://<user>.github.io).
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://example.github.io',
  base: '/cr-legislative-coverage',
  output: 'static',
  trailingSlash: 'always',
});
