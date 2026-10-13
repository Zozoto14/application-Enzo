/**
 * Écran Tâches : garde, état vide et exemple, ajout rapide, vues, détail,
 * ami (lecture / écriture), rendu dans les 8 thèmes du hub (bureau et téléphone).
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { THEMES_HUB, themeHub } from '../hub/themes';
import type { ContexteHub, ServicesAdmin } from '../hub/types';
import type { Profil } from '../profils/profils';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { ModeAffichageForce } from '../ui/mobile';
import { ajouterDemo } from './demo';
import { creerEspace, creerProjet, creerTache, lireDonnees, modifierProjet, donneesVides, tachesVivantes } from './modele';
import { appliquerReception, CLES_TACHES, copieVide, projectionPourAmi } from './partage';
import { Taches } from './ui/RacineTaches';
import { APP_TACHES } from './registre';
import { appsAttribuables, appsVisibles } from '../hub/permissions';
import { fonctionnalitesPour } from '../hub/devblog/logiqueDevblog';
import { ENTREES } from '../hub/devblog/entrees';

const T = new Date(2026, 9, 13, 9, 0).getTime();
const AUJ = '2026-10-13';
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
const lea: Profil = { id: 'leaami01', nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['taches'] };
const hugo: Profil = { id: 'hugoami2', nom: 'Hugo', admin: false, creeLe: '2026-01-01', apps: ['taches'] };

function base(initial: Record<string, string> = {}): BasePrefs & { m: Map<string, string> } {
  const m = new Map(Object.entries(initial));
  return { m, lire: c => m.get(c), ecrire: (c, v) => void m.set(c, v), supprimer: c => void m.delete(c) };
}
const admin = (): ServicesAdmin => ({ stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined });
const ctxF = (b: BasePrefs): ContexteHub => ({ profil: fondateur, admin: admin(), baseProfil: b, maintenant: T });

async function monter(contexte: ContexteHub, mode: 'large' | 'telephone' = 'large', theme = themeHub('nuit')) {
  return await render(
    <ModeAffichageForce mode={mode}>
      <Taches contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}
const toucher = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
};
/** Barre latérale (en feuille quand l'écran est étroit). */
const nav = async (id: string) => {
  if (!screen.queryByTestId(id)) await toucher('taches-navigation');
  await toucher(id);
};

function avecDemo(): { b: ReturnType<typeof base>; projetId: string } {
  const r = ajouterDemo(donneesVides(), { maintenant: T, auteur: 'fondateur' }, AUJ);
  const b = base({ [CLES_TACHES.donnees]: JSON.stringify(r.donnees), [CLES_TACHES.affichage]: JSON.stringify({ selection: { g: 'projet', id: r.projetId }, vue: 'liste' }) });
  return { b, projetId: r.projetId };
}

describe('Tâches : écran', () => {
  it('garde : un compte sans accès ne voit rien', async () => {
    await monter({ profil: hugo, baseProfil: base(), maintenant: T });
    expect(screen.getByTestId('taches-refuse')).toBeTruthy();
    expect(screen.queryByTestId('ajout-rapide')).toBeNull();
  });

  it('état vide puis exemple ; les quatre vues', async () => {
    const b = base();
    await monter(ctxF(b));
    expect(screen.getByTestId('taches-bienvenue')).toBeTruthy();
    await toucher('taches-demo');
    expect(tachesVivantes(lireDonnees(b.m.get(CLES_TACHES.donnees))).length).toBeGreaterThan(5);
    expect(screen.getByTestId('vue-liste')).toBeTruthy();
    await toucher('onglet-kanban');
    expect(screen.getByTestId('vue-kanban')).toBeTruthy();
    expect(screen.getByTestId('colonne-en-cours')).toBeTruthy();
    await toucher('onglet-calendrier');
    expect(screen.getByTestId('vue-calendrier')).toBeTruthy();
    await toucher('cal-mode-semaine');
    expect(screen.getByTestId('cal-titre')).toHaveTextContent(/Semaine du 12 octobre/);
    await toucher('onglet-journee');
    expect(screen.getByTestId('vue-journee')).toBeTruthy();
    expect(screen.getByTestId('journee-section-retard')).toBeTruthy();
  });

  it('ajout rapide : syntaxe comprise, tâche enregistrée', async () => {
    const { b } = avecDemo();
    await monter(ctxF(b));
    await fireEvent.changeText(screen.getByTestId('ajout-rapide'), 'Appeler Paul demain #prospects !haute');
    expect(screen.getByTestId('ajout-rapide-apercu')).toHaveTextContent(/demain.*Haute.*#prospects/);
    await fireEvent(screen.getByTestId('ajout-rapide'), 'submitEditing');
    const t = tachesVivantes(lireDonnees(b.m.get(CLES_TACHES.donnees))).find(x => x.titre === 'Appeler Paul');
    expect(t).toMatchObject({ priorite: 'haute', etiquettes: ['prospects'], echeance: { jour: '2026-10-14' } });
    expect(screen.getByTestId('taches-avis')).toHaveTextContent(/Appeler Paul/);
  });

  it('détail : terminer, menu de statut, historique', async () => {
    const { b } = avecDemo();
    await monter(ctxF(b));
    const t = tachesVivantes(lireDonnees(b.m.get(CLES_TACHES.donnees))).find(x => x.titre === 'Choisir les photos')!;
    await toucher(`tache-titre-${t.id}`);
    expect(screen.getByTestId('detail-tache')).toBeTruthy();
    await toucher('detail-statut');
    await toucher('choix-statut-option-en-revue');
    expect(lireDonnees(b.m.get(CLES_TACHES.donnees)).taches[t.id].statut).toBe('en-revue');
    await toucher('detail-terminer');
    expect(lireDonnees(b.m.get(CLES_TACHES.donnees)).taches[t.id].statut).toBe('fait');
    await toucher('detail-historique');
    expect(screen.getByTestId('detail-tache')).toHaveTextContent(/Statut : À faire → En revue/);
    await toucher('detail-fermer');
    expect(screen.queryByTestId('detail-tache')).toBeNull();
  });

  it('ami : projet en écriture modifiable, projet en lecture seule, projet privé invisible', async () => {
    const ctx = { maintenant: T, auteur: 'fondateur' as const };
    const e = creerEspace(donneesVides(), 'Travail', ctx);
    const p1 = creerProjet(e.donnees, e.espace.id, 'Partagé', ctx);
    const p2 = creerProjet(p1.donnees, e.espace.id, 'Lecture', ctx);
    const p3 = creerProjet(p2.donnees, e.espace.id, 'Privé', ctx);
    let d = modifierProjet(modifierProjet(p3.donnees, p1.projet.id, { partage: 'ecriture' }, ctx), p2.projet.id, { partage: 'lecture' }, ctx);
    d = creerTache(d, { titre: 'À faire ensemble', listeId: p1.liste.id }, ctx).donnees;
    d = creerTache(d, { titre: 'À lire', listeId: p2.liste.id }, ctx).donnees;
    d = creerTache(d, { titre: 'Secret', listeId: p3.liste.id }, ctx).donnees;
    const copie = appliquerReception(copieVide(), { v: 1, ami: lea.id, amiNom: 'Léa', fondateur: 'Enzo', cle: 'ab'.repeat(32), donnees: projectionPourAmi(d) });
    const b = base({ [CLES_TACHES.copie]: JSON.stringify(copie), [CLES_TACHES.affichage]: JSON.stringify({ selection: { g: 'projet', id: p2.projet.id } }) });
    await monter({ profil: lea, baseProfil: b, maintenant: T });
    expect(screen.queryByText('Privé')).toBeNull();
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.getByText('À lire')).toBeTruthy();
    expect(screen.queryByTestId('ajout-rapide')).toBeTruthy(); // un projet en écriture existe
    expect(screen.queryByTestId('taches-projet-reglages')).toBeNull();
    expect(screen.queryByTestId(`nav-projet-menu-${p1.projet.id}`)).toBeNull();
    expect(screen.queryByTestId(`nav-espace-menu-${e.espace.id}`)).toBeNull();
    expect(screen.queryByTestId("taches-menu")).toBeNull();
    const lecture = Object.values(copie.donnees.taches).find(t => t.titre === 'À lire')!;
    await toucher(`tache-titre-${lecture.id}`);
    expect(screen.getByTestId('detail-lecture-seule')).toBeTruthy();
    expect(screen.queryByTestId('detail-supprimer')).toBeNull();
    await toucher('detail-fermer');
    await toucher('taches-navigation');
    await toucher(`nav-projet-${p1.projet.id}`);
    const partagee = Object.values(copie.donnees.taches).find(t => t.titre === 'À faire ensemble')!;
    await toucher(`case-${partagee.id}`);
    const apres = JSON.parse(b.m.get(CLES_TACHES.copie)!).donnees.taches[partagee.id];
    expect(apres.statut).toBe('fait');
    expect(apres.h.statut.endsWith('|a')).toBe(true);
  });

  it('les 8 thèmes, bureau et téléphone : rendu sans erreur (liste, Kanban, détail)', async () => {
    for (const theme of THEMES_HUB) {
      for (const mode of ['large', 'telephone'] as const) {
        const { b } = avecDemo();
        const r = await monter(ctxF(b), mode, theme);
        expect(screen.getByTestId('vue-liste')).toBeTruthy();
        await toucher('onglet-kanban');
        expect(screen.getByTestId('vue-kanban')).toBeTruthy();
        await r.unmount();
      }
    }
  });

  it('supprimer un espace : menu ⋯, ce qui part, déplacer, Annuler, corbeille, restaurer', async () => {
    const { b } = avecDemo();
    const ctx = { maintenant: T, auteur: 'fondateur' as const };
    let d = lireDonnees(b.m.get(CLES_TACHES.donnees));
    const perso = creerEspace(d, 'Perso', ctx);
    d = creerProjet(perso.donnees, perso.espace.id, 'Courses', ctx).donnees;
    b.m.set(CLES_TACHES.donnees, JSON.stringify(d));
    const exemple = d.reglages.demo!;
    const nb = tachesVivantes(d).length;
    await monter(ctxF(b));
    // Menu « ⋯ » de l'espace, puis confirmation qui dit ce qui part.
    await nav(`nav-espace-menu-${exemple}`);
    await toucher('menu-supprimer-espace');
    expect(screen.getByTestId('suppression-bilan')).toHaveTextContent(new RegExp(`^Contenu : 1 projet, ${nb} tâches\\.`));
    await toucher('suppression-confirmer');
    expect(tachesVivantes(lireDonnees(b.m.get(CLES_TACHES.donnees)))).toHaveLength(0);
    expect(screen.getByTestId('taches-annulable')).toHaveTextContent(new RegExp(`^Espace « Exemple » supprimé \\(1 projet, ${nb} tâches\\)\\.`));
    await toucher('taches-annuler');
    expect(tachesVivantes(lireDonnees(b.m.get(CLES_TACHES.donnees)))).toHaveLength(nb);
    // Cette fois en déplaçant le contenu vers « Perso ».
    await nav(`nav-espace-menu-${exemple}`);
    await toucher('menu-supprimer-espace');
    await toucher('suppression-mode-deplacer');
    await toucher(`suppression-cible-${perso.espace.id}`);
    await toucher('suppression-confirmer');
    const apres = lireDonnees(b.m.get(CLES_TACHES.donnees));
    expect(tachesVivantes(apres)).toHaveLength(nb);
    expect(Object.values(apres.projets).filter(p => !p.supprime).every(p => p.espaceId === perso.espace.id)).toBe(true);
    expect(apres.espaces[exemple].supprime).toBe(true);
    // Corbeille : l'espace (vide) se restaure.
    await nav('nav-corbeille');
    expect(screen.getByTestId(`corbeille-${exemple}`)).toHaveTextContent(/Espace « Exemple »/);
    await toucher(`corbeille-restaurer-${exemple}`);
    expect(lireDonnees(b.m.get(CLES_TACHES.donnees)).espaces[exemple].supprime).toBeFalsy();
  });

  it('supprimer un projet depuis la vue (⋯), puis le restaurer depuis la corbeille ; supprimer définitivement', async () => {
    const { b, projetId } = avecDemo();
    await monter(ctxF(b));
    expect(screen.getByTestId('taches-projet-reglages')).toBeTruthy();
    await toucher('taches-menu');
    await toucher('menu-supprimer-projet');
    expect(screen.getByTestId('suppression-bilan')).toHaveTextContent(/2 listes, 8 tâches/);
    await toucher('suppression-confirmer');
    expect(lireDonnees(b.m.get(CLES_TACHES.donnees)).projets[projetId].supprime).toBe(true);
    await nav('nav-corbeille');
    await toucher(`corbeille-restaurer-${projetId}`);
    expect(tachesVivantes(lireDonnees(b.m.get(CLES_TACHES.donnees)), projetId)).toHaveLength(8);
    await nav(`nav-projet-${projetId}`);
    await toucher('taches-menu');
    await toucher('menu-supprimer-projet');
    await toucher('suppression-confirmer');
    await nav('nav-corbeille');
    await toucher(`corbeille-effacer-${projetId}`);
    await toucher(`corbeille-effacer-oui-${projetId}`);
    expect(lireDonnees(b.m.get(CLES_TACHES.donnees)).projets[projetId].efface).toBe(true);
    expect(screen.getByTestId('corbeille-vide')).toBeTruthy();
  });

  it('se relit quand la synchronisation change la base', async () => {
    jest.useFakeTimers();
    const { b } = avecDemo();
    await monter(ctxF(b));
    const d = lireDonnees(b.m.get(CLES_TACHES.donnees));
    const liste = Object.values(d.listes).find(l => !l.supprime)!;
    b.m.set(CLES_TACHES.donnees, JSON.stringify(creerTache(d, { titre: 'Arrivée d’un autre appareil', listeId: liste.id }, { maintenant: T + 1, auteur: 'fondateur' }).donnees));
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    expect(screen.getByText('Arrivée d’un autre appareil')).toBeTruthy();
    jest.useRealTimers();
  });
});

describe('Tâches dans le hub', () => {
  it('tuile : Fondateur oui, ami désigné oui, autre ami non ; pas de case dans l’Administration', async () => {
    const copie = JSON.stringify({ ...copieVide(), cle: 'ab'.repeat(32) });
    expect(appsVisibles([APP_TACHES], ctxF(base())).map(a => a.id)).toEqual(['taches']);
    expect(appsVisibles([APP_TACHES], { profil: lea, baseProfil: base({ [CLES_TACHES.copie]: copie }) })).toHaveLength(1);
    expect(appsVisibles([APP_TACHES], { profil: hugo, baseProfil: base() })).toHaveLength(0);
    expect(appsVisibles([APP_TACHES], { profil: { ...hugo, apps: [] }, baseProfil: base({ [CLES_TACHES.copie]: copie }) })).toHaveLength(0);
    expect(appsAttribuables(REGISTRE).some(a => a.id === 'taches')).toBe(false);
    expect(APP_TACHES.page).toBe('publique');
  });
  it('devblog : la nouveauté Tâches pour le Fondateur et l’ami concerné seulement', async () => {
    const entree = ENTREES[0];
    expect(entree.version).toBe('2026.10.24');
    expect(fonctionnalitesPour(entree, true).map(f => f.id)).toEqual(['taches-v1', 'taches-partage']);
    expect(fonctionnalitesPour(entree, false, false, ['taches']).map(f => f.id)).toEqual(['taches-v1', 'taches-partage-ami']);
    expect(fonctionnalitesPour(entree, false, false, ['tsuzuku'])).toEqual([]);
  });
});
