import { envoyerTicket } from './envoi';
import { ESSAIS_AUTOMATIQUES_MAX, ServiceSupport } from './service';
import { corpsDuTicket, erreurFormulaire, infosTechniques, lireTickets, nouveauTicket, prochainNumero, type FormulaireTicket } from './tickets';

const form: FormulaireTicket = { categorie: 'bug', sujet: 'Le graphique est vide', message: 'Depuis la dernière mise à jour, rien ne s’affiche.', inclureTechnique: true };
const technique = infosTechniques({ version: '1.2.3', plateforme: 'web', rang: 'ami', idCompte: 'abcdef123456' });

function depot() {
  let valeur: string | undefined;
  return { lire: () => valeur, ecrire: (v: string) => void (valeur = v), brut: () => valeur };
}
const reponse = (statut: number, corps: unknown = {}) => new Response(JSON.stringify(corps), { status: statut });

describe('tickets', () => {
  it('valide le formulaire (sujet, message, catégorie)', () => {
    expect(erreurFormulaire(form)).toBeUndefined();
    expect(erreurFormulaire({ ...form, sujet: 'a' })).toBeTruthy();
    expect(erreurFormulaire({ ...form, message: 'court' })).toBeTruthy();
    expect(erreurFormulaire({ ...form, message: 'x'.repeat(5000) })).toBeTruthy();
  });

  it('les informations techniques se limitent à version, plateforme, rang et un identifiant court', () => {
    expect(technique).toEqual({ version: '1.2.3', plateforme: 'web', rang: 'ami', compte: 'abcdef' });
    const corps = corpsDuTicket(nouveauTicket(form, 1, technique, '2026-10-06T10:00:00Z'));
    expect(Object.keys(corps).sort()).toEqual(['categorie', 'message', 'numero', 'sujet', 'technique']);
    expect(JSON.stringify(corps)).not.toMatch(/mot de passe|cle|secret|jeton/i);
    // Sans l'option : aucune information technique.
    expect(corpsDuTicket(nouveauTicket({ ...form, inclureTechnique: false }, 2, technique, 'x'))).not.toHaveProperty('technique');
  });

  it('numérote, relit un historique abîmé sans lever', () => {
    expect(prochainNumero([])).toBe(1);
    expect(prochainNumero([{ numero: 4 }, { numero: 2 }])).toBe(5);
    expect(lireTickets('pas du json')).toEqual([]);
    expect(lireTickets(JSON.stringify([{ numero: 'x' }, null, 3]))).toEqual([]);
  });
});

describe('envoi au relais', () => {
  const ticket = nouveauTicket(form, 1, technique, '2026-10-06T10:00:00Z');
  it('POST /support avec le jeton, sans jamais connaître le webhook', async () => {
    const requete = jest.fn().mockResolvedValue(reponse(200));
    const r = await envoyerTicket({ relais: 'https://relais.exemple', jeton: 'jeton-secret-long-abcdef' }, ticket, requete);
    expect(r).toEqual({ ok: true });
    const [url, init] = requete.mock.calls[0];
    expect(url).toBe('https://relais.exemple/support');
    expect(init.headers.Authorization).toBe('Bearer jeton-secret-long-abcdef');
    expect(String(init.body)).not.toContain('discord');
  });
  it('hors ligne, relais non relié, 404 (relais à redéployer), 429 et 503 : motifs clairs', async () => {
    expect(await envoyerTicket(undefined, ticket)).toMatchObject({ ok: false, reessayer: true });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockRejectedValue(new Error('réseau')))).toMatchObject({ ok: false, reessayer: true });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(404)))).toMatchObject({ ok: false, reessayer: false, motif: expect.stringContaining('redéployez') });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(429, { erreur: 'Trop de tickets' })))).toMatchObject({ ok: false, reessayer: false, motif: 'Trop de tickets' });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(503)))).toMatchObject({ ok: false, reessayer: false });
    expect(await envoyerTicket({ relais: 'https://r', jeton: 'j' }, ticket, jest.fn().mockResolvedValue(reponse(502)))).toMatchObject({ ok: false, reessayer: true });
  });
});

describe('ServiceSupport', () => {
  const liaison = async () => ({ relais: 'https://r', jeton: 'j' });
  it('enregistre puis envoie : ticket numéroté, état « envoyé », capture effacée', async () => {
    const d = depot();
    const s = new ServiceSupport({ depot: d, liaison, technique: () => technique, requete: jest.fn().mockResolvedValue(reponse(200)) });
    const t = await s.creer({ ...form, piece: { nom: 'c.png', type: 'image/png', donnees: 'AAAA' } });
    expect(t).toMatchObject({ numero: 1, statut: 'envoye' });
    expect(t.piece).toBeUndefined();
    const t2 = await s.creer(form);
    expect(t2.numero).toBe(2);
    expect(s.liste().map(x => x.numero)).toEqual([2, 1]);
    expect(lireTickets(d.brut())).toHaveLength(2);
  });

  it('hors ligne : le ticket attend puis part tout seul au retour du réseau', async () => {
    const requete = jest.fn().mockRejectedValueOnce(new Error('réseau')).mockResolvedValue(reponse(200));
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete });
    const t = await s.creer(form);
    expect(t.statut).toBe('attente');
    expect(s.enAttente).toBe(1);
    await s.renvoyerEnAttente();
    expect(s.liste()[0].statut).toBe('envoye');
    expect(s.enAttente).toBe(0);
  });

  it('refus définitif : état « erreur », « Réessayer » le relance ; trop d’essais : erreur', async () => {
    const requete = jest.fn().mockResolvedValueOnce(reponse(400, { erreur: 'Sujet refusé' })).mockResolvedValue(reponse(200));
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete });
    expect((await s.creer(form)).statut).toBe('erreur');
    await s.reessayer(1);
    expect(s.liste()[0].statut).toBe('envoye');
    const passe = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete: jest.fn().mockRejectedValue(new Error('x')) });
    await passe.creer(form);
    for (let i = 0; i < ESSAIS_AUTOMATIQUES_MAX; i += 1) await passe.renvoyerEnAttente();
    expect(passe.liste()[0].statut).toBe('erreur');
  });

  it('un formulaire invalide ne crée aucun ticket ; aucun envoi en double simultané', async () => {
    const requete = jest.fn().mockResolvedValue(reponse(200));
    const s = new ServiceSupport({ depot: depot(), liaison, technique: () => technique, requete });
    await expect(s.creer({ ...form, sujet: '' })).rejects.toThrow();
    expect(s.liste()).toHaveLength(0);
    const t = await s.creer(form);
    await Promise.all([s.envoyer(t.numero), s.envoyer(t.numero)]);
    expect(requete).toHaveBeenCalledTimes(1);
  });
});
