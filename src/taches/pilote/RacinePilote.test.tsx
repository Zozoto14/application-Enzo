/**
 * Écran « Ta semaine » : 8 thèmes, bureau et téléphone ; déplacer, retirer,
 * régénérer, valider d'un clic (une seule écriture des données de Tâches),
 * annuler, réglages, récompenses qui se débloquent sans jamais bloquer
 * Tsuzuku, membre et rangs.
 */

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { REGISTRE } from '../../hub/registre';
import { THEMES_HUB, themeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import type { Profil } from '../../profils/profils';
import { aleatoireDeterministe } from '../../securite/aleatoire';
import type { BasePrefs } from '../../tsuzuku/plateforme/stockage';
import { ModeAffichageForce } from '../../ui/mobile';
import { changerDroit, inviterMembre, listeMembres } from '../membres';
import { creerEspace, creerProjet, creerTache, lireDonnees, type DonneesTaches } from '../modele';
import { appliquerReception, CLES_TACHES, copieVide, documentPourMembre } from '../partage';
import { terminerTache } from '../recurrence';
import { Taches } from '../ui/RacineTaches';
import { CLE_PILOTE, lireEtatBase } from './hote';

const DIM = new Date(2026, 9, 18, 19, 0).getTime();
const LUNDI = '2026-10-19';
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01', apps: [] };
const LEA = 'lea0000001';
const lea: Profil = { id: LEA, nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['taches', 'tsuzuku'] };

function base(initial: Record<string, string> = {}): BasePrefs & { m: Map<string, string>; ecritures: string[] } {
  const m = new Map(Object.entries(initial));
  const ecritures: string[] = [];
  return {
    m,
    ecritures,
    lire: c => m.get(c),
    ecrire: (c, v) => {
      ecritures.push(c);
      m.set(c, v);
    },
    supprimer: c => void m.delete(c),
  };
}
const admin = () => ({ stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined });
let n = 0;
const ctx = () => ({ maintenant: new Date(2026, 9, 17, 9).getTime() + n++, auteur: 'fondateur' as const, aleaOctets: aleatoireDeterministe(n + 1) });

function donnees() {
  const e = creerEspace(lireDonnees(undefined), 'Travail', ctx());
  const p = creerProjet(e.donnees, e.espace.id, 'Site', ctx());
  let d: DonneesTaches = p.donnees;
  const t1 = creerTache(d, { titre: 'Maquette', listeId: p.liste.id, echeance: { jour: '2026-10-21' }, estimation: 90, priorite: 'haute' }, ctx());
  const t2 = creerTache(t1.donnees, { titre: 'Textes', listeId: p.liste.id, echeance: { jour: '2026-10-23' }, estimation: 60 }, ctx());
  const t3 = creerTache(t2.donnees, { titre: 'Photos', listeId: p.liste.id, echeance: { jour: '2026-10-19' }, estimation: 45 }, ctx());
  d = t3.donnees;
  return { d, t1: t1.tache.id, t2: t2.tache.id, t3: t3.tache.id, lSite: p.liste.id };
}
const biblio = JSON.stringify({
  version: 2,
  anime: [{ id: 'a1', kind: 'anime', title: 'Alpha', image: null, status: 'en_cours', currentEpisode: 3, totalEpisodes: 12, runtime: 24, year: 2025, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: null, lastWatched: '2026-10-10' }],
  movies: [],
  history: [],
  manualSources: {},
});
const avec = (d: DonneesTaches, extra: Record<string, string> = {}) => base({ [CLES_TACHES.donnees]: JSON.stringify(d), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'semaine' } }), 'tsuzuku.bibliotheque': biblio, ...extra });
const ctxHub = (b: BasePrefs): ContexteHub => ({ profil: fondateur, admin: admin(), baseProfil: b, maintenant: DIM, profils: { actuel: fondateur, tous: [fondateur, lea] } } as unknown as ContexteHub);

async function monter(contexte: ContexteHub, mode: 'large' | 'telephone' = 'large', theme = themeHub('nuit'), onOuvrirApp?: (id: string) => void) {
  return await render(
    <ModeAffichageForce mode={mode}>
      <Taches contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} onOuvrirApp={onOuvrirApp} />
    </ModeAffichageForce>,
  );
}
const toucher = async (id: string) => {
  await act(async () => fireEvent.press(screen.getByTestId(id)));
};
const lu = (b: ReturnType<typeof base>) => lireDonnees(b.m.get(CLES_TACHES.donnees));
const jourDeElement = (id: string) => {
  for (let i = 0; i < 7; i++) {
    const j = `2026-10-${19 + i}`;
    const zone = screen.queryByTestId(`pilote-jour-${j}`);
    if (zone && within(zone).queryByTestId(id)) return j;
  }
  return undefined;
};
describe('Ta semaine', () => {
  it('8 thèmes, bureau et téléphone : la semaine proposée s’affiche', async () => {
    const s = donnees();
    for (const theme of THEMES_HUB) {
      for (const mode of ['large', 'telephone'] as const) {
        const b = avec(s.d);
        const r = await monter(ctxHub(b), mode, theme);
        expect(screen.getByTestId('vue-pilote')).toBeTruthy();
        expect(screen.getByTestId('pilote-plage')).toHaveTextContent('19 au 25 octobre', { exact: false });
        expect(screen.getByTestId('pilote-etat')).toHaveTextContent('Proposition à valider', { exact: false });
        expect(screen.getByTestId('pilote-resume')).toHaveTextContent('3 tâches', { exact: false });
        for (let i = 0; i < 7; i++) expect(screen.getByTestId(`pilote-jour-2026-10-${19 + i}`)).toBeTruthy();
        expect(screen.getByTestId(`pilote-element-tache:${s.t3}`)).toBeTruthy();
        // Samedi et dimanche : jours sans travail.
        expect(screen.getByTestId('pilote-charge-2026-10-24')).toHaveTextContent('Jour sans travail', { exact: false });
        await r.unmount();
      }
    }
  });

  it('l’entrée « Ta semaine » est dans la navigation', async () => {
    const s = donnees();
    const b = base({ [CLES_TACHES.donnees]: JSON.stringify(s.d), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'tout' }, vue: 'liste' }) });
    await monter(ctxHub(b));
    if (!screen.queryByTestId('nav-semaine')) await toucher('taches-navigation');
    await toucher('nav-semaine');
    expect(screen.getByTestId('taches-titre')).toHaveTextContent('Ta semaine', { exact: false });
    expect(screen.getByTestId('vue-pilote')).toBeTruthy();
  });

  it('valider d’un clic : une seule écriture des données, les jours et créneaux appliqués ; annuler les rend', async () => {
    const s = donnees();
    const b = avec(s.d);
    await monter(ctxHub(b));
    const avant = lu(b);
    b.ecritures.length = 0;
    await toucher('pilote-valider');
    expect(b.ecritures.filter(c => c === CLES_TACHES.donnees)).toHaveLength(1);
    const apres = lu(b);
    for (const id of [s.t1, s.t2, s.t3]) {
      expect(apres.taches[id].echeance?.heure).toMatch(/^\d\d:\d\d$/);
      expect(apres.taches[id].echeance!.jour >= LUNDI && apres.taches[id].echeance!.jour <= '2026-10-25').toBe(true);
    }
    expect(apres.taches[s.t3].echeance!.jour <= '2026-10-19').toBe(true);
    expect(screen.getByTestId('pilote-etat')).toHaveTextContent('Validée', { exact: false });
    expect(screen.getByTestId('pilote-avis')).toHaveTextContent('3 tâches planifiées dans Tâches', { exact: false });
    expect(screen.queryByTestId('pilote-valider')).toBeNull();
    expect(lireEtatBase(b).valide?.annulation).toHaveLength(3);
    // Annuler.
    b.ecritures.length = 0;
    await toucher('pilote-annuler');
    expect(b.ecritures.filter(c => c === CLES_TACHES.donnees)).toHaveLength(1);
    for (const id of [s.t1, s.t2, s.t3]) expect(lu(b).taches[id].echeance).toEqual(avant.taches[id].echeance);
    expect(screen.getByTestId('pilote-etat')).toHaveTextContent('Proposition à valider', { exact: false });
    expect(lireEtatBase(b).valide).toBeUndefined();
  });

  it('déplacer d’un jour (‹ ›), retirer puis remettre, rien d’appliqué avant la validation', async () => {
    const s = donnees();
    const b = avec(s.d);
    await monter(ctxHub(b));
    const id = `tache:${s.t2}`;
    const depart = jourDeElement(`pilote-element-${id}`);
    expect(depart).toBeDefined();
    await toucher(`pilote-apres-${id}`);
    const apres = jourDeElement(`pilote-element-${id}`);
    expect(apres).not.toBe(depart);
    await toucher(`pilote-avant-${id}`);
    expect(jourDeElement(`pilote-element-${id}`)).toBe(depart);
    await toucher(`pilote-retirer-${id}`);
    expect(screen.queryByTestId(`pilote-element-${id}`)).toBeNull();
    expect(screen.getByTestId('pilote-retires')).toBeTruthy();
    await toucher(`pilote-placer-${id}-2026-10-22`);
    expect(jourDeElement(`pilote-element-${id}`)).toBe('2026-10-22');
    // Rien n'a été écrit dans les données de Tâches.
    expect(lu(b).taches[s.t2].echeance).toEqual(s.d.taches[s.t2].echeance);
    // Le brouillon survit à un nouveau montage (état de l'appareil).
    expect(lireEtatBase(b).brouillon?.elements.find(e => e.id === id)?.jour).toBe('2026-10-22');
  });

  it('régénérer rend la proposition d’origine', async () => {
    const s = donnees();
    const b = avec(s.d);
    await monter(ctxHub(b));
    const id = `tache:${s.t2}`;
    const depart = jourDeElement(`pilote-element-${id}`);
    await toucher(`pilote-retirer-${id}`);
    await toucher('pilote-regenerer');
    expect(screen.getByTestId('pilote-avis')).toHaveTextContent('Semaine régénérée', { exact: false });
    expect(jourDeElement(`pilote-element-${id}`)).toBe(depart);
  });

  it('les épisodes en récompense se débloquent à l’écran, sans jamais bloquer Tsuzuku', async () => {
    const s = donnees();
    const b = avec(s.d);
    const ouvertes: string[] = [];
    await monter(ctxHub(b), 'large', themeHub('nuit'), id => ouvertes.push(id));
    const ep = screen.getAllByTestId(/^pilote-recompense-episode:/)[0];
    expect(ep).toHaveTextContent('Se débloque quand tes tâches du jour sont faites', { exact: false });
    const idEp = ep.props.testID.replace('pilote-recompense-', '');
    // Le bouton Tsuzuku reste utilisable même verrouillé.
    await toucher(`pilote-tsuzuku-${idEp}`);
    expect(ouvertes).toEqual(['tsuzuku']);
  });

  it('terminer les tâches du jour débloque l’épisode du soir', async () => {
    const s = donnees();
    const b = avec(s.d);
    const r = await monter(ctxHub(b));
    const ep = screen.getAllByTestId(/^pilote-recompense-episode:/)[0];
    const idEp = ep.props.testID.replace('pilote-recompense-', '');
    const jour = jourDeElement(`pilote-element-${idEp}`)!;
    // Tout ce qui est prévu ce jour-là est fait.
    let d = lu(b);
    const du = lireEtatBase(b).brouillon!.elements.filter(e => e.jour === jour && e.genre === 'tache');
    for (const e of du) d = terminerTache(d, e.refId, ctx(), '2026-10-19').donnees;
    b.m.set(CLES_TACHES.donnees, JSON.stringify(d));
    await r.unmount();
    await monter(ctxHub(b));
    expect(screen.getByTestId(`pilote-recompense-${idEp}`)).toHaveTextContent('Débloqué', { exact: false });
  });

  it('réglages : enregistrer régénère avec les nouveaux créneaux, jours off et charge', async () => {
    const s = donnees();
    const b = avec(s.d);
    await monter(ctxHub(b));
    await toucher('pilote-reglages-ouvrir');
    await toucher('pilote-r-jour-5');
    await toucher('pilote-r-charge-180');
    await toucher('pilote-r-off-1');
    await act(async () => fireEvent.changeText(screen.getByTestId('pilote-r-debut-0'), '08:00'));
    await act(async () => fireEvent.changeText(screen.getByTestId('pilote-r-fin-0'), '11:00'));
    await toucher('pilote-r-recompenses');
    await toucher('pilote-reglages-enregistrer');
    const e = lireEtatBase(b);
    expect(e.reglages).toMatchObject({ jour: 5, chargeMax: 180, recompenses: false });
    expect(e.reglages.joursOff).toContain(1);
    expect(e.reglages.creneaux[0]).toEqual({ debut: '08:00', fin: '11:00' });
    // Lundi est maintenant un jour off : rien n'y est placé.
    expect(e.brouillon!.elements.filter(x => x.jour === LUNDI && x.genre === 'tache')).toEqual([]);
    expect(e.brouillon!.elements.some(x => x.genre === 'episode')).toBe(false);
  });

  it('réglages : une heure invalide empêche d’enregistrer', async () => {
    const s = donnees();
    await monter(ctxHub(avec(s.d)));
    await toucher('pilote-reglages-ouvrir');
    await act(async () => fireEvent.changeText(screen.getByTestId('pilote-r-heure'), '25h'));
    expect(screen.getByTestId('pilote-r-erreur')).toBeTruthy();
    expect(screen.getByTestId('pilote-reglages-enregistrer').props.accessibilityState.disabled).toBe(true);
  });

  it('semaine libre : état vide pédagogique', async () => {
    const b = base({ [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'semaine' } }) });
    await monter(ctxHub(b));
    expect(screen.getByTestId('pilote-vide')).toBeTruthy();
  });

  it('un membre : seulement ses tâches assignées, validées dans sa copie', async () => {
    const e = creerEspace(lireDonnees(undefined), 'Travail', ctx());
    const p = creerProjet(e.donnees, e.espace.id, 'Site', ctx());
    let d: DonneesTaches = inviterMembre(p.donnees, LEA, 'Léa', ctx(), 'ami');
    d = changerDroit(d, p.projet.id, LEA, 'ecriture', ctx());
    const a = creerTache(d, { titre: 'Pour Léa', listeId: p.liste.id, assignes: [LEA], echeance: { jour: '2026-10-21' }, estimation: 60 }, ctx());
    const c = creerTache(a.donnees, { titre: 'Pour le Fondateur', listeId: p.liste.id, assignes: ['fondateur'], echeance: { jour: '2026-10-21' } }, ctx());
    const copie = appliquerReception(copieVide(), documentPourMembre(c.donnees, listeMembres(c.donnees).find(m => m.compte === LEA)!, 'Enzo'));
    const b = base({ [CLES_TACHES.copie]: JSON.stringify(copie), [CLES_TACHES.affichage]: JSON.stringify({ ouverture: 'derniere', selection: { g: 'semaine' } }) });
    await monter({ profil: lea, baseProfil: b, maintenant: DIM } as unknown as ContexteHub);
    expect(screen.getByTestId(`pilote-element-tache:${a.tache.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`pilote-element-tache:${c.tache.id}`)).toBeNull();
    await toucher('pilote-valider');
    const apres = JSON.parse(b.m.get(CLES_TACHES.copie)!).donnees.taches[a.tache.id];
    expect(apres.echeance.heure).toMatch(/^\d\d:\d\d$/);
    expect(b.m.has(CLE_PILOTE)).toBe(true);
  });
});
