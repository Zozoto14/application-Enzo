/**
 * Analyse et resolution d'adresses web, en JavaScript pur.
 *
 * Pourquoi ne pas utiliser `URL` ? Celui de React Native est une imitation a
 * base d'expressions regulieres : il ne resout pas « ../x » ni « //hote/x »,
 * ne normalise pas l'hote et ignore les IP ecrites en decimal ou en hexa.
 * Le moteur devant se comporter a l'identique sur iPhone, dans Electron et
 * dans un navigateur, il porte sa propre analyse, alignee sur les regles
 * WHATWG pour http(s) (celles des navigateurs) :
 *
 * - tabulations et retours a la ligne supprimes, espaces de bord retires ;
 * - « \ » traite comme « / » ; barres obliques en trop apres le schema ignorees ;
 * - hote decode (%xx), en minuscules ; IPv4 en decimal, octal ou hexadecimal
 *   ramenee a la forme pointee ; IPv6 normalisee entre crochets ;
 * - segments « . » et « .. » resolus ; port par defaut retire.
 *
 * Seuls http et https sont analyses completement : tout autre schema est
 * rendu tel quel (schema + reste), et la garde le refuse.
 */

export interface Adresse {
  /** Schema en minuscules, sans « : » (http, https, javascript...). */
  schema: string;
  /** Hote normalise ; IPv6 entre crochets. Vide pour un schema non http(s). */
  hote: string;
  /** Port explicite non standard, sinon chaine vide. */
  port: string;
  /** Chemin commencant par « / » (http(s)) ou contenu opaque (autre schema). */
  chemin: string;
  /** « ?... » ou vide. */
  requete: string;
  /** « #... » ou vide. */
  fragment: string;
  /** Presence d'identifiants (utilisateur:motdepasse@). */
  identifiants: boolean;
  /** Nature de l'hote. */
  typeHote: 'nom' | 'ipv4' | 'ipv6' | 'aucun';
}

const SPECIAUX: Record<string, string> = { http: '80', https: '443' };
const SCHEMA = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

// Caracteres interdits dans un nom d'hote (WHATWG « forbidden domain code point »),
// plus tout ce qui n'est pas ASCII : on n'applique pas IDNA, un nom
// international doit etre fourni sous sa forme « xn-- ».
const HOTE_INTERDIT = /[\u0000- #%/:<>?@[\\\]^|\u007f-￿]/;

function nettoyer(texte: string): string {
  // eslint-disable-next-line no-control-regex
  return texte.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
}

function decoderPourcent(texte: string): string | null {
  try {
    return decodeURIComponent(texte);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// IPv4 et IPv6
// ---------------------------------------------------------------------------

function nombreIpv4(partie: string): number | null {
  if (partie === '') {
    return null;
  }
  let base = 10;
  let t = partie;
  if (/^0x/i.test(t)) {
    base = 16;
    t = t.slice(2);
  } else if (t.length > 1 && t.startsWith('0')) {
    base = 8;
    t = t.slice(1);
  }
  if (t === '') {
    return 0;
  }
  const motif = base === 16 ? /^[0-9a-f]+$/i : base === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
  if (!motif.test(t)) {
    return null;
  }
  const n = parseInt(t, base);
  return Number.isFinite(n) ? n : null;
}

/** Le dernier libelle est-il un nombre ? Alors l'hote DOIT etre une IPv4. */
export function finitParUnNombre(hote: string): boolean {
  const parties = hote.split('.');
  if (parties[parties.length - 1] === '' && parties.length > 1) {
    parties.pop();
  }
  const dernier = parties[parties.length - 1] ?? '';
  return /^[0-9]+$/.test(dernier) || /^0x[0-9a-f]*$/i.test(dernier);
}

/**
 * IPv4 selon WHATWG : « 2130706433 », « 0x7f.1 », « 0177.0.0.1 » et
 * « 127.1 » designent tous 127.0.0.1. Renvoie la valeur 32 bits, ou null.
 */
export function analyserIpv4(hote: string): number | null {
  const parties = hote.split('.');
  if (parties[parties.length - 1] === '' && parties.length > 1) {
    parties.pop();
  }
  if (parties.length === 0 || parties.length > 4) {
    return null;
  }
  const nombres: number[] = [];
  for (const p of parties) {
    const n = nombreIpv4(p);
    if (n === null) {
      return null;
    }
    nombres.push(n);
  }
  for (let i = 0; i < nombres.length - 1; i += 1) {
    if (nombres[i] > 255) {
      return null;
    }
  }
  const dernier = nombres[nombres.length - 1];
  if (dernier >= 256 ** (5 - nombres.length)) {
    return null;
  }
  let valeur = dernier;
  for (let i = 0; i < nombres.length - 1; i += 1) {
    valeur += nombres[i] * 256 ** (3 - i);
  }
  return valeur;
}

export function ipv4EnTexte(valeur: number): string {
  return [24, 16, 8, 0].map(d => Math.floor(valeur / 2 ** d) % 256).join('.');
}

/** IPv6 (sans crochets) vers 8 mots de 16 bits, ou null. Zones (%eth0) refusees. */
export function analyserIpv6(texte: string): number[] | null {
  const t = texte.toLowerCase();
  if (!t || /[^0-9a-f:.]/.test(t)) {
    return null;
  }
  const doubles = t.split('::');
  if (doubles.length > 2) {
    return null;
  }
  const lire = (bloc: string): number[] | null => {
    if (bloc === '') {
      return [];
    }
    const mots: number[] = [];
    const groupes = bloc.split(':');
    for (let i = 0; i < groupes.length; i += 1) {
      const g = groupes[i];
      if (g.includes('.')) {
        // IPv4 finale (::ffff:1.2.3.4) : uniquement en derniere position.
        if (i !== groupes.length - 1 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(g)) {
          return null;
        }
        const octets = g.split('.').map(Number);
        if (octets.some(o => o > 255)) {
          return null;
        }
        mots.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(g)) {
          return null;
        }
        mots.push(parseInt(g, 16));
      }
    }
    return mots;
  };
  const avant = lire(doubles[0]);
  const apres = doubles.length === 2 ? lire(doubles[1]) : [];
  if (!avant || !apres) {
    return null;
  }
  if (doubles.length === 1) {
    return avant.length === 8 ? avant : null;
  }
  const manquants = 8 - avant.length - apres.length;
  if (manquants < 1) {
    return null;
  }
  return [...avant, ...new Array<number>(manquants).fill(0), ...apres];
}

export function ipv6EnTexte(mots: number[]): string {
  // Compresse la plus longue suite de zeros (au moins deux mots).
  let debut = -1;
  let longueur = 0;
  for (let i = 0; i < 8; ) {
    if (mots[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && mots[j] === 0) {
      j += 1;
    }
    if (j - i > longueur && j - i >= 2) {
      debut = i;
      longueur = j - i;
    }
    i = j;
  }
  const hex = mots.map(m => m.toString(16));
  if (debut === -1) {
    return hex.join(':');
  }
  return `${hex.slice(0, debut).join(':')}::${hex.slice(debut + longueur).join(':')}`;
}

// ---------------------------------------------------------------------------
// Hote, chemin
// ---------------------------------------------------------------------------

function analyserHote(brut: string): { hote: string; typeHote: Adresse['typeHote'] } | null {
  if (brut.startsWith('[')) {
    if (!brut.endsWith(']')) {
      return null;
    }
    const mots = analyserIpv6(brut.slice(1, -1));
    return mots ? { hote: `[${ipv6EnTexte(mots)}]`, typeHote: 'ipv6' } : null;
  }
  const decode = decoderPourcent(brut);
  if (decode === null || decode === '') {
    return null;
  }
  const hote = decode.toLowerCase();
  if (HOTE_INTERDIT.test(hote)) {
    return null;
  }
  if (finitParUnNombre(hote)) {
    const v4 = analyserIpv4(hote);
    return v4 === null ? null : { hote: ipv4EnTexte(v4), typeHote: 'ipv4' };
  }
  return { hote, typeHote: 'nom' };
}

function encoder(texte: string, encodeGuillemetSimple: boolean): string {
  let out = '';
  for (const car of texte) {
    const code = car.codePointAt(0) ?? 0;
    const aEncoder =
      code <= 0x20 ||
      code >= 0x7f ||
      car === '"' ||
      car === '<' ||
      car === '>' ||
      car === '`' ||
      (encodeGuillemetSimple && car === "'");
    out += aEncoder ? encodeURIComponent(car) : car;
  }
  return out;
}

const estPoint = (s: string) => s === '.' || s.toLowerCase() === '%2e';
const estDoublePoint = (s: string) => {
  const l = s.toLowerCase();
  return l === '..' || l === '.%2e' || l === '%2e.' || l === '%2e%2e';
};

/** Resout les segments « . » et « .. » d'un chemin absolu. */
export function simplifierChemin(chemin: string): string {
  const segments = chemin.split('/').slice(1);
  const sortie: string[] = [];
  segments.forEach((s, i) => {
    const dernier = i === segments.length - 1;
    if (estDoublePoint(s)) {
      sortie.pop();
      if (dernier) {
        sortie.push('');
      }
    } else if (estPoint(s)) {
      if (dernier) {
        sortie.push('');
      }
    } else {
      sortie.push(s);
    }
  });
  return `/${sortie.join('/')}`;
}

function decouper(reste: string): { avant: string; requete: string; fragment: string } {
  let fragment = '';
  let t = reste;
  const diese = t.indexOf('#');
  if (diese !== -1) {
    fragment = t.slice(diese);
    t = t.slice(0, diese);
  }
  let requete = '';
  const interro = t.indexOf('?');
  if (interro !== -1) {
    requete = t.slice(interro);
    t = t.slice(0, interro);
  }
  return { avant: t, requete, fragment };
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

function analyserAbsolue(schema: string, reste: string): Adresse | null {
  if (!(schema in SPECIAUX)) {
    return {
      schema,
      hote: '',
      port: '',
      chemin: reste,
      requete: '',
      fragment: '',
      identifiants: false,
      typeHote: 'aucun',
    };
  }
  const sansBarres = reste.replace(/^[/\\]+/, '');
  const { avant, requete, fragment } = decouper(sansBarres);
  const fin = avant.search(/[/\\]/);
  let autorite = fin === -1 ? avant : avant.slice(0, fin);
  const chemin = fin === -1 ? '/' : avant.slice(fin).replace(/\\/g, '/');

  let identifiants = false;
  const arobase = autorite.lastIndexOf('@');
  if (arobase !== -1) {
    identifiants = true;
    autorite = autorite.slice(arobase + 1);
  }

  let hoteBrut = autorite;
  let port = '';
  const deuxPoints = autorite.startsWith('[') ? autorite.indexOf(':', autorite.indexOf(']')) : autorite.lastIndexOf(':');
  if (deuxPoints !== -1) {
    hoteBrut = autorite.slice(0, deuxPoints);
    port = autorite.slice(deuxPoints + 1);
    if (port !== '' && (!/^\d+$/.test(port) || Number(port) > 65535)) {
      return null;
    }
    if (port !== '') {
      port = String(Number(port));
    }
    if (port === SPECIAUX[schema]) {
      port = '';
    }
  }
  const hote = analyserHote(hoteBrut);
  if (!hote) {
    return null;
  }
  return {
    schema,
    hote: hote.hote,
    port,
    chemin: encoder(simplifierChemin(chemin), false),
    requete: encoder(requete, true),
    fragment: encoder(fragment, false),
    identifiants,
    typeHote: hote.typeHote,
  };
}

/**
 * Analyse `texte`, eventuellement relatif a `base`. Renvoie null si
 * l'adresse est invalide ou si elle est relative sans base utilisable.
 */
export function analyserAdresse(texte: unknown, base?: string | Adresse | null): Adresse | null {
  if (typeof texte !== 'string') {
    return null;
  }
  const t = nettoyer(texte);
  const schema = SCHEMA.exec(t);
  if (schema) {
    return analyserAbsolue(schema[1].toLowerCase(), t.slice(schema[0].length));
  }
  const b = typeof base === 'string' ? analyserAdresse(base) : base ?? null;
  if (!b || !(b.schema in SPECIAUX)) {
    return null;
  }
  const rel = t.replace(/^([^?#]*)/, m => m.replace(/\\/g, '/'));
  if (rel.startsWith('//')) {
    return analyserAbsolue(b.schema, rel);
  }
  const { avant, requete, fragment } = decouper(rel);
  const encodees = { requete: encoder(requete, true), fragment: encoder(fragment, false) };
  if (avant === '') {
    return {
      ...b,
      requete: rel.startsWith('#') ? b.requete : encodees.requete,
      fragment: encodees.fragment,
    };
  }
  const chemin = avant.startsWith('/')
    ? avant
    : `${b.chemin.slice(0, b.chemin.lastIndexOf('/') + 1)}${avant}`;
  return { ...b, chemin: encoder(simplifierChemin(chemin), false), ...encodees };
}

export function origineDe(a: Adresse): string {
  return `${a.schema}://${a.hote}${a.port ? `:${a.port}` : ''}`;
}

/** Forme texte canonique (identifiants retires : on ne les reemet jamais). */
export function adresseEnTexte(a: Adresse): string {
  if (a.typeHote === 'aucun') {
    return `${a.schema}:${a.chemin}`;
  }
  return `${origineDe(a)}${a.chemin}${a.requete}${a.fragment}`;
}

/** Resout `texte` par rapport a `base` et renvoie la forme canonique, ou null. */
export function resoudreAdresse(texte: unknown, base?: string | null): string | null {
  const a = analyserAdresse(texte, base);
  return a ? adresseEnTexte(a) : null;
}

/** Hote sans « www. » ni point final : sert a comparer deux sites. */
export function hoteDeSite(a: Adresse): string {
  return a.hote.replace(/\.$/, '').replace(/^www\./, '');
}
