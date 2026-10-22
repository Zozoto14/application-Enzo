/**
 * Coffre serveur des comptes (relais version 9, relais/coffres.mjs) dans PostgreSQL.
 *
 *   relais_coffre             un enregistrement chiffré par (compte, identifiant opaque) : révision,
 *                             date, suppression, valeur (TEXT : enveloppe JSON en base 64, jusqu'à
 *                             8 Mio ; TEXT accepte 1 Go, inutile de passer en BYTEA)
 *   relais_coffre_rev         compteur de révisions par compte (verrouillé pendant une écriture :
 *                             deux appareils qui écrivent en même temps sont servis l'un après l'autre)
 *   relais_coffre_historique  corbeille et conflits, gardés RETENTION_HISTORIQUE_JOURS jours
 *
 * Lecture par pages : `rev > depuis ORDER BY rev LIMIT n` (index (profil, rev)), bornée en octets.
 * `espace` (tests) : préfixe des comptes, pour isoler plusieurs magasins dans un même schéma.
 */

import { MAX_HISTORIQUE, OCTETS_PAGE_MAX, RETENTION_HISTORIQUE_JOURS, decider } from '../coffres.mjs';

export async function creerTablesCoffres(base) {
  await base.script(`CREATE TABLE IF NOT EXISTS relais_coffre (
  profil TEXT NOT NULL,
  id TEXT NOT NULL,
  rev BIGINT NOT NULL,
  date TEXT NOT NULL,
  supprime BOOLEAN NOT NULL DEFAULT FALSE,
  valeur TEXT NOT NULL,
  PRIMARY KEY (profil, id)
);
CREATE INDEX IF NOT EXISTS relais_coffre_rev_idx ON relais_coffre (profil, rev);
CREATE TABLE IF NOT EXISTS relais_coffre_rev (
  profil TEXT PRIMARY KEY,
  rev BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS relais_coffre_historique (
  num BIGSERIAL PRIMARY KEY,
  profil TEXT NOT NULL,
  id TEXT NOT NULL,
  rev BIGINT NOT NULL,
  date TEXT NOT NULL,
  supprime BOOLEAN NOT NULL DEFAULT FALSE,
  valeur TEXT NOT NULL,
  raison TEXT NOT NULL,
  le BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS relais_coffre_historique_idx ON relais_coffre_historique (profil, le);`);
}

/** Purge de l'historique trop ancien (cron). Rend le nombre de lignes effacées. */
export async function purgerHistoriqueCoffres(base, maintenant = Date.now()) {
  const existe = await base.premier("SELECT to_regclass('relais_coffre_historique') IS NOT NULL AS ok", []);
  if (!existe?.ok) return 0;
  return (await base.executer('DELETE FROM relais_coffre_historique WHERE le < ?', [maintenant - RETENTION_HISTORIQUE_JOURS * 86_400_000])).changements;
}

const ligne = r => ({ id: r.id, rev: Number(r.rev), date: r.date, supprime: Boolean(r.supprime), valeur: r.valeur });

export function coffresPostgres(base, { espace = '', maintenant = () => Date.now() } = {}) {
  const pool = base.pool;
  const p = profil => (espace ? `${espace}:${profil}` : profil);
  return {
    async lire(profil, depuis = 0, limite = 500, octetsMax = OCTETS_PAGE_MAX) {
      const cle = p(profil);
      const revRow = (await pool.query('SELECT rev FROM relais_coffre_rev WHERE profil = $1', [cle])).rows[0];
      const lignes = (
        await pool.query('SELECT id, rev, date, supprime, valeur FROM relais_coffre WHERE profil = $1 AND rev > $2 ORDER BY rev LIMIT $3', [cle, depuis, limite + 1])
      ).rows;
      const page = [];
      let octets = 0;
      for (const r of lignes.slice(0, limite)) {
        if (page.length > 0 && octets + r.valeur.length > octetsMax) break;
        page.push(ligne(r));
        octets += r.valeur.length;
      }
      return { rev: Number(revRow?.rev ?? 0), enregistrements: page, suite: page.length < lignes.length };
    },

    async ecrire(profil, enregistrements) {
      const cle = p(profil);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO relais_coffre_rev (profil, rev) VALUES ($1, 0) ON CONFLICT (profil) DO NOTHING', [cle]);
        // Verrou du compte : les écritures concurrentes d'un même compte passent l'une après l'autre.
        let rev = Number((await client.query('SELECT rev FROM relais_coffre_rev WHERE profil = $1 FOR UPDATE', [cle])).rows[0].rev);
        const avant = rev;
        const existants = new Map(
          (
            await client.query('SELECT id, rev, date, supprime, valeur FROM relais_coffre WHERE profil = $1 AND id = ANY($2)', [cle, enregistrements.map(e => e.id)])
          ).rows.map(r => [r.id, ligne(r)]),
        );
        const le = maintenant();
        const historiser = (r, raison) =>
          client.query('INSERT INTO relais_coffre_historique (profil, id, rev, date, supprime, valeur, raison, le) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
            cle,
            r.id,
            r.rev,
            r.date,
            r.supprime,
            r.valeur,
            raison,
            le,
          ]);
        const resultats = [];
        let historise = false;
        for (const e of enregistrements) {
          const existant = existants.get(e.id);
          const d = decider(existant, e);
          if (d.issue === 'perdu') {
            await historiser({ ...e, rev: existant.rev }, 'conflit');
            historise = true;
            resultats.push({ id: e.id, rev: existant.rev, etat: 'perdu', actuel: existant });
            continue;
          }
          if (d.garder && existant) {
            await historiser(existant, d.garder);
            historise = true;
          }
          rev++;
          await client.query(
            `INSERT INTO relais_coffre (profil, id, rev, date, supprime, valeur) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (profil, id) DO UPDATE SET rev = excluded.rev, date = excluded.date, supprime = excluded.supprime, valeur = excluded.valeur`,
            [cle, e.id, rev, e.date, e.supprime, e.valeur],
          );
          existants.set(e.id, { id: e.id, rev, date: e.date, supprime: e.supprime, valeur: e.valeur });
          resultats.push({ id: e.id, rev, etat: 'ok' });
        }
        await client.query('UPDATE relais_coffre_rev SET rev = $2 WHERE profil = $1', [cle, rev]);
        if (historise) {
          await client.query('DELETE FROM relais_coffre_historique WHERE profil = $1 AND le < $2', [cle, le - RETENTION_HISTORIQUE_JOURS * 86_400_000]);
          await client.query(
            'DELETE FROM relais_coffre_historique WHERE num IN (SELECT num FROM relais_coffre_historique WHERE profil = $1 ORDER BY num DESC OFFSET $2)',
            [cle, MAX_HISTORIQUE],
          );
        }
        await client.query('COMMIT');
        return { rev, avant, resultats };
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },

    /** Révision courante du coffre (une ligne, clé primaire) : sert aux avis et au sondage (v10). */
    async version(profil) {
      const r = (await pool.query('SELECT rev FROM relais_coffre_rev WHERE profil = $1', [p(profil)])).rows[0];
      return Number(r?.rev ?? 0);
    },

    async historique(profil, limite = 200) {
      const lignes = (
        await pool.query('SELECT id, rev, date, supprime, valeur, raison, le FROM relais_coffre_historique WHERE profil = $1 ORDER BY num DESC LIMIT $2', [p(profil), limite])
      ).rows;
      return lignes.map(r => ({ ...ligne(r), raison: r.raison, le: Number(r.le) }));
    },

    async etat(profil) {
      const cle = p(profil);
      const revRow = (await pool.query('SELECT rev FROM relais_coffre_rev WHERE profil = $1', [cle])).rows[0];
      const t = (await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(valeur)), 0) AS o FROM relais_coffre WHERE profil = $1', [cle])).rows[0];
      const h = (await pool.query('SELECT COUNT(*) AS n FROM relais_coffre_historique WHERE profil = $1', [cle])).rows[0];
      return { rev: Number(revRow?.rev ?? 0), enregistrements: Number(t.n), octets: Number(t.o), historique: Number(h.n) };
    },

    async vider(profil) {
      const cle = p(profil);
      await pool.query('DELETE FROM relais_coffre WHERE profil = $1', [cle]);
      await pool.query('DELETE FROM relais_coffre_historique WHERE profil = $1', [cle]);
      await pool.query('DELETE FROM relais_coffre_rev WHERE profil = $1', [cle]);
    },
  };
}
