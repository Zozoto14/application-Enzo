/**
 * Écran Tâches V3 : chronologie, tableau de bord, objectifs (8 thèmes,
 * bureau et téléphone, mouvement réduit), membres et droits, assignation à
 * plusieurs, mentions, IA en mode essai (aperçu puis « Appliquer »),
 * GitHub en mode essai, membre admin d'un projet.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { THEMES_HUB, themeHub } from '../hub/themes';
import type { ContexteHub, ServicesAdmin } from '../hub/types';
import type { Profil } from '../profils/profils';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { ModeAffichageForce } from '../ui/mobile';
import { ajouterDemo } from './demo';
import { ajouterJours } from './dates';
import { changerDroit, changerPerso, inviterMembre, listeMembres } from './membres';
import { ReglagesTachesFondateur, ReglagesTachesPerso } from './ui/ParametresTaches';
import { assignesDe, creerTache, lireDonnees, modifierTache, sousTaches, tachesVivantes, type DonneesTaches } from './modele';
import { appliquerReception, CLES_TACHES, copieVide, documentPourMembre } from './partage';
import { Taches } from './ui/RacineTaches';

const T = new Date(2026, 9, 13, 9, 0).getTime();
const AUJ = '2026-10-13';
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
const lea: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: [] };
const hugo: Profil = { id: 'hugo000002', nom: 'Hugo', admin: false, creeLe: '2026-01-01', apps: [], role: 'gestionnaire' };

function base(initial: Record<string, string> = {}): BasePrefs & { m: Map<string, string> } {
  const m = new Map(Object.entries(initial));
  return { m, lire: c => m.get(c), ecrire: (c, v) => void m.set(c, v), supprimer: c => void m.delete(c) };
}
const admin = (): ServicesAdmin => ({ stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined });
const autorisations: Array<[string, string[]]> = [];
const comptes: Profil[] = [fondateur, { ...lea }, { ...hugo }];
const ctxF = (b: BasePrefs): ContexteHub =>
  ({
    profil: fondateur,
    admin: admin(),
    baseProfil: b,
    maintenant: T,
    profils: {
      actuel: fondateur,
      tous: comptes,
      onAutoriser: async (id: string, apps: string[]) => {
        autorisations.push([id, apps]);
        const p = comptes.find(x => x.id === id);
        if (p) p.apps = apps;
      },
    },
  }) as unknown as ContexteHub;

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
const lu = (b: ReturnType<typeof base>) => lireDonnees(b.m.get(CLES_TACHES.donnees));
const ctx = (n = 0) => ({ maintenant: T + n, auteur: 'fondateur' as const, aleaOctets: aleatoireDeterministe(n + 1) });

/** Exemple + une chaîne datée (Conception → Réalisation). */
function donnees(): { d: DonneesTaches; projetId: string; a: string; b: string } {
  const r = ajouterDemo(lireDonnees(undefined), { maintenant: T, auteur: 'fondateur' }, AUJ);
  const liste = Object.values(r.donnees.listes).find(l => l.projetId === r.projetId)!.id;
  const a = creerTache(r.donnees, { titre: 'Conception', listeId: liste, debut: AUJ, echeance: { jour: ajouterJours(AUJ, 2) } }, ctx(1));
  const b = creerTache(a.donnees, { titre: 'Réalisation', listeId: liste, debut: ajouterJours(AUJ, 3), echeance: { jour: ajouterJours(AUJ, 5) } }, ctx(2));
  const d = modifierTache(b.donnees, b.tache.id, { dependances: [a.tache.id] }, ctx(3));
  return { d, projetId: r.projetId, a: a.tache.id, b: b.tache.id };
}
const avec = (d: DonneesTaches, affichage: object, extra: Record<string, string> = {}) =>
  base({ [CLES_TACHES.donnees]: JSON.stringify(d), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', ...affichage }), ...extra });

describe('Tâches V3 : écran', () => {
  it('chronologie, tableau de bord et objectifs : 8 thèmes, bureau et téléphone', async () => {
    const { d, projetId } = donnees();
    for (const theme of THEMES_HUB) {
      for (const mode of ['large', 'telephone'] as const) {
        const b = avec(d, { selection: { g: 'projet', id: projetId }, vue: 'gantt' });
        const r = await monter(ctxF(b), mode, theme);
        expect(screen.getByTestId('vue-gantt')).toBeTruthy();
        expect(screen.getByTestId('gantt-ligne-aujourdhui')).toBeTruthy();
        await toucher('onglet-tableau');
        if (!screen.queryByTestId('vue-tableau')) throw new Error(`tableau absent : ${theme.id} ${mode}`);
        expect(screen.getByTestId('tableau-avancement')).toHaveTextContent(/%/);
        if (!screen.queryByTestId('nav-objectifs')) await toucher('taches-navigation');
        await toucher('nav-objectifs');
        expect(screen.getByTestId('objectifs-vide')).toBeTruthy();
        await r.unmount();
      }
    }
  });

  it('mouvement réduit : la chronologie se rend sans animation', async () => {
    const g = globalThis as unknown as { matchMedia?: unknown };
    const avant = g.matchMedia;
    g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    try {
      const { d, projetId } = donnees();
      await monter(ctxF(avec(d, { selection: { g: 'projet', id: projetId }, vue: 'gantt' })));
      expect(screen.getByTestId('vue-gantt')).toBeTruthy();
    } finally {
      g.matchMedia = avant;
    }
  });

  it('chronologie : dépendance violée signalée, « Décaler les suivantes », clavier', async () => {
    const { d, projetId, a, b: id } = donnees();
    const x = modifierTache(d, a, { echeance: { jour: ajouterJours(AUJ, 4) } }, ctx(9));
    const b = avec(x, { selection: { g: 'projet', id: projetId }, vue: 'gantt' });
    await monter(ctxF(b));
    expect(screen.getByTestId('gantt-violations')).toHaveTextContent(/Réalisation.*Conception/);
    expect(screen.getByTestId(`gantt-dependance-${a}-${id}`)).toBeTruthy();
    await toucher('gantt-decaler');
    expect(lu(b).taches[id].debut).toBe(ajouterJours(AUJ, 5));
    expect(screen.queryByTestId('gantt-violations')).toBeNull();
    // Clavier : flèche droite déplace d'un jour.
    await fireEvent(screen.getByTestId(`gantt-barre-${a}`), 'keyDown', { key: 'ArrowRight', preventDefault: () => undefined });
    expect(lu(b).taches[a].echeance?.jour).toBe(ajouterJours(AUJ, 5));
    await toucher('gantt-zoom-mois');
    await toucher('gantt-zoom-semaine');
  });

  it('membres : inviter (app ouverte), droits par projet, retirer (clé tournée)', async () => {
    const { d, projetId } = donnees();
    const b = avec(d, { selection: { g: 'projet', id: projetId }, vue: 'liste' });
    autorisations.length = 0;
    await monter(ctxF(b));
    await toucher('taches-reglages');
    await toucher('reglages-membres');
    await act(async () => fireEvent.press(screen.getByTestId(`membre-inviter-${lea.id}`)));
    await act(async () => fireEvent.press(screen.getByTestId(`membre-inviter-${hugo.id}`)));
    expect(listeMembres(lu(b)).map(m => [m.nom, m.rang])).toEqual([
      ['Hugo', 'gestionnaire'],
      ['Léa', 'ami'],
    ]);
    expect(autorisations).toEqual([
      [lea.id, ['taches']],
      [hugo.id, ['taches']],
    ]);
    await toucher(`membre-droits-${lea.id}`);
    await toucher(`droit-${projetId}-${lea.id}-ecriture`);
    expect(lu(b).projets[projetId].acces).toEqual({ [lea.id]: 'ecriture' });
    const cle = lu(b).reglages.clesProjets![projetId].cle;
    await toucher(`membre-retirer-${lea.id}`);
    await act(async () => fireEvent.press(screen.getByTestId(`membre-retirer-confirmer-${lea.id}`)));
    expect(listeMembres(lu(b)).map(m => m.nom)).toEqual(['Hugo']);
    expect(lu(b).reglages.clesProjets![projetId].cle).not.toBe(cle);
    expect(autorisations.at(-1)).toEqual([lea.id, []]);
  });

  it('assignation à plusieurs, et mention notifiée', async () => {
    let { d, projetId } = donnees();
    // L'accès à l'app et la liste des membres ne font qu'un : Léa a l'app.
    comptes[1].apps = ['taches'];
    d = inviterMembre(d, lea.id, 'Léa', ctx(20));
    d = changerDroit(d, projetId, lea.id, 'ecriture', ctx(21));
    const b = avec(d, { selection: { g: 'projet', id: projetId }, vue: 'liste' });
    await monter(ctxF(b));
    const t = tachesVivantes(lu(b)).find(x => x.titre === 'Conception')!;
    await toucher(`tache-titre-${t.id}`);
    await toucher('detail-assigne');
    await toucher(`choix-assigne-${lea.id}`);
    await toucher('choix-assigne-fondateur');
    expect(assignesDe(lu(b).taches[t.id])).toEqual([lea.id, 'fondateur']);
    await toucher('choix-assigne-fermer');
    expect(screen.getByTestId(`avatars-${t.id}`)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('detail-commentaire-champ'), 'Bonjour @L');
    await toucher(`mention-choisir-${lea.id}`);
    expect(screen.getByTestId('detail-commentaire-champ').props.value).toBe('Bonjour @Léa ');
    await fireEvent.changeText(screen.getByTestId('detail-commentaire-champ'), 'Bonjour @Léa peux-tu relire ?');
    await toucher('detail-commentaire-publier');
    const c = Object.values(lu(b).taches[t.id].commentaires)[0];
    expect(c.mentions).toEqual([lea.id]);
  });

  it('IA (mode essai) : ce qui part est montré, rien n’est créé avant « Appliquer »', async () => {
    const { d, projetId } = donnees();
    const b = avec(d, { selection: { g: 'projet', id: projetId }, vue: 'liste' }, { [CLES_TACHES.secrets]: JSON.stringify({ ia: { actif: true, mode: 'essai' }, github: {} }) });
    await monter(ctxF(b));
    const t = tachesVivantes(lu(b)).find(x => x.titre === 'Conception')!;
    await toucher(`tache-titre-${t.id}`);
    await toucher('detail-ia-decouper');
    expect(screen.getByTestId('ia-donnees')).toHaveTextContent(/Tâche : Conception/);
    expect(screen.getByTestId('ia-donnees')).not.toHaveTextContent(new RegExp(t.id));
    await act(async () => fireEvent.press(screen.getByTestId('ia-envoyer')));
    expect(screen.getByTestId('ia-apercu')).toBeTruthy();
    expect(sousTaches(lu(b), t.id)).toHaveLength(0);
    await toucher('ia-garder-3');
    await toucher('ia-appliquer');
    expect(sousTaches(lu(b), t.id).map(x => x.titre)).toEqual(['Préparer : Conception', 'Faire le cœur du travail', 'Relire et vérifier']);
    // Réglages : la clé saisie n'est jamais affichée en entier, et reste hors des données synchronisées.
    await toucher('taches-ia');
    await toucher('menu-ia-reglages');
    await fireEvent.changeText(screen.getByTestId('aides-ia-cle'), `sk-ant-${'z'.repeat(30)}`);
    await toucher('aides-ia-cle-enregistrer');
    expect(screen.getByTestId('aides-ia-cle-etat')).toHaveTextContent(/sk-ant-…zzzz/);
    expect(b.m.get(CLES_TACHES.donnees)).not.toContain('sk-ant-');
    expect(JSON.parse(b.m.get(CLES_TACHES.secrets)!).ia.cle).toMatch(/^sk-ant-/);
  });

  it('GitHub (mode essai) : lien, état lu, « Faite » à la fusion', async () => {
    const { d, projetId } = donnees();
    const b = avec(d, { selection: { g: 'projet', id: projetId }, vue: 'liste' }, { [CLES_TACHES.secrets]: JSON.stringify({ ia: {}, github: { actif: true, mode: 'essai' } }) });
    await monter(ctxF(b));
    const t = tachesVivantes(lu(b)).find(x => x.titre === 'Conception')!;
    await toucher(`tache-titre-${t.id}`);
    await fireEvent.changeText(screen.getByTestId('detail-github-champ'), 'https://github.com/zozoto14/tsuzuku/pull/12');
    await fireEvent(screen.getByTestId('detail-github-champ'), 'submitEditing');
    expect(lu(b).taches[t.id].github).toEqual({ depot: 'zozoto14/tsuzuku', pr: 12 });
    await toucher('detail-github-fusion');
    await act(async () => fireEvent.press(screen.getByTestId('detail-github-relire')));
    expect(screen.getByTestId('detail-github-etat')).toHaveTextContent(/PR fusionnée #12/);
    expect(lu(b).taches[t.id].statut).toBe('fait');
  });

  it('membre admin d’un projet : paramètres du projet ; lecture seule : rien', async () => {
    let { d, projetId } = donnees();
    d = inviterMembre(d, lea.id, 'Léa', ctx(30));
    d = changerDroit(d, projetId, lea.id, 'admin', ctx(31));
    const copie = appliquerReception(copieVide(), documentPourMembre(d, listeMembres(d).find(m => m.compte === lea.id)!, 'Enzo'));
    const b = base({ [CLES_TACHES.copie]: JSON.stringify(copie), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'projet', id: projetId }, vue: 'liste' }) });
    const r = await monter({ profil: { ...lea, apps: ['taches'] }, baseProfil: b, maintenant: T });
    expect(screen.getByTestId('taches-projet-reglages')).toBeTruthy();
    expect(screen.getByTestId(`personnes-${projetId}`)).toBeTruthy();
    expect(screen.queryByTestId('nav-objectifs')).toBeNull();
    await toucher('taches-projet-reglages');
    expect(screen.queryByTestId('projet-supprimer')).toBeNull();
    await r.unmount();
    const d2 = changerDroit(d, projetId, lea.id, 'lecture', ctx(32));
    const c2 = appliquerReception(copieVide(), documentPourMembre(d2, listeMembres(d2).find(m => m.compte === lea.id)!, 'Enzo'));
    const b2 = base({ [CLES_TACHES.copie]: JSON.stringify(c2), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'projet', id: projetId }, vue: 'liste' }) });
    const r2 = await monter({ profil: { ...lea, apps: ['taches'] }, baseProfil: b2, maintenant: T });
    expect(screen.queryByTestId('taches-projet-reglages')).toBeNull();
    await r2.unmount();
  });

  it('membre sans projet : état vide clair ; s’il en a le droit, ses propres projets (à lui seul)', async () => {
    let { d } = donnees();
    d = inviterMembre(d, lea.id, 'Léa', ctx(40));
    const doc = documentPourMembre(changerPerso(d, lea.id, true, ctx(41)), listeMembres(changerPerso(d, lea.id, true, ctx(41))).find(m => m.compte === lea.id)!, 'Enzo');
    const copie = appliquerReception(copieVide(), doc);
    const b = base({ [CLES_TACHES.copie]: JSON.stringify(copie) });
    await monter({ profil: { ...lea, apps: ['taches'] }, baseProfil: b, maintenant: T });
    expect(screen.getByTestId('taches-rien-partage')).toHaveTextContent(/Aucun projet partagé avec toi/);
    await toucher('taches-perso');
    await toucher('taches-creer-espace');
    await fireEvent.changeText(screen.getByTestId('nouvel-espace-nom'), 'Perso');
    await toucher('nouvel-espace-creer');
    const perso = lireDonnees(b.m.get(CLES_TACHES.perso));
    expect(Object.values(perso.espaces).map(e => e.nom)).toEqual(['Perso']);
    expect(lireDonnees(JSON.parse(b.m.get(CLES_TACHES.copie)!).donnees).espaces).toEqual({});
    // Ni membres, ni liens, ni IA dans ses projets personnels.
    await toucher('taches-reglages');
    expect(screen.getByTestId('reglages-perso')).toBeTruthy();
    expect(screen.queryByTestId('reglages-membres')).toBeNull();
    expect(screen.queryByTestId('reglages-aides')).toBeNull();
  });

  it('Paramètres › Tâches : les mêmes réglages (Fondateur : membres, IA… ; membre : les siens)', async () => {
    const { d } = donnees();
    const b = avec(d, {});
    await render(
      <ModeAffichageForce mode="large">
        <ReglagesTachesPerso contexte={ctxF(b)} theme={themeHub('nuit')} onOuvrirTaches={() => undefined} />
        <ReglagesTachesFondateur contexte={ctxF(b)} theme={themeHub('nuit')} onOuvrirTaches={() => undefined} />
      </ModeAffichageForce>,
    );
    await toucher('parametres-taches-ouverture-journee');
    expect(JSON.parse(b.m.get(CLES_TACHES.affichage)!).ouverture).toBe('journee');
    await toucher('parametres-taches-membres');
    expect(screen.getByTestId('dialogue-membres')).toBeTruthy();
    await toucher('dialogue-membres-fermer');
    await toucher('parametres-taches-aides');
    await toucher('aides-ia-actif');
    expect(JSON.parse(b.m.get(CLES_TACHES.secrets)!).ia.actif).toBe(true);
    await toucher('dialogue-aides-fermer');
    await toucher('parametres-taches-notifications');
    expect(screen.getByTestId('dialogue-notifications')).toBeTruthy();
    // Un membre : seulement ses réglages.
    const copie = JSON.stringify({ ...copieVide(), cle: 'ab'.repeat(32) });
    const bm = base({ [CLES_TACHES.copie]: copie });
    const r = await render(
      <ModeAffichageForce mode="large">
        <ReglagesTachesFondateur contexte={{ profil: { ...lea, apps: ['taches'] }, baseProfil: bm, maintenant: T }} theme={themeHub('nuit')} onOuvrirTaches={() => undefined} />
      </ModeAffichageForce>,
    );
    expect(r.queryByTestId('parametres-taches-fondateur')).toBeNull();
  });
});
