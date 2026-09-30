import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AcceptationJuridique, LiensJuridiques, PageJuridique } from './PageJuridique';
import { PageSupport } from './PageSupport';
import { themeHub } from './themes';
import { ServiceSupport } from '../support/service';
import { infosTechniques } from '../support/tickets';
import { AVERTISSEMENT_JURIDIQUE, MODELES } from '../juridique/modele';

const theme = themeHub('nuit');
const infos = infosTechniques({ version: '1.0', plateforme: 'web', rang: 'ami', idCompte: 'abcdef999' });

function service(requete: typeof fetch) {
  let brut: string | undefined;
  return new ServiceSupport({ depot: { lire: () => brut, ecrire: v => void (brut = v) }, liaison: async () => ({ relais: 'https://r', jeton: 'j' }), technique: () => infos, requete });
}

describe('PageSupport', () => {
  it('envoie un ticket et l’affiche dans « Mes tickets »', async () => {
    const requete = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const s = service(requete as never);
    const ecran = await render(<PageSupport theme={theme} service={s} infos={infos} tickets={s.liste()} onFermer={() => undefined} />);
    expect(screen.getByTestId('support-aucun-ticket')).toBeTruthy();
    expect(screen.getByTestId('support-technique-detail').props.children).toContain('compte abcdef');
    await fireEvent.press(screen.getByTestId('support-categorie-bug'));
    await fireEvent.changeText(screen.getByTestId('support-sujet'), 'Écran blanc');
    await fireEvent.changeText(screen.getByTestId('support-message'), 'Au démarrage, l’écran reste blanc.');
    await fireEvent.press(screen.getByTestId('support-envoyer'));
    await ecran.rerender(<PageSupport theme={theme} service={s} infos={infos} tickets={s.liste()} onFermer={() => undefined} />);
    expect(requete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('support-resultat').props.children).toContain('Ticket n° 1 envoyé');
    expect(screen.getByTestId('support-ticket-1-statut').props.children).toBe('Envoyé');
  });

  it('refuse un ticket vide sans rien envoyer, et décocher les infos techniques le dit', async () => {
    const requete = jest.fn();
    const s = service(requete as never);
    await render(<PageSupport theme={theme} service={s} infos={infos} tickets={[]} onFermer={() => undefined} />);
    await fireEvent.press(screen.getByTestId('support-envoyer'));
    expect(screen.getByTestId('support-resultat')).toBeTruthy();
    expect(requete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('support-technique'));
    expect(screen.getByTestId('support-technique-detail').props.children).toBe('Aucune information technique ne sera jointe.');
  });

  it('hors ligne : le ticket est « en attente » et le dit', async () => {
    const s = service(jest.fn().mockRejectedValue(new Error('réseau')) as never);
    await render(<PageSupport theme={theme} service={s} infos={infos} tickets={[]} onFermer={() => undefined} />);
    await fireEvent.changeText(screen.getByTestId('support-sujet'), 'Question');
    await fireEvent.changeText(screen.getByTestId('support-message'), 'Comment relier mon téléphone ?');
    await fireEvent.press(screen.getByTestId('support-envoyer'));
    expect(screen.getByTestId('support-resultat').props.children).toContain('n° 1 enregistré');
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
