/**
 * Rendu « comme sur Discord » d'un devblog, pour l'aperçu en direct de l'éditeur. Miroir de
 * esport/noyau/devblog/regles.mjs (`texteDiscord`, `decouperDiscord`) : le serveur reste la référence (aperçu
 * exact avant envoi : GET /devblog/:id/discord).
 */

import type { ContenuDevblog } from './api';

export const LIMITE_DISCORD = 2000;

/** Mentions neutralisées comme sur le serveur (aucun ping ne peut venir du texte saisi). */
const sur = (v: string) => String(v ?? '').replace(/@(everyone|here)/gi, '@​$1').replace(/<(?=[@#/]|id:)/gi, '<​');
const gras = (v: string) => `**${sur(v).replace(/\*\*/g, '')}**`;

export function dateLisible(jour: string, langue: 'fr' | 'en'): string {
  const d = new Date(`${jour}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return jour;
  return d.toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function texteDiscord(c: ContenuDevblog, langue: 'fr' | 'en', { here = false, version = '', date = '' }: { here?: boolean; version?: string | null; date?: string } = {}): string {
  const blocs: string[] = [];
  const tete = [`🚀 DEVBLOG — ${sur(c.titre || (langue === 'en' ? 'New Update!' : 'Nouvelle Mise à Jour !'))} 🛠️`];
  if (version) tete.push(`-# Version ${sur(version)} · ${dateLisible(date, langue)}`);
  blocs.push(tete.join('\n'));
  if (c.intro.trim()) blocs.push(sur(c.intro.trim()));
  for (const s of c.sections) {
    const lignes: string[] = [];
    const titre = [s.emoji.trim() ? sur(s.emoji.trim()) : '', s.titre.trim() ? gras(s.titre.trim()) : ''].filter(Boolean).join(' ');
    if (titre) lignes.push(titre);
    for (const p of s.puces) {
      if (!p.nom.trim() && !p.description.trim()) continue;
      lignes.push(p.nom.trim() ? `• **${sur(p.nom.trim()).replace(/\*\*/g, '')}${langue === 'en' ? ':' : ' :'}** ${sur(p.description.trim())}`.trimEnd() : `• ${sur(p.description.trim())}`);
    }
    if (lignes.length) blocs.push(lignes.join('\n'));
  }
  const fin = sur(c.conclusion.trim());
  if (fin || here) blocs.push([fin, here ? '@here' : ''].filter(Boolean).join(' '));
  return blocs.join('\n\n');
}

/** Découpage en messages de 2000 caractères au plus (entre sections, puis lignes, puis mots). */
export function decouperDiscord(texte: string, max = LIMITE_DISCORD): string[] {
  const morceaux: string[] = [];
  let courant = '';
  const pousser = (unite: string, sep: string) => {
    if (!unite) return;
    if (!courant) courant = unite;
    else if (courant.length + sep.length + unite.length <= max) courant += sep + unite;
    else {
      morceaux.push(courant);
      courant = unite;
    }
  };
  const mots = (l: string) => {
    const sortie: string[] = [];
    let c = '';
    for (const m of l.split(' ')) {
      const bouts = m.length > max ? (m.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) ?? [m]) : [m];
      for (const b of bouts) {
        if (!c) c = b;
        else if (c.length + 1 + b.length <= max) c += ` ${b}`;
        else {
          sortie.push(c);
          c = b;
        }
      }
    }
    if (c) sortie.push(c);
    return sortie;
  };
  for (const bloc of texte.split('\n\n')) {
    if (bloc.length <= max) {
      pousser(bloc, '\n\n');
      continue;
    }
    let premier = true;
    for (const l of bloc.split('\n')) {
      for (const p of l.length <= max ? [l] : mots(l)) {
        pousser(p, premier ? '\n\n' : '\n');
        premier = false;
      }
    }
  }
  if (courant) morceaux.push(courant);
  return morceaux.filter(m => m.trim());
}

/**
 * Segments d'une ligne de Markdown Discord pour l'aperçu : gras (`**…**`) et petit texte (`-# …`) ; le reste
 * tel quel. Assez pour la DA du devblog (titres de section, noms des puces).
 */
export function segmentsLigne(ligne: string): { petit: boolean; morceaux: Array<{ texte: string; gras: boolean }> } {
  const petit = ligne.startsWith('-# ');
  const corps = petit ? ligne.slice(3) : ligne;
  const morceaux: Array<{ texte: string; gras: boolean }> = [];
  const parts = corps.split('**');
  parts.forEach((p, i) => {
    if (p) morceaux.push({ texte: p, gras: i % 2 === 1 && i < parts.length - (parts.length % 2 === 0 ? 1 : 0) });
  });
  return { petit, morceaux };
}
