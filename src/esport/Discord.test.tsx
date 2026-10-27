/**
 * Esport, phase 4 (interface) : écran Discord réservé à discord.manage,
 * webhook affiché masqué (jamais l'adresse), message de test, réglage de
 * chaque notification (activation, modèle, rôle), erreurs du serveur,
 * libellés du journal.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, ErreurEsport, type ClientEsport, type DetailTeam } from './client';
import { LIBELLES_DISCORD, apiDiscord, type EtatBot, type EtatDiscord, type ParametreDiscord } from './discord/api';
import { phraseJournal } from './libelles';
import { LierDiscord, PageTeam, entreesBarre } from './ui/PageTeam';

const theme = themeHub('nuit');
const URL_SECRETE = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd';

const detail = (permissions: string[], modules = ['discord', 'planning', 'activity_log']): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Manager', couleur: '#7c3aed', cle: 'manager' }, permissions, superAdmin: false },
});
const MANAGER = ['members.view', 'planning.view', 'discord.manage'];

const parametre = (cle: string, libelle: string, extra: Partial<ParametreDiscord> = {}): ParametreDiscord => ({
  cle,
  libelle,
  description: `Description de ${libelle}`,
  modules: [],
  disponible: true,
  actif: true,
  modele: `Modèle de ${libelle} : {titre}`,
  modeleDefaut: `Modèle de ${libelle} : {titre}`,
  personnalise: false,
  roleMention: null,
  variables: [{ nom: 'titre', description: 'Titre' }],
  apercu: `Aperçu de ${libelle}`,
  ...extra,
});

function etatInitial(): EtatDiscord {
  return {
    webhook: { configure: false },
    parametres: [
      parametre('event_created', 'Nouvel événement au planning'),
      parametre('rsvp_missing', 'RSVP manquant', { actif: false }),
      parametre('review_created', 'Review créée', { disponible: false, actif: false, modules: ['video_review'] }),
    ],
    file: { enAttente: 0, abandonnes: 0 },
    envois: [],
  };
}

function fauxServeur(surcharge: (chemin: string, methode: string, corps: unknown) => unknown = () => undefined) {
  let etat = etatInitial();
  let bot: EtatBot = {
    disponible: true,
    invitation: 'https://discord.com/oauth2/authorize?client_id=424242424242424242&scope=bot%20applications.commands&permissions=150528',
    serveur: { serveur: '7000…0001', salon: '7100…0001', salonNom: 'annonces', lieLe: '2026-10-20T10:00:00.000Z', majLe: '2026-10-20T10:00:00.000Z', dernierSucces: null, dernierEchec: null, invalide: false },
    pings: [
      { type: 'scrim', libelle: 'Scrim', ping: true },
      { type: 'match', libelle: 'Match', ping: true },
    ],
    comptes: [
      { compte: 'lea12345', pseudo: 'Léa', role: 'Joueur', lie: true, discordNom: 'lea#0', lieLe: '2026-10-20T10:00:00.000Z' },
      { compte: 'tom12345', pseudo: 'Tom', role: 'Remplaçant', lie: false, discordNom: null, lieLe: null },
    ],
  };
  const appels: Array<{ chemin: string; methode: string; corps: unknown }> = [];
  const requete = jest.fn(async (chemin: string, methode = 'GET', corps?: unknown) => {
    appels.push({ chemin, methode, corps });
    const special = surcharge(chemin, methode, corps);
    if (special !== undefined) return special;
    if (chemin.endsWith('/discord/webhook') && methode === 'PUT') {
      etat = { ...etat, webhook: { configure: true, masque: '…/abcd', invalide: false } };
      return etat.webhook;
    }
    if (chemin.endsWith('/discord/webhook') && methode === 'DELETE') {
      etat = { ...etat, webhook: { configure: false } };
      return { ok: true };
    }
    if (chemin.endsWith('/discord/test')) return { ok: true };
    // Bot Discord.
    if (chemin.endsWith('/discord/bot/code')) return { code: 'ABCD-EFGH', expire: new Date(Date.now() + 600_000).toISOString(), commande: '/esport-lier-serveur code:ABCD-EFGH' };
    const ping = /\/discord\/bot\/pings\/([a-z]+)$/.exec(chemin);
    if (ping) {
      bot = { ...bot, pings: bot.pings.map(x => (x.type === ping[1] ? { ...x, ping: (corps as { ping: boolean }).ping } : x)) };
      return { pings: bot.pings };
    }
    if (chemin.endsWith('/discord/bot/serveur') && methode === 'DELETE') {
      bot = { ...bot, serveur: null };
      return { ok: true };
    }
    if (chemin.endsWith('/discord/bot')) return bot;
    const p = /\/discord\/parametres\/([a-z_0-9]+)$/.exec(chemin);
    if (p) {
      const c = corps as { actif?: boolean; modele?: string | null; roleMention?: string | null };
      etat = {
        ...etat,
        parametres: etat.parametres.map(x =>
          x.cle !== p[1]
            ? x
            : { ...x, ...(c.actif !== undefined ? { actif: c.actif } : {}), ...(c.modele !== undefined ? { personnalise: c.modele !== null, modele: c.modele ?? x.modeleDefaut } : {}), ...(c.roleMention !== undefined ? { roleMention: c.roleMention } : {}) },
        ),
      };
      return etat.parametres.find(x => x.cle === p[1]);
    }
    return etat;
  });
  return { requete: requete as unknown as ClientEsport['requete'], appels };
}

let detailCourant: DetailTeam;

function fauxClient(requete: ClientEsport['requete']): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detailCourant,
      moi: async () => ({ compte: 'max12345', superAdmin: false, profil: { pseudo: 'Max', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      membres: async () => [],
      requete,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}

async function monter(requete: ClientEsport['requete'], d: DetailTeam, mode: 'large' | 'telephone' = 'large') {
  detailCourant = d;
  return render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={theme} client={fauxClient(requete)} teamId="t1" large={mode === 'large'} sectionInitiale="module:discord" onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
}

describe('accès à l’écran Discord', () => {
  it('l’entrée « Discord » n’existe que pour discord.manage et module activé', () => {
    expect(entreesBarre(detail(MANAGER)).map(x => x.id)).toContain('module:discord');
    expect(entreesBarre(detail(MANAGER)).find(x => x.id === 'module:discord')?.bientot).toBe(false);
    expect(entreesBarre(detail(['members.view', 'planning.view'])).map(x => x.id)).not.toContain('module:discord');
    expect(entreesBarre(detail(MANAGER, ['planning'])).map(x => x.id)).not.toContain('module:discord');
  });

  it('le client appelle les bonnes routes, l’adresse ne part que dans la saisie du webhook', async () => {
    const { requete, appels } = fauxServeur();
    const api = apiDiscord(fauxClient(requete), 't 1');
    await api.etat();
    await api.definirWebhook(URL_SECRETE);
    await api.tester();
    await api.majParametre('event_created', { actif: false });
    await api.supprimerWebhook();
    expect(appels.map(a => `${a.methode} ${a.chemin}`)).toEqual([
      'GET /teams/t%201/discord',
      'PUT /teams/t%201/discord/webhook',
      'POST /teams/t%201/discord/test',
      'PUT /teams/t%201/discord/parametres/event_created',
      'DELETE /teams/t%201/discord/webhook',
    ]);
    expect(appels.filter(a => JSON.stringify(a.corps ?? '').includes('abcd')).length).toBe(1);
  });
});

describe('bot Discord dans l’écran Discord', () => {
  it('serveur lié, code de liaison, ping par type, qui est lié, délier', async () => {
    const { requete, appels } = fauxServeur();
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-bot-serveur');
    expect(screen.getByText(/annonces dans #annonces/)).toBeTruthy();
    expect(screen.getByText(/Comptes Discord liés : 1 \/ 2/)).toBeTruthy();
    expect(screen.getByTestId('esport-bot-compte-tom12345').props.children.join('')).toMatch(/pas lié/);
    await fireEvent.press(screen.getByTestId('esport-bot-lier'));
    expect((await screen.findByTestId('esport-bot-code-code')).props.children).toBe('ABCD-EFGH');
    expect(screen.getByText(/\/esport-lier-serveur code:ABCD-EFGH/)).toBeTruthy();
    await fireEvent(screen.getByTestId('esport-bot-ping-scrim'), 'onChanger', false);
    await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && a.chemin.endsWith('/discord/bot/pings/scrim') && JSON.stringify(a.corps) === '{"ping":false}')).toBe(true));
    await fireEvent.press(screen.getByTestId('esport-bot-delier'));
    await fireEvent.press(screen.getByTestId('esport-bot-delier-confirmer'));
    await waitFor(() => expect(screen.queryByTestId('esport-bot-serveur')).toBeNull());
  });

  it('bot absent du serveur : message clair, bouton de liaison inactif', async () => {
    const { requete } = fauxServeur(chemin => (chemin.endsWith('/discord/bot') ? { disponible: false, invitation: null, serveur: null, pings: [], comptes: [] } : undefined));
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-bot-absent');
    expect(screen.getByTestId('esport-bot-lier').props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId('esport-bot-inviter')).toBeNull();
  });
});

describe('« Lier mon Discord » (profil)', () => {
  it('code à usage unique, vérification, délier ; masqué si le bot est absent', async () => {
    let lie = false;
    const appels: string[] = [];
    const requete = jest.fn(async (chemin: string, methode = 'GET') => {
      appels.push(`${methode} ${chemin}`);
      if (chemin === '/moi/discord/code') return { code: 'WXYZ-2345', expire: new Date(Date.now() + 600_000).toISOString(), commande: '/lier code:WXYZ-2345' };
      if (chemin === '/moi/discord' && methode === 'DELETE') {
        lie = false;
        return { ok: true };
      }
      return { botDisponible: true, lie, discordNom: lie ? 'Léa' : null, lieLe: null };
    }) as unknown as ClientEsport['requete'];
    await render(<LierDiscord theme={theme} client={fauxClient(requete)} />);
    await fireEvent.press(await screen.findByTestId('esport-lier-discord-bouton'));
    expect((await screen.findByTestId('esport-lier-discord-code-code')).props.children).toBe('WXYZ-2345');
    expect(screen.getByText(/\/lier code:WXYZ-2345/)).toBeTruthy();
    lie = true;
    await fireEvent.press(screen.getByTestId('esport-lier-discord-verifier'));
    expect([(await screen.findByTestId('esport-lier-discord-etat')).props.children].flat().join('')).toMatch(/Discord lié : Léa/);
    await fireEvent.press(screen.getByTestId('esport-lier-discord-delier'));
    await waitFor(() => expect(appels).toContain('DELETE /moi/discord'));
    await screen.findByTestId('esport-lier-discord-bouton');
  });

  it('rien ne s’affiche si le serveur n’a pas de bot', async () => {
    const requete = jest.fn(async () => ({ botDisponible: false, lie: false, discordNom: null, lieLe: null })) as unknown as ClientEsport['requete'];
    await render(<LierDiscord theme={theme} client={fauxClient(requete)} />);
    await waitFor(() => expect(requete).toHaveBeenCalled());
    expect(screen.queryByTestId('esport-lier-discord')).toBeNull();
  });
});

describe('écran Discord', () => {
  it('webhook : saisie masquée, enregistrement, affichage « …/abcd » sans jamais montrer l’adresse', async () => {
    const { requete, appels } = fauxServeur();
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-discord');
    expect(screen.getByTestId('esport-discord-test').props.accessibilityState?.disabled).toBe(true);
    const champ = screen.getByTestId('esport-discord-url');
    expect(champ.props.secureTextEntry).toBe(true);
    await fireEvent.changeText(champ, URL_SECRETE);
    await fireEvent.press(screen.getByTestId('esport-discord-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && a.chemin.endsWith('/webhook'))).toBe(true));
    expect(appels.find(a => a.methode === 'PUT')?.corps).toEqual({ url: URL_SECRETE });
    await screen.findByTestId('esport-discord-masque');
    expect(screen.getByText(/Webhook enregistré : discord\.com\/api\/webhooks\/…\/abcd/)).toBeTruthy();
    // L'adresse a disparu du champ et n'apparaît nulle part.
    expect(screen.getByTestId('esport-discord-url').props.value).toBe('');
    expect(JSON.stringify(screen.toJSON())).not.toContain('AbCdEf');
    expect(await screen.findByTestId('esport-discord-avis')).toBeTruthy();
  });

  it('message de test, puis suppression en deux temps', async () => {
    const { requete, appels } = fauxServeur();
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-discord');
    await fireEvent.changeText(screen.getByTestId('esport-discord-url'), URL_SECRETE);
    await fireEvent.press(screen.getByTestId('esport-discord-enregistrer'));
    await screen.findByTestId('esport-discord-masque');
    await fireEvent.press(screen.getByTestId('esport-discord-test'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/discord/test') && a.methode === 'POST')).toBe(true));
    expect((await screen.findByTestId('esport-discord-avis')).props.children).toMatch(/Message de test envoyé/);
    await fireEvent.press(screen.getByTestId('esport-discord-supprimer'));
    expect(appels.some(a => a.methode === 'DELETE')).toBe(false);
    await fireEvent.press(screen.getByTestId('esport-discord-supprimer-confirmer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('esport-discord-masque')).toBeNull());
  });

  it('erreurs du serveur affichées (adresse refusée, Discord injoignable)', async () => {
    let refus = true;
    const { requete } = fauxServeur((chemin, methode) => {
      if (methode === 'PUT' && chemin.endsWith('/webhook') && refus) throw new ErreurEsport('Adresse de webhook invalide : …', 400, 'webhook-url');
      if (chemin.endsWith('/discord/test')) throw new ErreurEsport('Discord n’a pas accepté le message de test (Discord injoignable).', 502, 'discord-echec');
      return undefined;
    });
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-discord');
    await fireEvent.changeText(screen.getByTestId('esport-discord-url'), 'n’importe quoi');
    await fireEvent.press(screen.getByTestId('esport-discord-enregistrer'));
    expect((await screen.findByTestId('esport-discord-erreur')).props.children).toMatch(/invalide/);
    refus = false;
    await fireEvent.changeText(screen.getByTestId('esport-discord-url'), URL_SECRETE);
    await fireEvent.press(screen.getByTestId('esport-discord-enregistrer'));
    await screen.findByTestId('esport-discord-masque');
    await fireEvent.press(screen.getByTestId('esport-discord-test'));
    await waitFor(() => expect(screen.getByTestId('esport-discord-erreur').props.children).toMatch(/injoignable/));
  });

  it('notifications : activer, modèle, rôle (identifiant), modèle par défaut ; « review créée » grisée sans le module', async () => {
    const { requete, appels } = fauxServeur();
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-discord-carte-event_created');
    // Interrupteur : RSVP manquant, désactivé par défaut.
    await fireEvent(screen.getByTestId('esport-discord-actif-rsvp_missing'), 'valueChange', true);
    await waitFor(() => expect(appels.find(a => a.chemin.endsWith('/parametres/rsvp_missing'))?.corps).toEqual({ actif: true }));
    // Review créée : indisponible, interrupteur bloqué, motif visible.
    expect(screen.getByTestId('esport-discord-actif-review_created').props.disabled).toBe(true);
    expect(screen.getByText(/le module Review vidéo n’est pas activé/)).toBeTruthy();
    expect(screen.queryByTestId('esport-discord-ouvrir-review_created')).toBeNull();

    // Modèle et rôle.
    await fireEvent.press(screen.getByTestId('esport-discord-ouvrir-event_created'));
    await fireEvent.changeText(screen.getByTestId('esport-discord-modele-event_created'), 'Nouveau : {titre} !');
    await fireEvent.changeText(screen.getByTestId('esport-discord-role-event_created'), '987654321012345678');
    await fireEvent.press(screen.getByTestId('esport-discord-enregistrer-event_created'));
    await waitFor(() => expect(appels.find(a => a.chemin.endsWith('/parametres/event_created'))?.corps).toEqual({ modele: 'Nouveau : {titre} !', roleMention: '987654321012345678' }));
    await waitFor(() => expect(screen.getByTestId('esport-discord-modele-event_created').props.value).toBe('Nouveau : {titre} !'));
    expect(screen.getByTestId('esport-discord-role-event_created').props.value).toBe('987654321012345678');
    // Retour au modèle par défaut.
    await fireEvent.press(screen.getByTestId('esport-discord-defaut-event_created'));
    await waitFor(() => expect(appels.filter(a => a.chemin.endsWith('/parametres/event_created')).at(-1)?.corps).toEqual({ modele: null }));
    await waitFor(() => expect(screen.getByTestId('esport-discord-modele-event_created').props.value).toBe(''));
  });

  it('un rôle refusé par le serveur (@everyone) affiche l’erreur et ne change rien', async () => {
    const { requete } = fauxServeur((chemin, _m, corps) => {
      if (chemin.includes('/parametres/') && (corps as { roleMention?: string }).roleMention === '@everyone') {
        throw new ErreurEsport('Rôle Discord : saisissez son identifiant numérique (chiffres seulement). @everyone et @here ne sont pas permis.', 400, 'role-mention');
      }
      return undefined;
    });
    await monter(requete, detail(MANAGER), 'telephone');
    await screen.findByTestId('esport-discord-carte-event_created');
    await fireEvent.press(screen.getByTestId('esport-discord-ouvrir-event_created'));
    await fireEvent.changeText(screen.getByTestId('esport-discord-role-event_created'), '@everyone');
    await fireEvent.press(screen.getByTestId('esport-discord-enregistrer-event_created'));
    expect((await screen.findByTestId('esport-discord-erreur')).props.children).toMatch(/@everyone et @here/);
  });

  it('langue : anglais + fil français par défaut, permissions et problème affichés ; désactivé → choix d’une seule langue', async () => {
    let bilingue = {
      filFr: true,
      dernierFil: '2026-10-19T10:00:00.000Z',
      dernierEchec: '2026-10-20T10:00:00.000Z',
      motifEchec: 'Fil français impossible : permission « Créer des fils publics » manquante',
      probleme: true,
      botConfigure: true,
      botLie: true,
      permissions: ['View Channel', 'Send Messages', 'Embed Links', 'Read Message History', 'Create Public Threads', 'Send Messages in Threads'],
    };
    const { requete, appels } = fauxServeur((chemin, methode, corps) => {
      if (chemin.endsWith('/discord/bilingue') && methode === 'PUT') {
        bilingue = { ...bilingue, filFr: (corps as { filFr: boolean }).filFr };
        return bilingue;
      }
      if (chemin.endsWith('/discord')) return { ...etatInitial(), langue: 'fr', languePrincipale: bilingue.filFr ? 'en' : 'fr', bilingue };
      return undefined;
    });
    await monter(requete, detail(MANAGER));
    await screen.findByTestId('esport-discord-bilingue');
    expect(screen.getByTestId('esport-discord-permissions').props.children).toMatch(/Create Public Threads, Send Messages in Threads/);
    expect(screen.getByTestId('esport-discord-fil-probleme').props.children).toMatch(/Fil français impossible le .*Créer des fils publics/);
    expect(screen.queryByTestId('esport-discord-langue')).toBeNull();
    await fireEvent(screen.getByTestId('esport-discord-fil-fr'), 'valueChange', false);
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/discord/bilingue') && a.methode === 'PUT' && (a.corps as { filFr: boolean }).filFr === false)).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('esport-discord-bilingue')).toBeNull());
  });

  it('message de test avec fil français impossible : le motif est affiché', async () => {
    const { requete } = fauxServeur(chemin => (chemin.endsWith('/discord/test') ? { ok: true, fil: { cree: false, motif: 'Fil français impossible : bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)' } } : chemin.endsWith('/discord') ? { ...etatInitial(), webhook: { configure: true, masque: '…/abcd' } } : undefined));
    await monter(requete, detail(MANAGER));
    await fireEvent.press(await screen.findByTestId('esport-discord-test'));
    expect((await screen.findByTestId('esport-discord-avis')).props.children).toMatch(/fil français est impossible : Fil français impossible : bot Discord non configuré/);
  });

  it('derniers envois : statut, essais et motif des échecs', async () => {
    const { requete } = fauxServeur(chemin => {
      if (chemin.endsWith('/discord')) {
        return {
          ...etatInitial(),
          webhook: { configure: true, masque: '…/abcd', invalide: true, dernierEchec: '2026-10-20T10:00:00.000Z' },
          file: { enAttente: 1, abandonnes: 1 },
          envois: [
            { id: 'e1', cle: 'event_created', libelle: 'Nouvel événement', statut: 'attente', essais: 2, erreur: 'Erreur de Discord (HTTP 503)', prochainEssai: null, creeLe: '2026-10-20T10:00:00.000Z', envoyeLe: null },
            { id: 'e2', cle: 'reminder_h1', libelle: 'Rappel H-1', statut: 'abandonne', essais: 6, erreur: 'Erreur de Discord (HTTP 500)', prochainEssai: null, creeLe: '2026-10-20T09:00:00.000Z', envoyeLe: null },
          ],
        };
      }
      return undefined;
    });
    await monter(requete, detail(MANAGER));
    const envois = await screen.findAllByTestId('esport-discord-envoi');
    expect(envois).toHaveLength(2);
    expect(screen.getByText(/Nouvel événement · En attente \(essai 2\)/)).toBeTruthy();
    expect(screen.getByText(/Rappel H-1 · Abandonné/)).toBeTruthy();
    expect(screen.getByText(/Erreur de Discord \(HTTP 500\)/)).toBeTruthy();
    expect(screen.getByText(/ne reconnaît plus ce webhook/)).toBeTruthy();
  });
});

describe('journal', () => {
  const e = (action: string, meta: Record<string, unknown>) => ({ id: '1', action, acteur: 'max12345', entiteType: null, entiteId: null, meta, date: '' });
  const noms = { max12345: 'Max' };

  it('phrases lisibles pour Discord, sans jamais citer une adresse', () => {
    expect(phraseJournal(e('discord.webhook_set', { remplace: false }), noms)).toBe('Max a enregistré le webhook Discord');
    expect(phraseJournal(e('discord.webhook_set', { remplace: true }), noms)).toBe('Max a remplacé le webhook Discord');
    expect(phraseJournal(e('discord.webhook_removed', {}), noms)).toBe('Max a supprimé le webhook Discord');
    expect(phraseJournal(e('discord.settings_changed', { notification: 'reminder_h1' }), noms)).toBe('Max a modifié la notification Discord « Rappel H-1 »');
    expect(phraseJournal(e('discord.test_sent', {}), noms)).toBe('Max a envoyé un message de test sur Discord');
    expect(phraseJournal(e('discord.delivery_failed', { cle: 'event_created', essai: 2, sur: 6, motif: 'Discord injoignable' }), noms)).toBe('Envoi Discord « Nouvel événement » échoué (essai 2/6) : Discord injoignable');
    expect(phraseJournal(e('discord.delivery_abandoned', { cle: 'task_assigned', motif: 'Webhook refusé ou supprimé (HTTP 404)' }), noms)).toBe('Envoi Discord « Tâche assignée » abandonné : Webhook refusé ou supprimé (HTTP 404)');
    expect(phraseJournal(e('event.reminder_h1', { titre: 'Scrim' }), noms)).toBe('Rappel H-1 préparé pour « Scrim »');
    expect(Object.keys(LIBELLES_DISCORD)).toHaveLength(14);
    expect(phraseJournal(e('discord.server_linked', { salon: 'scrims' }), noms)).toMatch(/a lié un serveur Discord à la team \(salon #scrims\)/);
    expect(phraseJournal(e('discord.command_used', { commande: 'prochain' }), noms)).toMatch(/a utilisé \/prochain sur Discord/);
    expect(phraseJournal(e('attendance.relance', { titre: 'Scrim' }), noms)).toMatch(/relancé sur Discord/);
  });
});
