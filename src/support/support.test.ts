import { agirSurTicket, envoyerTicket, listerTickets } from './envoi';
import { ESSAIS_AUTOMATIQUES_MAX, ServiceSupport } from './service';
import { appareilDe, corpsDuTicket, erreurFormulaire, infosTechniques, lireTickets, nouveauTicket, prochainNumero, type FormulaireTicket } from './tickets';

const form: FormulaireTicket = { categorie: 'bug', titre: 'Le graphique est vide', message: 'Depuis la dernière mise à jour, rien ne s’affiche.', inclureTechnique: true };
const technique = infosTechniques({ version: '1.2.3', plateforme: 'web', rang: 'ami', app: 'portefeuille', langue: 'fr', appareil: 'iPhone' });

function depot() {
  let valeur: string | undefined;
  return { lire: () => valeur, ecrire: (v: string) => void (valeur = v), brut: () => valeur };
}
const reponse = (statut: number, corps: unknown = {}) => new Response(JSON.stringify(corps), { status: statut });
const vue = (plus: Record<string, unknown> = {}) => ({ id: '0123456789abcdef', numero: 12, categorie: 'bug', titre: 'Le graphique est vide', message: 'x', statut: 'ouvert', cree: '2026-10-21T10:00:00Z', messages: [], nonLus: 0, ...plus });

describe('demandes', () => {
  it('valide le formulaire (titre, message, catégorie)', () => {
    expect(erreurFormulaire(form)).toBeUndefined();
    expect(erreurFormulaire({ ...form, titre: 'a' })).toBeTruthy();
    expect(erreurFormulaire({ ...form, message: 'court' })).toBeTruthy();
    expect(erreurFormulaire({ ...form, message: 'x'.repeat(5000) })).toBeTruthy();
    expect(erreurFormulaire({ ...form, categorie: 'autre' as never })).toBeTruthy();
  });

  it('infos techniques en liste fermée (version, plateforme, appareil, app, langue, rang) ; jamais de secret', () => {
    expect(technique).toEqual({ version: '1.2.3', plateforme: 'web', appareil: 'iPhone', app: 'portefeuille', langue: 'fr', rang: 'ami' });
    const corps = corpsDuTicket(nouveauTicket(form, 1, technique, '2026-10-06T10:00:00Z'), 'Léa');
    expect(Object.keys(corps).sort()).toEqual(['auteur', 'categorie', 'langue', 'message', 'numero', 'technique', 'titre']);
    expect(JSON.stringify(corps)).not.toMatch(/mot de passe|cle|secret|jeton/i);
    expect(corpsDuTicket(nouveauTicket({ ...form, inclureTechnique: false }, 2, technique, 'x'))).not.toHaveProperty('technique');
    expect(appareilDe('web', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    expect(appareilDe('web', 'Mozilla/5.0 (Windows NT 10.0) Electron/30')).toBe('PC (app)');
  });

  it('numérote, relit un historique abîmé sans lever, et l’ancien format (sujet, catégorie « demande »)', () => {
    expect(prochainNumero([])).toBe(1);
    expect(prochainNumero([{ numero: 4 }, { numero: 2 }])).toBe(5);
    expect(lireTickets('pas du json')).toEqual([]);
    expect(lireTickets(JSON.stringify([{ numero: 'x' }, null, 3]))).toEqual([]);
    const ancien = lireTickets(JSON.stringify([{ numero: 3, date: '2026-10-01', categorie: 'demande', sujet: 'Vieux ticket', message: 'Un message de l’ancienne version.', statut: 'envoye' }]));
    expect(ancien[0]).toMatchObject({ categorie: 'idee', titre: 'Vieux ticket' });
  });
});

describe('échanges avec le relais', () => {
  const ticket = nouveauTicket(form, 1, technique, '2026-10-06T10:00:00Z');
  it('POST /support avec le jeton, sans jamais connaître le webhook ; la demande rangée revient', async () => {
    const requete = jest.fn().mockResolvedValue(reponse(200, { ok: true, ticket: vue() }));
    const r = await envoyerTicket({ relais: 'https://relais.exemple', jeton: 'jeton-secret-long-abcdef' }, ticket, requete);
    expect(r).toMatchObject({ ok: true, vue: { numero: 12 } });
    const [url, init] = requete.mock.calls[0];
    expect(url).toBe('https://relais.exemple/support');
    expect(init.headers.Authorization).toBe('Bearer jeton-secret-long-abcdef');
    expect(String(init.body)).not.toContain('discord');
  });
  it('hors ligne, relais non relié, 404 (relais à mettre à jour), 429 et 503 : motifs clairs', async () => {
    expect(await envoyerTicket(undefined, ticket)).toMatchObject({ ok: false, reessayer: true });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockRejectedValue(new Error('réseau')))).toMatchObject({ ok: false, reessayer: true });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(404)))).toMatchObject({ ok: false, reessayer: false, motif: expect.stringContaining('mis à jour') });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(429, { erreur: 'Trop de demandes' })))).toMatchObject({ ok: false, reessayer: false, motif: 'Trop de demandes' });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(503)))).toMatchObject({ ok: false, reessayer: false });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(502)))).toMatchObject({ ok: false, reessayer: true });
  });
  it('liste (Fondateur : ?tous=1) et actions (réponse, statut, renvoi Discord)', async () => {
    const requete = jest.fn().mockResolvedValue(reponse(200, { tickets: [vue()], discord: 'ok' }));
    expect(await listerTickets({ relais: 'https://r/', jeton: 'j' }, requete, true)).toMatchObject({ discord: 'ok', tickets: [{ numero: 12 }] });
    expect(requete.mock.calls[0][0]).toBe('https://r/support/tickets?tous=1');
    const action = jest.fn().mockResolvedValue(reponse(200, { ok: true, ticket: vue({ statut: 'repondu' }), discord: true, courriel: { ok: true } }));
    expect(await agirSurTicket({ relais: 'https://r', jeton: 'j' }, '0123456789abcdef', 'messages', { texte: 'Bonjour' }, action)).toMatchObject({ ok: true, discord: true, courriel: { ok: true } });
    expect(action.mock.calls[0][0]).toBe('https://r/support/tickets/0123456789abcdef/messages');
    expect(await agirSurTicket({ relais: 'https://r', jeton: 'j' }, 'x', 'statut', {}, jest.fn().mockResolvedValue(reponse(404, { erreur: 'Demande introuvable.' })))).toEqual({ ok: false, motif: 'Demande introuvable.' });
  });
});

describe('ServiceSupport', () => {
  const liaison = async () => ({ relais: 'https://r', jeton: 'j' });
  it('enregistre puis envoie : demande numérotée, état « envoyée », capture effacée, numéro du support repris', async () => {
    const d = depot();
    const s = new ServiceSupport({ depot: d, liaison, technique: () => technique, requete: jest.fn().mockResolvedValue(reponse(200, { ok: true, ticket: vue() })) });
    const t = await s.creer({ ...form, piece: { nom: 'c.png', type: 'image/png', donnees: 'AAAA' } });
    expect(t).toMatchObject({ numero: 1, statut: 'envoye', id: '0123456789abcdef', numeroServeur: 12, statutServeur: 'ouvert' });
    expect(t.piece).toBeUndefined();
    const t2 = await s.creer(form);
    expect(t2.numero).toBe(2);
    expect(s.liste().map(x => x.numero)).toEqual([2, 1]);
    expect(lireTickets(d.brut())).toHaveLength(2);
  });

  it('hors ligne : la demande attend puis part toute seule au retour du réseau', async () => {
    const requete = jest.fn().mockRejectedValueOnce(new Error('réseau')).mockResolvedValue(reponse(200, { ok: true }));
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete });
    const t = await s.creer(form);
    expect(t.statut).toBe('attente');
    expect(s.enAttente).toBe(1);
    await s.renvoyerEnAttente();
    expect(s.liste()[0].statut).toBe('envoye');
    expect(s.enAttente).toBe(0);
  });

  it('refus définitif : état « erreur », « Réessayer » la relance ; trop d’essais : erreur', async () => {
    const requete = jest.fn().mockResolvedValueOnce(reponse(400, { erreur: 'Titre refusé' })).mockResolvedValue(reponse(200, { ok: true }));
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete });
    expect((await s.creer(form)).statut).toBe('erreur');
    await s.reessayer(1);
    expect(s.liste()[0].statut).toBe('envoye');
    const passe = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete: jest.fn().mockRejectedValue(new Error('x')) });
    await passe.creer(form);
    for (let i = 0; i < ESSAIS_AUTOMATIQUES_MAX; i += 1) await passe.renvoyerEnAttente();
    expect(passe.liste()[0].statut).toBe('erreur');
  });

  it('un formulaire invalide ne crée aucune demande ; aucun envoi en double simultané', async () => {
    const requete = jest.fn().mockResolvedValue(reponse(200, { ok: true }));
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete });
    await expect(s.creer({ ...form, titre: '' })).rejects.toThrow();
    expect(s.liste()).toHaveLength(0);
    const t = await s.creer(form);
    await Promise.all([s.envoyer(t.numero), s.envoyer(t.numero)]);
    expect(requete).toHaveBeenCalledTimes(1);
  });

  it('synchronise : réponse du Fondateur (non lue), demande d’un autre appareil ajoutée, complément envoyé', async () => {
    const requete = jest.fn(async (url: string) => {
      if (url.endsWith('/support')) return reponse(200, { ok: true, ticket: vue() });
      if (url.endsWith('/support/tickets')) {
        return reponse(200, {
          tickets: [
            vue({ statut: 'repondu', nonLus: 1, messages: [{ id: 'm', de: 'equipe', texte: 'Corrigé.', date: '2026-10-21T11:00:00Z' }] }),
            vue({ id: 'fedcba9876543210', numero: 13, titre: 'Depuis le PC', message: 'Envoyée depuis un autre appareil.', categorie: 'idee' }),
          ],
        });
      }
      return reponse(200, { ok: true, ticket: vue({ statut: 'ouvert', messages: [{ id: 'm2', de: 'utilisateur', texte: 'Merci', date: 'x' }] }) });
    });
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete: requete as never });
    await s.creer(form);
    expect(await s.synchroniser()).toBe(1);
    expect(s.nonLus).toBe(1);
    expect(s.liste().map(t => t.titre)).toEqual(['Depuis le PC', 'Le graphique est vide']);
    expect(await s.repondre(1, 'Merci')).toBeUndefined();
    expect(s.liste().find(t => t.numero === 1)?.messages?.at(-1)?.de).toBe('utilisateur');
  });
});
