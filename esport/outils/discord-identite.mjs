/**
 * Identité visuelle du bot Discord : rend en PNG l'avatar et la bannière
 * (SVG versionnés dans docs/esport/bot/), et les APERÇUS des messages du bot
 * (HTML au style de Discord, puis PNG) dans docs/esport/bot/apercus/. Les
 * aperçus sont fabriqués avec les VRAIES fonctions du bot (embeds.mjs) :
 * ce qu'on voit est ce que Discord reçoit.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node esport/outils/discord-identite.mjs
 *   node esport/outils/discord-identite.mjs --html     (aperçus HTML seulement, sans navigateur)
 *
 * Aucun réseau : les miniatures des cartes (valorant-api) sont remplacées par
 * une vignette locale dans les aperçus.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACCENT, COULEUR_ERREUR, COULEUR_OK, boutonLien, boutonsPagination, boutonsRsvp, carteDans, embedEvenement, embedReponse, horodatage } from '../noyau/discord/embeds.mjs';

const racine = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dossier = join(racine, 'docs/esport/bot');
const apercus = join(dossier, 'apercus');
mkdirSync(apercus, { recursive: true });
const identite = JSON.parse(readFileSync(join(dossier, 'identite.json'), 'utf8'));
const LIEN = 'https://appdashboard.fr/esport';
const T = Date.parse('2026-10-21T17:00:00Z');
const DEBUT = Date.parse('2026-10-22T18:30:00Z');
const IDS = { lea: '800000000000000001', tom: '800000000000000002', zed: '800000000000000003', nox: '800000000000000004' };
const NOMS = { [IDS.lea]: 'Léa', [IDS.tom]: 'Tom', [IDS.zed]: 'Zed', [IDS.nox]: 'Nox' };
const convoques = [
  { pseudo: 'Léa', discordId: IDS.lea },
  { pseudo: 'Tom', discordId: IDS.tom },
  { pseudo: 'Nox', discordId: IDS.nox },
  { pseudo: 'Ana', discordId: null },
  { pseudo: 'Kai', discordId: null },
];
const team = { nom: 'Faucons Valorant' };
const carte = carteDans('Ascent');

// ------------------------------------------------------------------ Messages d'exemple (vraies fonctions du bot)

const MESSAGES = [
  {
    fichier: '01-annonce-scrim',
    titre: 'Annonce d’un scrim',
    content: `<@${IDS.lea}> <@${IDS.tom}> <@${IDS.nox}>`,
    embeds: [embedEvenement({ genre: 'event_created', occurrence: { titre: 'Scrim vs Team Nova', type: 'scrim', debut: DEBUT, fin: DEBUT + 7_200_000 }, team, carte, adversaire: { nom: 'Team Nova' }, convoques, reponses: { oui: 2, peut_etre: 1, non: 0, sans: 2 }, texte: '**Nouvel événement** : Scrim vs Team Nova (Scrim), le jeudi 22 octobre à 20:30.', lien: LIEN, maintenant: T })],
    components: boutonsRsvp('6039e222-7104-44d3-8bd0-e8d1ca3de6aa', new Date(DEBUT).toISOString(), { lien: LIEN }),
  },
  {
    fichier: '02-rappel-h1-match',
    titre: 'Rappel H-1 d’un match',
    content: `<@${IDS.lea}> <@${IDS.tom}> <@${IDS.zed}>`,
    embeds: [embedEvenement({ genre: 'reminder_h1', occurrence: { titre: 'Match de ligue · Semaine 4', type: 'match', debut: DEBUT, fin: DEBUT + 5_400_000 }, team, adversaire: { nom: 'Les Aigles' }, convoques: convoques.slice(0, 3), reponses: { oui: 3, peut_etre: 0, non: 0, sans: 0 }, texte: '**C’est bientôt** : Match de ligue (Match) commence dans 45 min, à 20:30.', lien: LIEN, maintenant: DEBUT - 2_700_000 })],
    components: boutonsRsvp('6039e222-7104-44d3-8bd0-e8d1ca3de6ab', new Date(DEBUT).toISOString(), { lien: LIEN }),
  },
  {
    fichier: '03-relance-groupee',
    titre: 'Relance groupée des sans-réponse',
    content: `<@${IDS.nox}>`,
    embeds: [embedEvenement({ genre: 'rsvp_relance', occurrence: { titre: 'Tournoi Open Paris', type: 'tournament', debut: DEBUT + 86_400_000 * 2 }, team, convoques, reponses: { oui: 3, peut_etre: 0, non: 0, sans: 2 }, texte: 'Pensez à répondre pour Tournoi Open Paris (samedi 24 octobre à 14:00) : Nox, Kai.', lien: LIEN, maintenant: T })],
    components: boutonsRsvp('6039e222-7104-44d3-8bd0-e8d1ca3de6ac', new Date(DEBUT + 86_400_000 * 2).toISOString(), { lien: LIEN }),
  },
  {
    fichier: '04-c-est-maintenant',
    titre: '« C’est maintenant » d’un entraînement',
    content: `<@${IDS.lea}> <@${IDS.tom}>`,
    embeds: [embedEvenement({ genre: 'event_now', occurrence: { titre: 'Entraînement aim + exécutions', type: 'training', debut: DEBUT, fin: DEBUT + 5_400_000 }, team, carte: carteDans('Bind'), convoques: convoques.slice(0, 2), reponses: { oui: 2, peut_etre: 0, non: 0, sans: 0 }, texte: '**C’est parti** : Entraînement aim + exécutions (Entraînement) commence maintenant.', lien: LIEN, maintenant: DEBUT })],
    components: boutonLien(LIEN),
  },
  {
    fichier: '05-commande-prochain',
    titre: 'Réponse à /prochain (éphémère, paginée)',
    ephemere: true,
    embeds: [
      embedReponse({
        titre: '📅 Tes prochains événements',
        description: '7 événements où tu es convoqué, dans les 30 prochains jours.',
        champs: [
          { nom: '⚔️ Scrim vs Team Nova', valeur: `${horodatage(DEBUT, 'f')} · ${horodatage(DEBUT, 'R')}\nTa réponse : ✅ Oui` },
          { nom: '🏆 Match de ligue · Semaine 4', valeur: `${horodatage(DEBUT + 86_400_000, 'f')} · ${horodatage(DEBUT + 86_400_000, 'R')}\nTa réponse : ⏳ Pas encore répondu` },
          { nom: '🏟️ Tournoi Open Paris', valeur: `${horodatage(DEBUT + 172_800_000, 'f')} · ${horodatage(DEBUT + 172_800_000, 'R')}\nTa réponse : 🤔 Peut-être` },
        ],
        couleur: '#7c3aed',
        pied: 'Page 1 / 2 · Esport',
        lien: LIEN,
      }),
    ],
    components: boutonsPagination('prochain', 1, 2),
  },
  {
    fichier: '06-commande-taches',
    titre: 'Réponse à /taches',
    ephemere: true,
    embeds: [
      embedReponse({
        titre: '✅ Tes tâches',
        description: '3 ouvertes · 🔴 **1 en retard**',
        couleur: COULEUR_ERREUR,
        champs: [
          { nom: '🔴 Lineups Viper sur B', valeur: 'Échéance : 18/10/2026 (**en retard**) · Priorité : haute' },
          { nom: '🟡 Revoir la VOD du match 3', valeur: 'Échéance : 25/10/2026 · Priorité : normale' },
          { nom: '⚪ Fiche adversaire : Team Nova', valeur: 'Sans échéance · Priorité : basse' },
        ],
        pied: 'Page 1 / 1 · Esport',
        lien: LIEN,
      }),
    ],
    components: boutonLien(LIEN),
  },
  {
    fichier: '07-commande-aide',
    titre: 'Réponse à /aide',
    ephemere: true,
    embeds: [
      embedReponse({
        titre: '🛰️ Bot Esport · aide',
        description: 'Les annonces des scrims, matchs et tournois arrivent dans le salon de la team, avec les convoqués mentionnés et des boutons pour répondre.',
        champs: [
          { nom: '🔗 /lier · /delier', valeur: 'Lier (ou délier) ton compte Discord à ton compte Esport.' },
          { nom: '📅 /prochain', valeur: 'Tes prochains événements, là où tu es convoqué.' },
          { nom: '🗳️ /rsvp', valeur: 'Choisir un événement, puis Oui, Peut-être ou Non.' },
          { nom: '🛠️ Staff', valeur: '`/evenement-creer` crée un événement ; `/relancer` relance les convoqués sans réponse.' },
        ],
        couleur: ACCENT,
        lien: LIEN,
      }),
    ],
    components: boutonLien(LIEN),
  },
  {
    fichier: '08-rsvp-confirme',
    titre: 'Clic sur « Oui » (réponse éphémère)',
    ephemere: true,
    embeds: [embedReponse({ titre: '✅ C’est noté', description: 'Ta réponse pour **Scrim vs Team Nova** : **✅ Oui**. L’app est à jour.', couleur: COULEUR_OK })],
    components: [],
  },
];

// ------------------------------------------------------------------ Rendu HTML au style de Discord

const echapper = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (ms, style) => {
  const d = new Date(ms);
  const o = { timeZone: 'Europe/Paris' };
  if (style === 'R') {
    const ecart = Math.round((ms - T) / 3_600_000);
    if (ecart <= 0) return 'maintenant';
    if (ecart < 24) return `dans ${ecart} heure${ecart > 1 ? 's' : ''}`;
    const jours = Math.round(ecart / 24);
    return `dans ${jours} jour${jours > 1 ? 's' : ''}`;
  }
  if (style === 't') return d.toLocaleTimeString('fr-FR', { ...o, hour: '2-digit', minute: '2-digit' });
  if (style === 'f') return d.toLocaleString('fr-FR', { ...o, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('fr-FR', { ...o, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Markdown Discord minimal : mentions, horodatages, gras, code, retours à la ligne. */
function md(texte) {
  return echapper(texte)
    .replace(/&lt;t:(\d+):([FfRt])&gt;/g, (_, s, st) => `<span class="ts">${echapper(fmt(Number(s) * 1000, st))}</span>`)
    .replace(/&lt;@(\d+)&gt;/g, (_, id) => `<span class="mention">@${echapper(NOMS[id] ?? 'membre')}</span>`)
    .replace(/&lt;#(\d+)&gt;/g, '<span class="mention"># annonces</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/​/g, '')
    .replace(/\n/g, '<br>');
}

// Vignettes locales à la place des images de valorant-api (aucun réseau pendant le rendu).
const VIGNETTES = { '7eaecc1b': ['#2b3a67', '#d7b56d', 'ASCENT'], '2c9d57ec': ['#3a2b20', '#e09b5a', 'BIND'] };
function vignette(url) {
  const v = VIGNETTES[/maps\/([0-9a-f]{8})-/.exec(url)?.[1]];
  if (!v) return '';
  return `<div class="vignette" style="background:linear-gradient(135deg, ${v[0]}, ${v[1]})"><span>${v[2]}</span></div>`;
}

function embedHtml(e) {
  const couleur = `#${(e.color ?? 0).toString(16).padStart(6, '0')}`;
  const champs = (e.fields ?? []).map(f => `<div class="champ${f.inline ? ' inline' : ''}"><div class="nom">${md(f.name)}</div><div class="valeur">${md(f.value)}</div></div>`).join('');
  return `<div class="embed" style="border-left-color:${couleur}">
    <div class="corps-embed">
      ${e.author ? `<div class="auteur">${md(e.author.name)}</div>` : ''}
      ${e.title ? `<div class="titre">${e.url ? `<a>${md(e.title)}</a>` : md(e.title)}</div>` : ''}
      ${e.description ? `<div class="description">${md(e.description)}</div>` : ''}
      ${champs ? `<div class="champs">${champs}</div>` : ''}
      ${e.footer ? `<div class="pied">${md(e.footer.text)}${e.timestamp ? ` • ${echapper(new Date(e.timestamp).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}` : ''}</div>` : ''}
    </div>
    ${e.thumbnail ? vignette(e.thumbnail.url) : ''}
  </div>`;
}

const STYLES_BOUTONS = { 1: 'primaire', 2: 'gris', 3: 'vert', 4: 'rouge', 5: 'lien' };
function composantsHtml(lignes = []) {
  return lignes
    .map(l => `<div class="rangee">${l.components.map(b => `<span class="bouton ${STYLES_BOUTONS[b.style]}${b.disabled ? ' inactif' : ''}">${b.emoji ? `${b.emoji.name} ` : ''}${echapper(b.label ?? '')}${b.style === 5 ? ' <span class="externe">↗</span>' : ''}</span>`).join('')}</div>`)
    .join('');
}

function pageHtml(m, { avatar }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapper(m.titre)}</title>
<style>
@font-face { font-family: Manrope; font-weight: 500; src: url('${manrope(500)}'); }
@font-face { font-family: Manrope; font-weight: 700; src: url('${manrope(700)}'); }
@font-face { font-family: Manrope; font-weight: 800; src: url('${manrope(800)}'); }
body { margin: 0; background: #313338; color: #dbdee1; font: 15px/1.375 Manrope, 'gg sans', 'Segoe UI', sans-serif; }
.message { display: flex; gap: 16px; padding: 18px 20px 18px 16px; width: 640px; }
.message.ephemere { background: rgba(88,101,242,.06); border-left: 2px solid #5865f2; }
.avatar { width: 40px; height: 40px; border-radius: 50%; flex: none; background: url('${avatar}') center/cover; }
.entete { display: flex; align-items: center; gap: 6px; }
.nom-bot { color: #fff; font-weight: 700; }
.tag { background: #5865f2; color: #fff; font-size: 10px; font-weight: 800; padding: 1px 5px; border-radius: 3px; }
.heure { color: #949ba4; font-size: 12px; }
.mention { background: rgba(88,101,242,.3); color: #c9cdfb; border-radius: 3px; padding: 0 2px; font-weight: 600; }
.ts { background: rgba(255,255,255,.06); border-radius: 3px; padding: 0 2px; }
.embed { margin-top: 6px; display: flex; gap: 16px; max-width: 520px; background: #2b2d31; border-left: 4px solid; border-radius: 4px; padding: 10px 16px 14px 12px; }
.corps-embed { flex: 1; min-width: 0; }
.auteur { font-size: 13px; font-weight: 700; color: #fff; margin: 4px 0 6px; }
.titre { font-weight: 800; color: #fff; font-size: 16px; margin-bottom: 6px; }
.titre a { color: #00a8fc; }
.description { font-size: 14px; margin-bottom: 8px; }
.champs { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 4px; }
.champ { flex: 1 1 100%; min-width: 0; }
.champ.inline { flex: 1 1 28%; }
.champ .nom { font-weight: 700; color: #fff; font-size: 13px; margin-bottom: 2px; }
.champ .valeur { font-size: 13.5px; }
.pied { margin-top: 10px; color: #b5bac1; font-size: 12px; }
.vignette { width: 80px; height: 80px; border-radius: 6px; flex: none; margin-top: 8px; display: flex; align-items: flex-end; justify-content: center; }
.vignette span { color: #fff; font-weight: 800; font-size: 11px; letter-spacing: 2px; margin-bottom: 6px; text-shadow: 0 1px 2px #000; }
code { background: #1e1f22; border-radius: 3px; padding: 0 3px; font-size: 13px; }
.rangee { display: flex; gap: 8px; margin-top: 8px; }
.bouton { padding: 6px 14px; border-radius: 4px; font-size: 14px; font-weight: 600; color: #fff; }
.vert { background: #248046; } .rouge { background: #da373c; } .gris { background: #4e5058; } .primaire { background: #5865f2; } .lien { background: #4e5058; }
.inactif { opacity: .5; }
.externe { font-size: 12px; opacity: .8; }
.note { color: #949ba4; font-size: 12px; margin-top: 6px; }
</style></head><body>
<div class="message${m.ephemere ? ' ephemere' : ''}">
  <div class="avatar"></div>
  <div style="flex:1;min-width:0">
    <div class="entete"><span class="nom-bot">${echapper(identite.nom)}</span><span class="tag">APP</span><span class="heure">Aujourd’hui à 19:00</span></div>
    ${m.content ? `<div>${md(m.content)}</div>` : ''}
    ${m.embeds.map(embedHtml).join('')}
    ${composantsHtml(m.components)}
    ${m.ephemere ? '<div class="note">👁 Seul·e toi peux voir ce message</div>' : ''}
  </div>
</div></body></html>`;
}

let manropeBase = '';
function manrope(poids) {
  return `${manropeBase}/manrope-latin-${poids}-normal.woff2`;
}

// ------------------------------------------------------------------ Navigateur (PNG)

function chargerPlaywright() {
  for (const base of [join(racine, 'x.js'), join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js')]) {
    try {
      return createRequire(base)('playwright');
    } catch {
      // essai suivant
    }
  }
  throw new Error('Playwright introuvable : PLAYWRIGHT_PATH=<dossier node_modules global>.');
}

const seulementHtml = process.argv.includes('--html');
// Chemins RELATIFS dans les fichiers HTML versionnés (aucun chemin de la machine).
manropeBase = '../../../../node_modules/@fontsource/manrope/files';
const avatarUrl = '../avatar.png';

for (const m of MESSAGES) writeFileSync(join(apercus, `${m.fichier}.html`), pageHtml(m, { avatar: avatarUrl }));
writeFileSync(
  join(apercus, 'index.html'),
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Aperçus du bot Esport</title><style>body{background:#1e1f22;color:#dbdee1;font:15px Manrope,sans-serif;padding:24px}a{color:#7aa2ff}img{display:block;margin:8px 0 24px;border-radius:8px}</style></head><body><h1>Aperçus des messages du bot</h1>${MESSAGES.map(m => `<h2>${echapper(m.titre)}</h2><a href="${m.fichier}.html"><img src="${m.fichier}.png" alt="${echapper(m.titre)}" width="640"></a>`).join('')}</body></html>`,
);
console.log(`Aperçus HTML : ${apercus}`);

if (!seulementHtml) {
  const { chromium } = chargerPlaywright();
  const navigateur = await chromium.launch({ headless: true });
  try {
    const page = await navigateur.newPage({ deviceScaleFactor: 1 });
    // Rendu des SVG : polices intégrées (data:), la page n'a pas d'adresse de fichier.
    const police = poids => `data:font/woff2;base64,${readFileSync(join(racine, `node_modules/@fontsource/manrope/files/manrope-latin-${poids}-normal.woff2`)).toString('base64')}`;
    // Avatar (1024 × 1024) et bannière (1360 × 480) depuis les SVG.
    for (const [nom, l, h] of [['avatar', 1024, 1024], ['banniere', 1360, 480]]) {
      const svg = readFileSync(join(dossier, `${nom}.svg`), 'utf8');
      await page.setViewportSize({ width: l, height: h });
      await page.setContent(`<!doctype html><html><head><style>@font-face{font-family:Manrope;font-weight:500;src:url('${police(500)}')}@font-face{font-family:Manrope;font-weight:800;src:url('${police(800)}')}html,body{margin:0;background:transparent}</style></head><body>${svg}</body></html>`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(dossier, `${nom}.png`), clip: { x: 0, y: 0, width: l, height: h } });
      console.log(`${nom}.png`);
    }
    const apercu = await navigateur.newPage({ deviceScaleFactor: 2, viewport: { width: 680, height: 400 } });
    for (const m of MESSAGES) {
      await apercu.goto(pathToFileURL(join(apercus, `${m.fichier}.html`)).href);
      await apercu.evaluate(() => document.fonts.ready);
      const boite = await apercu.locator('.message').boundingBox();
      await apercu.screenshot({ path: join(apercus, `${m.fichier}.png`), fullPage: true, clip: { x: 0, y: 0, width: 680, height: Math.ceil(boite.height) } });
      console.log(`apercus/${m.fichier}.png`);
    }
  } finally {
    await navigateur.close();
  }
}
