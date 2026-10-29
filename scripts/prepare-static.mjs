import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

// A real entry lets static hosts serve /screen/ and refresh it without SPA rewrites.
mkdirSync('dist/screen', { recursive: true });
copyFileSync('dist/index.html', 'dist/screen/index.html');
writeFileSync('dist/.nojekyll', '');
