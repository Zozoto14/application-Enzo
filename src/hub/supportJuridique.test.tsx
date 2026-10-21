import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AcceptationJuridique, LiensJuridiques, PageJuridique } from './PageJuridique';
import { PageSupport } from './PageSupport';
import { themeHub } from './themes';
import { ServiceSupport } from '../support/service';
import { infosTechniques } from '../support/tickets';
import { AVERTISSEMENT_JURIDIQUE, MODELES } from '../juridique/modele';

const theme = themeHub('nuit');
const infos = infosTechniques({ version: '1.0', plateforme: 'web', rang: 'ami', app: 'portefeuille', langue: 'fr', appareil: 'PC (app)' });

/** Faux relais : POST /support rend la demande rangée ; GET /support/tickets la liste (avec la réponse du Fondateur si `repondu`). */
function fauxRelais({ hors = false, repondu = false } = {}) {
  const appels: Array<{ url: string; methode: string; corps?: unknown }> = [];
  let vue: Record<string, unknown> | undefined;
  let lu = false;
  const reponse = [{ id: 'm1', de: 'equipe', texte: 'C’est **corrigé** !', date: '2026-10-21T11:00:00Z' }];
  const vueCourante = () => (repondu ? { ...vue, statut: 'repondu', nonLus: lu ? 0 : 1, messages: reponse } : vue);
  const requete = jest.fn(async (url: string, init?: RequestInit) => {
    const methode = init?.method ?? 'GET';
    appels.push({ url, methode, corps: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (hors) throw new Error('réseau');
    if (url.endsWith('/support') && methode === 'POST') {
      const c = JSON.parse(String(init!.body));
      vue = { id: '0123456789abcdef', numero: 42, categorie: c.categorie, titre: c.titre, message: c.message, statut: 'ouvert', cree: '2026-10-21T10:00:00Z', messages: [], nonLus: 0 };
      return new Response(JSON.stringify({ ok: true, ticket: vue }), { status: 200 });
    }
    if (url.includes('/support/tickets/') && url.endsWith('/lu')) {
      lu = true;
      return new Response(JSON.stringify({ ok: true, ticket: vueCourante() }), { status: 200 });
    }
    if (url.endsWith('/support/tickets')) {
      return new Response(JSON.stringify({ tickets: vue ? [vueCourante()] : [] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  return { requete, appels };
}

function service(requete: typeof fetch) {
  let brut: string | undefined;
  return new ServiceSupport({ depot: { lire: () => brut, ecrire: v => void (brut = v) }, liaison: async () => ({ relais: 'https://r', jeton: 'j' }), technique: () => infos, auteur: () => 'Léa', requete });
}

describe('PageSupport', () => {
  // Premier rendu de l'éditeur riche (ChampNote) : chargement des modules un peu long sous Jest.
  jest.setTimeout(30_000);
  it('envoie une demande (catégorie, titre, message riche, infos techniques) et l’affiche dans « Mes demandes »', async () => {
    const r = fauxRelais();
    const s = service(r.requete as never);
    const ecran = await render(<PageSupport theme={theme} service={s} infos={infos} tickets={s.liste()} onFermer={() => undefined} />);
    expect(screen.getByTestId('support-aucun-ticket')).toBeTruthy();
    expect(screen.getByTestId('support-technique-detail').props.children).toContain('appareil PC (app), app portefeuille');
    for (const c of ['bug', 'idee', 'question', 'compte']) expect(screen.getByTestId(`support-categorie-${c}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('support-categorie-bug'));
    await fireEvent.changeText(screen.getByTestId('support-titre'), 'Écran blanc');
    await fireEvent.changeText(screen.getByTestId('support-message'), 'Au démarrage, l’écran reste **blanc**.');
    await fireEvent.press(screen.getByTestId('support-envoyer'));
    await ecran.rerender(<PageSupport theme={theme} service={s} infos={infos} tickets={s.liste()} onFermer={() => undefined} />);
    const envoi = r.appels.find(a => a.methode === 'POST');
    expect(envoi?.corps).toMatchObject({ categorie: 'bug', titre: 'Écran blanc', auteur: 'Léa', technique: { app: 'portefeuille', version: '1.0' } });
    expect(screen.getByTestId('support-resultat').props.children).toContain('Demande n° 42 envoyée');
    expect(screen.getByTestId('support-ticket-1-statut').props.children).toBe('Ouverte');
  });

  it('refuse une demande vide sans rien envoyer, et décocher les infos techniques le dit', async () => {
    const r = fauxRelais();
    const s = service(r.requete as never);
    await render(<PageSupport theme={theme} service={s} infos={infos} tickets={[]} onFermer={() => undefined} />);
    await fireEvent.press(screen.getByTestId('support-envoyer'));
    expect(screen.getByTestId('support-resultat')).toBeTruthy();
    expect(r.appels.some(a => a.methode === 'POST')).toBe(false);
    await fireEvent.press(screen.getByTestId('support-technique'));
    expect(screen.getByTestId('support-technique-detail').props.children).toBe('Aucune information technique ne sera jointe.');
  });

  it('hors ligne : la demande est « en attente » et le dit', async () => {
    const s = service(fauxRelais({ hors: true }).requete as never);
    await render(<PageSupport theme={theme} service={s} infos={infos} tickets={[]} onFermer={() => undefined} />);
    await fireEvent.changeText(screen.getByTestId('support-titre'), 'Question');
    await fireEvent.changeText(screen.getByTestId('support-message'), 'Comment relier mon téléphone ?');
    await fireEvent.press(screen.getByTestId('support-envoyer'));
    expect(screen.getByTestId('support-resultat').props.children).toContain('n° 1 enregistrée');
  });

  it('la réponse du Fondateur arrive : notification, conversation, puis lue', async () => {
    const r = fauxRelais({ repondu: true });
    const s = service(r.requete as never);
    await s.creer({ categorie: 'question', titre: 'Synchro', message: 'Comment synchroniser ?', inclureTechnique: true });
    expect(await s.synchroniser()).toBe(1);
    expect(s.nonLus).toBe(1);
    await render(<PageSupport theme={theme} service={s} infos={infos} tickets={s.liste()} onFermer={() => undefined} />);
    expect(screen.getByTestId('support-ticket-1-nouveau')).toBeTruthy();
    expect(screen.getByTestId('support-ticket-1-statut').props.children).toBe('Répondu');
    expect(screen.getByTestId('support-ticket-1-message-equipe')).toBeTruthy();
    await waitFor(() => expect(r.appels.some(a => a.url.endsWith('/lu'))).toBe(true));
    expect(s.nonLus).toBe(0);
  });
});

describe('PageJuridique', () => {
  it('liste les quatre documents, ouvre un texte et porte l’avertissement', async () => {
    await render(<PageJuridique theme={theme} onFermer={() => undefined} />);
    expect(screen.getByTestId('juridique-avertissement').props.children).toBe(AVERTISSEMENT_JURIDIQUE);
    for (const id of ['conditions', 'confidentialite', 'cookies', 'mentions']) expect(screen.getByTestId(`juridique-ouvrir-${id}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('juridique-ouvrir-cookies'));
    expect(screen.getByText('Cookies et stockage local')).toBeTruthy();
    expect(screen.getByTestId('juridique-texte')).toBeTruthy();
    expect(screen.queryByTestId('juridique-modifier')).toBeNull();
  });

  it('un Fondateur modifie puis rétablit un texte (révision enregistrée)', async () => {
    const onEnregistrer = jest.fn().mockResolvedValue(undefined);
    await render(<PageJuridique theme={theme} idInitial="mentions" onEnregistrer={onEnregistrer} nomEditeur="Zoé" maintenant={() => new Date('2026-10-06T10:00:00Z')} onFermer={() => undefined} />);
    await fireEvent.press(screen.getByTestId('juridique-modifier'));
    expect(screen.getByTestId('juridique-edition').props.value).toBe(MODELES.mentions);
    await fireEvent.changeText(screen.getByTestId('juridique-edition'), '## Éditeur\n\nZoé Dupont');
    await fireEvent.press(screen.getByTestId('juridique-enregistrer'));
    expect(onEnregistrer).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, par: 'Zoé', documents: { mentions: '## Éditeur\n\nZoé Dupont' } }));
  });
});

describe('AcceptationJuridique', () => {
  it('« Continuer » exige la case cochée ; « Refuser » verrouille', async () => {
    const onAccepter = jest.fn();
    const onRefuser = jest.fn();
    await render(<AcceptationJuridique theme={theme} nouvelleVersion={false} onAccepter={onAccepter} onLire={() => undefined} onRefuser={onRefuser} />);
    await fireEvent.press(screen.getByTestId('acceptation-continuer'));
    expect(onAccepter).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('acceptation-case'));
    await fireEvent.press(screen.getByTestId('acceptation-continuer'));
    expect(onAccepter).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('acceptation-refuser'));
    expect(onRefuser).toHaveBeenCalled();
  });

  it('version changée : le titre le dit', async () => {
    await render(<AcceptationJuridique theme={theme} nouvelleVersion onAccepter={() => undefined} onLire={() => undefined} onRefuser={() => undefined} />);
    expect(screen.getByText('Nos documents ont changé')).toBeTruthy();
  });
});

describe('LiensJuridiques', () => {
  it('quatre liens', async () => {
    const onOuvrir = jest.fn();
    await render(<LiensJuridiques theme={theme} onOuvrir={onOuvrir} />);
    await fireEvent.press(screen.getByTestId('lien-juridique-conditions'));
    expect(onOuvrir).toHaveBeenCalledWith('conditions');
  });
});
