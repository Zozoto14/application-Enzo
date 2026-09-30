import {
  AVERTISSEMENT_JURIDIQUE,
  DOCUMENTS,
  MODELES,
  TAILLE_MAX_DOCUMENT,
  VERSION_MODELE,
  accepter,
  blocsDuTexte,
  doitAccepter,
  estModifie,
  lireAcceptations,
  lireDocsJuridiques,
  modifierDocument,
  retablirModele,
  texteDuDocument,
  versionJuridique,
} from './modele';

describe('modèle des documents légaux', () => {
  it('quatre documents, chacun avec son texte', () => {
    expect(DOCUMENTS.map(d => d.titre)).toEqual(['Conditions d’utilisation', 'Politique de confidentialité', 'Cookies et stockage local', 'Mentions légales']);
    for (const d of DOCUMENTS) expect(MODELES[d.id].length).toBeGreaterThan(300);
  });

  it('est véridique : stockage local chiffré, aucun cookie de suivi, tiers nommés, Discord pour le support', () => {
    const tout = DOCUMENTS.map(d => MODELES[d.id]).join('\n').toLowerCase();
    expect(tout).toContain('chiffr');
    expect(tout).toMatch(/aucun cookie (de suivi|publicitaire)|aucun cookie/);
    for (const tiers of ['jikan', 'anilist', 'tmdb', 'discord', 'cloudflare']) expect(tout).toContain(tiers);
    expect(tout).toContain('support');
    expect(tout).toMatch(/ne héberge, ne stocke et ne distribue aucun film/);
    expect(tout).toMatch(/droit d’auteur|droit d'auteur/);
    expect(tout).toMatch(/analyse|statistiques/);
  });

  it('n’affirme jamais que les sources tierces sont légales', () => {
    const tout = DOCUMENTS.map(d => MODELES[d.id]).join('\n');
    expect(tout).not.toMatch(/(sources?|contenus?|sites?)[^.\n]{0,60}(est|sont) (tout à fait |entièrement )?(légal|légaux|légale|légales|licite)/i);
    expect(tout).not.toMatch(/100 ?% légal|usage légal garanti/i);
  });

  it('porte l’avertissement « à faire relire par un professionnel du droit »', () => {
    expect(AVERTISSEMENT_JURIDIQUE).toBe('Modèle informatif à faire relire par un professionnel du droit ; ne constitue pas un conseil juridique.');
  });

  it('un Fondateur modifie un texte : révision, version à accepter, retour au modèle', () => {
    expect(versionJuridique(undefined)).toBe(`${VERSION_MODELE}.0`);
    const a = modifierDocument(undefined, 'conditions', '## Mon texte\n\nBonjour', 'Zoé', '2026-10-06T10:00:00Z');
    expect(estModifie('conditions', a)).toBe(true);
    expect(texteDuDocument('conditions', a)).toContain('Mon texte');
    expect(texteDuDocument('cookies', a)).toBe(MODELES.cookies);
    expect(versionJuridique(a)).toBe(`${VERSION_MODELE}.1`);
    const b = retablirModele(a, 'conditions', 'Zoé', '2026-10-06T11:00:00Z');
    expect(estModifie('conditions', b)).toBe(false);
    expect(versionJuridique(b)).toBe(`${VERSION_MODELE}.2`);
    expect(modifierDocument(undefined, 'conditions', 'x'.repeat(TAILLE_MAX_DOCUMENT + 50), undefined, 'd').documents.conditions).toHaveLength(TAILLE_MAX_DOCUMENT);
  });

  it('relit ce qui vient du relais avec méfiance', () => {
    expect(lireDocsJuridiques(null)).toBeUndefined();
    expect(lireDocsJuridiques({ revision: -1 })).toBeUndefined();
    expect(lireDocsJuridiques({ revision: 2, modifieLe: 'x', documents: { conditions: 'ok', inconnu: 'non', cookies: 5 } })).toEqual({ revision: 2, modifieLe: 'x', documents: { conditions: 'ok' } });
  });

  it('découpe en intertitres, paragraphes et puces', () => {
    expect(blocsDuTexte('## Titre\n\nUn\npara\n\n- a\n- b')).toEqual([
      { genre: 'titre', texte: 'Titre' },
      { genre: 'paragraphe', texte: 'Un para' },
      { genre: 'puces', elements: ['a', 'b'] },
    ]);
  });

  it('acceptation : demandée à la première connexion, redemandée si la version change', () => {
    const v1 = versionJuridique(undefined);
    let acc = lireAcceptations(undefined);
    expect(doitAccepter(acc, v1)).toBe(true);
    acc = accepter(acc, v1, '2026-10-06T10:00:00Z');
    expect(doitAccepter(acc, v1)).toBe(false);
    const v2 = versionJuridique(modifierDocument(undefined, 'mentions', 'Nouveau', undefined, 'd'));
    expect(doitAccepter(acc, v2)).toBe(true);
    expect(lireAcceptations(JSON.stringify(acc))).toEqual(acc);
    expect(lireAcceptations('{{')).toEqual([]);
  });
});
