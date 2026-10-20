/**
 * Review vidéo v2 côté app : barre de mise en forme (raccourcis qui entourent
 * la sélection, rendu sûr), dessin sur la vidéo (logique pure : quand
 * l'afficher, à quel repère le rattacher, annuler / rétablir, rendu SVG),
 * réactions 👍 / 👎 (écran, tri « plus likés »), app native (pas de dessin,
 * mention « disponible sur le site ou le PC »).
 */

import React, { useState } from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from '../client';
import { ChampNote } from '../ui/ChampNote';
import { PageTeam } from '../ui/PageTeam';
import { messageDessinNatif } from '../ui/review/dessinVideo';
import { SANS_REACTION } from './api';
import {
  ajouterForme,
  annulerDessin,
  dessinDe,
  dessinsAAfficher,
  elementsSvg,
  finDessin,
  gommerForme,
  historiqueDessin,
  normaliserForme,
  pointeFleche,
  repereDuDessin,
  resumeDessin,
  retablirDessin,
  type Dessin,
  type FormeDessin,
} from './dessin';
import { fauxReviewScouting, repereDe } from './faux';
import { appliquerFormat, basculerListe, entourer, formatDuRaccourci, insererLien } from './formatage';
import { phraseJournalReview, trierReperes } from './libelles';

const theme = themeHub('nuit');
const FLECHE: FormeDessin = { t: 'fleche', c: '#e5484d', e: 4, p: [0.1, 0.2, 0.5, 0.6] };
const DESSIN: Dessin = { v: 1, objets: [FLECHE] };

describe('mise en forme : raccourcis et barre d’outils (logique pure)', () => {
  it('Ctrl/Cmd+B entoure la sélection de **…**, Ctrl/Cmd+I de *…*', () => {
    expect(entourer('Erreur grave ici', { start: 7, end: 12 }, 'gras')).toEqual({ texte: 'Erreur **grave** ici', selection: { start: 9, end: 14 } });
    expect(entourer('Erreur grave ici', { start: 7, end: 12 }, 'italique')).toEqual({ texte: 'Erreur *grave* ici', selection: { start: 8, end: 13 } });
    // Sélection à l'envers et espaces en bord : laissés dehors.
    expect(entourer('a mot b', { start: 6, end: 1 }, 'gras').texte).toBe('a **mot** b');
    // Sans sélection : un exemple inséré et sélectionné.
    const vide = entourer('Note : ', { start: 7, end: 7 }, 'gras');
    expect(vide.texte).toBe('Note : **texte en gras**');
    expect(vide.texte.slice(vide.selection.start, vide.selection.end)).toBe('texte en gras');
  });

  it('bascule : un second appui retire la mise en forme (dedans ou autour de la sélection)', () => {
    const une = entourer('Erreur grave', { start: 7, end: 12 }, 'gras');
    expect(entourer(une.texte, une.selection, 'gras')).toEqual({ texte: 'Erreur grave', selection: { start: 7, end: 12 } });
    expect(entourer('x **mot** y', { start: 2, end: 9 }, 'gras').texte).toBe('x mot y');
    // L'italique ne confond pas avec le gras : ***mot*** reste cohérent.
    expect(entourer('**mot**', { start: 2, end: 5 }, 'italique').texte).toBe('***mot***');
    expect(entourer('*mot*', { start: 1, end: 4 }, 'italique').texte).toBe('mot');
  });

  it('liste à puces et lien', () => {
    expect(basculerListe('un\ndeux\ntrois', { start: 0, end: 7 }).texte).toBe('- un\n- deux\ntrois');
    expect(basculerListe('- un\n- deux', { start: 0, end: 10 }).texte).toBe('un\ndeux');
    const curseur = basculerListe('Rotation', { start: 3, end: 3 });
    expect(curseur).toEqual({ texte: '- Rotation', selection: { start: 5, end: 5 } });
    const lien = insererLien('voir la VOD', { start: 8, end: 11 });
    expect(lien.texte).toBe('voir la [VOD](https://)');
    expect(lien.texte.slice(lien.selection.start, lien.selection.end)).toBe('https://');
    expect(appliquerFormat('x', { start: 0, end: 1 }, 'lien').texte).toBe('[x](https://)');
  });

  it('raccourcis reconnus : Ctrl ou Cmd + B / I, sans Alt ni Maj', () => {
    expect(formatDuRaccourci({ key: 'b', ctrlKey: true })).toBe('gras');
    expect(formatDuRaccourci({ key: 'B', metaKey: true })).toBe('gras');
    expect(formatDuRaccourci({ key: 'i', ctrlKey: true })).toBe('italique');
    expect(formatDuRaccourci({ key: 'b' })).toBeUndefined();
    expect(formatDuRaccourci({ key: 'b', ctrlKey: true, shiftKey: true })).toBeUndefined();
    expect(formatDuRaccourci({ key: 'z', ctrlKey: true })).toBeUndefined();
  });
});

describe('ChampNote : barre d’outils, raccourcis et aperçu sûr', () => {
  function Hote({ initial = '' }: { initial?: string }) {
    const [v, setV] = useState(initial);
    return <ChampNote theme={theme} libelle="Note" valeur={v} onChanger={setV} testID="note" apercu="toujours" />;
  }

  it('Ctrl+B entoure la sélection ; les boutons (44 px) appliquent gras, italique, liste et lien', async () => {
    await render(<Hote initial="Erreur grave" />);
    const champ = screen.getByTestId('note');
    await fireEvent(champ, 'selectionChange', { nativeEvent: { selection: { start: 7, end: 12 } } });
    const evt = { nativeEvent: { key: 'b', ctrlKey: true }, preventDefault: jest.fn() };
    await fireEvent(champ, 'keyPress', evt);
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId('note').props.value).toBe('Erreur **grave**');
    // Une touche ordinaire ne fait rien.
    await fireEvent(champ, 'keyPress', { nativeEvent: { key: 'b' }, preventDefault: jest.fn() });
    expect(screen.getByTestId('note').props.value).toBe('Erreur **grave**');
    await fireEvent(champ, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 6 } } });
    await fireEvent.press(screen.getByTestId('note-italique'));
    expect(screen.getByTestId('note').props.value).toBe('*Erreur* **grave**');
    await fireEvent(champ, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 0 } } });
    await fireEvent.press(screen.getByTestId('note-liste'));
    expect(screen.getByTestId('note').props.value).toBe('- *Erreur* **grave**');
    for (const f of ['gras', 'italique', 'liste', 'lien']) {
      const style = [screen.getByTestId(`note-${f}`).props.style].flat().reduce((a: object, b: object) => ({ ...a, ...b }), {});
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    }
    // Aperçu : rendu par les composants de l'app.
    expect(within(screen.getByTestId('note-apercu')).getByText('grave')).toBeTruthy();
  });

  it('aperçu sûr : aucun HTML interprété, lien dangereux rendu en texte seul', async () => {
    await render(<Hote initial={'<img src=x onerror=alert(1)> **ok** [clic](javascript:alert(1))'} />);
    const apercu = screen.getByTestId('note-apercu');
    expect(within(apercu).getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(within(apercu).queryAllByRole('link')).toHaveLength(0);
    expect(within(apercu).queryByText(/javascript/)).toBeNull();
  });
});

describe('dessin sur la vidéo (logique pure)', () => {
  const reperes = [
    { id: 'a', debut: 10, fin: null, dessin: DESSIN, peutModifier: true },
    { id: 'b', debut: 40, fin: 50, dessin: DESSIN, peutModifier: false },
    { id: 'c', debut: 60, fin: null, dessin: null, peutModifier: true },
  ];

  it('affiché pendant la durée du repère, ou 3 s par défaut ; en continu en pause sur le repère', () => {
    const ids = (t: number, pause = false) => dessinsAAfficher(reperes, t, pause).map(r => r.id);
    expect(ids(9)).toEqual([]);
    expect(ids(10)).toEqual(['a']);
    expect(ids(12.9)).toEqual(['a']);
    expect(ids(13.2)).toEqual([]); // après 3 s, le dessin disparaît
    expect(ids(45)).toEqual(['b']); // repère avec durée : toute la durée
    expect(ids(50.5)).toEqual([]);
    expect(ids(60)).toEqual([]); // repère sans dessin
    // En pause sur le repère (un saut YouTube tombe parfois juste avant) : affiché tant que la pause dure.
    expect(ids(9.7, true)).toEqual(['a']);
    expect(ids(9.7, false)).toEqual([]);
    expect(finDessin({ debut: 5, fin: null })).toBe(8);
    expect(finDessin({ debut: 5, fin: 5 })).toBe(8);
  });

  it('rattaché au repère du timestamp courant que l’on peut modifier, sinon un repère sera créé', () => {
    expect(repereDuDessin(reperes, 10.3)?.id).toBe('a');
    expect(repereDuDessin(reperes, 11)).toBeUndefined();
    expect(repereDuDessin(reperes, 40)).toBeUndefined(); // pas le droit de modifier « b »
    expect(repereDuDessin(reperes, 60.2)?.id).toBe('c');
  });

  it('annuler et rétablir ; gomme ; dessin vide = retiré', () => {
    let h = historiqueDessin();
    h = ajouterForme(h, FLECHE);
    h = ajouterForme(h, { t: 'cercle', c: '#30A46C', e: 2, p: [0.2, 0.2, 0.4, 0.5] });
    expect(h.present.map(f => f.t)).toEqual(['fleche', 'cercle']);
    expect(h.present[1].c).toBe('#30a46c');
    h = annulerDessin(h);
    expect(h.present.map(f => f.t)).toEqual(['fleche']);
    h = retablirDessin(h);
    expect(h.present.map(f => f.t)).toEqual(['fleche', 'cercle']);
    h = gommerForme(h, 0);
    expect(h.present.map(f => f.t)).toEqual(['cercle']);
    expect(retablirDessin(h)).toBe(h);
    h = annulerDessin(annulerDessin(annulerDessin(h)));
    expect(h.present).toEqual([]);
    expect(dessinDe([])).toBeNull();
    expect(dessinDe([{ t: 'texte', c: '#ffffff', e: 4, p: [0.5, 0.5], x: '  ' }])).toBeNull();
  });

  it('coordonnées relatives bornées (0 à 1) ; rendu SVG à l’échelle du lecteur', () => {
    expect(normaliserForme({ t: 'rect', c: '#FFFFFF', e: 99, p: [-0.2, 0.123456, 1.4, 0.5] })).toEqual({ t: 'rect', c: '#ffffff', e: 20, p: [0, 0.1235, 1, 0.5] });
    const long = normaliserForme({ t: 'trait', c: '#000000', e: 2, p: Array.from({ length: 1000 }, (_, i) => (i % 100) / 100) });
    expect(long.p.length).toBeLessThanOrEqual(400);
    expect(normaliserForme({ t: 'texte', c: '#000000', e: 2, p: [0, 0], x: '<b>Push</b> B' }).x).toBe('bPush/b B');
    const els = elementsSvg(DESSIN, 640, 360);
    expect(els[0]).toEqual({ el: 'line', x1: 64, y1: 72, x2: 320, y2: 216, couleur: '#e5484d', epaisseur: 4 });
    expect(els[1].el).toBe('polygon');
    const double = elementsSvg(DESSIN, 1280, 720);
    expect(double[0]).toMatchObject({ x2: 640, y2: 432, epaisseur: 8 });
    expect(pointeFleche(0, 0, 100, 0, 4)[0]).toEqual([100, 0]);
    expect(resumeDessin({ v: 1, objets: [FLECHE, FLECHE, { ...FLECHE, t: 'texte', x: 'A' }] })).toBe('3 formes (flèche, texte)');
  });
});

describe('réactions : tri et journal', () => {
  it('« plus likés » / « plus dislikés » (à égalité, par instant)', () => {
    const r = (id: string, debut: number, like: number, dislike: number) => ({ id, debut, reactions: { ...SANS_REACTION, like, dislike } });
    const liste = [r('a', 10, 1, 3), r('b', 20, 4, 0), r('c', 5, 1, 0)];
    expect(trierReperes(liste, 'instant').map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(trierReperes(liste, 'likes').map(x => x.id)).toEqual(['b', 'c', 'a']);
    expect(trierReperes(liste, 'dislikes').map(x => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('phrase du journal', () => {
    expect(phraseJournalReview('review.reaction_changed', 'Léa', { cible: 'repere', valeur: 'like', repereTitre: 'Peek', review: 'Faucons vs Nova' })).toBe('Léa aime 👍 le repère « Peek » de « Faucons vs Nova »');
    expect(phraseJournalReview('review.reaction_changed', 'Kai', { cible: 'commentaire', valeur: null, repereTitre: 'Peek', review: 'R' })).toBe('Kai a retiré sa réaction à un commentaire du repère « Peek » de « R »');
  });
});

// ---------------------------------------------------------------- Écran

const MODULES = ['activity_log', 'planning', 'video_review', 'scouting'];
const JOUEUR = ['members.view', 'planning.view', 'video_review.view', 'video_review.annotate', 'video_review.react'];

function detail(permissions: string[]): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: MODULES.includes(m.cle) })),
    membres: 3,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
  };
}

async function monter(permissions: string[], mode: 'large' | 'telephone' = 'large') {
  const f = fauxReviewScouting(permissions, {
    reperes: [
      repereDe({ id: 'r1', debut: 83, titre: 'Peek trop large', dessin: DESSIN, commentaires: [{ id: 'k1', texte: 'Compris **chef**', auteur: { compte: 'kai12345', pseudo: 'Kai' }, creeLe: '2026-10-20T11:00:00.000Z', peutSupprimer: false, reactions: SANS_REACTION }] }),
      repereDe({ id: 'r2', debut: 200, titre: 'Fumée trop tôt', categorie: 'utilitaires', reactions: { like: 2, dislike: 0, moi: null, qui: { like: [{ compte: 'kai12345', pseudo: 'Kai' }, { compte: 'coach123', pseudo: 'Coach Zed' }], dislike: [] } } }),
    ],
  });
  const c = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    membres: async () => [],
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
    requete: f.requete,
  } as unknown as ClientEsport;
  await render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={theme} client={c} teamId="t1" large={mode === 'large'} sectionInitiale="module:video_review" onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
  await fireEvent.press(await screen.findByTestId('esport-review-rv1'));
  await screen.findByTestId('esport-repere-r1');
  return f;
}

describe('écran Review v2 (app native)', () => {
  let ouvrir: jest.SpyInstance;
  beforeEach(() => {
    ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => ouvrir.mockRestore());

  it('un Joueur like puis dislike un repère : une seule réaction, compteurs à jour', async () => {
    const { appels } = await monter(JOUEUR, 'telephone');
    expect(screen.getByTestId('esport-repere-reaction-r2-like-n').props.children).toBe(2);
    await fireEvent.press(screen.getByTestId('esport-repere-reaction-r1-like'));
    await waitFor(() => expect(screen.getByTestId('esport-repere-reaction-r1-like-n').props.children).toBe(1));
    expect(appels.at(-1)).toMatchObject({ methode: 'PUT', chemin: '/teams/t1/review/rv1/reperes/r1/reaction', corps: { valeur: 'like' } });
    expect(screen.getByTestId('esport-repere-reaction-r1-like').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-repere-reaction-r1-dislike'));
    await waitFor(() => expect(screen.getByTestId('esport-repere-reaction-r1-dislike-n').props.children).toBe(1));
    expect(screen.getByTestId('esport-repere-reaction-r1-like-n').props.children).toBe(0);
    // Un second appui retire la réaction.
    await fireEvent.press(screen.getByTestId('esport-repere-reaction-r1-dislike'));
    await waitFor(() => expect(screen.getByTestId('esport-repere-reaction-r1-dislike-n').props.children).toBe(0));
    expect(appels.at(-1)?.corps).toEqual({ valeur: null });
    // Qui a réagi : appui long (ou survol sur le site), et dans le nom accessible.
    expect(screen.getByTestId('esport-repere-reaction-r2-like').props.accessibilityLabel).toMatch(/Kai, Coach Zed/);
    await fireEvent(screen.getByTestId('esport-repere-reaction-r2-like'), 'longPress');
    expect(screen.getByTestId('esport-repere-reaction-r2-qui').props.children).toBe('👍 Kai, Coach Zed');
  });

  it('réaction sur un commentaire ; commentaire rendu en Markdown', async () => {
    const { appels } = await monter(JOUEUR, 'telephone');
    await fireEvent.press(screen.getByTestId('esport-repere-commentaires-r1'));
    expect(within(await screen.findByTestId('esport-commentaire-texte-rendu-k1')).getByText('chef')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-commentaire-reaction-k1-like'));
    await waitFor(() => expect(screen.getByTestId('esport-commentaire-reaction-k1-like-n').props.children).toBe(1));
    expect(appels.at(-1)?.chemin).toBe('/teams/t1/review/rv1/reperes/r1/commentaires/k1/reaction');
    expect(screen.getByTestId('esport-commentaire-texte-r1-gras')).toBeTruthy();
  });

  it('sans video_review.react : compteurs visibles, aucun envoi', async () => {
    const { appels } = await monter(['members.view', 'video_review.view'], 'telephone');
    const n = appels.length;
    await fireEvent.press(screen.getByTestId('esport-repere-reaction-r2-like'));
    expect(appels.length).toBe(n);
    expect(screen.getByTestId('esport-repere-reaction-r2-qui')).toBeTruthy();
  });

  it('tri « plus likés »', async () => {
    await monter(JOUEUR, 'large');
    const ordre = () => screen.getAllByTestId(/^esport-repere-r\d$/).map(x => x.props.testID);
    expect(ordre()).toEqual(['esport-repere-r1', 'esport-repere-r2']);
    await fireEvent.press(screen.getByTestId('esport-review-tri-likes'));
    expect(ordre()).toEqual(['esport-repere-r2', 'esport-repere-r1']);
  });

  it('app native : pas de bouton « Dessiner » ; le repère dessiné le signale (✏️, « disponible sur le site ou le PC »)', async () => {
    await monter(JOUEUR, 'telephone');
    expect(screen.queryByTestId('esport-review-dessiner')).toBeNull();
    expect(screen.getByTestId('esport-repere-icone-dessin-r1')).toBeTruthy();
    expect(screen.getByTestId('esport-repere-miniature-r1').props.children).toBe(messageDessinNatif());
    expect(screen.queryByTestId('esport-repere-miniature-r2')).toBeNull();
  });
});
