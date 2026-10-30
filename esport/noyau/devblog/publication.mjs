/**
 * Publication d'un devblog, partagée par l'éditeur (« Publier dans l'app », « Publier sur Discord », « 🚀 Tout
 * publier »), la publication PROGRAMMÉE (cron) et le mode AUTOMATIQUE (docs/esport/devblog.md).
 *
 *  - `ciblesPossibles(base)` : salons Discord proposés (salons du club par webhook, salon du bot, salons des teams) ;
 *  - `publierDansApp(base, id, …)` : brouillon → publié (versions française ET anglaise complètes exigées) ;
 *  - `mettreEnFileDiscord(base, id, …)` : une ligne par salon dans `devblog_discord` (jamais deux ; contenu corrigé :
 *    réédition) ; l'envoi est fait par `traiterDevblogDiscord` (discord.mjs) ;
 *  - `notifierGestionnaires` : notification in-app au Fondateur et aux comptes qui ont devblog.gerer.
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { comptesAvecGlobale } from '../roles/globales.mjs';
import { PERMISSION_DEVBLOG, contenuVide, empreinteTextes, lireContenu, messagesDiscord } from './regles.mjs';

export async function lireReglage(base, cle, repli) {
  return jsonOu((await base.premier('SELECT valeur FROM devblog_reglages WHERE cle = ?', [cle]))?.valeur, repli);
}

export async function ecrireReglage(base, cle, valeur, { par = null, t }) {
  await base.executer(
    'INSERT INTO devblog_reglages (cle, valeur, maj_par, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
    [cle, JSON.stringify(valeur), par, t],
  );
}

/** Salons possibles : salons du club (webhooks de la page Réseaux), salon du bot, salons des teams. */
export async function ciblesPossibles(base) {
  const club = (await base.tous('SELECT id, nom, fin, invalide_le FROM cm_rs_salons ORDER BY nom', [])).map(s => ({ cle: `salon:${s.id}`, genre: 'club', nom: s.nom, detail: `webhook …${s.fin}`, invalide: Boolean(s.invalide_le) }));
  const bot = await lireReglage(base, 'salon_bot', null);
  if (bot?.id) club.push({ cle: 'bot:club', genre: 'club', nom: bot.nom || `#${bot.id}`, detail: `bot · ${bot.id}`, invalide: false });
  const teams = await base.tous(
    `SELECT t.id, t.nom,
            (SELECT 1 FROM discord_serveurs s WHERE s.team_id = t.id) AS bot,
            (SELECT 1 FROM discord_webhooks w WHERE w.team_id = t.id) AS webhook
       FROM teams t
      WHERE t.supprimee_le IS NULL AND t.archivee_le IS NULL
        AND EXISTS (SELECT 1 FROM team_modules m WHERE m.team_id = t.id AND m.module = 'discord' AND m.active = 1)
      ORDER BY t.nom`,
    [],
  );
  return [
    ...club,
    ...teams.filter(t => t.bot || t.webhook).map(t => ({ cle: `team:${t.id}`, genre: 'team', nom: t.nom, detail: t.bot ? 'bot' : 'webhook', invalide: false })),
  ];
}

/** Salons cochés par défaut (« annonces du club ») encore valables. */
export async function ciblesParDefaut(base) {
  const connues = new Set((await ciblesPossibles(base)).map(p => p.cle));
  return (await lireReglage(base, 'cibles', [])).filter(c => connues.has(c));
}

export const entreeDiscord = l => ({ date: l.date_maj, version: l.version, contenuFr: jsonOu(l.contenu_fr, contenuVide()), contenuEn: jsonOu(l.contenu_en, contenuVide()) });

/** Les deux langues sont-elles prêtes à publier ? (exception 400 sinon) */
export function exigerComplet(l) {
  lireContenu(jsonOu(l.contenu_fr, null), { exiger: true, langue: 'fr' });
  lireContenu(jsonOu(l.contenu_en, null), { exiger: true, langue: 'en' });
}

/**
 * Brouillon → publié (idempotent : déjà publié, rien ne change). La programmation éventuelle est effacée.
 * `seulementSiProgramme` (cron) : ne publie que si la programmation est toujours celle attendue (aucun double).
 * Rend true si la ligne a été publiée par cet appel.
 */
export async function publierDansApp(base, id, { par = null, t, seulementSiProgramme = null }) {
  const r = seulementSiProgramme
    ? await base.executer(
      "UPDATE devblog_entrees SET statut = 'publie', publie_le = ?, publie_par = ?, programme_le = NULL, maj_le = ? WHERE id = ? AND statut = 'brouillon' AND programme_le = ?",
      [t, par, t, id, seulementSiProgramme],
    )
    : await base.executer(
      "UPDATE devblog_entrees SET statut = 'publie', publie_le = ?, publie_par = ?, programme_le = NULL, programme_cibles = NULL, maj_par = COALESCE(?, maj_par), maj_le = ? WHERE id = ? AND statut = 'brouillon'",
      [t, par, par, t, id],
    );
  return r.changements === 1;
}

/**
 * Met en file la publication Discord d'une entrée PUBLIÉE dans chaque salon. Jamais deux fois : une ligne par entrée
 * et par salon. Déjà publié et identique : rien ; contenu corrigé : réédition (sans nouvelle mention) ; en cours :
 * l'envoi prendra le contenu à jour. `cibles` doit être une liste de salons connus (vérifiée ici).
 */
export async function mettreEnFileDiscord(base, id, { cibles, here = true, par = null, t }) {
  const l = await base.premier('SELECT * FROM devblog_entrees WHERE id = ?', [id]);
  if (!l) throw echec(404, 'devblog-introuvable', 'Devblog introuvable.');
  if (l.statut !== 'publie') throw echec(409, 'devblog-brouillon', 'Publiez d’abord le devblog dans l’app (il est encore en brouillon).');
  exigerComplet(l);
  const possibles = new Set((await ciblesPossibles(base)).map(p => p.cle));
  const liste = [...new Set(Array.isArray(cibles) ? cibles : [])];
  if (!liste.length) throw echec(400, 'devblog-salons', 'Choisissez au moins un salon Discord.');
  for (const c of liste) if (!possibles.has(c)) throw echec(400, 'devblog-salon-inconnu', 'Salon Discord inconnu (supprimé ?) : rechargez la liste.');
  const empreinte = empreinteTextes(messagesDiscord(entreeDiscord(l), { here: false }));
  const resultats = [];
  for (const c of liste) {
    const x = await base.premier('SELECT * FROM devblog_discord WHERE entree_id = ? AND cible = ?', [id, c]);
    const [genre, ref] = c.split(':');
    if (!x) {
      await base.executer(
        `INSERT INTO devblog_discord (id, entree_id, cible, team_id, salon_id, operation, statut, mention_here, prochain_essai_le, demande_par, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, 'poster', 'attente', ?, ?, ?, ?, ?) ON CONFLICT (entree_id, cible) DO NOTHING`,
        [nouvelId(), id, c, genre === 'team' ? ref : null, genre === 'salon' ? ref : null, here ? 1 : 0, t, par, t, t],
      );
      resultats.push({ cible: c, etat: 'publication' });
      continue;
    }
    if (x.statut === 'attente') {
      resultats.push({ cible: c, etat: 'en_cours' });
      continue;
    }
    if (x.statut === 'envoye' && x.empreinte === empreinte) {
      resultats.push({ cible: c, etat: 'deja_publie' });
      continue;
    }
    const poste = jsonOu(x.message_ids, []).length > 0;
    await base.executer(
      `UPDATE devblog_discord SET operation = ?, statut = 'attente', essais = 0, prochain_essai_le = ?, verrou_jusqua = NULL, derniere_erreur = NULL, revision = revision + 1,
              mention_here = CASE WHEN ? = 1 THEN mention_here ELSE ? END, demande_par = ?, maj_le = ? WHERE id = ?`,
      [poste ? 'editer' : 'poster', t, poste ? 1 : 0, here ? 1 : 0, par, t, x.id],
    );
    resultats.push({ cible: c, etat: poste ? 'correction' : 'publication' });
  }
  return resultats;
}

/** Notification in-app (type `devblog-auto`) au Fondateur et aux gestionnaires du devblog. */
export async function notifierGestionnaires(base, { id, charge, t }) {
  const comptes = await comptesAvecGlobale(base, PERMISSION_DEVBLOG);
  if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) comptes.add('principal');
  for (const compte of comptes) {
    await base.executer('INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [
      `${id}:${compte}`,
      compte,
      'devblog-auto',
      JSON.stringify(charge),
      t,
    ]);
  }
  return comptes.size;
}
