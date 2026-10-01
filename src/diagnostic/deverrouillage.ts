/**
 * Diagnostic de l'écran de déverrouillage.
 *
 * Ce que le support doit savoir quand des identifiants justes sont refusés,
 * et RIEN de secret : ni mot de passe, ni code, ni clé, ni identifiant de
 * compte, ni jeton du relais, ni empreinte du coffre. Seulement des oui/non,
 * des versions et des durées. Le texte produit est fait pour être copié et
 * envoyé tel quel.
 */

/** Au-delà de cet écart avec le relais, les codes à six chiffres risquent d'être refusés. */
export const SEUIL_ECART_HORLOGE_S = 20;

export interface EntreesDiagnostic {
  version: string;
  /** Navigateur / système, abrégé (jamais l'agent utilisateur complet). */
  plateforme: string;
  /** Écart avec le relais en secondes (positif : appareil en avance), `undefined` si inconnu. */
  ecartHorlogeS?: number;
  cryptoSubtle: boolean;
  webAssembly: boolean;
  /** Mémoire annoncée par le navigateur (Go), quand il la donne. */
  memoireGo?: number;
  liaisonRelais: boolean;
  coffreLocal: boolean;
  /** Ancienneté connue du coffre local, en jours. */
  coffreAgeJours?: number;
  /** Coffre local identique à celui publié sur le relais (`undefined` : inconnu). */
  coffreIdentiqueAuRelais?: boolean;
}

/** Plateforme abrégée, sans numéro de build ni identifiant d'appareil. */
export function plateformeAbregee(agent: string | undefined): string {
  if (!agent) return 'inconnue';
  const ipad = /iPad/.test(agent) || (/Macintosh/.test(agent) && /Mobile\//.test(agent));
  const systeme = /iPhone/.test(agent)
    ? 'iPhone'
    : ipad
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(agent)
            ? 'macOS'
            : /Linux/.test(agent)
              ? 'Linux'
              : 'autre';
  const ios = /OS (\d+)[_.](\d+)/.exec(agent);
  const navigateur = /Electron\//.test(agent)
    ? 'Electron'
    : /CriOS|Chrome\//.test(agent) && !/Edg\//.test(agent)
      ? 'Chrome'
      : /Edg\//.test(agent)
        ? 'Edge'
        : /FxiOS|Firefox\//.test(agent)
          ? 'Firefox'
          : /Safari\//.test(agent)
            ? 'Safari'
            : /AppleWebKit/.test(agent)
              ? 'WebKit (app)'
              : 'autre';
  return `${systeme}${ios && (systeme === 'iPhone' || systeme === 'iPad') ? ` ${ios[1]}.${ios[2]}` : ''} · ${navigateur}`;
}

/** Ce que l'environnement JavaScript offre, lu sans rien demander à l'utilisateur. */
export function lireEnvironnement(g: typeof globalThis = globalThis): Pick<EntreesDiagnostic, 'plateforme' | 'cryptoSubtle' | 'webAssembly' | 'memoireGo'> {
  const nav = (g as { navigator?: { userAgent?: string; deviceMemory?: number } }).navigator;
  const memoire = nav?.deviceMemory;
  return {
    plateforme: plateformeAbregee(nav?.userAgent),
    cryptoSubtle: Boolean((g as { crypto?: { subtle?: unknown } }).crypto?.subtle),
    webAssembly: typeof (g as { WebAssembly?: unknown }).WebAssembly === 'object',
    ...(typeof memoire === 'number' && Number.isFinite(memoire) ? { memoireGo: memoire } : {}),
  };
}

/** Message à montrer quand l'horloge de l'appareil est trop décalée, sinon `undefined`. */
export function messageHorloge(ecartMs: number | undefined): string | undefined {
  if (ecartMs === undefined || !Number.isFinite(ecartMs)) return undefined;
  const secondes = Math.round(Math.abs(ecartMs) / 1000);
  if (secondes <= SEUIL_ECART_HORLOGE_S) return undefined;
  return `L’heure de cet appareil est décalée de ${secondes} secondes (${ecartMs > 0 ? 'en avance' : 'en retard'}) : activez le réglage automatique de la date et de l’heure, puis saisissez un nouveau code.`;
}

const ouiNon = (valeur: boolean | undefined) => (valeur === undefined ? 'inconnu' : valeur ? 'oui' : 'non');

/** Texte à copier pour le support : une ligne par point, aucune donnée secrète. */
export function formaterDiagnostic(d: EntreesDiagnostic): string {
  const ecart =
    d.ecartHorlogeS === undefined
      ? 'inconnu (relais injoignable ou trop ancien)'
      : `${d.ecartHorlogeS > 0 ? '+' : ''}${d.ecartHorlogeS} s${Math.abs(d.ecartHorlogeS) > SEUIL_ECART_HORLOGE_S ? ' (TROP DÉCALÉE)' : ''}`;
  return [
    'Diagnostic du déverrouillage',
    `Version : ${d.version}`,
    `Plateforme : ${d.plateforme}`,
    `Écart d’horloge avec le relais : ${ecart}`,
    `crypto.subtle : ${ouiNon(d.cryptoSubtle)}`,
    `WebAssembly : ${ouiNon(d.webAssembly)}`,
    `Mémoire annoncée : ${d.memoireGo === undefined ? 'inconnue' : `${d.memoireGo} Go`}`,
    `Liaison au relais : ${ouiNon(d.liaisonRelais)}`,
    `Coffre local : ${d.coffreLocal ? `oui${d.coffreAgeJours === undefined ? '' : ` (connu depuis ${d.coffreAgeJours} j)`}` : 'non'}`,
    `Coffre local = coffre publié par le PC : ${ouiNon(d.coffreIdentiqueAuRelais)}`,
  ].join('\n');
}
