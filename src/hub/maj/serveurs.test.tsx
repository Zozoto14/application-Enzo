/**
 * Page « Mises à jour » › Serveurs : version EN SERVICE du relais (GET /serveur/version) et du serveur Esport,
 * depuis quand ils tournent, alerte « n'a pas redémarré » ; relais d'avant ce suivi ou injoignable : dit clairement.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { definirLangue } from '../../esport/i18n';
import { liaisonCourriel } from '../../messagerie/courriel';
import { THEMES_HUB } from '../themes';
import { creerSondeur, sondeur, type EtatDeploiement } from './deploiement';
import { PageMisesAJour } from './PageMisesAJour';
import { versionRelais } from './serveurs';
import { depuis } from './textes';
import type { ClientEsport } from '../../esport/client';

const relaisReel = liaisonCourriel.relais;
const requeteReelle = liaisonCourriel.requete;
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function brancher(reponse: () => Response) {
  liaisonCourriel.relais = () => ({ relais: 'https://relais.test', jeton: 'jeton-de-test-0123456789' });
  liaisonCourriel.requete = () => (async () => reponse()) as never;
}
const json = (c: unknown, statut = 200) => new Response(JSON.stringify(c), { status: statut });
const version = (partiel: Record<string, unknown> = {}) => ({ app: 'relais', commit: A, commitCourt: 'aaaaaaa', demarreLe: '2026-11-07T12:00:00.000Z', pid: 42, node: '22.12.0', dureeS: 3 * 86_400 + 60, codeDeploye: A, aJour: true, ...partiel });

async function rendre(etat?: EtatDeploiement): Promise<{ texte: string; rendu: ReactTestRenderer }> {
  const s = creerSondeur(async () => (etat ? { cle: 'f', client: { requete: async () => etat } as unknown as ClientEsport } : undefined));
  await s.rafraichir(true);
  jest.spyOn(sondeur, 'etat').mockImplementation(s.etat);
  jest.spyOn(sondeur, 'utiliser').mockImplementation(() => () => undefined);
  let rendu!: ReactTestRenderer;
  await act(async () => {
    rendu = create(<PageMisesAJour theme={THEMES_HUB[0]} />);
    await new Promise<void>(res => setTimeout(res, 10));
  });
  return { texte: JSON.stringify(rendu.toJSON()), rendu };
}

afterEach(() => {
  liaisonCourriel.relais = relaisReel;
  liaisonCourriel.requete = requeteReelle;
  jest.restoreAllMocks();
  definirLangue('fr');
});

describe('version du relais', () => {
  it('versionRelais : version lue ; 404 = ancien relais ; HTML 503 = relais arrêté ; non relié', async () => {
    brancher(() => json(version()));
    expect((await versionRelais()).version).toMatchObject({ commit: A, aJour: true, pid: 42, dureeS: 259_260 });
    brancher(() => json({ erreur: 'Adresse inconnue.' }, 404));
    expect(await versionRelais()).toMatchObject({ probleme: 'ancien-relais' });
    brancher(() => new Response('<html>503</html>', { status: 503 }));
    expect(await versionRelais()).toMatchObject({ probleme: 'relais-indisponible' });
    liaisonCourriel.relais = () => undefined;
    expect(await versionRelais()).toMatchObject({ probleme: 'non-relie' });
  });

  it('durée lisible : à l’instant, minutes, heures, jours', () => {
    expect(depuis(30)).toBe('à l’instant');
    expect(depuis(5 * 60)).toBe('il y a 5 min');
    expect(depuis(3 * 3600 + 5)).toBe('il y a 3 h');
    expect(depuis(3 * 86_400 + 60)).toBe('il y a 3 j');
    expect(depuis(null)).toBe('inconnue');
  });

  it('page : « Relais : version aaaaaaa (démarré il y a 3 j) », et l’alerte quand il n’a pas redémarré', async () => {
    brancher(() => json(version()));
    let { texte, rendu } = await rendre();
    expect(texte).toContain('Relais : version aaaaaaa (démarré il y a 3 j)');
    expect(rendu.root.findAllByProps({ testID: 'maj-serveur-relais-pas-redemarre' })).toHaveLength(0);
    expect(texte).toContain('tail -n 50 ~/logs/relais.log');
    act(() => rendu.unmount());

    brancher(() => json(version({ codeDeploye: B, aJour: false })));
    ({ texte, rendu } = await rendre());
    expect(texte).toContain('Relais n’a pas redémarré : il tourne aaaaaaa alors que bbbbbbb est déployé. Cliquez « Restart » dans cPanel › Setup Node.js App (application-enzo/relais)');
    act(() => rendu.unmount());
  });

  it('page : relais d’avant ce suivi (404) ou arrêté : dit, avec la marche à suivre', async () => {
    brancher(() => json({ erreur: 'Adresse inconnue.' }, 404));
    let { texte, rendu } = await rendre();
    expect(rendu.root.findAllByProps({ testID: 'maj-serveur-relais-ancien' }).length).toBeGreaterThan(0);
    expect(texte).toContain('il n’a pas redémarré');
    act(() => rendu.unmount());
    brancher(() => new Response('<html>502</html>', { status: 502 }));
    ({ texte, rendu } = await rendre());
    expect(texte).toContain('erreur 502 de l’hébergeur');
    act(() => rendu.unmount());
  });

  it('page : serveur Esport, version et durée, alerte de redémarrage en attente', async () => {
    brancher(() => json(version()));
    const etat = {
      etat: 'a-jour',
      estimationMin: null,
      site: null,
      serveur: { commit: A, demarreLe: '2026-11-10T10:00:00.000Z', dureeS: 7200, redemarrageEnAttente: true },
      relais: { commit: B, redemarreLe: null },
      deploiement: { codeDeploye: B, dernierDeploiement: null, derniereVerification: null, derniereLigne: null, echec: null, journal: [], demandeEnAttente: false, demandeLe: null },
      github: { main: null, workflow: null, majLe: null, erreur: null },
      heure: '2026-11-10T12:00:00.000Z',
    } as EtatDeploiement;
    const { texte, rendu } = await rendre(etat);
    expect(texte).toContain('Serveur Esport : version aaaaaaa (démarré il y a 2 h)');
    expect(texte).toContain('Serveur Esport n’a pas redémarré : il tourne aaaaaaa alors que bbbbbbb est déployé');
    act(() => rendu.unmount());
  });
});
