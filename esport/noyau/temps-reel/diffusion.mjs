/**
 * Temps réel : écriture du journal `temps_reel_flux` et transport entre processus (docs/esport/temps-reel.md).
 *
 *  - `publierEnBase(base, message)` : ajoute une ligne (identifiant = plus grand + 1, donc croissant dans
 *    l'ordre des écritures validées) puis prévient les processus :
 *      PostgreSQL → `pg_notify` sur un canal propre au schéma (tous les processus Node du pool Passenger,
 *                   et le cron, qui écrit des notifications, passent par la même base) ;
 *      SQLite     → bus en mémoire (un seul processus : tests, serveur de développement).
 *  - `ecouterBase(base, recevoir)` : abonnement d'un processus. PostgreSQL : une connexion LISTEN dédiée,
 *    ouverte SEULEMENT tant qu'un navigateur est connecté à ce processus (aucune connexion de plus au repos),
 *    rouverte avec une attente croissante si elle tombe, puis rattrapage par le curseur (rien n'est perdu).
 *  - `relire(base, depuis, limite)` : reprise après coupure (le navigateur donne son `dernierId`).
 *  - `purger(base, t)` : garde deux heures de journal (et toujours la dernière ligne : le curseur continue).
 */

import { iso } from '../outils.mjs';

export const DUREE_JOURNAL_MS = 2 * 3_600_000;
const ESSAIS_INSERTION = 8;

/** Bus en mémoire par base (SQLite : un seul processus). */
const busLocaux = new WeakMap();
const busLocal = base => {
  let b = busLocaux.get(base);
  if (!b) {
    b = new Set();
    busLocaux.set(base, b);
  }
  return b;
};

export const estPostgres = base => base?.dialecte === 'postgres' && Boolean(base.pool);
/** Canal NOTIFY (un par schéma : les bases de test partagent la même base PostgreSQL). */
export const canalDe = base => `esport_tr_${String(base?.schema || 'public').replace(/[^a-z0-9_]/g, '_')}`.slice(0, 63);

/** Ligne du journal → message interne (champs courts, sans donnée métier). */
export function messageDeLigne(l) {
  return {
    id: Number(l.id),
    sujet: l.sujet,
    ...(l.cle ? { cle: l.cle } : {}),
    ...(l.sonde ? { sonde: l.sonde } : {}),
    ...(Number(l.objet_public) === 1 ? { objetPublic: true } : {}),
    ...(l.version !== null && l.version !== undefined ? { version: Number(l.version) } : {}),
    ...(l.action ? { action: l.action } : {}),
    ...(l.acteur ? { acteur: l.acteur } : {}),
    ...(l.pseudo ? { pseudo: l.pseudo } : {}),
    ...(Number(l.invalider) === 1 ? { invalider: true } : {}),
    le: l.cree_le,
    t: Date.parse(l.cree_le) || undefined,
  };
}

/** Prévient les processus (PostgreSQL) ou le bus en mémoire (SQLite). Messages éphémères (présence) compris. */
export async function prevenir(base, message) {
  if (estPostgres(base)) {
    const texte = JSON.stringify(message);
    // Limite de pg_notify : 8000 octets ; un message ne porte que des identifiants, très loin de là.
    if (texte.length > 7900) return;
    await base.executer('SELECT pg_notify(?, ?)', [canalDe(base), texte]);
    return;
  }
  for (const f of [...busLocal(base)]) {
    queueMicrotask(() => {
      try {
        f(message);
      } catch {
        // Un abonné en panne ne gêne pas les autres.
      }
    });
  }
}

/**
 * Ajoute un changement au journal et prévient les processus. `m` : `{ sujet, cle?, sonde?, objetPublic?, version?,
 * action?, acteur?, pseudo?, invalider? }`. Rend le message (avec son `id`).
 */
export async function publierEnBase(base, m, maintenant = Date.now()) {
  const le = iso(maintenant);
  let id;
  for (let essai = 0; essai < ESSAIS_INSERTION && id === undefined; essai++) {
    try {
      const l = await base.premier(
        `INSERT INTO temps_reel_flux (id, sujet, cle, sonde, objet_public, version, action, acteur, pseudo, invalider, cree_le)
         SELECT COALESCE(MAX(id), 0) + 1, ?, ?, ?, CAST(? AS INTEGER), CAST(? AS INTEGER), ?, ?, ?, CAST(? AS INTEGER), ? FROM temps_reel_flux RETURNING id`,
        [m.sujet, m.cle ?? null, m.sonde ?? null, m.objetPublic ? 1 : 0, m.version ?? null, m.action ?? null, m.acteur ?? null, m.pseudo ?? null, m.invalider ? 1 : 0, le],
      );
      id = Number(l?.id);
    } catch (e) {
      // Deux écritures simultanées ont pris le même numéro : la seconde réessaie (après la première).
      if (!/UNIQUE|unique|duplicate|constraint/i.test(String(e?.message)) || essai === ESSAIS_INSERTION - 1) throw e;
      await new Promise(ok => setTimeout(ok, 2 + Math.random() * 10 * (essai + 1)));
    }
  }
  const message = messageDeLigne({ id, sujet: m.sujet, cle: m.cle, sonde: m.sonde, objet_public: m.objetPublic ? 1 : 0, version: m.version ?? null, action: m.action, acteur: m.acteur, pseudo: m.pseudo, invalider: m.invalider ? 1 : 0, cree_le: le });
  await prevenir(base, message);
  return message;
}

/** Changements après `depuis` (curseur du navigateur), dans l'ordre. */
export async function relire(base, depuis, limite = 200) {
  const lignes = await base.tous('SELECT * FROM temps_reel_flux WHERE id > ? ORDER BY id LIMIT ?', [depuis, limite]);
  return lignes.map(messageDeLigne);
}

/** Bornes du journal : `{ min, max }` (0 si vide). */
export async function bornes(base) {
  const l = await base.premier('SELECT MIN(id) AS min, MAX(id) AS max FROM temps_reel_flux', []);
  return { min: Number(l?.min ?? 0), max: Number(l?.max ?? 0) };
}

/** Purge du journal et des présences expirées (la dernière ligne reste : le curseur ne repart jamais à 1). */
export async function purger(base, maintenant = Date.now()) {
  const limite = iso(maintenant - DUREE_JOURNAL_MS);
  const max = (await bornes(base)).max;
  const a = await base.executer('DELETE FROM temps_reel_flux WHERE cree_le < ? AND id < ?', [limite, max]);
  const b = await base.executer('DELETE FROM temps_reel_presences WHERE jusqua < ?', [iso(maintenant)]);
  return a.changements + b.changements;
}

/**
 * Abonne `recevoir(message)` aux changements de la base. Rend `{ fermer() }`. PostgreSQL : connexion LISTEN
 * dédiée (rouverte en cas de coupure ; `rattraper()` est appelé après chaque réouverture).
 */
export function ecouterBase(base, recevoir, { rattraper = () => undefined, journal = console } = {}) {
  if (!estPostgres(base)) {
    const bus = busLocal(base);
    bus.add(recevoir);
    return { fermer: async () => void bus.delete(recevoir), pret: Promise.resolve() };
  }
  let client;
  let ferme = false;
  let essais = 0;
  let minuterie;
  const canal = canalDe(base);
  const ouvrir = async () => {
    if (ferme) return;
    const pool = base.pool;
    const c = new pool.Client(pool.options);
    client = c;
    c.on('notification', n => {
      if (n.channel !== canal) return;
      try {
        recevoir(JSON.parse(n.payload));
      } catch {
        // Message illisible : ignoré.
      }
    });
    c.on('error', e => {
      journal.error?.('[esport] temps réel : écoute PostgreSQL coupée', e?.message ?? e);
      relancer(c);
    });
    c.on('end', () => relancer(c));
    try {
      await c.connect();
      await c.query(`LISTEN "${canal}"`);
      if (ferme) {
        await c.end().catch(() => undefined);
        return;
      }
      if (essais > 0) await rattraper();
      essais = 0;
    } catch (e) {
      journal.error?.('[esport] temps réel : écoute PostgreSQL impossible', e?.message ?? e);
      relancer(c);
    }
  };
  const relancer = c => {
    if (ferme || c !== client) return;
    client = undefined;
    c.end().catch(() => undefined);
    if (minuterie) return;
    // Attente croissante (1 s → 30 s) : jamais de reconnexion en boucle.
    const pause = Math.min(30_000, 1000 * 2 ** Math.min(5, essais++));
    minuterie = setTimeout(() => {
      minuterie = undefined;
      void ouvrir();
    }, pause);
    minuterie.unref?.();
  };
  const pret = ouvrir();
  return {
    pret,
    fermer: async () => {
      ferme = true;
      if (minuterie) clearTimeout(minuterie);
      const c = client;
      client = undefined;
      await pret.catch(() => undefined);
      await c?.end().catch(() => undefined);
    },
  };
}
