/**
 * Écran Tâches : déplacer des tâches (détail « Emplacement », menu ⋯,
 * multi-sélection, convertir en sous-tâche, avertissement de visibilité,
 * Annuler) et menu « Équipe » (8 thèmes, bureau et téléphone, matrice de
 * droits, retrait avec réassignation, profils supprimés, fiche, vue d'un
 * membre en lecture seule).
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
import { changerDroit, droitDe, inviterMembre, listeMembres } from './membres';
import { assignesDe, creerEspace, creerProjet, creerTache, lireDonnees, type DonneesTaches } from './modele';
import { appliquerReception, CLES_TACHES, copieVide, documentPourMembre } from './partage';
import { Taches } from './ui/RacineTaches';

const T = new Date(2026, 9, 15, 9, 0).getTime();
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
const LEA = 'lea0000001';
const HUGO = 'hugo000002';
const lea: Profil = { id: LEA, nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['taches'] };
const hugo: Profil = { id: HUGO, nom: 'Hugo', admin: false, creeLe: '2026-01-01', apps: ['taches'], role: 'gestionnaire' };
const zoe: Profil = { id: 'zoe0000003', nom: 'Zoé', admin: false, creeLe: '2026-01-01', apps: [] };

function base(initial: Record<string, string> = {}): BasePrefs & { m: Map<string, string> } {
  const m = new Map(Object.entries(initial));
  return { m, lire: c => m.get(c), ecrire: (c, v) => void m.set(c, v), supprimer: c => void m.delete(c) };
}
const admin = (): ServicesAdmin => ({ stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined });
const ctxF = (b: BasePrefs, comptes: Profil[] = [fondateur, { ...lea }, { ...hugo }, { ...zoe }]): ContexteHub =>
  ({
    profil: fondateur,
    admin: admin(),
    baseProfil: b,
    maintenant: T,
    profils: {
      actuel: fondateur,
      tous: comptes,
      onAutoriser: async (id: string, apps: string[]) => {
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
  await act(async () => fireEvent.press(screen.getByTestId(id)));
};
const lu = (b: ReturnType<typeof base>) => lireDonnees(b.m.get(CLES_TACHES.donnees));
let n = 0;
const ctx = () => ({ maintenant: T - 100_000 + n++, auteur: 'fondateur' as const, aleaOctets: aleatoireDeterministe(n + 1) });

/** « Site » partagé (Léa écriture, Hugo lecture), « Privé » ; trois tâches dans Site, une dans Privé. */
function donnees() {
  const e = creerEspace(lireDonnees(undefined), 'Travail', ctx());
  const pS = creerProjet(e.donnees, e.espace.id, 'Site', ctx());
  const pP = creerProjet(pS.donnees, e.espace.id, 'Privé', ctx());
  let d: DonneesTaches = pP.donnees;
  d = inviterMembre(d, LEA, 'Léa', ctx(), 'ami');
  d = inviterMembre(d, HUGO, 'Hugo', ctx(), 'gestionnaire');
  d = changerDroit(d, pS.projet.id, LEA, 'ecriture', ctx());
  d = changerDroit(d, pS.projet.id, HUGO, 'lecture', ctx());
  const t1 = creerTache(d, { titre: 'Maquette', listeId: pS.liste.id, assignes: [LEA] }, ctx());
  const t2 = creerTache(t1.donnees, { titre: 'Textes', listeId: pS.liste.id, assignes: [LEA] }, ctx());
  const t3 = creerTache(t2.donnees, { titre: 'Photos', listeId: pS.liste.id }, ctx());
  const t4 = creerTache(t3.donnees, { titre: 'Budget', listeId: pP.liste.id }, ctx());
  return { d: t4.donnees, site: pS.projet.id, prive: pP.projet.id, lS: pS.liste.id, lP: pP.liste.id, t1: t1.tache.id, t2: t2.tache.id, t3: t3.tache.id, t4: t4.tache.id };
}
const avec = (d: DonneesTaches, affichage: object) => base({ [CLES_TACHES.donnees]: JSON.stringify(d), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', ...affichage }) });

describe('Tâches : menu Équipe', () => {
  it('8 thèmes, bureau et téléphone : membres, charge, accès, matrice', async () => {
    const s = donnees();
    for (const theme of THEMES_HUB) {
      for (const mode of ['large', 'telephone'] as const) {
        const b = avec(s.d, { selection: { g: 'equipe' } });
        const r = await monter(ctxF(b), mode, theme);
        expect(screen.getByTestId('vue-equipe')).toBeTruthy();
        expect(screen.getByTestId(`equipe-membre-${LEA}`)).toHaveTextContent(/Léa/);
        expect(screen.getByTestId(`equipe-charge-${LEA}`)).toHaveTextContent('2 ouvertes · 0 en retard', { exact: false });
        expect(screen.getByTestId(`equipe-acces-${HUGO}`)).toHaveTextContent('Accès ouvert', { exact: false });
        expect(screen.getByTestId('equipe-invitable-zoe0000003')).toBeTruthy();
        await toucher('equipe-onglet-droits');
        expect(screen.getByTestId(`matrice-${LEA}-${s.site}`)).toHaveTextContent('Écriture', { exact: false });
        await r.unmount();
      }
    }
  });

  it('l’entrée « Équipe » est dans la barre de navigation', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'tout' }, vue: 'liste' });
    await monter(ctxF(b));
    if (!screen.queryByTestId('nav-equipe')) await toucher('taches-navigation');
    await toucher('nav-equipe');
    expect(screen.getByTestId('taches-titre')).toHaveTextContent('Équipe', { exact: false });
    expect(screen.getByTestId('vue-equipe')).toBeTruthy();
  });

  it('matrice : droits en masse appliqués d’un geste (retrait : clé tournée)', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'equipe' } });
    await monter(ctxF(b));
    const cle = s.d.reglages.clesProjets![s.site].cle;
    await toucher('equipe-onglet-droits');
    // Toute la ligne de Hugo : Écriture ; Léa sur Site : Aucun.
    await toucher(`matrice-ligne-${HUGO}`);
    await toucher('matrice-choix-ecriture');
    await toucher(`matrice-${LEA}-${s.site}`);
    await toucher('matrice-choix-aucun');
    expect(screen.getByTestId('matrice-en-attente')).toHaveTextContent('3 changements en attente dont 1 retrait', { exact: false });
    // Rien n'est écrit avant « Appliquer ».
    expect(droitDe(lu(b), s.prive, HUGO)).toBe('aucun');
    await toucher('matrice-appliquer');
    const d = lu(b);
    expect(droitDe(d, s.site, HUGO)).toBe('ecriture');
    expect(droitDe(d, s.prive, HUGO)).toBe('ecriture');
    expect(droitDe(d, s.site, LEA)).toBe('aucun');
    expect(d.reglages.clesProjets![s.site].cle).not.toBe(cle);
  });

  it('retirer de tous les projets avec réassignation, fiche du membre, filtres', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'equipe' } });
    await monter(ctxF(b));
    await act(async () => fireEvent.changeText(screen.getByTestId('equipe-recherche'), 'hug'));
    expect(screen.queryByTestId(`equipe-membre-${LEA}`)).toBeNull();
    await act(async () => fireEvent.changeText(screen.getByTestId('equipe-recherche'), ''));
    await toucher(`equipe-fiche-${LEA}`);
    expect(screen.getByTestId('equipe-fiche')).toHaveTextContent(/SES TÂCHES · 2 OUVERTES/);
    expect(screen.getByTestId(`fiche-tache-${s.t1}`)).toHaveTextContent('Maquette', { exact: false });
    await toucher('fiche-retirer-tous');
    expect(screen.getByTestId('retrait-reassigner')).toHaveTextContent(/SES 2 TÂCHES OUVERTES/);
    await toucher(`retrait-vers-${HUGO}`);
    await toucher('retrait-confirmer');
    const d = lu(b);
    expect(droitDe(d, s.site, LEA)).toBe('aucun');
    expect(listeMembres(d).some(m => m.compte === LEA)).toBe(true);
    // Hugo voit Site (lecture) : il les reçoit.
    expect(assignesDe(d.taches[s.t1])).toEqual([HUGO]);
    expect(screen.getByTestId('taches-avis')).toHaveTextContent('Léa est retiré de tous les projets ; 2 tâches réassignées.', { exact: false });
  });

  it('profils supprimés du hub : signalés, nettoyés en un clic', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'equipe' } });
    await monter(ctxF(b, [fondateur, { ...lea }, { ...zoe }]));
    expect(screen.getByTestId('equipe-supprimes')).toHaveTextContent('Un profil supprimé du hub est encore membre : Hugo.', { exact: false });
    expect(screen.getByTestId(`equipe-acces-${HUGO}`)).toHaveTextContent('Profil supprimé du hub', { exact: false });
    await toucher('equipe-nettoyer');
    expect(listeMembres(lu(b)).map(m => m.compte)).toEqual([LEA]);
    expect(screen.queryByTestId('equipe-supprimes')).toBeNull();
  });

  it('inviter un profil du hub (l’accès s’ouvre, même vérité que l’Administration)', async () => {
    const s = donnees();
    const comptes = [fondateur, { ...lea }, { ...hugo }, { ...zoe }];
    const b = avec(s.d, { selection: { g: 'equipe' } });
    await monter(ctxF(b, comptes));
    await toucher('equipe-inviter-zoe0000003');
    expect(listeMembres(lu(b)).some(m => m.compte === 'zoe0000003')).toBe(true);
    expect(comptes[3].apps).toEqual(['taches']);
  });

  it('membre : l’équipe des projets partagés avec lui, en lecture seule', async () => {
    const s = donnees();
    const copie = appliquerReception(copieVide(), documentPourMembre(s.d, listeMembres(s.d).find(m => m.compte === HUGO)!, 'Enzo'));
    const b = base({ [CLES_TACHES.copie]: JSON.stringify(copie), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'equipe' } }) });
    for (const mode of ['large', 'telephone'] as const) {
      const r = await monter({ profil: hugo, baseProfil: b, maintenant: T } as unknown as ContexteHub, mode);
      expect(screen.getByTestId('vue-equipe-membre')).toHaveTextContent(/Seul Enzo gère l’équipe/);
      expect(screen.getByTestId(`equipe-personne-${LEA}`)).toHaveTextContent(/Site · Écriture/);
      expect(screen.queryByTestId('equipe-onglet-droits')).toBeNull();
      await r.unmount();
    }
  });
});

describe('Tâches : déplacer des tâches (écran)', () => {
  it('depuis le détail : « Emplacement », avertissement de visibilité, puis Annuler', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'projet', id: s.prive }, vue: 'liste' });
    await monter(ctxF(b));
    await toucher(`tache-titre-${s.t4}`);
    expect(screen.getByTestId('detail-emplacement')).toHaveTextContent(/Travail › Privé/);
    await toucher('detail-emplacement');
    expect(screen.getByTestId('dialogue-deplacer')).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId('deplacer-recherche'), 'site'));
    await toucher(`deplacer-option-${s.lS}|`);
    expect(screen.getByTestId('deplacer-visibilite')).toHaveTextContent('Visibilité : « Site » est partagé. Elle sera visible par Hugo (lecture), Léa (écriture).', { exact: false });
    await toucher('deplacer-valider');
    expect(lu(b).taches[s.t4].projetId).toBe(s.site);
    expect(screen.getByTestId('taches-annulable')).toHaveTextContent('« Budget » déplacée vers « Travail › Site ».', { exact: false });
    await toucher('taches-annuler');
    expect(lu(b).taches[s.t4].projetId).toBe(s.prive);
    expect(screen.getByTestId('taches-avis')).toHaveTextContent('Déplacement annulé.', { exact: false });
  });

  it('multi-sélection (cases, Maj + clic) et « Déplacer N tâches… »', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'projet', id: s.site }, vue: 'liste', groupe: 'aucun', tri: 'titre' });
    await monter(ctxF(b));
    await toucher(`choisir-${s.t1}`);
    // Maj + clic sur le titre : la plage (Maquette … Textes, dans l'ordre affiché).
    await act(async () => fireEvent.press(screen.getByTestId(`tache-titre-${s.t2}`), { nativeEvent: { shiftKey: true } }));
    expect(screen.getByTestId('barre-selection')).toHaveTextContent('3 tâches sélectionnées', { exact: false });
    await toucher(`choisir-${s.t3}`);
    expect(screen.getByTestId('barre-selection')).toHaveTextContent('2 tâches sélectionnées', { exact: false });
    await toucher('selection-deplacer');
    await toucher(`deplacer-option-${s.lP}|`);
    expect(screen.getByTestId('deplacer-disparition')).toHaveTextContent('Elles disparaîtront chez Hugo, Léa, qui ne voient pas « Privé ».', { exact: false });
    await toucher('deplacer-valider');
    const d = lu(b);
    expect([d.taches[s.t1].projetId, d.taches[s.t2].projetId, d.taches[s.t3].projetId]).toEqual([s.prive, s.prive, s.site]);
    expect(screen.queryByTestId('barre-selection')).toBeNull();
  });

  it('menu ⋯ : convertir en sous-tâche (recherche de la tâche parente)', async () => {
    const s = donnees();
    const b = avec(s.d, { selection: { g: 'projet', id: s.site }, vue: 'liste' });
    await monter(ctxF(b));
    await toucher(`ligne-menu-${s.t3}`);
    await toucher('menu-tache-sous');
    await act(async () => fireEvent.changeText(screen.getByTestId('deplacer-recherche'), 'maquette'));
    await toucher(`deplacer-option-${s.lS}|${s.t1}`);
    await toucher('deplacer-valider');
    expect(lu(b).taches[s.t3].parentId).toBe(s.t1);
    expect(screen.getByTestId('taches-annulable')).toHaveTextContent('« Photos » devient sous-tâche de « Maquette ».', { exact: false });
  });

  it('téléphone : depuis le détail (⋯ › Déplacer…), la sous-tâche suit sa parente', async () => {
    const s = donnees();
    const avecSous = creerTache(s.d, { titre: 'Retouches', listeId: s.lS, parentId: s.t1 }, ctx());
    const b = avec(avecSous.donnees, { selection: { g: 'projet', id: s.site }, vue: 'liste' });
    await monter(ctxF(b), 'telephone');
    await toucher(`ouvrir-${s.t1}`);
    expect(screen.getByTestId('detail-emplacement')).toHaveTextContent('Travail › Site', { exact: false });
    await toucher('detail-menu');
    await toucher('menu-tache-deplacer');
    await toucher(`deplacer-option-${s.lP}|`);
    await toucher('deplacer-valider');
    const d = lu(b);
    expect(d.taches[s.t1].projetId).toBe(s.prive);
    expect(d.taches[avecSous.tache.id]).toMatchObject({ projetId: s.prive, parentId: s.t1 });
  });
});
