/**
 * Review vidéo et scouting côté app (phase 5) : extraction des identifiants
 * YouTube, rendu Markdown sans HTML brut (XSS), temps et libellés, écrans
 * (app native : liste des repères en lecture seule qui ouvre YouTube au bon
 * timestamp), droits, filtres, commentaires, export, scouting et « Ouvrir en
 * review vidéo », 8 thèmes.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { THEMES_HUB, themeHub, type ThemeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from '../client';
import { phraseJournal, phraseNotification } from '../libelles';
import { PageTeam, entreesBarre, type SectionTeam } from '../ui/PageTeam';
import { fauxPlanning } from '../planning/faux';
import { fauxReviewScouting } from './faux';
import { documentImpression } from './impression';
import { CATEGORIES, categorie, formatTemps, lireTemps, positionPourcent, repereActif } from './libelles';
import { analyserMarkdown, echapperHtml, lienSur, versHtml } from './markdown';
import { adresseYoutube, extraireYoutube, lienYoutubeA, miniatureYoutube, secondesDe } from './youtube';

const theme = themeHub('nuit');
const ID = 'dQw4w9WgXcQ';
const MODULES = ['activity_log', 'planning', 'video_review', 'scouting'];
const JOUEUR = ['members.view', 'planning.view', 'video_review.view', 'video_review.annotate'];
const COACH = [...JOUEUR, 'video_review.create', 'video_review.delete', 'scouting.view', 'scouting.manage'];
const MANAGER = ['members.view', 'planning.view', 'video_review.view', 'scouting.view'];

function detail(permissions: string[]): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: MODULES.includes(m.cle) })),
    membres: 3,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#2563eb', cle: 'coach' }, permissions, superAdmin: false },
  };
}

function client(permissions: string[]) {
  const f = fauxReviewScouting(permissions);
  const c = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    membres: async () => [],
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
    requete: f.requete,
  } as unknown as ClientEsport;
  return { client: c, ...f };
}

async function monter(permissions: string[], section: SectionTeam, mode: 'large' | 'telephone' = 'large', t: ThemeHub = theme, onExporter?: (n: string, c: string, ty?: string) => Promise<boolean>) {
  const c = client(permissions);
  const r = await render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={t} client={c.client} teamId="t1" large={mode === 'large'} sectionInitiale={section} onQuitter={() => undefined} onExporter={onExporter} />
    </ModeAffichageForce>,
  );
  return { ...c, ...r };
}

describe('YouTube : extraction de l’identifiant', () => {
  it('watch, youtu.be, shorts, embed, live (et nocookie, mobile, sans schéma)', () => {
    for (const u of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&list=PL1&index=2`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/live/${ID}?feature=share`,
      `youtu.be/${ID}`,
      `  www.youtube.com/watch?v=${ID} `,
    ]) {
      expect(extraireYoutube(u)?.id).toBe(ID);
    }
    expect(extraireYoutube(`https://youtu.be/${ID}?t=1h2m3s`)).toEqual({ id: ID, debut: 3723 });
    expect(extraireYoutube(`https://www.youtube.com/embed/${ID}?start=12`)?.debut).toBe(12);
    expect(secondesDe('90')).toBe(90);
    expect(secondesDe('1m30s')).toBe(90);
    expect(secondesDe('x')).toBeUndefined();
  });

  it('refuse les autres sites, les faux hôtes, les identifiants invalides et les schémas dangereux', () => {
    for (const u of [
      '',
      null,
      'pas une adresse',
      'https://www.youtube.com/watch?v=court',
      `https://www.youtube.com/watch?v=${ID}x`,
      'https://www.youtube.com/playlist?list=PL1',
      `https://youtube.com.exemple.fr/watch?v=${ID}`,
      `https://evilyoutube.com/watch?v=${ID}`,
      `https://vimeo.com/${ID}`,
      `javascript:alert(1)//youtu.be/${ID}`,
      `ftp://youtu.be/${ID}`,
      `https://user:pass@youtu.be/${ID}`,
    ]) {
      expect(extraireYoutube(u)).toBeNull();
    }
    expect(adresseYoutube(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(lienYoutubeA(ID, 83.9)).toBe(`https://www.youtube.com/watch?v=${ID}&t=83s`);
    expect(miniatureYoutube(ID)).toBe(`https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  });
});

describe('Markdown limité : rendu sans HTML brut', () => {
  it('blocs et styles autorisés', () => {
    const blocs = analyserMarkdown('### Titre\n\nUn **gras**, une *nuance* et `code`.\n\n- un\n- deux\n\n1. a\n2. b');
    expect(blocs.map(b => b.t)).toEqual(['titre', 'paragraphe', 'liste', 'liste']);
    expect(blocs[2]).toMatchObject({ t: 'liste', ordonnee: false });
    expect(blocs[3]).toMatchObject({ t: 'liste', ordonnee: true });
    expect(versHtml('**gras** et *italique*')).toBe('<p><strong>gras</strong> et <em>italique</em></p>');
  });

  it('XSS : aucune balise ni lien dangereux ne sort', () => {
    const attaques = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[clic](javascript:alert(1))',
      '[clic](JaVaScRiPt:alert(1))',
      '[clic](data:text/html;base64,AAAA)',
      '[clic](https://exemple.fr/" onmouseover="alert(1))',
      '**<b onmouseover=alert(1)>x</b>**',
      '`<script>`',
      '- <iframe src="https://evil.example"></iframe>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    ];
    for (const a of attaques) {
      const html = versHtml(a);
      expect(html).not.toMatch(/<(script|img|iframe|b|svg)[\s>]/i);
      expect(html).not.toMatch(/<[^>]*\son\w+\s*=/i);
      expect(html).not.toMatch(/href="(?!https?:)/i);
      expect(html).not.toMatch(/javascript:/i);
    }
    expect(versHtml('[ok](https://exemple.fr/a?b=1&c=2)')).toBe('<p><a href="https://exemple.fr/a?b=1&amp;c=2" rel="noopener noreferrer">ok</a></p>');
    expect(versHtml('[x](javascript:alert(1))')).toBe('<p>x</p>');
    expect(echapperHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(lienSur('https://exemple.fr/a')).toBe(true);
    expect(lienSur('javascript:alert(1)')).toBe(false);
    // Les entités posées par le serveur redeviennent du TEXTE (jamais interprétées).
    expect(versHtml('1 &lt; 2')).toBe('<p>1 &lt; 2</p>');
  });

  it('impression PDF : le document est échappé', () => {
    const html = documentImpression('<b>Titre</b>', '# <script>x</script>\n\n[a](javascript:alert(1))');
    expect(html).not.toMatch(/<script|<b>|javascript:/i);
    expect(html).toContain('aria-label="&lt;b&gt;Titre&lt;/b&gt;"');
  });
});

describe('temps, catégories et phrases', () => {
  it('formatage et lecture du temps', () => {
    expect(formatTemps(83.4)).toBe('01:23');
    expect(formatTemps(3725)).toBe('1:02:05');
    expect(lireTemps('1:23')).toBe(83);
    expect(lireTemps('1:02:05')).toBe(3725);
    expect(lireTemps('83')).toBe(83);
    expect(lireTemps('83,5')).toBe(83.5);
    expect(lireTemps('1m23s')).toBe(83);
    expect(lireTemps('abc')).toBeUndefined();
    expect(lireTemps('')).toBeUndefined();
    expect(positionPourcent(50, 200)).toBe(25);
    expect(positionPourcent(500, 200)).toBe(100);
    expect(positionPourcent(5, 0)).toBe(0);
  });

  it('repère actif selon la lecture', () => {
    const r = [
      { id: 'a', debut: 10, fin: null },
      { id: 'b', debut: 30, fin: 60 },
    ];
    expect(repereActif(r, 5)).toBeUndefined();
    expect(repereActif(r, 12)?.id).toBe('a');
    expect(repereActif(r, 25)).toBeUndefined();
    expect(repereActif(r, 45)?.id).toBe('b');
    expect(repereActif(r, 61)).toBeUndefined();
  });

  it('cinq catégories colorées, glyphes distincts', () => {
    expect(CATEGORIES.map(c => c.cle)).toEqual(['erreur', 'bonne_action', 'utilitaires', 'placement', 'comms']);
    expect(new Set(CATEGORIES.map(c => c.couleur)).size).toBe(5);
    expect(new Set(CATEGORIES.map(c => c.glyphe)).size).toBe(5);
    expect(categorie('inconnue').cle).toBe('erreur');
  });

  it('journal et notifications', () => {
    const e = (action: string, meta: Record<string, unknown>) => ({ id: '1', action, acteur: 'c', entiteType: null, entiteId: null, meta, date: '' });
    expect(phraseJournal(e('review.created', { titre: 'Faucons vs Nova' }), { c: 'Zed' })).toBe('Zed a créé la review « Faucons vs Nova »');
    expect(phraseJournal(e('review.created', { titre: 'VOD', depuisVod: true }), { c: 'Zed' })).toContain('depuis une VOD');
    expect(phraseJournal(e('review.marker_added', { titre: 'Peek', categorie: 'erreur', debut: 83, review: 'R' }), { c: 'Zed' })).toBe('Zed a ajouté le repère « Peek » (Erreur, 01:23) à « R »');
    expect(phraseJournal(e('review.comment_added', { repereTitre: 'Peek', titre: 'R' }), { c: 'Léa' })).toBe('Léa a commenté le repère « Peek » de « R »');
    expect(phraseJournal(e('opponent.created', { nom: 'Nova' }), { c: 'Zed' })).toBe('Zed a créé la fiche adversaire « Nova »');
    expect(phraseJournal(e('opponent.detail_changed', { partie: 'vod', action: 'review', nom: 'Finale', adversaire: 'Nova' }), { c: 'Zed' })).toBe('Zed a ouvert en review une VOD (« Finale ») de la fiche « Nova »');
    const n = (type: string, charge: Record<string, unknown>) => ({ id: 'n', type, team: { id: 't', nom: 'Faucons' }, charge, lue: false, date: '' });
    expect(phraseNotification(n('review-nouvelle', { titre: 'Faucons vs Nova' }), {})).toBe('Nouvelle review « Faucons vs Nova » (Faucons)');
    expect(phraseNotification(n('review-commentaire', { repere: 'Peek' }), {})).toBe('Nouveau commentaire sur votre repère « Peek » (Faucons)');
  });
});

describe('barre de la team : droits', () => {
  it('Review et Scouting selon les permissions (un Joueur n’a pas le scouting)', () => {
    const noms = (p: string[]) => entreesBarre(detail(p)).map(e => e.libelle);
    expect(noms(JOUEUR)).toContain('Review vidéo');
    expect(noms(JOUEUR)).not.toContain('Scouting');
    expect(noms(COACH)).toEqual(expect.arrayContaining(['Review vidéo', 'Scouting']));
    expect(noms(MANAGER)).toEqual(expect.arrayContaining(['Review vidéo', 'Scouting']));
    expect(noms(['members.view', 'planning.view'])).not.toContain('Review vidéo');
  });
});

describe('écran Review (app native : lecture seule, ouverture dans YouTube)', () => {
  let ouvrir: jest.SpyInstance;
  beforeEach(() => {
    ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => ouvrir.mockRestore());

  it('liste des reviews (plus de mention « pas de dessin »), ouverture du détail', async () => {
    await monter(JOUEUR, 'module:video_review', 'telephone');
    expect(await screen.findByTestId('esport-review-rv1')).toBeTruthy();
    expect(screen.queryByTestId('esport-review-limite')).toBeNull();
    expect(screen.queryByTestId('esport-review-nouvelle')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-review-rv1'));
    expect(await screen.findByTestId('esport-review-detail')).toBeTruthy();
    expect(screen.getByTestId('esport-review-nom').props.children).toBe('Faucons vs Nova');
    expect(screen.getByTestId('esport-lecteur-natif')).toBeTruthy();
    // Repères triés, lecture seule : ni ajout, ni modification, ni suppression.
    for (const id of ['r1', 'r3', 'r2']) expect(screen.getByTestId(`esport-repere-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('esport-review-ajouter')).toBeNull();
    expect(screen.queryByTestId('esport-repere-modifier-r1')).toBeNull();
    expect(screen.queryByTestId('esport-repere-supprimer-r1')).toBeNull();
    expect(screen.queryByTestId('esport-review-supprimer')).toBeNull();
    expect(screen.queryByTestId('esport-timeline')).toBeNull();
    expect(screen.queryByTestId('esport-review-export-pdf')).toBeNull();
  });

  it('chaque repère ouvre la vidéo dans YouTube au bon timestamp', async () => {
    await monter(JOUEUR, 'module:video_review', 'telephone');
    await fireEvent.press(await screen.findByTestId('esport-review-rv1'));
    await fireEvent.press(await screen.findByTestId('esport-repere-youtube-r1'));
    expect(ouvrir).toHaveBeenCalledWith(`https://www.youtube.com/watch?v=${ID}&t=83s`);
    await fireEvent.press(screen.getByTestId('esport-repere-youtube-r2'));
    expect(ouvrir).toHaveBeenLastCalledWith(`https://www.youtube.com/watch?v=${ID}&t=3725s`);
    await fireEvent.press(screen.getByTestId('esport-lecteur-youtube'));
    expect(ouvrir).toHaveBeenLastCalledWith(`https://www.youtube.com/watch?v=${ID}&t=0s`);
  });

  it('note Markdown rendue en texte, filtres par catégorie, joueur et auteur', async () => {
    await monter(JOUEUR, 'module:video_review', 'large');
    await fireEvent.press(await screen.findByTestId('esport-review-rv1'));
    await screen.findByTestId('esport-repere-r1');
    expect(within(screen.getByTestId('esport-repere-note-r1')).getByText(/trader/)).toBeTruthy();
    expect([screen.getByTestId('esport-review-compte').props.children].flat().join('')).toBe('3 / 3 repères');
    await fireEvent.press(screen.getByTestId('esport-filtre-cat-erreur'));
    expect(screen.queryByTestId('esport-repere-r2')).toBeNull();
    expect(screen.getByTestId('esport-repere-r1')).toBeTruthy();
    expect([screen.getByTestId('esport-review-compte').props.children].flat().join('')).toBe('1 / 3 repères');
    await fireEvent.press(screen.getByTestId('esport-filtre-effacer'));
    await fireEvent.press(screen.getByTestId('esport-filtre-joueur-kai12345'));
    expect(screen.queryByTestId('esport-repere-r1')).toBeNull();
    expect(screen.getByTestId('esport-repere-r2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-filtre-joueur-'));
    await fireEvent.press(screen.getByTestId('esport-filtre-auteur-kai12345'));
    expect(screen.queryByTestId('esport-repere-r3')).toBeNull();
    expect(screen.getByTestId('esport-repere-r2')).toBeTruthy();
  });

  it('un Joueur commente (fil par repère) mais ne voit pas la suppression de la review', async () => {
    const { appels } = await monter(JOUEUR, 'module:video_review', 'telephone');
    await fireEvent.press(await screen.findByTestId('esport-review-rv1'));
    await fireEvent.press(await screen.findByTestId('esport-repere-commentaires-r1'));
    expect(await screen.findByTestId('esport-commentaire-k1')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-commentaire-texte-r1'), 'Je prends note');
    await fireEvent.press(screen.getByTestId('esport-commentaire-envoyer-r1'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && a.chemin.endsWith('/reperes/r1/commentaires'))).toBe(true));
    expect(appels.find(a => a.chemin.endsWith('/commentaires'))?.corps).toEqual({ texte: 'Je prends note' });
    await waitFor(() => expect(screen.getByText('Je prends note')).toBeTruthy());
    expect(screen.queryByTestId('esport-review-supprimer')).toBeNull();
  });

  it('Coach : crée une review depuis une adresse YouTube, supprime avec confirmation', async () => {
    const { appels } = await monter(COACH, 'module:video_review', 'telephone');
    await screen.findByTestId('esport-review-nouvelle');
    expect(screen.getByTestId('esport-review-creer').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('esport-review-url'), 'https://exemple.fr/pas-youtube');
    expect((await screen.findByTestId('esport-review-url-etat')).props.children).toBe('Adresse YouTube non reconnue.');
    await fireEvent.changeText(screen.getByTestId('esport-review-url'), `https://youtu.be/${ID}`);
    expect(screen.getByTestId('esport-review-url-etat').props.children).toBe(`Vidéo reconnue (${ID})`);
    await fireEvent.changeText(screen.getByTestId('esport-review-titre'), 'Scrim vs Orion');
    await fireEvent.press(screen.getByTestId('esport-review-creer'));
    await screen.findByTestId('esport-review-detail');
    expect(appels.find(a => a.methode === 'POST' && a.chemin === '/teams/t1/review')?.corps).toEqual({ titre: 'Scrim vs Orion', url: `https://youtu.be/${ID}`, reference: '' });
    expect(screen.getByTestId('esport-review-supprimer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-review-supprimer'));
    await fireEvent.press(screen.getByTestId('esport-review-supprimer-confirmer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'DELETE' && a.chemin === '/teams/t1/review/rv2')).toBe(true));
    expect(await screen.findByTestId('esport-review-liste')).toBeTruthy();
  });

  it('export Markdown des notes', async () => {
    const exporter = jest.fn(async () => true);
    await monter(JOUEUR, 'module:video_review', 'large', theme, exporter);
    await fireEvent.press(await screen.findByTestId('esport-review-rv1'));
    await fireEvent.press(await screen.findByTestId('esport-review-export-md'));
    await waitFor(() => expect(exporter).toHaveBeenCalledWith('Review - Faucons vs Nova.md', expect.stringContaining('# Faucons vs Nova'), 'text/markdown'));
  });
});

describe('écran Scouting', () => {
  let ouvrir: jest.SpyInstance;
  beforeEach(() => {
    ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => ouvrir.mockRestore());

  it('Coach : fiche adversaire, joueurs, tendances, VODs et « Ouvrir en review vidéo »', async () => {
    const { appels } = await monter(COACH, 'module:scouting', 'large');
    await screen.findByTestId('esport-adversaire-nouveau');
    await fireEvent.changeText(screen.getByTestId('esport-adversaire-nom'), 'Team Nova');
    await fireEvent.changeText(screen.getByTestId('esport-adversaire-logo'), 'https://exemple.fr/logo.png');
    await fireEvent.press(screen.getByTestId('esport-adversaire-creer'));
    expect(await screen.findByTestId('esport-adversaire-detail')).toBeTruthy();
    expect(screen.getByTestId('esport-adversaire-titre').props.children).toBe('Team Nova');
    expect(appels.find(a => a.methode === 'POST' && a.chemin.endsWith('/scouting/adversaires'))?.corps).toEqual({ nom: 'Team Nova', logoUrl: 'https://exemple.fr/logo.png', notes: '' });

    // Joueur adverse.
    await fireEvent.press(screen.getByTestId('esport-joueur-adverse-ajouter'));
    await fireEvent.changeText(screen.getByTestId('esport-joueur-adverse-pseudo'), 'Phantom');
    await fireEvent.changeText(screen.getByTestId('esport-joueur-adverse-riot'), 'Phantom#EUW');
    await fireEvent.changeText(screen.getByTestId('esport-joueur-adverse-role'), 'Duelliste');
    await fireEvent.changeText(screen.getByTestId('esport-joueur-adverse-agents'), 'Jett, Raze, Jett');
    await fireEvent.press(screen.getByTestId('esport-joueur-adverse-enregistrer'));
    expect(await screen.findByText(/Agents : Jett, Raze/)).toBeTruthy();
    expect(appels.find(a => a.chemin.endsWith('/joueurs') && a.methode === 'POST')?.corps).toMatchObject({ pseudo: 'Phantom', riotId: 'Phantom#EUW', role: 'Duelliste', agents: ['Jett', 'Raze'] });

    // Tendance.
    await fireEvent.press(screen.getByTestId('esport-tendance-ajouter'));
    await fireEvent.changeText(screen.getByTestId('esport-tendance-map'), 'Ascent');
    await fireEvent.press(screen.getByTestId('esport-tendance-side-defense'));
    await fireEvent.changeText(screen.getByTestId('esport-tendance-taux'), '140');
    await fireEvent.press(screen.getByTestId('esport-tendance-enregistrer'));
    expect((await screen.findByTestId('esport-tendance-erreur')).props.children).toContain('0 à 100');
    await fireEvent.changeText(screen.getByTestId('esport-tendance-taux'), '62');
    await fireEvent.changeText(screen.getByTestId('esport-tendance-compos'), 'Jett, Sova, Omen\nJett, Raze');
    await fireEvent.press(screen.getByTestId('esport-tendance-enregistrer'));
    expect(await screen.findByText(/Ascent · Défense · 62 % de victoires/)).toBeTruthy();
    expect(appels.find(a => a.chemin.endsWith('/tendances') && a.methode === 'POST')?.corps).toMatchObject({ map: 'Ascent', side: 'defense', tauxVictoire: 62, compos: [['Jett', 'Sova', 'Omen'], ['Jett', 'Raze']] });

    // VOD YouTube → review.
    await fireEvent.changeText(screen.getByTestId('esport-vod-url'), `https://youtu.be/${ID}`);
    await fireEvent.changeText(screen.getByTestId('esport-vod-titre'), 'Finale de ligue');
    await fireEvent.press(screen.getByTestId('esport-vod-ajouter'));
    const bouton = await screen.findByText('Ouvrir en review vidéo');
    await fireEvent.press(bouton);
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && /\/vods\/[^/]+\/review$/.test(a.chemin))).toBe(true));
    // La review s'ouvre dans le module Review vidéo.
    expect(await screen.findByTestId('esport-review-detail')).toBeTruthy();
    expect(screen.getByTestId('esport-review-nom').props.children).toBe('Faucons vs Nova');
  });

  it('VOD hors YouTube : le lien s’ouvre, mais pas en review', async () => {
    await monter(COACH, 'module:scouting', 'telephone');
    await fireEvent.changeText(await screen.findByTestId('esport-adversaire-nom'), 'Orion');
    await fireEvent.press(screen.getByTestId('esport-adversaire-creer'));
    await screen.findByTestId('esport-adversaire-detail');
    await fireEvent.changeText(screen.getByTestId('esport-vod-url'), 'https://www.twitch.tv/videos/123');
    await fireEvent.changeText(screen.getByTestId('esport-vod-titre'), 'Stream');
    await fireEvent.press(screen.getByTestId('esport-vod-ajouter'));
    await screen.findByText('Seules les vidéos YouTube s’ouvrent en review.');
    const bouton = (await screen.findByText('Ouvrir en review vidéo')).parent!;
    expect(bouton).toBeTruthy();
    await fireEvent.press(screen.getByText('Ouvrir le lien'));
    expect(ouvrir).toHaveBeenCalledWith('https://www.twitch.tv/videos/123');
  });

  it('Manager : lecture seule (aucun bouton de gestion)', async () => {
    const { adversaires } = await monter(MANAGER, 'module:scouting', 'telephone');
    expect(await screen.findByTestId('esport-scouting')).toBeTruthy();
    expect(screen.queryByTestId('esport-adversaire-nouveau')).toBeNull();
    expect(adversaires.length).toBe(0);
  });
});

describe('8 thèmes', () => {
  it('Review (liste et détail) et Scouting s’affichent dans chaque thème, sur téléphone', async () => {
    expect(THEMES_HUB.length).toBe(8);
    for (const t of THEMES_HUB) {
      const a = await monter(COACH, 'module:video_review', 'telephone', t);
      await fireEvent.press(await screen.findByTestId('esport-review-rv1'));
      expect(await screen.findByTestId('esport-review-detail')).toBeTruthy();
      await a.unmount();
      const b = await monter(COACH, 'module:scouting', 'telephone', t);
      expect(await screen.findByTestId('esport-scouting')).toBeTruthy();
      await b.unmount();
    }
  });
});

describe('planning : sélecteur d’adversaire du formulaire d’événement', () => {
  it('le Coach choisit l’adversaire (envoyé au serveur) ; sans scouting.view, pas de sélecteur', async () => {
    const permissions = [...COACH, 'planning.create', 'planning.update', 'planning.delete'];
    const p = fauxPlanning(permissions);
    const rs = fauxReviewScouting(permissions);
    await rs.requete('/teams/t1/scouting/adversaires', 'POST', { nom: 'Team Nova' });
    const requete = (async (chemin: string, methode?: string, corps?: unknown) => (/\/scouting\//.test(chemin) ? rs.requete(chemin, methode, corps) : p.requete(chemin, methode, corps))) as ClientEsport['requete'];
    const c = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, team: async () => detail(permissions), membres: async () => [], notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }), moi: async () => ({ compte: 'c', superAdmin: false, profil: null, peutCreerTeam: false }), requete } as unknown as ClientEsport;
    const { unmount } = await render(
      <ModeAffichageForce mode="large">
        <PageTeam theme={theme} client={c} teamId="t1" large sectionInitiale="module:planning" onQuitter={() => undefined} />
      </ModeAffichageForce>,
    );
    await fireEvent.press(await screen.findByTestId('esport-planning-nouveau'));
    await fireEvent.press(await screen.findByTestId('esport-formulaire-adversaire-a1'));
    await fireEvent.changeText(screen.getByTestId('esport-formulaire-titre'), 'Scrim vs Nova');
    await fireEvent.press(screen.getByTestId('esport-formulaire-enregistrer'));
    await waitFor(() => expect(p.appels.some(a => a.methode === 'POST' && a.chemin === '/teams/t1/planning')).toBe(true));
    expect(p.appels.find(a => a.methode === 'POST' && a.chemin === '/teams/t1/planning')?.corps).toMatchObject({ titre: 'Scrim vs Nova', adversaireId: 'a1' });
    await unmount();

    // Un rôle qui édite le planning sans voir le scouting : pas de sélecteur, et aucun appel au scouting.
    const sans = permissions.filter(x => !x.startsWith('scouting.'));
    const p2 = fauxPlanning(sans);
    const c2 = { ...c, team: async () => detail(sans), requete: p2.requete } as unknown as ClientEsport;
    await render(
      <ModeAffichageForce mode="large">
        <PageTeam theme={theme} client={c2} teamId="t1" large sectionInitiale="module:planning" onQuitter={() => undefined} />
      </ModeAffichageForce>,
    );
    await fireEvent.press(await screen.findByTestId('esport-planning-nouveau'));
    await screen.findByTestId('esport-formulaire');
    expect(screen.queryByTestId('esport-formulaire-adversaire-a1')).toBeNull();
    expect(p2.appels.some(a => /scouting/.test(a.chemin))).toBe(false);
  });
});
