#!/usr/bin/env node
/**
 * Site hébergé chez o2switch (Apache) : traduit les règles du site
 * (bureau/public/_headers ; _redirects s'il existe) en un bloc .htaccess, et
 * le fusionne dans le .htaccess de public_html SANS toucher au reste (règles
 * ajoutées par cPanel, Let's Encrypt, PHP…) : seul le bloc entre les
 * marqueurs « BEGIN AppDashboard » et « END AppDashboard » est remplacé.
 *
 *   node scripts/htaccess-o2switch.mjs generer bureau/public > site-dist/htaccess-appdashboard.conf
 *   node scripts/htaccess-o2switch.mjs fusionner site/htaccess-appdashboard.conf ~/public_html/.htaccess
 *
 * Comportements assurés : HTTPS obligatoire, en-têtes de _headers,
 * repli « application d'une page » (une adresse inconnue sert index.html),
 * index.html / manifeste / maj revalidés à chaque visite.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEBUT = '# BEGIN AppDashboard (généré par scripts/htaccess-o2switch.mjs : ne pas modifier entre ces lignes)';
export const FIN = '# END AppDashboard';

/** Règles de _headers : [{ motif, entetes: [[nom, valeur]] }]. */
export function lireHeaders(texte) {
  const regles = [];
  let courante;
  for (const brute of String(texte).split(/\r?\n/)) {
    if (!brute.trim() || brute.trim().startsWith('#')) continue;
    if (!/^\s/.test(brute)) {
      courante = { motif: brute.trim(), entetes: [] };
      regles.push(courante);
      continue;
    }
    const m = /^\s+([A-Za-z0-9-]+)\s*:\s*(.+)$/.exec(brute);
    if (m && courante) courante.entetes.push([m[1], m[2].trim()]);
  }
  return regles.filter(r => r.entetes.length > 0);
}

/** Règles de _redirects : [{ source, cible, code }]. */
export function lireRedirects(texte) {
  return String(texte)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [source, cible, code = '301'] = l.split(/\s+/);
      return { source, cible, code };
    })
    .filter(r => r.source && r.cible);
}

const echapperRegex = s => s.replace(/[.+?^${}()|[\]\\#]/g, '\\$&');
/** Motif de _headers / _redirects (`/assets/*`, `/:nom`) → expression régulière Apache. */
export const motifVersRegex = motif => `^${echapperRegex(motif).replace(/\*/g, '.*').replace(/:[a-z]+/gi, '[^/]+')}$`;
const guillemets = v => `"${String(v).replace(/"/g, '\\"')}"`;

export function genererBloc({ headers = '', redirects = '' } = {}) {
  const l = [DEBUT];
  l.push('Options -Indexes', 'DirectoryIndex index.html', 'AddType application/manifest+json .webmanifest', 'AddType application/javascript .jsbundle', '');
  l.push('<IfModule mod_rewrite.c>', 'RewriteEngine On');
  l.push('# HTTPS obligatoire (sauf la validation Let’s Encrypt).', 'RewriteCond %{HTTPS} !=on', 'RewriteCond %{REQUEST_URI} !^/\\.well-known/', 'RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]');
  for (const r of lireRedirects(redirects)) {
    const code = Number(r.code);
    const regle = motifVersRegex(r.source).replace(/^\^\\?\//, '^');
    if (code === 200) l.push(`RewriteRule ${regle} ${r.cible} [L]`);
    else l.push(`RewriteRule ${regle} ${r.cible} [L,R=${Number.isFinite(code) ? code : 301}]`);
  }
  l.push('# Application d’une page : une adresse inconnue sert index.html.');
  l.push('RewriteCond %{REQUEST_FILENAME} !-f', 'RewriteCond %{REQUEST_FILENAME} !-d', 'RewriteCond %{REQUEST_URI} !^/(assets|maj|esport-assets|\\.well-known)/', 'RewriteRule ^ index.html [L]');
  l.push('</IfModule>', '');
  l.push('<IfModule mod_headers.c>', 'Header always set X-Content-Type-Options "nosniff"');
  l.push('# index.html, manifeste, configuration (esport.json, relais.json) et mises à jour : revalidés à chaque visite.');
  l.push('<FilesMatch "\\.(html|json|webmanifest|jsbundle)$">', '  Header set Cache-Control "no-cache"', '</FilesMatch>');
  for (const r of lireHeaders(headers)) {
    l.push(`<If "%{REQUEST_URI} =~ m#${motifVersRegex(r.motif)}#">`);
    for (const [nom, valeur] of r.entetes) l.push(`  Header set ${nom} ${guillemets(valeur)}`);
    l.push('</If>');
  }
  l.push('</IfModule>', FIN);
  return `${l.join('\n')}\n`;
}

/** Remplace (ou ajoute en tête) le bloc AppDashboard ; le reste du fichier est gardé tel quel. */
export function fusionner(existant, bloc) {
  const texte = String(existant ?? '');
  const propre = bloc.trimEnd();
  const i = texte.indexOf(DEBUT);
  const j = texte.indexOf(FIN);
  if (i >= 0 && j > i) return `${texte.slice(0, i)}${propre}${texte.slice(j + FIN.length)}`.replace(/\n{3,}/g, '\n\n');
  return texte.trim() ? `${propre}\n\n${texte.replace(/^\n+/, '')}` : `${propre}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [action, a, b] = process.argv.slice(2);
  if (action === 'generer') {
    const dossier = a ?? 'bureau/public';
    const lire = nom => (existsSync(join(dossier, nom)) ? readFileSync(join(dossier, nom), 'utf8') : '');
    process.stdout.write(genererBloc({ headers: lire('_headers'), redirects: lire('_redirects') }));
  } else if (action === 'fusionner' && a && b) {
    const bloc = readFileSync(a, 'utf8');
    if (!bloc.startsWith(DEBUT)) throw new Error(`${a} n’est pas un bloc AppDashboard.`);
    writeFileSync(b, fusionner(existsSync(b) ? readFileSync(b, 'utf8') : '', bloc));
    console.log(`.htaccess mis à jour : ${b}`);
  } else {
    console.error('Usage : generer <dossier public> | fusionner <bloc> <.htaccess>');
    process.exit(2);
  }
}
