/**
 * Éditeur de strats par modèle (panneaux testables sans canevas) : frise des étapes (phases du modèle,
 * durée, lecture animée), ordre des utilitaires, joueurs (3 pour The Finals), inspecteur (dimensions en
 * mètres, marqueurs d'équipes adverses, étages), fiche d'une capacité « à vérifier » ; profils de jeu
 * précis : modèle de strat, pré-remplissage, capacités d'un personnage, détails d'une map (calibrage,
 * callouts, repères) ; liste des strats selon le modèle du jeu de la team.
 */

import React from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { documentVide, appliquer, executer, historique, type Action, type DocumentStrat, type Historique, type ObjetStrat } from './strats/document';
import { Chronologie, FicheCapacite, Inspecteur, ListeUtilitaires, PanneauJoueurs } from './ui/strats/Panneaux';
import { CapacitesPersonnage, DetailsCarte, ModeleProfil } from './ui/jeux/DetailsJeu';
import type { CarteJeu, DonneesJeu, PersonnageJeu } from './jeux/api';
import { donneesVides } from './jeux/profil';
import { capacitesValorant } from './jeux/modeles';
import { documentImpression } from './ui/strats/impression';

jest.mock('./ui/jeux/EditeurCarte', () => {
  // Plan simulé : deux boutons touchent la map en des points connus.
  const { Pressable: P, Text: T, View: V } = require('react-native');
  return {
    __esModule: true,
    planDisponible: true,
    default: ({ onPoint }: { onPoint(x: number, y: number): void }) => (
      <V>
        <P testID="plan-a" onPress={() => onPoint(100, 100)}>
          <T>a</T>
        </P>
        <P testID="plan-b" onPress={() => onPoint(100, 600)}>
          <T>b</T>
        </P>
        <P testID="plan-c" onPress={() => onPoint(400, 600)}>
          <T>c</T>
        </P>
      </V>
    ),
  };
});

const theme = themeHub('nuit');
const ASCENT = { cle: 'ascent', nom: 'Ascent', image: null, echelle: null };

/** Petit banc : un historique de document, et `faire` qui l'applique. */
function banc(doc: DocumentStrat) {
  const etat: { h: Historique } = { h: historique(doc) };
  const faire = jest.fn((a: Action) => {
    etat.h = executer(etat.h, a);
  });
  return { etat, faire };
}

describe('frise des étapes et lecture', () => {
  it('phases du modèle Valorant, durée, ajout d’étape ; boutons de lecture', async () => {
    const { etat, faire } = banc(documentVide(ASCENT));
    const onEtape = jest.fn();
    const onLire = jest.fn();
    await render(<Chronologie theme={theme} doc={etat.h.present} etape={0} onEtape={onEtape} faire={faire} modifiable enLecture={false} onLire={onLire} onPause={jest.fn()} onArreter={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('esport-etape-phase-post-plant'));
    expect(etat.h.present.etapes[0].phase).toBe('post-plant');
    await fireEvent.changeText(screen.getByTestId('esport-etape-duree'), '12');
    expect(etat.h.present.etapes[0].duree).toBe(12);
    await fireEvent.press(screen.getByTestId('esport-etape-ajouter'));
    expect(etat.h.present.etapes).toHaveLength(2);
    expect(etat.h.present.etapes[1].phase).toBe('post-plant');
    expect(onEtape).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByTestId('esport-lecture-lire'));
    expect(onLire).toHaveBeenCalled();
    expect(screen.queryByTestId('esport-etape-phase-prise')).toBeNull();
  });

  it('The Finals : phases propres (prise, vol…), lecture en cours : temps et barre de progression', async () => {
    const doc = documentVide(ASCENT, 'attaque', 'the-finals', 'thefinals');
    const onPause = jest.fn();
    await render(<Chronologie theme={theme} doc={doc} etape={0} onEtape={jest.fn()} faire={jest.fn()} modifiable temps={2.5} enLecture onLire={jest.fn()} onPause={onPause} onArreter={jest.fn()} />);
    expect(screen.getByTestId('esport-etape-phase-prise')).toBeTruthy();
    expect(screen.getByTestId('esport-etape-phase-vol')).toBeTruthy();
    expect(screen.queryByTestId('esport-etape-phase-post-plant')).toBeNull();
    expect(screen.getByTestId('esport-lecture-temps').props.children).toMatch(/2\.5/);
    await fireEvent.press(screen.getByTestId('esport-lecture-pause'));
    expect(onPause).toHaveBeenCalled();
  });
});

describe('utilitaires, joueurs, inspecteur', () => {
  const cap = (id: string, ordre: number): ObjetStrat => ({ id, type: 'capacite', x: 0, y: 0, agent: 'omen', capacite: 'Ability2', nom: `Smoke ${id}`, icone: null, joueur: 0, couleur: '#ef4444', zone: { forme: 'cercle', rayon: 4.1 }, ordre });

  it('ordre des utilitaires : descendre réordonne et renumérote', async () => {
    let doc = documentVide(ASCENT);
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: cap('a', 1) });
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: cap('b', 2) });
    const { etat, faire } = banc(doc);
    await render(<ListeUtilitaires theme={theme} doc={etat.h.present} etape={0} faire={faire} modifiable onChoisir={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('esport-utilitaire-descendre-a'));
    const ordres = Object.fromEntries(etat.h.present.etapes[0].objets.map(o => [o.id, (o as { ordre: number }).ordre]));
    expect(ordres).toEqual({ a: 2, b: 1 });
  });

  it('joueurs : trois pour The Finals, nom et classe', async () => {
    const { etat, faire } = banc(documentVide(ASCENT, 'attaque', 'the-finals', 'thefinals'));
    const agents = [{ cle: 'heavy', nom: 'Heavy', role: null, icone: null, capacites: [] }];
    await render(<PanneauJoueurs theme={theme} doc={etat.h.present} agents={agents} joueur={0} onJoueur={jest.fn()} faire={faire} modifiable libelleAgent="Classe" />);
    expect(screen.getAllByTestId(/^esport-joueur-ligne-/)).toHaveLength(3);
    await fireEvent.changeText(screen.getByTestId('esport-joueur-nom-2'), 'Kai');
    expect(etat.h.present.joueurs[2].nom).toBe('Kai');
  });

  it('inspecteur : rayon en mètres, ordre, minutage ; marqueur ennemi d’une équipe adverse ; étage', async () => {
    let doc = documentVide(ASCENT, 'attaque', 'the-finals', 'thefinals');
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: cap('a', 1) });
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: { id: 'm', type: 'marqueur', x: 1, y: 1, genre: 'ennemi', etiquette: '', couleur: '#ef4444', equipe: null } });
    const { etat, faire } = banc(doc);
    const props = { theme, etape: 0, faire, niveaux: [{ valeur: 0, nom: 'RDC' }, { valeur: 1, nom: 'Toit' }], genres: ['ennemi', 'cashout'] as const, onFermer: jest.fn(), onSupprimer: jest.fn(), onDupliquer: jest.fn() };
    const vue = await render(<Inspecteur {...props} doc={etat.h.present} objet={etat.h.present.etapes[0].objets[0]} />);
    await fireEvent.changeText(screen.getByTestId('esport-inspecteur-rayon'), '6,5');
    await fireEvent.changeText(screen.getByTestId('esport-inspecteur-ordre'), '3');
    await fireEvent.changeText(screen.getByTestId('esport-inspecteur-t'), '4');
    await fireEvent.press(screen.getByTestId('esport-inspecteur-niveau-1'));
    expect(etat.h.present.etapes[0].objets[0]).toMatchObject({ zone: { forme: 'cercle', rayon: 6.5 }, ordre: 3, t: 4, niveau: 1 });
    await vue.rerender(<Inspecteur {...props} doc={etat.h.present} objet={etat.h.present.etapes[0].objets[1]} />);
    await fireEvent.press(screen.getByTestId('esport-inspecteur-equipe-3'));
    await fireEvent.changeText(screen.getByTestId('esport-inspecteur-etiquette'), 'Équipe rouge sur le toit');
    expect(etat.h.present.etapes[0].objets[1]).toMatchObject({ equipe: 3, etiquette: 'Équipe rouge sur le toit' });
  });

  it('fiche d’une capacité : caractéristiques et « à vérifier »', async () => {
    const donnees = capacitesValorant('omen').find(c => c.touche === 'E');
    await render(<FicheCapacite theme={theme} capacite={{ cle: 'Ability2', nom: 'Dark Cover', icone: null, touche: 'E', donnees }} />);
    expect(screen.getByTestId('esport-fiche-capacite')).toBeTruthy();
    expect(screen.getByText(/rayon 4\.1 m/)).toBeTruthy();
    expect(screen.getByTestId('esport-fiche-a-verifier')).toBeTruthy();
  });

  it('impression (PDF) : textes échappés, joueurs, utilitaires dans l’ordre, images des étapes', () => {
    let doc = documentVide(ASCENT);
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: cap('b', 2) });
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: cap('a', 1) });
    doc = appliquer(doc, { type: 'noteEtape', etape: 0, note: '<script>x</script>' });
    const html = documentImpression({ strat: { titre: 'Exec <A>', notes: '' } as never, doc, images: ['data:image/png;base64,AAAA'], agents: [] });
    expect(html).toContain('Exec &lt;A&gt;');
    expect(html).not.toContain('<script>x');
    expect(html.indexOf('Smoke a')).toBeLessThan(html.indexOf('Smoke b'));
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
  });
});

describe('lecture seule (app native)', () => {
  it('phases, durées et ordre des utilitaires de chaque étape ; pas d’attaque / défense pour The Finals', async () => {
    let doc = documentVide(ASCENT, 'attaque', 'the-finals', 'thefinals');
    doc = appliquer(doc, { type: 'phaseEtape', etape: 0, phase: 'prise' });
    doc = appliquer(doc, { type: 'ajouter', etape: 0, objet: { id: 'c', type: 'capacite', x: 0, y: 0, agent: 'heavy', capacite: 'dome-shield', nom: 'Dome Shield', icone: null, joueur: 2, couleur: '#22c55e', zone: null, ordre: 1, t: 3 } });
    const strat = { id: 's1', jeu: 'the-finals', modele: 'thefinals', titre: 'Cashout', carte: { cle: 'monaco', nom: 'Monaco' }, side: 'attaque', type: 'execute', tags: [], notes: '', visibilite: 'team', revision: 1, versionDocument: 3, miniature: null, origine: null, creePar: { compte: 'x', pseudo: null }, majPar: { compte: 'x', pseudo: null }, creeLe: '', majLe: '', moi: { modifier: false, supprimer: false, partager: false }, donnees: doc };
    const { Editeur } = require('./ui/strats/Editeur');
    const api = { detail: jest.fn(async () => strat) };
    await render(<Editeur theme={theme} api={api} teamId="t1" stratId="s1" large assets={undefined} onRetour={jest.fn()} onOuvrir={jest.fn()} onSupprimee={jest.fn()} />);
    expect((await screen.findByTestId('esport-strat-lecture-phase')).props.children).toMatch(/Prise du cashout/);
    expect(screen.getByTestId('esport-strat-lecture-utilitaire').props.children).toMatch(/1\. Dome Shield \(Joueur 3\) · 3 s/);
    expect(screen.queryByText('Attaque')).toBeNull();
  });
});

describe('profils de jeu précis', () => {
  it('modèle de strat et pré-remplissage des capacités (à vérifier)', async () => {
    const onModele = jest.fn();
    let d: DonneesJeu = { ...donneesVides(), personnages: [{ cle: 'omen', nom: 'Omen', classe: null, image: null, actif: true }] };
    const onDonnees = jest.fn((x: DonneesJeu) => {
      d = x;
    });
    await render(<ModeleProfil theme={theme} modele="valorant" onModele={onModele} d={d} onDonnees={onDonnees} testID="j" />);
    await fireEvent.press(screen.getByTestId('j-modele-choix-thefinals'));
    expect(onModele).toHaveBeenCalledWith('thefinals');
    await fireEvent.press(screen.getByTestId('j-prerempli-capacites'));
    expect(d.personnages[0].capacites).toHaveLength(4);
    expect(screen.getByTestId('j-prerempli-avis')).toBeTruthy();
  });

  it('The Finals : « Compléter avec le modèle » ajoute classes, maps et gadgets', async () => {
    let d: DonneesJeu = donneesVides();
    await render(<ModeleProfil theme={theme} modele="thefinals" onModele={jest.fn()} d={d} onDonnees={x => (d = x)} testID="j" />);
    await fireEvent.press(screen.getByTestId('j-prerempli-thefinals'));
    expect(d.personnages.map(p => p.nom)).toEqual(['Light', 'Medium', 'Heavy']);
    expect(d.cartes.length).toBeGreaterThan(5);
    expect(d.cartes[0].niveaux?.length).toBe(5);
  });

  it('capacités d’un personnage : ajout, dimensions, « à vérifier » décoché', async () => {
    let caps: PersonnageJeu['capacites'] = capacitesValorant('phoenix');
    const p = (): PersonnageJeu => ({ cle: 'phoenix', nom: 'Phoenix', classe: null, image: null, actif: true, capacites: caps });
    const vue = await render(<CapacitesPersonnage theme={theme} personnage={p()} modele="valorant" onCapacites={c => (caps = c)} testID="c" />);
    expect(screen.getByTestId('c-a-verifier')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('c-0-longueur'), '20');
    expect(caps?.[0].longueur).toBe(20);
    await vue.rerender(<CapacitesPersonnage theme={theme} personnage={p()} modele="valorant" onCapacites={c => (caps = c)} testID="c" />);
    await fireEvent.press(screen.getByTestId('c-0-a-verifier'));
    expect(caps?.[0].aVerifier).toBe(false);
    await fireEvent.press(screen.getByTestId('c-ajouter'));
    expect(caps).toHaveLength(5);
  });

  it('détails d’une map : état vide, calibrage par deux points, callout, repère', async () => {
    let carte: CarteJeu = { cle: 'ascent', nom: 'Ascent', image: null, actif: true, modes: [] };
    const deposer = jest.fn();
    const monter = () => <DetailsCarte theme={theme} carte={carte} onCarte={c => (carte = c)} deposer={deposer} testID="m" />;
    const vue = await render(monter());
    expect(screen.getByTestId('m-image-vide')).toBeTruthy();
    // Calibrage : deux points à 500 unités, 50 m → 10 unités par mètre.
    await fireEvent.press(screen.getByTestId('m-mode-echelle'));
    await fireEvent.press(await screen.findByTestId('plan-a'));
    await fireEvent.press(screen.getByTestId('plan-b'));
    await fireEvent.changeText(screen.getByTestId('m-echelle-distance'), '50');
    await fireEvent.press(screen.getByTestId('m-echelle-valider'));
    expect(carte.echelle?.pxParMetre).toBe(10);
    await vue.rerender(monter());
    expect(screen.getByTestId('m-echelle').props.children).toMatch(/10/);
    // Callout : trois sommets et un nom.
    await fireEvent.press(screen.getByTestId('m-mode-zone'));
    await fireEvent.changeText(screen.getByTestId('m-zone-nom'), 'A Main');
    await fireEvent.press(screen.getByTestId('plan-a'));
    await fireEvent.press(screen.getByTestId('plan-b'));
    await fireEvent.press(screen.getByTestId('plan-c'));
    await fireEvent.press(screen.getByTestId('m-zone-fermer'));
    expect(carte.zones?.[0]).toMatchObject({ cle: 'a-main', points: [100, 100, 100, 600, 400, 600] });
    await vue.rerender(monter());
    // Repère : un site.
    await fireEvent.press(screen.getByTestId('m-mode-repere'));
    await fireEvent.changeText(screen.getByTestId('m-repere-nom'), 'Site A');
    await fireEvent.press(screen.getByTestId('plan-c'));
    expect(carte.reperes?.[0]).toMatchObject({ nom: 'Site A', type: 'site', x: 400, y: 600 });
    await vue.rerender(monter());
    // Callout coloré, dernier sommet retiré.
    await fireEvent.press(screen.getByTestId('m-mode-zone'));
    await fireEvent.changeText(screen.getByTestId('m-zone-nom'), 'Mid');
    await fireEvent.press(screen.getByTestId('m-zone-couleur-#22c55e'));
    await fireEvent.press(screen.getByTestId('plan-a'));
    await fireEvent.press(screen.getByTestId('plan-b'));
    await fireEvent.press(screen.getByTestId('plan-c'));
    await fireEvent.press(screen.getByTestId('plan-a'));
    await fireEvent.press(screen.getByTestId('m-zone-dernier'));
    await fireEvent.press(screen.getByTestId('m-zone-fermer'));
    expect(carte.zones?.[1]).toMatchObject({ cle: 'mid', couleur: '#22c55e', points: [100, 100, 100, 600, 400, 600] });
    expect(Pressable).toBeTruthy();
    expect(Text).toBeTruthy();
  });
});
