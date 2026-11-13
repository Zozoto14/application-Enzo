/**
 * Navigation dans une team de l'Esport, pour les tests de bout en bout.
 *
 * Les modules sont rangés en cinq sections (barre latérale sur PC, barre
 * basse sur iPhone) : Accueil · Agenda (Planning, Disponibilités, Présence) ·
 * Jeu (Strats, Playbook, Lineups, Ressources, Review vidéo, Scouting) · Équipe (Résumés, Objectifs
 * et tâches, Membres et rôles) · Réglages (Paramètres, Discord, Journal).
 * Dans une section, un sous-onglet par module activé et permis (aucun quand
 * la section n'en a qu'un).
 */

import { pause } from './mobile-outils.mjs';

/** Section de la team → groupe de la navigation (voir GROUPES_TEAM dans src/esport/ui/PageTeam.tsx). */
export const GROUPES_TEAM = {
  accueil: 'accueil',
  'module-planning': 'agenda',
  'module-availability': 'agenda',
  'module-attendance': 'agenda',
  'module-strat_editor': 'jeu',
  'module-playbook': 'jeu',
  'module-lineups': 'jeu',
  'module-plans_match': 'jeu',
  'module-resources': 'jeu',
  'module-video_review': 'jeu',
  'module-scouting': 'jeu',
  'module-tournois': 'competition',
  'module-resultats': 'competition',
  'module-meeting_summaries': 'equipe',
  'module-goals_tasks': 'equipe',
  'module-player_notes': 'equipe',
  'module-cm': 'equipe',
  membres: 'equipe',
  parametres: 'reglages',
  'module-discord': 'reglages',
  journal: 'reglages',
};

/** Ouvre une section de la team (« module-planning », « journal »…) : la section, puis son sous-onglet. */
export async function ongletTeam(page, id, { delai = 20_000 } = {}) {
  const groupe = GROUPES_TEAM[id];
  if (!groupe) throw new Error(`section inconnue : ${id}`);
  await page.getByTestId(`esport-section-${groupe}`).first().click({ timeout: delai });
  const onglet = page.getByTestId(`esport-onglet-${id}`).first();
  // Sous-onglet présent (section à plusieurs modules) : on le choisit ; sinon la section seule l'affiche.
  if (await onglet.waitFor({ timeout: 1500 }).then(() => true, () => false)) await onglet.click();
  await page.getByTestId(`esport-contenu-${id}`).first().waitFor({ timeout: delai });
}

/** La section est-elle ouverte au membre (module activé et permis) ? Sans rien laisser ouvert d'inattendu. */
export async function ongletPresent(page, id) {
  const groupe = GROUPES_TEAM[id];
  const section = page.getByTestId(`esport-section-${groupe}`).first();
  if (!(await section.count())) return false;
  await section.click();
  await pause(300);
  if (await page.getByTestId(`esport-onglet-${id}`).count()) return true;
  return (await page.getByTestId(`esport-contenu-${id}`).count()) > 0;
}
