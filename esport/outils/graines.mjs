/**
 * Graines de développement : une team Valorant avec ses membres, un rôle
 * personnalisé et quelques actions journalisées ; son planning (événements,
 * disponibilités, présences : graines-planning.mjs) ; des dépôts de réunion
 * (à résumer, en cours, terminé avec un PDF si un stockage est fourni), des
 * objectifs et des tâches (dont une en retard) ; des strats et un playbook
 * (graines-strats.mjs). Passe par les services
 * (mêmes règles que l'API : invitations réelles, anti-escalade…).
 *
 *   node esport/outils/graines.mjs [fichier.db]   (base SQLite locale, migrée au besoin)
 */

import { pathToFileURL } from 'node:url';
import { servicesComptes } from '../noyau/comptes.mjs';
import { servicesPlanning } from '../noyau/planning/service.mjs';
import { servicesSuivi } from '../noyau/suivi/service.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { servicesObjectifs } from '../noyau/objectifs.mjs';
import { servicesResumes } from '../noyau/resumes.mjs';
import { servicesEsport } from '../noyau/service.mjs';
import { semerPlanning } from './graines-planning.mjs';
import { semerReview } from './graines-review.mjs';
import { semerStrats } from './graines-strats.mjs';

/** Un petit PDF valide (une page, un texte) pour les graines et les tests de bout en bout. */
export function pdfDeDemo(texte = 'Résumé de démonstration') {
  const contenu = `BT /F1 18 Tf 72 720 Td (${texte.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '')}) Tj ET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const COMPTES_GRAINES = [
  { compte: 'max12345', pseudo: 'Max', riotId: 'Max#EUW', role: 'manager', poste: 'IGL' },
  { compte: 'zed12345', pseudo: 'Zed', role: 'coach' },
  { compte: 'ana12345', pseudo: 'Ana', role: 'analyste' },
  { compte: 'lea12345', pseudo: 'Léa', riotId: 'Lea#1234', discord: 'lea_val', role: 'joueur', poste: 'Duelliste' },
  { compte: 'kai12345', pseudo: 'Kai', role: 'joueur', poste: 'Contrôleur' },
  { compte: 'ines1234', pseudo: 'Inès', role: 'joueur', poste: 'Initiateur' },
  { compte: 'sam12345', pseudo: 'Sam', role: 'joueur', poste: 'Sentinelle' },
  { compte: 'tom12345', pseudo: 'Tom', role: 'remplacant', poste: 'Flex' },
];

/** Sème la base (vide ou non) ; rend l'identifiant de la team créée. `stockage` : pour le PDF de démonstration. */
export async function semer(base, { maintenant = () => Date.now(), stockage } = {}) {
  const s = servicesEsport({ base, maintenant, creationTeams: 'fondateur' });
  const comptes = servicesComptes({ base, maintenant, noyau: s });
  const fondateur = { compte: 'principal', superAdmin: true };
  await s.majProfil(fondateur, { pseudo: 'Fondateur' });
  const { team } = await s.creerTeam(fondateur, {
    nom: 'Faucons Valorant',
    jeu: 'valorant',
    preset: 'valorant_complet',
    description: 'Team de démonstration (graines de développement).',
  });
  const roles = Object.fromEntries((await s.listeRoles(fondateur, team.id)).map(r => [r.cle ?? r.nom, r]));
  for (const c of COMPTES_GRAINES) {
    const acteur = { compte: c.compte, superAdmin: false };
    await s.majProfil(acteur, { pseudo: c.pseudo, riotId: c.riotId, discord: c.discord });
    // Invitation directe : le Fondateur ajoute le compte à la team, avec son rôle et son poste.
    await comptes.ajouterMembre(fondateur, team.id, { compte: c.compte, roleId: roles[c.role].id, posteJeu: c.poste });
  }
  await s.creerRole(fondateur, team.id, { nom: 'Capitaine', couleur: '#f59e0b', permissions: ['members.view', 'planning.view', 'planning.create', 'attendance.mark', 'attendance.rsvp_own', 'availability.edit_own'] });

  await semerPlanning(base, team.id, { maintenant });

  // Résumés de réunions (phase 3).
  const r = servicesResumes({ base, stockage, cleSession: undefined, maintenant, socle: s });
  const types = await r.typesReunion(fondateur, team.id);
  const type = nom => types.find(t => t.nom === nom).id;
  const jour = decalage => new Date(maintenant() + decalage * 86_400_000).toISOString().slice(0, 10);
  const lea = { compte: 'lea12345', superAdmin: false };
  const zed = { compte: 'zed12345', superAdmin: false };
  await r.deposer(lea, team.id, { lien: 'https://www.youtube.com/watch?v=demo-hebdo', typeId: type('Hebdo'), dateReunion: jour(-1), titre: 'Réunion hebdo : retakes B', note: 'On a surtout parlé des retakes sur Ascent.' });
  const enCours = await r.deposer({ compte: 'kai12345', superAdmin: false }, team.id, { lien: 'https://www.twitch.tv/videos/123456', typeId: type('Débrief de match'), dateReunion: jour(-3), titre: 'Débrief contre Team Nova' });
  await r.changerStatut(fondateur, team.id, enCours.id, { statut: 'en_cours' });
  await r.deposer(zed, team.id, { lien: 'https://drive.google.com/file/d/demo-staff', typeId: type('Staff'), dateReunion: jour(-5), titre: 'Point staff : compositions' });
  if (stockage) {
    const fait = await r.deposer(lea, team.id, { lien: 'https://www.youtube.com/watch?v=demo-mensuel', typeId: type('Mensuel'), dateReunion: jour(-10), titre: 'Bilan du mois' });
    const octets = pdfDeDemo('Bilan du mois - Faucons Valorant');
    await r.deposerPdf(fondateur, team.id, fait.id, new Request('http://graines/', { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'X-Nom-Fichier': encodeURIComponent('Bilan du mois.pdf') }, body: octets }));
  }

  // Objectifs et tâches (phase 3).
  const o = servicesObjectifs({ base, maintenant, socle: s });
  const objectif = await o.creerObjectif(zed, team.id, { titre: 'Passer Immortel en équipe', description: 'Avant la fin de la saison.', dateCible: jour(60) });
  await o.creerObjectif(zed, team.id, { titre: 'Aim : 30 minutes par jour', proprietaire: 'lea12345', dateCible: jour(30) });
  await o.creerTache(zed, team.id, { titre: 'Revoir la VOD du dernier scrim', assigne: 'lea12345', echeance: jour(-2), priorite: 'haute', objectifId: objectif.id });
  await o.creerTache(zed, team.id, { titre: 'Lineups Viper sur Breeze', assigne: 'sam12345', echeance: jour(1), priorite: 'normale', objectifId: objectif.id });
  const faite = await o.creerTache(zed, team.id, { titre: 'Préparer la compo de Lotus', assigne: 'kai12345', echeance: jour(-1), objectifId: objectif.id });
  await o.modifierTache(zed, team.id, faite.id, { statut: 'fait' });
  await o.creerTache(zed, team.id, { titre: 'Réserver le créneau de scrim', echeance: jour(4), priorite: 'basse' });
  await semerReview(base, team.id, { maintenant, noyau: s });
  await semerStrats(base, team.id, { maintenant, noyau: s, stockage });
  // Suivi des joueurs : quelques notes du Coach (une épinglée, une partagée avec Léa).
  const suivi = servicesSuivi({ base, maintenant, socle: s, planning: servicesPlanning({ base, maintenant, noyau: s }) });
  await suivi.creer(zed, team.id, 'lea12345', { contenu: '**Très bon** entry sur Ascent : timings propres, à garder.', categorie: 'performance', ton: 'positif', tags: ['entry', 'ascent'], date: jour(-6), partagee: true });
  await suivi.creer(zed, team.id, 'lea12345', { contenu: 'Objectif du mois : prendre la parole en début de round (annonces de contact).', categorie: 'objectif', ton: 'neutre', tags: ['comms'], date: jour(-4), epinglee: true });
  await suivi.creer(zed, team.id, 'kai12345', { contenu: 'Se décourage vite après deux rounds perdus : en parler en individuel.', categorie: 'mental', ton: 'a_travailler', tags: ['tilt'], date: jour(-3) });
  await suivi.creer({ compte: 'ana12345', superAdmin: false }, team.id, 'kai12345', { contenu: 'Smokes de Viper sur Breeze : 3 lineups à revoir.', categorie: 'performance', ton: 'a_travailler', tags: ['breeze', 'lineups'], date: jour(-2) });
  await distribuer(base, { maintenant: maintenant() });
  return team.id;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { baseSqliteMigree } = await import('../adaptateurs/sqlite.mjs');
  const chemin = process.argv[2] ?? 'esport/esport-local.db';
  const base = await baseSqliteMigree(chemin);
  const { stockageDisque } = await import('../adaptateurs/stockage.mjs');
  const id = await semer(base, { stockage: await stockageDisque(`${chemin}.fichiers`) });
  console.log(`Graines posées dans ${chemin} : team « Faucons Valorant » (${id}), ${COMPTES_GRAINES.length + 1} membres, résumés, objectifs et tâches.`);
}
