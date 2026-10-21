/**
 * Administration › Support (réponse du Fondateur, e-mail facultatif, renvoi Discord), Administration ›
 * Messagerie (e-mails envoyés par le serveur, historique) et envoi direct d'une invitation, contre un
 * faux relais (les vraies routes sont testées dans relais/*.test.mjs).
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { liaisonCourriel } from '../../../messagerie/courriel';
import type { Profil } from '../../../profils/profils';
import { ModeAffichageForce } from '../../../ui/mobile';
import { donneesVides, type DonneesAdmin } from '../donnees';
import { themeHub } from '../../themes';
import type { OutilsAdmin } from './commun';
import { PanneauInvitation } from './EnvoiInvitation';
import { Messagerie } from './Messagerie';
import { SupportAdmin } from './Support';
import { fabrique } from '../../../esport/fabrique';

const theme = themeHub('nuit');
const relaisReel = liaisonCourriel.relais;
const requeteReelle = liaisonCourriel.requete;
const relaisEsport = fabrique.relais;

type Appel = { url: string; methode: string; corps?: Record<string, unknown> };

function fauxRelais({ smtp = true }: { smtp?: boolean } = {}) {
  const appels: Appel[] = [];
  const journal: unknown[] = [];
  let ticket: Record<string, unknown> = { id: '0123456789abcdef', numero: 7, compte: 'lea0000001', auteur: 'Léa', categorie: 'bug', titre: 'Écran blanc', message: 'Au **démarrage**.', statut: 'ouvert', cree: '2026-10-21T10:00:00Z', technique: { app: 'portefeuille', version: '1.0', langue: 'en' }, messages: [], nonLus: 0, discord: 'echec' };
  const requete = jest.fn(async (url: string, init?: RequestInit) => {
    const methode = init?.method ?? 'GET';
    const corps = init?.body ? JSON.parse(String(init.body)) : undefined;
    appels.push({ url, methode, corps });
    const json = (c: unknown, statut = 200) => new Response(JSON.stringify(c), { status: statut });
    if (url.endsWith('/support/tickets?tous=1')) return json({ tickets: [ticket], discord: 'absent', mode: null });
    if (url.endsWith('/support/etat')) return json({ webhook: 'absent', mode: null, bot: false, dernierEnvoi: null, courriel: smtp });
    if (url.endsWith('/messages')) {
      ticket = { ...ticket, statut: corps.statut, messages: [{ id: 'r1', de: 'equipe', texte: corps.texte, date: '2026-10-21T12:00:00Z' }] };
      return json({ ok: true, ticket, discord: false, ...(corps.courriel ? { courriel: { ok: true } } : {}) });
    }
    if (url.endsWith('/discord')) {
      ticket = { ...ticket, discord: 'envoye' };
      return json({ ok: true, ticket, discord: true });
    }
    if (url.endsWith('/courriel/etat')) return json({ configure: smtp });
    if (url.endsWith('/courriel/journal')) return json({ envois: journal });
    if (url.endsWith('/courriel/envoyer')) {
      if (!smtp) return json({ erreur: 'non configuré', motif: 'non-configure' }, 503);
      const resultats = corps.destinataires.map((d: { adresse: string }) => ({ a: `${d.adresse[0]}***`, statut: 'envoye' }));
      journal.unshift({ id: 'e1', date: '2026-10-21T12:00:00Z', modele: corps.modele, objet: corps.variables.objet, resultats });
      return json({ ok: true, envoyes: resultats.length, resultats });
    }
    return json({}, 404);
  });
  return { requete, appels };
}

function outils(): OutilsAdmin & { journal: unknown[] } {
  const donnees: DonneesAdmin = { ...donneesVides(), contacts: { lea0000001: { email: 'lea@exemple.fr', envois: [] }, tom0000002: { email: 'tom@exemple.com', envois: [] } } };
  const tous: Profil[] = [
    { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' },
    { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '' },
    { id: 'tom0000002', nom: 'Tom', admin: false, creeLe: '' },
    { id: 'sam0000003', nom: 'Sam', admin: false, creeLe: '' },
  ];
  const journal: unknown[] = [];
  return {
    theme,
    donnees,
    tous,
    controle: { tous, actuel: tous[0] } as never,
    journaliser: (e: unknown) => void journal.push(e),
    journal,
  } as unknown as OutilsAdmin & { journal: unknown[] };
}

const monter = (element: React.ReactElement) => render(<ModeAffichageForce mode="large">{element}</ModeAffichageForce>);

afterEach(() => {
  liaisonCourriel.relais = relaisReel;
  liaisonCourriel.requete = requeteReelle;
  fabrique.relais = relaisEsport;
});

function brancher(r: ReturnType<typeof fauxRelais>) {
  liaisonCourriel.relais = () => ({ relais: 'https://relais.test', jeton: 'jeton-maitre-de-test-0123456789' });
  liaisonCourriel.requete = () => r.requete as never;
  // Pas d'Esport dans ces tests (Messagerie le lit seulement pour proposer les teams).
  fabrique.relais = () => undefined;
}

describe('Administration › Support', () => {
  jest.setTimeout(30_000);
  it('liste les demandes, diagnostic du webhook, réponse (app + e-mail), renvoi Discord', async () => {
    const r = fauxRelais();
    brancher(r);
    const o = outils();
    await monter(<SupportAdmin outils={o} />);
    expect(await screen.findByTestId('admin-support-diagnostic')).toHaveTextContent(/ABSENT/);
    await fireEvent.press(await screen.findByTestId('admin-support-ticket-7'));
    expect(screen.getByTestId('admin-support-detail')).toHaveTextContent(/De Léa/);
    await fireEvent.changeText(screen.getByTestId('admin-support-reponse'), 'C’est corrigé, merci !');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-support-repondre'));
      await new Promise<void>(res => setTimeout(res, 20));
    });
    const envoi = r.appels.find(a => a.url.endsWith('/messages'));
    expect(envoi?.corps).toEqual({ texte: 'C’est corrigé, merci !', statut: 'repondu', courriel: { adresse: 'lea@exemple.fr', langue: 'en' } });
    expect(await screen.findByTestId('admin-support-retour')).toHaveTextContent(/e-mail envoyé/);
    expect(screen.getByTestId('admin-support-message-equipe')).toBeTruthy();
    expect(o.journal).toEqual([expect.objectContaining({ type: 'support', cible: 'lea0000001' })]);
    expect(JSON.stringify(o.journal)).not.toContain('lea@exemple.fr');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-support-discord'));
      await new Promise<void>(res => setTimeout(res, 20));
    });
    expect(screen.getByTestId('admin-support-retour')).toHaveTextContent(/annoncée sur Discord/);
  });
});

describe('Administration › Messagerie', () => {
  jest.setTimeout(30_000);
  it('écrit à plusieurs utilisateurs (adresses des fiches), envoi par le serveur, historique', async () => {
    const r = fauxRelais();
    brancher(r);
    const o = outils();
    await monter(<Messagerie outils={o} />);
    expect(await screen.findByTestId('admin-messagerie-pret')).toBeTruthy();
    expect(screen.queryByTestId('admin-messagerie-dest-sam0000003')).toBeNull();
    await fireEvent.press(screen.getByTestId('admin-messagerie-dest-lea0000001'));
    await fireEvent.press(screen.getByTestId('admin-messagerie-dest-tom0000002'));
    await fireEvent.press(screen.getByTestId('admin-messagerie-langue-en'));
    await fireEvent.changeText(screen.getByTestId('admin-messagerie-objet'), 'Tournament');
    await fireEvent.changeText(screen.getByTestId('admin-messagerie-message'), '**Saturday** 2 pm');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-messagerie-envoyer'));
      await new Promise<void>(res => setTimeout(res, 20));
    });
    const envoi = r.appels.find(a => a.url.endsWith('/courriel/envoyer'));
    expect(envoi?.corps).toMatchObject({
      modele: 'libre',
      langue: 'en',
      destinataires: [
        { adresse: 'lea@exemple.fr', nom: 'Léa', langue: 'en' },
        { adresse: 'tom@exemple.com', nom: 'Tom', langue: 'en' },
      ],
      variables: { objet: 'Tournament', message: '**Saturday** 2 pm' },
    });
    expect(await screen.findByTestId('admin-messagerie-retour')).toHaveTextContent(/2 e-mails envoyés/);
    await waitFor(() => expect(screen.getByTestId('admin-messagerie-envoi-e1')).toHaveTextContent(/Tournament/));
    expect(JSON.stringify(o.journal)).not.toMatch(/@exemple/);
  });

  it('sans SMTP sur le serveur : avertissement et secours « Ouvrir ma messagerie »', async () => {
    brancher(fauxRelais({ smtp: false }));
    await monter(<Messagerie outils={outils()} />);
    expect(await screen.findByTestId('admin-messagerie-non-configure')).toHaveTextContent(/SMTP_HOST/);
    await fireEvent.press(screen.getByTestId('admin-messagerie-dest-lea0000001'));
    await fireEvent.changeText(screen.getByTestId('admin-messagerie-objet'), 'Salut');
    await fireEvent.changeText(screen.getByTestId('admin-messagerie-message'), 'Bonjour');
    expect(screen.getByTestId('admin-messagerie-mailto')).toBeTruthy();
    expect(screen.getByTestId('admin-messagerie-envoyer').props.accessibilityState?.disabled).toBe(true);
  });
});

describe('Invitation envoyée directement', () => {
  jest.setTimeout(30_000);
  const invitation = { lien: 'https://appdashboard.fr/#invitation=AI1.secret', expire: '2026-10-28T10:00:00Z', prenom: 'Léa', fondateur: 'Enzo', longueur: 10, publie: true };
  it('SMTP configuré : bouton « Envoyer l’e-mail maintenant », FR ou EN, mailto en secours', async () => {
    const r = fauxRelais();
    brancher(r);
    const envoyes: string[] = [];
    await monter(<PanneauInvitation theme={theme} nom="Léa" invitation={invitation} email="lea@exemple.fr" onEnvoye={c => envoyes.push(c)} />);
    await fireEvent.press(await screen.findByTestId('admin-invitation-langue-en'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-invitation-envoyer-direct'));
      await new Promise<void>(res => setTimeout(res, 20));
    });
    const envoi = r.appels.find(a => a.url.endsWith('/courriel/envoyer'));
    expect(envoi?.corps).toMatchObject({ modele: 'invitation', langue: 'en', destinataires: [{ adresse: 'lea@exemple.fr', nom: 'Léa', langue: 'en' }], variables: { lien: invitation.lien } });
    expect((envoi?.corps as { variables: { objet: string; message: string } }).variables.objet).toMatch(/invites you/);
    expect((envoi?.corps as { variables: { message: string } }).variables.message).toContain(invitation.lien);
    expect(screen.getByTestId('admin-invitation-copie')).toHaveTextContent(/E-mail d’invitation envoyé à lea@exemple\.fr/);
    expect(envoyes).toEqual(['email']);
    expect(screen.getByTestId('admin-invitation-email')).toHaveTextContent('Ouvrir ma messagerie');
  });

  it('sans SMTP : seulement le mailto (comme avant)', async () => {
    brancher(fauxRelais({ smtp: false }));
    await monter(<PanneauInvitation theme={theme} nom="Léa" invitation={invitation} email="lea@exemple.fr" />);
    await waitFor(() => expect(screen.getByTestId('admin-invitation-email')).toHaveTextContent(/Envoyer l’invitation par e-mail/));
    expect(screen.queryByTestId('admin-invitation-envoyer-direct')).toBeNull();
  });
});
