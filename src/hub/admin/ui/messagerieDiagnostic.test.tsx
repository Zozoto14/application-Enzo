/**
 * Administration › Messagerie : jamais silencieux. Chaque panne a son message précis (appareil non relié avec le
 * jeton maître, relais injoignable ou arrêté, ancienne version du relais, refus, SMTP non configuré ou refusé), sur la
 * page, après « Envoyer » et après « Tester l'envoi ». Faux relais (les vraies routes : relais/*.test.mjs).
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { liaisonCourriel } from '../../../messagerie/courriel';
import type { Profil } from '../../../profils/profils';
import { ModeAffichageForce } from '../../../ui/mobile';
import { donneesVides, type DonneesAdmin } from '../donnees';
import { themeHub } from '../../themes';
import type { OutilsAdmin } from './commun';
import { Messagerie } from './Messagerie';
import { fabrique } from '../../../esport/fabrique';

const theme = themeHub('nuit');
const relaisReel = liaisonCourriel.relais;
const requeteReelle = liaisonCourriel.requete;
const relaisEsport = fabrique.relais;

type Routeur = (chemin: string, corps: Record<string, unknown> | undefined) => Response | Promise<Response>;
const json = (c: unknown, statut = 200) => new Response(JSON.stringify(c), { status: statut });
const PRET = { configure: true, expediteur: 'noreply@appdashboard.fr', limites: { heure: 100, jour: 300 }, manques: [], verification: { statut: 'ok' }, test: true };

function brancher(routeur: Routeur | 'non-relie') {
  const appels: Array<{ chemin: string; corps?: Record<string, unknown> }> = [];
  fabrique.relais = () => undefined;
  if (routeur === 'non-relie') {
    liaisonCourriel.relais = () => undefined;
    liaisonCourriel.requete = () => (async () => json({})) as never;
    return appels;
  }
  liaisonCourriel.relais = () => ({ relais: 'https://relais.test', jeton: 'jeton-de-test-0123456789' });
  liaisonCourriel.requete = () =>
    (async (url: string, init?: RequestInit) => {
      const chemin = url.replace('https://relais.test', '');
      const corps = init?.body ? JSON.parse(String(init.body)) : undefined;
      appels.push({ chemin, corps });
      return routeur(chemin, corps);
    }) as never;
  return appels;
}

function outils(): OutilsAdmin {
  const donnees: DonneesAdmin = { ...donneesVides(), contacts: { principal: { email: 'enzo@exemple.fr', envois: [] }, lea0000001: { email: 'lea@exemple.fr', envois: [] } } };
  const tous: Profil[] = [
    { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' },
    { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '' },
  ];
  return { theme, donnees, tous, controle: { tous, actuel: tous[0] } as never, journaliser: () => undefined } as unknown as OutilsAdmin;
}

const attendre = () => new Promise<void>(res => setTimeout(res, 20));

async function monterEtEcrire() {
  await act(async () => {
    render(
      <ModeAffichageForce mode="large">
        <Messagerie outils={outils()} />
      </ModeAffichageForce>,
    );
    await attendre();
  });
  await fireEvent.press(screen.getByTestId('admin-messagerie-dest-lea0000001'));
  await fireEvent.changeText(screen.getByTestId('admin-messagerie-objet'), 'Salut');
  await fireEvent.changeText(screen.getByTestId('admin-messagerie-message'), 'Bonjour à tous');
}

async function appuyer(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
    await attendre();
  });
}

afterEach(() => {
  liaisonCourriel.relais = relaisReel;
  liaisonCourriel.requete = requeteReelle;
  fabrique.relais = relaisEsport;
});

describe('Administration › Messagerie : erreurs toujours visibles', () => {
  jest.setTimeout(30_000);

  it('appareil non relié avec le jeton maître : dit comment faire, « Envoyer » le redit au lieu de ne rien faire', async () => {
    brancher('non-relie');
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-probleme')).toHaveTextContent(/pas relié au relais avec le jeton maître.*code de liaison \(AB1/);
    expect(screen.getByTestId('admin-messagerie-envoyer').props.accessibilityState?.disabled).toBeFalsy();
    await appuyer('admin-messagerie-envoyer');
    expect(screen.getByTestId('admin-messagerie-retour')).toHaveTextContent(/Aucun e-mail envoyé : Cet appareil n’est pas relié/);
    expect(screen.getByTestId('admin-messagerie-historique-indisponible')).toHaveTextContent(/jeton maître/);
    await appuyer('admin-messagerie-tester');
    expect(screen.getByTestId('admin-messagerie-test-retour')).toHaveTextContent(/pas relié/);
  });

  it('relais injoignable (réseau) : message et solution (redémarrer, lire ~/logs/relais.log)', async () => {
    brancher(() => {
      throw new TypeError('Failed to fetch');
    });
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-probleme')).toHaveTextContent(/Relais injoignable.*tail -n 50 ~\/logs\/relais\.log/);
    await appuyer('admin-messagerie-envoyer');
    expect(screen.getByTestId('admin-messagerie-retour')).toHaveTextContent(/Aucun e-mail envoyé : Relais injoignable/);
    expect(screen.getByTestId('admin-messagerie-mailto')).toBeTruthy();
  });

  it('relais arrêté (502 de l’hébergeur, page HTML) : « l’app relais est arrêtée », Restart dans Setup Node.js App', async () => {
    brancher(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-probleme')).toHaveTextContent(/erreur 502 de l’hébergeur.*Setup Node\.js App.*Restart/);
    await appuyer('admin-messagerie-envoyer');
    expect(screen.getByTestId('admin-messagerie-retour')).toHaveTextContent(/Aucun e-mail envoyé : Le relais ne répond pas \(erreur 502/);
  });

  it('ancien relais (pas redémarré) : avertissement, « Tester l’envoi » le dit aussi', async () => {
    brancher((chemin, corps) => {
      if (chemin === '/courriel/etat') return json({ configure: true, expediteur: null, limites: { heure: 100, jour: 300 } });
      if (chemin === '/courriel/journal') return json({ envois: [] });
      if (chemin === '/courriel/envoyer') return json({ ok: true, envoyes: 1, resultats: [{ a: 'l***@e***.fr', statut: 'envoye' }], corps });
      return json({ erreur: 'Adresse inconnue.' }, 404);
    });
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-relais-ancien')).toHaveTextContent(/ancienne version.*Restart/);
    await appuyer('admin-messagerie-tester');
    expect(screen.getByTestId('admin-messagerie-test-retour')).toHaveTextContent(/ancienne version \(il n’a pas redémarré/);
  });

  it('jeton refusé (403) : réservé au Fondateur, comment relier', async () => {
    brancher(() => json({ erreur: 'Réservé au Fondateur.' }, 403));
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-probleme')).toHaveTextContent(/réservé au Fondateur \(jeton maître\)/);
    await appuyer('admin-messagerie-envoyer');
    expect(screen.getByTestId('admin-messagerie-retour')).toHaveTextContent(/refuse cet appareil/);
  });

  it('SMTP non configuré : variables manquantes nommées ; « Tester l’envoi » les liste', async () => {
    brancher(chemin => {
      if (chemin === '/courriel/etat') return json({ ...PRET, configure: false, manques: ['SMTP_PASS', 'MAIL_FROM'], verification: { statut: 'non-configure' } });
      if (chemin === '/courriel/journal') return json({ envois: [] });
      if (chemin === '/courriel/tester') return json({ ok: false, etape: 'configuration', code: 'non-configure', manques: ['SMTP_PASS', 'MAIL_FROM'], explication: 'L’envoi d’e-mails n’est pas configuré sur le serveur. Manquant : SMTP_PASS, MAIL_FROM.' }, 503);
      return json({ erreur: 'non configuré', motif: 'non-configure' }, 503);
    });
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-non-configure')).toHaveTextContent(/il manque SMTP_PASS, MAIL_FROM dans ~\/\.appdashboard\/relais\.env/);
    await appuyer('admin-messagerie-tester');
    expect(screen.getByTestId('admin-messagerie-test-retour')).toHaveTextContent(/Envoi non configuré : .*Manquant : SMTP_PASS, MAIL_FROM/);
  });

  it('identifiants SMTP refusés : vérification du démarrage en échec, « Tester l’envoi » et « Envoyer » donnent la cause', async () => {
    const appels = brancher(chemin => {
      if (chemin === '/courriel/etat') return json({ ...PRET, verification: { statut: 'echec', code: 'smtp-authentification', technique: 'EAUTH 535', explication: 'Identifiant ou mot de passe SMTP refusé (EAUTH) : vérifiez SMTP_USER et SMTP_PASS.' } });
      if (chemin === '/courriel/journal') return json({ envois: [] });
      if (chemin === '/courriel/tester') return json({ ok: false, etape: 'connexion', code: 'smtp-authentification', technique: 'EAUTH 535', explication: 'Identifiant ou mot de passe SMTP refusé (EAUTH) : vérifiez SMTP_USER et SMTP_PASS.' });
      return json({ ok: false, envoyes: 0, resultats: [{ a: 'l***@e***.fr', statut: 'echec', erreur: 'smtp-authentification' }], erreur: 'smtp-authentification' }, 502);
    });
    await monterEtEcrire();
    expect(screen.getByTestId('admin-messagerie-verification-echec')).toHaveTextContent(/connexion SMTP a échoué \(code EAUTH 535\)/);
    expect(screen.getByTestId('admin-messagerie-test-adresse').props.value).toBe('enzo@exemple.fr');
    await appuyer('admin-messagerie-tester');
    expect(appels.find(a => a.chemin === '/courriel/tester')?.corps).toEqual({ adresse: 'enzo@exemple.fr' });
    expect(screen.getByTestId('admin-messagerie-test-retour')).toHaveTextContent(/Connexion SMTP impossible : Identifiant ou mot de passe SMTP refusé.*\(code EAUTH 535\)/);
    await appuyer('admin-messagerie-envoyer');
    expect(screen.getByTestId('admin-messagerie-retour')).toHaveTextContent(/Aucun e-mail envoyé : identifiants SMTP refusés/);
  });

  it('autres refus SMTP : connexion refusée, délai, expéditeur, limite de l’hébergeur', async () => {
    let reponse: Record<string, unknown> = {};
    brancher(chemin => {
      if (chemin === '/courriel/etat') return json(PRET);
      if (chemin === '/courriel/journal') return json({ envois: [] });
      return json(reponse);
    });
    await monterEtEcrire();
    const cas: Array<[Record<string, unknown>, RegExp]> = [
      [{ ok: false, etape: 'connexion', code: 'smtp-refuse', technique: 'ESOCKET ECONNREFUSED' }, /Connexion SMTP impossible : connexion refusée.*SMTP_PORT.*\(code ESOCKET ECONNREFUSED\)/],
      [{ ok: false, etape: 'connexion', code: 'smtp-delai', technique: 'ETIMEDOUT' }, /ne répond pas \(délai dépassé\)/],
      [{ ok: false, etape: 'envoi', code: 'expediteur-refuse', a: 'e***@e***.fr' }, /E-mail de test refusé : expéditeur refusé.*MAIL_FROM/],
      [{ ok: false, etape: 'envoi', code: 'smtp-limite', a: 'e***@e***.fr' }, /limite d’envoi de l’hébergeur atteinte/],
      [{ ok: true, etape: 'envoi', a: 'e***@e***.fr' }, /e-mail de test envoyé à e\*\*\*@e\*\*\*\.fr/],
    ];
    for (const [r, attendu] of cas) {
      reponse = r;
      await appuyer('admin-messagerie-tester');
      expect(screen.getByTestId('admin-messagerie-test-retour')).toHaveTextContent(attendu);
    }
  });

  it('saisie incomplète : « Envoyer » dit ce qui manque au lieu d’un bouton grisé muet', async () => {
    const appels = brancher(chemin => (chemin === '/courriel/etat' ? json(PRET) : json({ envois: [] })));
    await act(async () => {
      render(
        <ModeAffichageForce mode="large">
          <Messagerie outils={outils()} />
        </ModeAffichageForce>,
      );
      await attendre();
    });
    expect(screen.getByTestId('admin-messagerie-pret')).toBeTruthy();
    await appuyer('admin-messagerie-envoyer');
    expect(screen.getByTestId('admin-messagerie-retour')).toHaveTextContent(/Choisissez au moins un destinataire/);
    expect(appels.some(a => a.chemin === '/courriel/envoyer')).toBe(false);
  });
});
