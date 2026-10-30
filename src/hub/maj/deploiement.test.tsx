import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ErreurEsport, type ClientEsport } from '../../esport/client';
import { definirLangue } from '../../esport/i18n';
import { THEMES_HUB } from '../themes';
import { creerSondeur, pastillePour, phraseEtat, sondeur, type EtatDeploiement } from './deploiement';
import { PageMisesAJour } from './PageMisesAJour';

function etatDe(partiel: Partial<EtatDeploiement> = {}): EtatDeploiement {
  return {
    etat: 'a-jour',
    estimationMin: null,
    site: { id: 'aaaaaaa-x', commit: 'a'.repeat(40), date: '2026-10-30T11:56:00.000Z' },
    serveur: { commit: 'a'.repeat(40), demarreLe: '2026-10-30T11:57:00.000Z', redemarrageEnAttente: false },
    relais: { commit: 'a'.repeat(40), redemarreLe: '2026-10-30T11:57:00.000Z' },
    deploiement: {
      codeDeploye: 'a'.repeat(40),
      dernierDeploiement: '2026-10-30 11:57:00',
      derniereVerification: '2026-10-30T11:59:40.000Z',
      derniereLigne: { date: '2026-10-30 11:57:00', texte: 'site : public_html à jour' },
      echec: null,
      journal: [{ date: '2026-10-30 11:57:00', texte: 'site : public_html à jour' }],
      demandeEnAttente: false,
      demandeLe: null,
    },
    github: {
      main: { sha: 'a'.repeat(40), message: 'Esport : devblog', date: '2026-10-30T11:49:00Z' },
      workflow: { statut: 'reussi', sha: 'a'.repeat(40), message: 'Esport : devblog', debut: null, fin: null, numero: 7, url: 'https://github.com/x/y/actions/runs/1' },
      majLe: '2026-10-30T12:00:00.000Z',
      erreur: null,
    },
    heure: '2026-10-30T12:00:00.000Z',
    ...partiel,
  };
}

describe('pastille et phrases', () => {
  afterEach(() => definirLangue('fr'));

  it('en cours (≈ X min), échec du workflow (tests en échec), bloqué, à jour, inconnu ; en français et en anglais', () => {
    definirLangue('fr');
    expect(pastillePour(etatDe({ etat: 'en-cours', phase: 'build', estimationMin: 4 }))).toMatchObject({ texte: 'Mise à jour en cours… (≈ 4 min)', ton: 'attente' });
    const echec = pastillePour(etatDe({ etat: 'echec' }))!;
    expect(echec.ton).toBe('alerte');
    expect(echec.titre).toContain('La mise à jour n’a pas pu être publiée (tests en échec)');
    expect(pastillePour(etatDe({ etat: 'bloque' }))!.ton).toBe('alerte');
    expect(pastillePour(etatDe())!.texte).toBe('À jour');
    expect(pastillePour(etatDe({ etat: 'inconnu' }))).toBeUndefined();
    expect(pastillePour(undefined)).toBeUndefined();
    expect(phraseEtat(etatDe({ etat: 'en-cours', phase: 'publication', estimationMin: 1 }))).toContain('≈ 1 min');
    definirLangue('en');
    expect(pastillePour(etatDe({ etat: 'en-cours', phase: 'build', estimationMin: 4 }))!.texte).toBe('Update in progress… (≈ 4 min)');
    expect(pastillePour(etatDe({ etat: 'echec' }))!.titre).toContain('could not be published (tests failing)');
  });
});

function fauxClient(reponses: Array<EtatDeploiement | Error>) {
  const appels: Array<[string, string | undefined]> = [];
  const client = {
    requete: async (chemin: string, methode?: string) => {
      appels.push([chemin, methode]);
      if (chemin === '/deploiement/verifier') return { demande: true };
      const r = reponses.length > 1 ? reponses.shift()! : reponses[0];
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as ClientEsport;
  return { client, appels };
}

describe('sondage partagé de l’état des mises à jour', () => {
  it('lit l’état, n’insiste pas après un refus (404), repart de zéro pour un autre compte', async () => {
    const horloge = { t: 0 };
    const a = fauxClient([etatDe({ etat: 'en-cours', estimationMin: 3 }), new ErreurEsport('Adresse inconnue.', 404, 'route')]);
    let acces: { cle: string; client: ClientEsport } | undefined = { cle: 'fondateur', client: a.client };
    const s = creerSondeur(async () => acces, () => horloge.t);
    await s.rafraichir(true);
    expect(s.etat().etat?.etat).toBe('en-cours');
    // Retour au premier plan trop tôt : pas d'appel.
    horloge.t += 10_000;
    await s.rafraichir();
    expect(a.appels).toHaveLength(1);
    // Refus : état effacé, plus d'appel pour ce compte.
    await s.rafraichir(true);
    expect(s.etat()).toMatchObject({ etat: undefined, erreur: 'indisponible' });
    await s.rafraichir(true);
    expect(a.appels).toHaveLength(2);
    // Autre compte : on recommence (et jamais l'état du précédent).
    const b = fauxClient([etatDe()]);
    acces = { cle: 'autre', client: b.client };
    await s.rafraichir(true);
    expect(s.etat().etat?.etat).toBe('a-jour');
    // Plus de relais (verrouillé) : rien d'affiché.
    acces = undefined;
    await s.rafraichir(true);
    expect(s.etat()).toMatchObject({ etat: undefined, erreur: 'indisponible' });
  });

  it('réseau en panne : « injoignable », l’état précédent reste ; « Vérifier maintenant » dépose la demande puis relit', async () => {
    const c = fauxClient([etatDe(), new ErreurEsport('injoignable', 0, 'injoignable'), etatDe({ deploiement: { ...etatDe().deploiement, demandeEnAttente: true } })]);
    const s = creerSondeur(async () => ({ cle: 'f', client: c.client }), () => 0);
    await s.rafraichir(true);
    await s.rafraichir(true);
    expect(s.etat()).toMatchObject({ erreur: 'injoignable' });
    expect(s.etat().etat?.etat).toBe('a-jour');
    expect(await s.verifierMaintenant()).toEqual({ ok: true });
    expect(c.appels).toContainEqual(['/deploiement/verifier', 'POST']);
    expect(s.etat().etat?.deploiement.demandeEnAttente).toBe(true);
  });
});

describe('page « Mises à jour »', () => {
  it('affiche versions, GitHub, journal, et les boutons Vérifier maintenant / Recharger', async () => {
    // L'état du sondage partagé est posé à la main (pas de serveur en test).
    const c = fauxClient([etatDe({ etat: 'echec', github: { ...etatDe().github, workflow: { ...etatDe().github.workflow!, statut: 'echec' } } })]);
    const s = creerSondeur(async () => ({ cle: 'f', client: c.client }));
    await s.rafraichir(true);
    jest.spyOn(sondeur, 'etat').mockImplementation(s.etat);
    let rendu!: ReactTestRenderer;
    await act(async () => {
      rendu = create(<PageMisesAJour theme={THEMES_HUB[0]} />);
    });
    const texte = JSON.stringify(rendu.toJSON());
    expect(texte).toContain('tests en échec');
    expect(texte).toContain('site : public_html à jour');
    expect(rendu.root.findAllByProps({ testID: 'maj-verifier-maintenant' }).length).toBeGreaterThan(0);
    expect(rendu.root.findAllByProps({ testID: 'maj-recharger-app' }).length).toBeGreaterThan(0);
    expect(rendu.root.findAllByProps({ testID: 'maj-version-github' }).length).toBeGreaterThan(0);
    act(() => rendu.unmount());
  });
});
