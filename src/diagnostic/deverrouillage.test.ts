import { formaterDiagnostic, lireEnvironnement, messageHorloge, plateformeAbregee } from './deverrouillage';

const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

describe('diagnostic du déverrouillage', () => {
  it('reconnaît l’iPad (qui se dit Macintosh) et l’iPhone, sans recopier l’agent utilisateur', () => {
    expect(plateformeAbregee(IPAD)).toBe('iPad · Safari');
    expect(plateformeAbregee(IPHONE)).toBe('iPhone 18.5 · Safari');
    expect(plateformeAbregee(undefined)).toBe('inconnue');
  });

  it('lit l’environnement sans rien exiger', () => {
    const env = lireEnvironnement({ navigator: { userAgent: IPHONE, deviceMemory: 4 }, crypto: { subtle: {} }, WebAssembly: {} } as never);
    expect(env).toEqual({ plateforme: 'iPhone 18.5 · Safari', cryptoSubtle: true, webAssembly: true, memoireGo: 4 });
    expect(lireEnvironnement({} as never)).toEqual({ plateforme: 'inconnue', cryptoSubtle: false, webAssembly: false });
  });

  it('ne contient aucun secret : seulement des oui/non, des versions et des durées', () => {
    const texte = formaterDiagnostic({
      version: '2026.10.10',
      plateforme: 'iPad · Safari',
      ecartHorlogeS: -92,
      cryptoSubtle: true,
      webAssembly: true,
      liaisonRelais: true,
      coffreLocal: true,
      coffreAgeJours: 12,
      coffreIdentiqueAuRelais: false,
    });
    expect(texte).toContain('Écart d’horloge avec le relais : -92 s (TROP DÉCALÉE)');
    expect(texte).toContain('Coffre local : oui (connu depuis 12 j)');
    expect(texte).toContain('Coffre local = coffre publié par le PC : non');
    expect(texte).toContain('Mémoire annoncée : inconnue');
    // Rien qui ressemble à une clé, un jeton, une adresse ou un code.
    expect(texte).not.toMatch(/[0-9a-f]{16,}|https?:|AB1\.|\b\d{6}\b/i);
  });

  it('écart inconnu (relais ancien) : dit tel quel ; écart faible : pas d’avis', () => {
    expect(formaterDiagnostic({ version: 'x', plateforme: 'y', cryptoSubtle: false, webAssembly: false, liaisonRelais: false, coffreLocal: false })).toContain(
      'inconnu (relais injoignable ou trop ancien)',
    );
    expect(messageHorloge(20_000)).toBeUndefined();
    expect(messageHorloge(21_000)).toMatch(/décalée de 21 secondes \(en avance\)/);
  });
});
