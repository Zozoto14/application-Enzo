import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Profil } from '../../profils/profils';
import { REGISTRE } from '../../hub/registre';
import { themeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { TsuzukuEcrans } from './Racine';
import { creerServices } from './services';

const theme = themeHub('nuit');

const media = (id: number, titre: string, extra: object = {}) => ({
  id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: `Synopsis de ${titre}`, episodes: 12, status: 'RELEASING', format: 'TV',
  seasonYear: 2025, averageScore: 85, popularity: 100, genres: ['Action'], coverImage: { extraLarge: `https://img-exemple.fr/${id}.jpg` }, studios: { nodes: [] }, externalLinks: [], ...extra,
});
const ANILIST = {
  trending: { media: [media(1, 'Frieren'), media(2, 'Dandadan')] },
  popular: { media: [media(3, 'One Piece')] },
  airing: { media: [] },
  topRated: { media: [] },
  movies: { media: [] },
};
const jikanAnime = (id: number, titre: string) => ({ mal_id: id, title: titre, title_english: titre, synopsis: `Synopsis de ${titre}`, images: { jpg: { image_url: `https://img-exemple.fr/${id}.jpg` } }, episodes: 12, status: 'Currently Airing', year: 2025, type: 'TV', genres: [{ name: 'Action' }], studios: [], streaming: [{ name: 'Plateforme légale', url: 'https://legal-exemple.fr/frieren' }] });
const jikanFilm = (id: number, titre: string) => ({ mal_id: id, title: titre, title_english: titre, synopsis: 'Un film.', images: { jpg: { image_url: 'https://img-exemple.fr/f.jpg' } }, type: 'Movie', year: 2016, duration: '107 min per ep', genres: [{ name: 'Drame' }], score: 8.4 });

function routes() {
  return {
    'https://graphql.anilist.co': json({ data: ANILIST }),
    'https://api.jikan.moe/v4/anime/1/full': json({ data: jikanAnime(1, 'Frieren') }),
    'https://api.jikan.moe/v4/anime/1/episodes': json({ data: [{ mal_id: 1, title: 'Le voyage' }, { mal_id: 2, title: 'Fern' }], pagination: { last_visible_page: 1 } }),
    'https://api.jikan.moe/v4/anime?q=Frieren': json({ data: [jikanAnime(1, 'Frieren')] }),
    'https://api.jikan.moe/v4/anime?type=movie&filter': json({ data: [jikanFilm(199, 'Your Name')], pagination: { current_page: 1, has_next_page: false } }),
    'https://api.jikan.moe/v4/top/anime?type=movie': json({ data: [jikanFilm(199, 'Your Name')], pagination: {} }),
    'https://api.jikan.moe/v4/anime?type=movie': json({ data: [jikanFilm(199, 'Your Name')], pagination: {} }),
    'https://api.jikan.moe/v4/anime/199/full': json({ data: jikanFilm(199, 'Your Name') }),
    'https://api.jikan.moe/v4/genres/anime': json({ data: [{ mal_id: 8, name: 'Drame' }] }),
    'https://exemple.fr/ep-5': html('<video src="https://cdn-exemple.fr/v5.mp4"></video>'),
  };
}

const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
const ami: Profil = { id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps: ['tsuzuku'], actif: true };

async function monter(o: { profil?: Profil; lecture?: boolean; stockage?: ReturnType<typeof stockageMemoire> } = {}) {
  const reseau = fauxReseau(routes());
  const stockage = o.stockage ?? stockageMemoire();
  const lecture = o.lecture ?? true;
  const services = creerServices({
    choix: { plateforme: lecture ? 'pc' : 'site', reseau, lectureSources: lecture },
    stockage,
    rang: (o.profil ?? admin).admin ? 'fondateur' : 'ami',
    catalogue: { attendre: attenteNulle },
  });
  const onRetour = jest.fn();
  const onParametres = jest.fn();
  const contexte: ContexteHub = { profil: o.profil ?? admin };
  const rendu = await render(<TsuzukuEcrans contexte={contexte} theme={theme} registre={REGISTRE} onRetour={onRetour} onParametres={onParametres} services={services} />);
  return { reseau, stockage, services, onRetour, onParametres, ...rendu };
}

const texte = (id: string, v: string) => fireEvent.changeText(screen.getByTestId(id), v);

describe('Tsuzuku : accueil et navigation', () => {
  it('montre les rangées animés du catalogue et revient au hub', async () => {
    const { onRetour, onParametres } = await monter();
    expect(await screen.findByText('Tendances du moment')).toBeTruthy();
    expect(screen.getByTestId('carte-anime-1')).toBeTruthy();
    expect(screen.getByTestId('rangee-popular')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retour-hub'));
    expect(onRetour).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('tsuzuku-reglages'));
    expect(onParametres).toHaveBeenCalledWith('tsuzuku');
  });

  it('cherche un animé puis ouvre sa fiche', async () => {
    await monter();
    await screen.findByText('Tendances du moment');
    await texte('accueil-recherche', 'Frieren');
    await fireEvent.press(screen.getByTestId('accueil-chercher'));
    expect(await screen.findByText('Résultats pour « Frieren »')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    expect(await screen.findByTestId('fiche-titre')).toBeTruthy();
    expect(screen.getByText('Synopsis de Frieren')).toBeTruthy();
    // Plateformes légales : de simples liens.
    expect(screen.getByTestId('liens-legaux')).toBeTruthy();
    expect(await screen.findByTestId('episode-2')).toBeTruthy();
  });

  it('affiche une erreur avec « Réessayer » quand le catalogue est injoignable', async () => {
    const reseau = fauxReseau({});
    const services = creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage: stockageMemoire(), estAdmin: true, catalogue: { attendre: attenteNulle } });
    await render(<TsuzukuEcrans contexte={{ profil: admin }} theme={theme} registre={REGISTRE} onRetour={() => undefined} services={services} />);
    expect(await screen.findByTestId('etat-erreur')).toBeTruthy();
    expect(screen.getByTestId('etat-reessayer')).toBeTruthy();
  });
});

describe('Tsuzuku : fiche, lien manuel, lecture, vu ailleurs, bibliothèque', () => {
  async function ouvrirFiche() {
    const m = await monter();
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    await screen.findByTestId('fiche-titre');
    return m;
  }

  it('lien manuel : motif {n} déduit de l’adresse d’un épisode, aperçu, enregistrement, lecture', async () => {
    const { services } = await ouvrirFiche();
    await fireEvent.press(screen.getByTestId('lien-anime-ouvrir'));
    await texte('lien-anime-adresse', 'https://exemple.fr/ep-5');
    await texte('lien-anime-episode', '5');
    await fireEvent.press(screen.getByTestId('lien-anime-analyser'));
    expect(screen.getByTestId('lien-anime-motif').props.value).toBe('https://exemple.fr/ep-{n}');
    expect(screen.getByTestId('apercu-5').props.children.join('')).toContain('https://exemple.fr/ep-5');
    expect(screen.getByTestId('apercu-6').props.children.join('')).toContain('https://exemple.fr/ep-6');
    await fireEvent.press(screen.getByTestId('lien-anime-enregistrer'));
    await waitFor(() => expect(screen.getByTestId('lien-anime-resume').props.children).toContain('https://exemple.fr/ep-{n}'));
    const db = await services.depot.lire();
    expect(db.manualSources.anime['1']).toMatchObject({ type: 'pattern', pattern: 'https://exemple.fr/ep-{n}' });

    // Lecture de l'épisode 5 : le lecteur direct est trouvé (sur téléphone : ouverture dans Safari).
    await fireEvent.press(screen.getByTestId('episode-2'));
    expect(await screen.findByTestId('lecteur-titre')).toBeTruthy();
  });

  it('lecture : ouvre le lecteur, note la progression et propose l’épisode suivant', async () => {
    const { services } = await ouvrirFiche();
    await services.depot.modifier(db => {
      db.manualSources = { anime: { '1': { type: 'pattern', pattern: 'https://exemple.fr/ep-{n}', padding: 0, offset: 0, overrides: {}, label: null, createdAt: '', updatedAt: '' } }, movies: {} };
    });
    await fireEvent.press(screen.getByTestId('fiche-lire'));
    // Épisode 1 : https://exemple.fr/ep-1 n'existe pas dans le faux réseau → page seule ; l'écran reste utilisable.
    expect(await screen.findByTestId('lecteur-titre')).toBeTruthy();
    await waitFor(async () => expect((await services.depot.lire()).anime[0]?.currentEpisode).toBe(1));
    expect((await services.depot.lire()).anime[0]).toMatchObject({ id: '1', status: 'en_cours', currentEpisode: 1 });
    await fireEvent.press(screen.getByTestId('lecteur-suivant'));
    await waitFor(async () => expect((await services.depot.lire()).anime[0]?.currentEpisode).toBe(2));
    expect(screen.getByTestId('lecteur-precedent')).toBeTruthy();
  });

  it('sans source ni lien : le lecteur explique quoi faire', async () => {
    await ouvrirFiche();
    await fireEvent.press(screen.getByTestId('fiche-lire'));
    expect(await screen.findByTestId('lecteur-message')).toBeTruthy();
    expect(screen.getByText(/Aucune source/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lecteur-vers-fiche'));
    expect(await screen.findByTestId('fiche-titre')).toBeTruthy();
  });

  it('« vu ailleurs » : compte l’animé comme vu, se retrouve dans l’onglet et les statistiques', async () => {
    const { services } = await ouvrirFiche();
    await fireEvent.press(screen.getByTestId('vu-ailleurs-ouvrir'));
    await texte('vu-ailleurs-date', '2025-12-25');
    await texte('vu-ailleurs-note', '9');
    await texte('vu-ailleurs-commentaire', 'Vu chez un ami');
    await fireEvent.press(screen.getByTestId('vu-ailleurs-enregistrer'));
    await waitFor(() => expect(screen.getByTestId('fiche-statut').props.children.join('')).toContain('Vu ailleurs'));
    const e = (await services.depot.lire()).anime[0];
    expect(e).toMatchObject({ status: 'vu_ailleurs', rating: 9, currentEpisode: 12 });
    expect(e.watchedElsewhere).toMatchObject({ date: '2025-12-25', comment: 'Vu chez un ami' });

    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    expect(await screen.findByTestId('bibliotheque-stats')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onglet-vu_ailleurs'));
    expect(screen.getByTestId('carte-anime-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onglet-a_voir'));
    expect(screen.queryByTestId('carte-anime-1')).toBeNull();
  });

  it('une date invalide est refusée avec un message', async () => {
    await ouvrirFiche();
    await fireEvent.press(screen.getByTestId('vu-ailleurs-ouvrir'));
    await texte('vu-ailleurs-date', 'hier');
    await fireEvent.press(screen.getByTestId('vu-ailleurs-enregistrer'));
    expect(await screen.findByText(/Date invalide/)).toBeTruthy();
  });

  it('ajoute à la bibliothèque, note, favori, retire', async () => {
    const { services } = await ouvrirFiche();
    await fireEvent.press(screen.getByTestId('statut-a_voir'));
    await waitFor(async () => expect((await services.depot.lire()).anime).toHaveLength(1));
    await fireEvent.press(await screen.findByTestId('note-8'));
    await fireEvent.press(screen.getByTestId('favori'));
    await waitFor(async () => expect((await services.depot.lire()).anime[0]).toMatchObject({ rating: 8, favorite: true, status: 'a_voir' }));
    await fireEvent.press(screen.getByTestId('retirer'));
    await waitFor(async () => expect((await services.depot.lire()).anime).toHaveLength(0));
  });

  it('la tuile « Reprendre » de l’accueil suit la bibliothèque', async () => {
    const { services } = await monter();
    await services.depot.modifier(db => {
      db.anime.push({ id: '1', kind: 'anime', title: 'Frieren', image: null, status: 'en_cours', currentEpisode: 3, totalEpisodes: 12, runtime: null, year: 2025, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: '2026-10-01', lastWatched: '2026-10-02' });
    });
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await fireEvent.press(screen.getByTestId('onglet-app-accueil'));
    expect(await screen.findByTestId('rangee-reprendre')).toBeTruthy();
  });
});

describe('Tsuzuku : films', () => {
  it('bascule en mode Films (cinéma sobre), catalogue Jikan sans clé TMDB, fiche, lien direct, lecture', async () => {
    const { services } = await monter();
    await fireEvent.press(screen.getByTestId('mode-movie'));
    expect(await screen.findByText(/Sans clé TMDB/)).toBeTruthy();
    await fireEvent.press((await screen.findAllByTestId('carte-movie-mal-199'))[0]);
    expect(await screen.findByTestId('fiche-titre')).toBeTruthy();
    expect(screen.getByTestId('tsuzuku-fiche-film')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lien-film-ouvrir'));
    await texte('lien-film-adresse', 'https://cdn-exemple.fr/yourname.mp4');
    await texte('lien-film-nom', 'Ma copie');
    await fireEvent.press(screen.getByTestId('lien-film-enregistrer'));
    await waitFor(async () => expect((await services.depot.lire()).manualSources.movies['mal-199']).toMatchObject({ url: 'https://cdn-exemple.fr/yourname.mp4', kind: 'video', label: 'Ma copie' }));
    await fireEvent.press(screen.getByTestId('fiche-lire'));
    expect(await screen.findByTestId('lecteur-titre')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('lecteur-marquer-vu'));
    await waitFor(async () => expect((await services.depot.lire()).movies[0]).toMatchObject({ id: 'mal-199', status: 'vu' }));
  });

  it('film vu ailleurs', async () => {
    const { services } = await monter();
    await fireEvent.press(screen.getByTestId('mode-movie'));
    await fireEvent.press((await screen.findAllByTestId('carte-movie-mal-199'))[0]);
    await screen.findByTestId('fiche-titre');
    await fireEvent.press(screen.getByTestId('vu-ailleurs-ouvrir'));
    expect(screen.queryByTestId('vu-ailleurs-episodes')).toBeNull();
    await fireEvent.press(screen.getByTestId('vu-ailleurs-enregistrer'));
    await waitFor(async () => expect((await services.depot.lire()).movies[0]).toMatchObject({ status: 'vu_ailleurs', kind: 'movie' }));
  });
});

describe('Tsuzuku : sur le site', () => {
  it('annonce que la lecture des sources n’y est pas disponible, et ne propose pas la lecture de page de série', async () => {
    await monter({ lecture: false });
    expect(await screen.findByTestId('tsuzuku-site')).toBeTruthy();
    expect(screen.getByText(/app PC\/iPhone/)).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    await screen.findByTestId('fiche-titre');
    await fireEvent.press(screen.getByTestId('lien-anime-ouvrir'));
    expect(screen.queryByTestId('lien-anime-serie')).toBeNull();
    // Sans source ni lien, le lecteur dit pourquoi.
    await fireEvent.press(screen.getByTestId('fiche-lire'));
    expect((await screen.findByTestId('lecteur-message')).props.children).toMatch(/app PC\/iPhone/);
  });
});

describe('Tsuzuku : rien de technique dans l’app, mention en pied de page', () => {
  it('aucun onglet « Sources » (ni pour le Fondateur ni pour un ami) : tout est dans Paramètres', async () => {
    await monter({ profil: ami });
    expect(screen.queryByTestId('onglet-app-sources')).toBeNull();
    expect(screen.queryByTestId('source-ajouter')).toBeNull();
  });

  it('pied de page honnête sur toutes les pages, avec « En savoir plus »', async () => {
    const { onParametres } = await monter();
    expect(screen.queryByTestId('onglet-app-sources')).toBeNull();
    const mention = await screen.findByTestId('tsuzuku-mention');
    expect(mention.props.children).toBe(
      'Tsuzuku n’héberge ni ne télécharge aucun contenu : il affiche des contenus fournis par des sources ajoutées par l’administrateur. Chacun est responsable de n’utiliser que des sources dont il a le droit de consulter les contenus (droit d’auteur).',
    );
    // Rien qui prétende que le service est légal ou que « ne rien télécharger » protège.
    expect(String(mention.props.children)).not.toMatch(/légal|protège|autorisé par la loi/i);
    for (const onglet of ['catalogue', 'bibliotheque', 'accueil']) {
      await fireEvent.press(screen.getByTestId(`onglet-app-${onglet}`));
      expect(screen.getByTestId('tsuzuku-pied')).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('tsuzuku-mention-plus'));
    expect(onParametres).toHaveBeenCalledWith('apropos');
  });
});

describe('Tsuzuku : import de l’ancienne bibliothèque (administrateur)', () => {
  const ancienne = {
    anime: [{ id: 21, title: 'One Piece', image: 'https://img-exemple.fr/op.jpg', status: 'en_cours', currentEpisode: 1000, totalEpisodes: null, rating: 9 }, { id: '', title: 'sans id' }],
    movies: [{ id: 'tmdb-603', title: 'Matrix', status: 'vu', year: 1999 }],
    history: [],
  };

  it('importe l’export de l’ancien Tsuzuku dans le profil courant, et le retrouve dans la bibliothèque', async () => {
    const { services } = await monter();
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await fireEvent.press(await screen.findByTestId('bibliotheque-importer'));
    await texte('import-texte', JSON.stringify(ancienne));
    await fireEvent.press(screen.getByTestId('import-valider'));
    expect((await screen.findByTestId('import-avis')).props.children).toMatch(/Importé : 1 animé\(s\), 1 film\(s\)\./);
    const db = await services.depot.lire();
    expect(db.anime[0]).toMatchObject({ id: '21', title: 'One Piece', status: 'en_cours', currentEpisode: 1000, rating: 9 });
    expect(db.movies[0]).toMatchObject({ id: 'tmdb-603', status: 'vu' });
    await fireEvent.press(screen.getByTestId('import-vers-bibliotheque'));
    expect(await screen.findByTestId('carte-anime-21')).toBeTruthy();
  });

  it('accepte le format backend/data/libraries/{userId}.json (ancienne version, sans « version »)', async () => {
    const { services } = await monter();
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await fireEvent.press(await screen.findByTestId('bibliotheque-importer'));
    await texte('import-texte', JSON.stringify({ anime: [{ id: 5114, title: 'FMA', status: 'vu', watchedAt: '2024-01-02' }], manualSources: { anime: {}, movies: {} } }));
    await fireEvent.press(screen.getByTestId('import-valider'));
    await screen.findByTestId('import-avis');
    expect((await services.depot.lire()).anime[0]).toMatchObject({ id: '5114', status: 'vu' });
  });

  it('remplacement : efface l’existant ; fusion : le garde', async () => {
    const { services } = await monter();
    await services.depot.modifier(db => {
      db.anime.push({ id: '9', kind: 'anime', title: 'Déjà là', image: null, status: 'a_voir', currentEpisode: 0, totalEpisodes: null, runtime: null, year: null, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: null, lastWatched: null });
    });
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await fireEvent.press(await screen.findByTestId('bibliotheque-importer'));
    await texte('import-texte', JSON.stringify(ancienne));
    await fireEvent.press(screen.getByTestId('import-valider'));
    await screen.findByTestId('import-avis');
    expect((await services.depot.lire()).anime.map(e => e.id).sort()).toEqual(['21', '9']);
    await texte('import-texte', JSON.stringify(ancienne));
    await fireEvent.press(screen.getByTestId('import-remplacement'));
    await fireEvent.press(screen.getByTestId('import-valider'));
    await waitFor(async () => expect((await services.depot.lire()).anime.map(e => e.id)).toEqual(['21']));
  });

  it('refuse un JSON illisible sans rien effacer', async () => {
    const { services } = await monter();
    await services.depot.modifier(db => {
      db.movies.push({ id: 'tmdb-1', kind: 'movie', title: 'Garde-moi', image: null, status: 'vu', currentEpisode: 0, totalEpisodes: null, runtime: null, year: null, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: null, lastWatched: null });
    });
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await fireEvent.press(await screen.findByTestId('bibliotheque-importer'));
    await fireEvent.press(screen.getByTestId('import-remplacement'));
    await texte('import-texte', '{oups');
    await fireEvent.press(screen.getByTestId('import-valider'));
    expect(await screen.findByTestId('import-avis')).toBeTruthy();
    expect((await services.depot.lire()).movies).toHaveLength(1);
  });

  it('un ami n’a pas le bouton d’import, et l’écran lui est refusé', async () => {
    await monter({ profil: ami });
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await screen.findByTestId('tsuzuku-bibliotheque');
    expect(screen.queryByTestId('bibliotheque-importer')).toBeNull();
  });

  it('exporte la bibliothèque au format réimportable', async () => {
    const { services } = await monter();
    await services.depot.modifier(db => {
      db.movies.push({ id: 'tmdb-1', kind: 'movie', title: 'Dune', image: null, status: 'vu', currentEpisode: 0, totalEpisodes: null, runtime: 155, year: 2021, rating: 8, favorite: false, comment: null, watchedElsewhere: null, dateAdded: '2026-01-01', lastWatched: null });
    });
    await fireEvent.press(screen.getByTestId('mode-movie'));
    await fireEvent.press(screen.getByTestId('onglet-app-bibliotheque'));
    await fireEvent.press(await screen.findByTestId('bibliotheque-exporter'));
    const brut = (await screen.findByTestId('bibliotheque-export-texte')).props.value as string;
    expect(JSON.parse(brut)).toMatchObject({ app: 'tsuzuku', movies: [{ id: 'tmdb-1', title: 'Dune' }] });
  });
});
