/**
 * Bloc .htaccess du site (scripts/htaccess-o2switch.mjs, docs/performance.md) : compression des textes (brotli, sinon
 * gzip), jamais des fichiers déjà compressés ; cache d'un an pour assets/ ; index.html et version.json revalidés.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { genererBloc, TYPES_COMPRESSES } from '../../scripts/htaccess-o2switch.mjs';

const headers = readFileSync(fileURLToPath(new URL('../../bureau/public/_headers', import.meta.url)), 'utf8');
const bloc = genererBloc({ headers });

test('compression : brotli si le module est là, sinon gzip (mod_deflate), jamais les deux', () => {
  // Toujours sous mod_filter : sans lui AddOutputFilterByType est inconnue et Apache rejette tout le .htaccess.
  assert.match(bloc, /<IfModule mod_filter\.c>\n\s+<IfModule mod_brotli\.c>\n\s+AddOutputFilterByType BROTLI_COMPRESS [^\n]*text\/javascript/);
  assert.match(bloc, /<IfModule !mod_brotli\.c>\n\s+<IfModule mod_deflate\.c>\n\s+AddOutputFilterByType DEFLATE [^\n]*application\/javascript/);
  for (const type of ['text/html', 'text/css', 'application/json', 'image/svg+xml', 'application/wasm']) assert.ok(TYPES_COMPRESSES.includes(type), type);
  // Polices et images sont déjà compressées : les recompresser coûte du processeur pour rien.
  assert.ok(!TYPES_COMPRESSES.some(t => /font|woff|png|jpe?g|webp/.test(t)));
  assert.match(bloc, /AddType application\/wasm \.wasm/);
});

test('cache : assets/ un an (noms à empreinte), index.html et version.json revalidés', () => {
  assert.match(bloc, /assets\/\.\*\$#">\n\s+Header set Cache-Control "public, max-age=31536000, immutable"/);
  assert.match(bloc, /<FilesMatch "\\\.\(html\|json\|webmanifest\|jsbundle\)\$">\n\s+Header set Cache-Control "no-cache"/);
  assert.match(bloc, /version\\\.json\$#">\n\s+Header set Cache-Control "no-cache, no-store, must-revalidate"/);
});

test('les blocs IfModule sont équilibrés (Apache refuse sinon tout le .htaccess : erreur 500)', () => {
  const ouverts = (bloc.match(/<IfModule /g) ?? []).length;
  const fermes = (bloc.match(/<\/IfModule>/g) ?? []).length;
  assert.equal(ouverts, fermes);
  assert.equal((bloc.match(/<If /g) ?? []).length, (bloc.match(/<\/If>/g) ?? []).length);
});
