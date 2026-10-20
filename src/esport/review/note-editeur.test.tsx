/**
 * Éditeur de notes (ChampNote) : chaque format et chaque raccourci transforme la sélection comme attendu,
 * continuation des listes, historique, rendu de chaque élément du Markdown limité, liens dangereux neutralisés.
 */

import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { ChampNote } from '../ui/ChampNote';
import { NoteMarkdown } from '../ui/review/Note';
import {
  actionDuRaccourci,
  annulerEdition,
  appliquerFormat,
  blocCode,
  choisirMention,
  continuerListe,
  enregistrer,
  historiqueVide,
  indenter,
  inserer,
  mentionEnCours,
  retablirEdition,
  separateur,
  type Format,
} from './formatage';
import { analyserInline, analyserMarkdown, basculerCase, COULEURS, versHtml } from './markdown';

const theme = themeHub('nuit');
const tout = (texte: string) => ({ start: 0, end: texte.length });

describe('mise en forme : chaque format transforme la sélection', () => {
  const cas: Array<[Format, string, { start: number; end: number }, string, string]> = [
    ['gras', 'a mot b', { start: 2, end: 5 }, 'a **mot** b', 'mot'],
    ['italique', 'a mot b', { start: 2, end: 5 }, 'a *mot* b', 'mot'],
    ['barre', 'a mot b', { start: 2, end: 5 }, 'a ~~mot~~ b', 'mot'],
    ['surligne', 'a mot b', { start: 2, end: 5 }, 'a ==mot== b', 'mot'],
    ['code', 'a mot b', { start: 2, end: 5 }, 'a `mot` b', 'mot'],
    ['couleur:rouge', 'a mot b', { start: 2, end: 5 }, 'a {{rouge|mot}} b', 'mot'],
    ['couleur:bleu', 'a mot b', { start: 2, end: 5 }, 'a {{bleu|mot}} b', 'mot'],
  ];
  it.each(cas)('%s entoure la sélection puis la libère au second appui', (format, texte, sel, attendu, selectionne) => {
    const e = appliquerFormat(texte, sel, format);
    expect(e.texte).toBe(attendu);
    expect(e.texte.slice(e.selection.start, e.selection.end)).toBe(selectionne);
    expect(appliquerFormat(e.texte, e.selection, format).texte).toBe(texte);
  });

  it('couleur : une autre couleur remplace la première', () => {
    const rouge = appliquerFormat('mot', tout('mot'), 'couleur:rouge');
    const vert = appliquerFormat(rouge.texte, rouge.selection, 'couleur:vert');
    expect(vert.texte).toBe('{{vert|mot}}');
    expect(vert.texte.slice(vert.selection.start, vert.selection.end)).toBe('mot');
  });

  it('sans sélection, un exemple est inséré et sélectionné', () => {
    for (const f of ['barre', 'surligne', 'code', 'couleur:jaune'] as Format[]) {
      const e = appliquerFormat('x ', { start: 2, end: 2 }, f);
      expect(e.texte.length).toBeGreaterThan(4);
      expect(e.selection.end).toBeGreaterThan(e.selection.start);
    }
  });

  it.each([
    ['titre1', '# mot'],
    ['titre2', '## mot'],
    ['titre3', '### mot'],
    ['liste', '- mot'],
    ['numerotee', '1. mot'],
    ['case', '- [ ] mot'],
    ['citation', '> mot'],
  ] as Array<[Format, string]>)('%s : préfixe de ligne, retiré au second appui', (format, attendu) => {
    const e = appliquerFormat('mot', { start: 1, end: 1 }, format);
    expect(e.texte).toBe(attendu);
    expect(appliquerFormat(e.texte, e.selection, format).texte).toBe('mot');
  });

  it('préfixes : un autre genre est remplacé, plusieurs lignes sont numérotées, les lignes vides sont laissées', () => {
    expect(appliquerFormat('# Titre', { start: 0, end: 0 }, 'titre2').texte).toBe('## Titre');
    expect(appliquerFormat('- a', { start: 0, end: 0 }, 'numerotee').texte).toBe('1. a');
    expect(appliquerFormat('- [x] a', { start: 0, end: 0 }, 'liste').texte).toBe('- a');
    expect(appliquerFormat('a\n\nb\nc', tout('a\n\nb\nc'), 'numerotee').texte).toBe('1. a\n\n2. b\n3. c');
    expect(appliquerFormat('a\nb', tout('a\nb'), 'case').texte).toBe('- [ ] a\n- [ ] b');
    expect(appliquerFormat('1. a\n2. b', tout('1. a\n2. b'), 'numerotee').texte).toBe('a\nb');
    expect(appliquerFormat('a\nb', tout('a\nb'), 'citation').texte).toBe('> a\n> b');
  });

  it('bloc de code : entoure la sélection, la retire au second appui, insère un exemple sans sélection', () => {
    const e = blocCode('avant\nx = 1\naprès', { start: 6, end: 11 });
    expect(e.texte).toBe('avant\n```\nx = 1\n```\naprès');
    expect(e.texte.slice(e.selection.start, e.selection.end)).toBe('x = 1');
    expect(blocCode(e.texte, e.selection).texte).toBe('avant\nx = 1\naprès');
    const vide = appliquerFormat('', { start: 0, end: 0 }, 'bloc');
    expect(vide.texte.startsWith('```\n')).toBe(true);
    expect(vide.texte.endsWith('\n```')).toBe(true);
  });

  it('séparateur : --- sur sa ligne, précédé d’une ligne vide, après la ligne courante', () => {
    expect(separateur('un', { start: 1, end: 1 })).toEqual({ texte: 'un\n\n---\n', selection: { start: 8, end: 8 } });
    expect(separateur('un\ndeux', { start: 1, end: 1 }).texte).toBe('un\n\n---\ndeux');
    expect(appliquerFormat('', { start: 0, end: 0 }, 'separateur').texte).toBe('---\n');
  });

  it('lien : l’adresse sélectionnée devient la cible', () => {
    const e = appliquerFormat('voir https://exemple.fr/a', { start: 5, end: 25 }, 'lien');
    expect(e.texte).toBe('voir [Lien](https://exemple.fr/a)');
  });

  it('emoji et mention : insertion et autocomplétion', () => {
    expect(inserer('a b', { start: 1, end: 2 }, '🔥')).toEqual({ texte: 'a🔥b', selection: { start: 3, end: 3 } });
    expect(mentionEnCours('bravo @Ka', 9)).toEqual({ debut: 6, requete: 'Ka' });
    expect(mentionEnCours('mail a@b', 8)).toBeUndefined();
    expect(mentionEnCours('bravo @Ka ', 10)).toBeUndefined();
    expect(choisirMention('bravo @Ka et', 9, 'Kaï Z')).toEqual({ texte: 'bravo @KaïZ  et', selection: { start: 12, end: 12 } });
  });
});

describe('raccourcis clavier', () => {
  const touche = (e: object) => actionDuRaccourci(e);
  it('Ctrl ou Cmd + B, I, U, K, Maj+X, Maj+7, Maj+8, Z, Y, Maj+Z', () => {
    expect(touche({ key: 'b', ctrlKey: true })).toBe('gras');
    expect(touche({ key: 'i', metaKey: true })).toBe('italique');
    expect(touche({ key: 'u', ctrlKey: true })).toBe('barre');
    expect(touche({ key: 'X', ctrlKey: true, shiftKey: true })).toBe('barre');
    expect(touche({ key: 'k', ctrlKey: true })).toBe('lien');
    expect(touche({ key: '7', ctrlKey: true, shiftKey: true })).toBe('numerotee');
    expect(touche({ key: '&', code: 'Digit7', metaKey: true, shiftKey: true })).toBe('numerotee');
    expect(touche({ key: '8', ctrlKey: true, shiftKey: true })).toBe('liste');
    expect(touche({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true })).toBe('liste');
    expect(touche({ key: 'z', ctrlKey: true })).toBe('annuler');
    expect(touche({ key: 'y', ctrlKey: true })).toBe('retablir');
    expect(touche({ key: 'z', ctrlKey: true, shiftKey: true })).toBe('retablir');
  });
  it('sans Ctrl/Cmd, avec Alt ou avec une autre touche : rien', () => {
    expect(touche({ key: 'b' })).toBeUndefined();
    expect(touche({ key: 'b', ctrlKey: true, altKey: true })).toBeUndefined();
    expect(touche({ key: 'b', ctrlKey: true, shiftKey: true })).toBeUndefined();
    expect(touche({ key: 'q', ctrlKey: true })).toBeUndefined();
  });
});

describe('listes : Entrée, Tab, historique', () => {
  const entree = (t: string, p = t.length) => continuerListe(t, { start: p, end: p });
  it('Entrée continue puces, numéros, cases et citations', () => {
    expect(entree('- un')).toEqual({ texte: '- un\n- ', selection: { start: 7, end: 7 } });
    expect(entree('* un')?.texte).toBe('* un\n* ');
    expect(entree('1. un')?.texte).toBe('1. un\n2. ');
    expect(entree('9) un')?.texte).toBe('9) un\n10) ');
    expect(entree('- [x] fait')?.texte).toBe('- [x] fait\n- [ ] ');
    expect(entree('> cite')?.texte).toBe('> cite\n> ');
    expect(entree('  - sous')?.texte).toBe('  - sous\n  - ');
    expect(entree('a\n- un\nb', 6)?.texte).toBe('a\n- un\n- \nb');
  });
  it('Entrée au milieu d’un élément coupe le texte', () => {
    expect(entree('- abcd', 4)).toEqual({ texte: '- ab\n- cd', selection: { start: 7, end: 7 } });
  });
  it('Entrée sur un élément vide sort de la liste (ou remonte d’un niveau)', () => {
    expect(entree('- un\n- ')).toEqual({ texte: '- un\n', selection: { start: 5, end: 5 } });
    expect(entree('1. ')?.texte).toBe('');
    expect(entree('- [ ] ')?.texte).toBe('');
    expect(entree('> ')?.texte).toBe('');
    expect(entree('- a\n  - ')?.texte).toBe('- a\n- ');
  });
  it('Entrée hors liste ou avant la puce : comportement normal', () => {
    expect(entree('texte')).toBeUndefined();
    expect(entree('- un', 1)).toBeUndefined();
    expect(continuerListe('- un', { start: 0, end: 4 })).toBeUndefined();
  });
  it('Tab indente et Maj+Tab désindente les listes (3 niveaux), rien hors liste', () => {
    expect(indenter('- a', { start: 3, end: 3 }, 1)).toEqual({ texte: '  - a', selection: { start: 5, end: 5 } });
    expect(indenter('  - a', { start: 5, end: 5 }, -1)?.texte).toBe('- a');
    expect(indenter('- a', { start: 0, end: 0 }, -1)?.texte).toBe('- a');
    expect(indenter('      - a', { start: 0, end: 0 }, 1)?.texte).toBe('      - a');
    expect(indenter('- a\n1. b', tout('- a\n1. b'), 1)?.texte).toBe('  - a\n  1. b');
    expect(indenter('texte', { start: 0, end: 0 }, 1)).toBeUndefined();
  });
  it('historique : annuler et rétablir, frappes regroupées, nouvelle modification = futur effacé', () => {
    const a = { texte: 'a', selection: { start: 1, end: 1 } };
    const b = { texte: 'ab', selection: { start: 2, end: 2 } };
    const c = { texte: 'abc', selection: { start: 3, end: 3 } };
    let h = historiqueVide();
    h = enregistrer(h, a);
    h = enregistrer(h, b, true); // frappe regroupée : pas de nouveau pas
    expect(h.passe).toEqual([a]);
    const u = annulerEdition(h, c)!;
    expect(u.etat).toEqual(a);
    const r = retablirEdition(u.historique, a)!;
    expect(r.etat).toEqual(c);
    expect(annulerEdition(historiqueVide(), a)).toBeUndefined();
    expect(enregistrer(u.historique, a).futur).toEqual([]);
  });
});

describe('Markdown : analyse et rendu de chaque élément', () => {
  const source = ['# T1', '## T2', '### T3', 'para **gras** *ital* ~~bar~~ ==surl== {{rouge|rouge}} `code` @Kai', '', '1. un', '2. deux', '  - sous', '', '- [ ] a faire', '- [x] fait', '', '> citation', '', '```', 'x < y', '```', '', '---'].join('\n');

  it('analyse : tous les blocs et inlines', () => {
    const blocs = analyserMarkdown(source);
    expect(blocs.map(b => b.t)).toEqual(['titre', 'titre', 'titre', 'paragraphe', 'liste', 'liste', 'citation', 'code', 'separateur']);
    const para = blocs[3];
    if (para.t !== 'paragraphe') throw new Error('paragraphe attendu');
    expect(para.v.map(x => x.t)).toEqual(['texte', 'gras', 'texte', 'italique', 'texte', 'barre', 'texte', 'surligne', 'texte', 'couleur', 'texte', 'code', 'texte', 'mention']);
    const num = blocs[4];
    if (num.t !== 'liste') throw new Error('liste attendue');
    expect(num.items.map(i => [i.niveau, i.ordonnee, i.numero])).toEqual([[0, true, 1], [0, true, 2], [1, false, 1]]);
    const cases = blocs[5];
    if (cases.t !== 'liste') throw new Error('liste attendue');
    expect(cases.items.map(i => [i.coche, i.ligne])).toEqual([[false, 9], [true, 10]]);
    expect(blocs[7]).toEqual({ t: 'code', v: 'x < y' });
  });

  it('le serveur échappe < >, le rendu les réaffiche en texte', () => {
    expect(analyserMarkdown('```\nx &lt; y\n```')[0]).toEqual({ t: 'code', v: 'x < y' });
    expect(analyserMarkdown('&gt; cite')[0].t).toBe('citation');
  });

  it('couleur inconnue, lien dangereux, image : texte seul, jamais de balise', () => {
    expect(analyserInline('{{javascript|piège}}')).toEqual([{ t: 'texte', v: 'piège' }]);
    expect(analyserInline('[clic](javascript:alert(1))')).toEqual([{ t: 'texte', v: 'clic' }]);
    expect(analyserInline('[clic](https://exemple.fr)')[0]).toMatchObject({ t: 'lien', href: 'https://exemple.fr' });
    expect(COULEURS).toHaveLength(8);
    const html = versHtml('<img src=x onerror=alert(1)> [a](javascript:x) {{rouge|<b>}}\n\n```\n<script>\n```');
    expect(html).not.toMatch(/<img|<script|<b>|href="javascript/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('versHtml (impression) : un élément HTML sûr par bloc', () => {
    const h = versHtml(source);
    for (const b of ['<h1>', '<h2>', '<h3>', '<ol>', '<ul>', '<blockquote>', '<pre><code>', '<hr>', '<s>', '<mark>', 'class="c-rouge"', '<em>', '<strong>']) expect(h).toContain(b);
    expect(h).toContain('&#9744;');
    expect(h).toContain('&#9745;');
  });

  it('basculerCase coche et décoche la ligne visée, seulement si c’est une case', () => {
    expect(basculerCase('- [ ] a\n- [x] b', 0)).toBe('- [x] a\n- [x] b');
    expect(basculerCase('- [ ] a\n- [x] b', 1)).toBe('- [ ] a\n- [ ] b');
    expect(basculerCase('texte', 0)).toBe('texte');
    expect(basculerCase('x', 4)).toBe('x');
  });

  it('composants : titres, listes numérotée et imbriquée, cases, citation, code, séparateur, couleur', async () => {
    await render(<NoteMarkdown theme={theme} source={source} testID="md" />);
    const md = screen.getByTestId('md');
    expect(within(md).getAllByRole('header')).toHaveLength(3);
    expect(within(md).getByText('T1')).toBeTruthy();
    expect(within(md).getByText('1.')).toBeTruthy();
    expect(within(md).getByText('2.')).toBeTruthy();
    expect(within(md).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(md).getByText(/citation/)).toBeTruthy();
    expect(within(md).getByText('x < y')).toBeTruthy();
    expect(within(md).getByText('@Kai')).toBeTruthy();
    const rouge = within(md).getByText('rouge');
    expect([rouge.props.style].flat().some((s: { color?: string }) => s?.color === '#e5484d')).toBe(true);
  });

  it('liens : http(s) cliquables, javascript: neutralisé', async () => {
    await render(<NoteMarkdown theme={theme} source={'[ok](https://exemple.fr) [piège](javascript:alert(1)) [data](data:text/html,x)'} testID="l" />);
    expect(within(screen.getByTestId('l')).getAllByRole('link')).toHaveLength(1);
    expect(within(screen.getByTestId('l')).queryByText(/javascript:/)).toBeNull();
  });
});

describe('ChampNote : barre, clavier, listes, aperçu, agrandir', () => {
  function Hote({ initial = '', max, joueurs }: { initial?: string; max?: number; joueurs?: string[] }) {
    const [v, setV] = useState(initial);
    return <ChampNote theme={theme} libelle="Note" valeur={v} onChanger={setV} testID="n" apercu="toujours" maxLength={max} joueurs={joueurs} />;
  }
  const valeur = () => screen.getByTestId('n').props.value as string;
  const choisir = (start: number, end = start) => fireEvent(screen.getByTestId('n'), 'selectionChange', { nativeEvent: { selection: { start, end } } });

  it.each([
    ['gras', '**mot**'], ['italique', '*mot*'], ['barre', '~~mot~~'], ['surligne', '==mot=='], ['code', '`mot`'],
    ['titre1', '# mot'], ['titre2', '## mot'], ['titre3', '### mot'], ['liste', '- mot'], ['numerotee', '1. mot'],
    ['case', '- [ ] mot'], ['citation', '> mot'], ['lien', '[mot](https://)'],
  ])('le bouton %s applique son format sur la sélection', async (id, attendu) => {
    await render(<Hote initial="mot" />);
    await choisir(0, 3);
    await fireEvent.press(screen.getByTestId(`n-${id}`));
    expect(valeur()).toBe(attendu);
  });

  it('bloc de code puis séparateur', async () => {
    await render(<Hote initial="mot" />);
    await choisir(0, 3);
    await fireEvent.press(screen.getByTestId('n-bloc'));
    expect(valeur()).toBe('```\nmot\n```');
    await fireEvent.press(screen.getByTestId('n-separateur'));
    expect(valeur()).toContain('\n---');
  });

  it('couleurs prédéfinies', async () => {
    await render(<Hote initial="mot" />);
    await choisir(0, 3);
    await fireEvent.press(screen.getByTestId('n-couleur'));
    for (const c of COULEURS) expect(screen.getByTestId(`n-couleur-${c}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('n-couleur-vert'));
    expect(valeur()).toBe('{{vert|mot}}');
    expect(screen.queryByTestId('n-couleurs')).toBeNull();
  });

  it('emoji inséré au curseur', async () => {
    await render(<Hote initial="a b" />);
    await choisir(1);
    await fireEvent.press(screen.getByTestId('n-emoji'));
    await fireEvent.press(screen.getByTestId('n-emoji-🔥'));
    expect(valeur()).toBe('a🔥 b');
  });

  it.each([
    ['Ctrl+B', { key: 'b', ctrlKey: true }, '**mot**'],
    ['Cmd+I', { key: 'i', metaKey: true }, '*mot*'],
    ['Ctrl+U', { key: 'u', ctrlKey: true }, '~~mot~~'],
    ['Ctrl+Maj+X', { key: 'x', ctrlKey: true, shiftKey: true }, '~~mot~~'],
    ['Ctrl+K', { key: 'k', ctrlKey: true }, '[mot](https://)'],
    ['Ctrl+Maj+7', { key: '7', ctrlKey: true, shiftKey: true }, '1. mot'],
    ['Ctrl+Maj+8', { key: '8', ctrlKey: true, shiftKey: true }, '- mot'],
  ])('raccourci %s', async (_nom, evt, attendu) => {
    await render(<Hote initial="mot" />);
    await choisir(0, 3);
    const e = { nativeEvent: evt, preventDefault: jest.fn() };
    await fireEvent(screen.getByTestId('n'), 'keyPress', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(valeur()).toBe(attendu);
  });

  it('Entrée continue la liste, Entrée sur une puce vide en sort', async () => {
    await render(<Hote initial="- un" />);
    await choisir(4);
    await fireEvent.changeText(screen.getByTestId('n'), '- un\n');
    expect(valeur()).toBe('- un\n- ');
    await fireEvent.changeText(screen.getByTestId('n'), '- un\n- \n');
    expect(valeur()).toBe('- un\n');
  });

  it('Entrée dans une liste numérotée et une case', async () => {
    await render(<Hote initial="1. a" />);
    await fireEvent.changeText(screen.getByTestId('n'), '1. a\n');
    expect(valeur()).toBe('1. a\n2. ');
  });

  it('Entrée dans une case : nouvelle case décochée', async () => {
    await render(<Hote initial="- [x] fait" />);
    await fireEvent.changeText(screen.getByTestId('n'), '- [x] fait\n');
    expect(valeur()).toBe('- [x] fait\n- [ ] ');
  });

  it('Tab et Maj+Tab indentent les listes ; Tab hors liste n’est pas intercepté', async () => {
    await render(<Hote initial="- a" />);
    await choisir(3);
    const tab = { nativeEvent: { key: 'Tab' }, preventDefault: jest.fn() };
    await fireEvent(screen.getByTestId('n'), 'keyPress', tab);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(valeur()).toBe('  - a');
    await fireEvent(screen.getByTestId('n'), 'keyPress', { nativeEvent: { key: 'Tab', shiftKey: true }, preventDefault: jest.fn() });
    expect(valeur()).toBe('- a');
  });

  it('Tab hors liste : laissé au navigateur', async () => {
    await render(<Hote initial="texte" />);
    const libre = { nativeEvent: { key: 'Tab' }, preventDefault: jest.fn() };
    await fireEvent(screen.getByTestId('n'), 'keyPress', libre);
    expect(libre.preventDefault).not.toHaveBeenCalled();
  });

  it('annuler / rétablir : boutons et Ctrl+Z / Ctrl+Y', async () => {
    await render(<Hote initial="mot" />);
    await choisir(0, 3);
    await fireEvent.press(screen.getByTestId('n-gras'));
    expect(valeur()).toBe('**mot**');
    await fireEvent.press(screen.getByTestId('n-annuler'));
    expect(valeur()).toBe('mot');
    await fireEvent.press(screen.getByTestId('n-retablir'));
    expect(valeur()).toBe('**mot**');
    await fireEvent(screen.getByTestId('n'), 'keyPress', { nativeEvent: { key: 'z', ctrlKey: true }, preventDefault: jest.fn() });
    expect(valeur()).toBe('mot');
    await fireEvent(screen.getByTestId('n'), 'keyPress', { nativeEvent: { key: 'y', ctrlKey: true }, preventDefault: jest.fn() });
    expect(valeur()).toBe('**mot**');
  });

  it('mention : le bouton @ propose les joueurs et complète le pseudo', async () => {
    await render(<Hote initial="bravo " joueurs={['Kaï', 'Léa', 'Kat']} />);
    await choisir(6);
    await fireEvent.press(screen.getByTestId('n-mention'));
    expect(valeur()).toBe('bravo @');
    await choisir(7);
    expect(screen.getByTestId('n-mention-Kat')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('n'), 'bravo @Ka');
    await choisir(9);
    expect(screen.queryByTestId('n-mention-Léa')).toBeNull();
    await fireEvent.press(screen.getByTestId('n-mention-Kat'));
    expect(valeur()).toBe('bravo @Kat ');
  });

  it('sans joueurs, pas de bouton @', async () => {
    await render(<Hote />);
    expect(screen.queryByTestId('n-mention')).toBeNull();
  });

  it('case cochable dans l’aperçu', async () => {
    await render(<Hote initial={'- [ ] a\n- [x] b'} />);
    await fireEvent.press(screen.getByTestId('n-apercu-case-0'));
    expect(valeur()).toBe('- [x] a\n- [x] b');
  });

  it('compteur visible près de la limite seulement', async () => {
    await render(<Hote initial="abc" max={100} />);
    expect(screen.queryByTestId('n-compteur')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('n'), 'x'.repeat(85));
    expect(screen.getByTestId('n-compteur').props.children).toBe('85 / 100 caractères');
  });

  it('aperçu repliable', async () => {
    await render(<Hote initial="**gras**" />);
    expect(screen.getByTestId('n-apercu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('n-voir-apercu'));
    expect(screen.queryByTestId('n-apercu')).toBeNull();
    await fireEvent.press(screen.getByTestId('n-voir-apercu'));
    expect(screen.getByTestId('n-apercu')).toBeTruthy();
  });

  it('Agrandir : panneau plein écran avec le même champ, puis Réduire', async () => {
    await render(<Hote initial="# Titre" />);
    await fireEvent.press(screen.getByTestId('n-agrandir'));
    expect(screen.getByTestId('n-agrandi')).toBeTruthy();
    expect(screen.getByTestId('n').props.value).toBe('# Titre');
    await fireEvent.changeText(screen.getByTestId('n'), '# Titre\nsuite');
    await fireEvent.press(screen.getByTestId('n-reduire'));
    expect(screen.queryByTestId('n-agrandi')).toBeNull();
    expect(valeur()).toBe('# Titre\nsuite');
  });

  it('boutons de 44 px minimum, saisie bien plus grande qu’avant', async () => {
    await render(<Hote />);
    for (const id of ['gras', 'italique', 'barre', 'liste', 'case', 'lien', 'titre1', 'bloc', 'annuler', 'agrandir', 'voir-apercu']) {
      const style = [screen.getByTestId(`n-${id}`).props.style].flat().reduce((a: object, b: object) => ({ ...a, ...b }), {});
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    }
    const champ = [screen.getByTestId('n').props.style].flat(3).reduce((a: object, b: object) => ({ ...a, ...b }), {});
    expect(champ.height).toBeGreaterThanOrEqual(11 * 22);
  });

  it('aperçu sûr : HTML et javascript: neutralisés', async () => {
    await render(<Hote initial={'<img src=x onerror=alert(1)> [clic](javascript:alert(1))'} />);
    const apercu = screen.getByTestId('n-apercu');
    expect(within(apercu).queryAllByRole('link')).toHaveLength(0);
    expect(within(apercu).queryByText(/javascript/)).toBeNull();
  });
});
