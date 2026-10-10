import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { STATIC_DEMO_CSP } from './static-demo-csp.ts';

/**
 * The dashboard is served by `exitos ui` under a strict Content-Security-Policy
 * (`script-src 'self'; style-src 'self'`), so the build must emit only external, hashed files:
 * no inline scripts, no inline styles and no remote assets.
 *
 * `vite build --mode demo` (`pnpm build:demo`) builds the STATIC ONLINE DEMO instead: the same
 * dashboard reading one recorded file, `demo-state.json`, with a relative base so it works from
 * any folder or sub-path (for example https://<user>.github.io/EXITOS/). Every static-demo code
 * path is behind the compile-time constant `__STATIC_DEMO__`, which is `false` in the normal build,
 * so the normal bundle contains none of it.
 */

/** `html.replace`, but a template that no longer matches is a build error, never a silent no-op. */
function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) {
    throw new Error(`static demo: index.html no longer contains ${what}; update vite.config.ts.`);
  }
  return html.replace(pattern, () => replacement);
}

/**
 * Demo-only changes to index.html: the CSP as a meta tag (right after the charset declaration, so
 * before any script or stylesheet) and wording that is true for the demo.
 */
function staticDemoHtml(): Plugin {
  return {
    name: 'exitos-static-demo-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = html;
        out = replaceOnce(
          out,
          /<meta charset="UTF-8" \/>/,
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${STATIC_DEMO_CSP}" />`,
          'the charset meta tag',
        );
        out = replaceOnce(
          out,
          /<title>[^<]*<\/title>/,
          '<title>ExitOS online demo (synthetic data)</title>',
          'a <title>',
        );
        out = replaceOnce(
          out,
          /content="ExitOS local dashboard: see what survives before you switch apps\."/,
          'content="ExitOS online demo: a replay of a recorded run on synthetic data. It cannot connect to Notion or ClickUp."',
          'the description meta tag',
        );
        out = replaceOnce(
          out,
          /<noscript\s*>[\s\S]*?<\/noscript\s*>/,
          '<noscript>The ExitOS online demo needs JavaScript. It is a replay of a recorded run on synthetic data and contacts no other service.</noscript>',
          'the <noscript> notice',
        );
        return out;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const staticDemo = mode === 'demo';
  return {
    plugins: [react(), tailwindcss(), ...(staticDemo ? [staticDemoHtml()] : [])],
    // Relative URLs: the demo must not care which folder or sub-path it is hosted under.
    base: staticDemo ? './' : '/',
    define: { __STATIC_DEMO__: JSON.stringify(staticDemo) },
    build: {
      outDir: staticDemo ? 'dist-demo' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // Never inline assets as data: URIs; every file is served from this origin.
      assetsInlineLimit: 0,
      // The polyfill would be one more piece of injected code; every supported browser has modulepreload.
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 600,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      // During development `exitos ui` (default port 4173) provides the state document. That server
      // accepts only its own Host header (DNS-rebinding defence), hence changeOrigin.
      proxy: {
        '/api': { target: 'http://127.0.0.1:4173', changeOrigin: true },
      },
    },
    // `vite preview --mode demo` serves dist-demo, where `pnpm build:demo` also puts demo-state.json.
    // The normal build keeps Vite's defaults.
    ...(staticDemo ? { preview: { host: '127.0.0.1', port: 4174, strictPort: true } } : {}),
  };
});
