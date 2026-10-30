/**
 * Devblog PROGRAMMÉ et AUTOMATIQUE (migration 0037, docs/esport/devblog.md, « Publication automatique »).
 *
 * Publication programmée (`publierProgrammes`, cron toutes les 5 minutes) : un brouillon prêt dont l'heure
 * (`programme_le`) est atteinte est publié dans l'app puis mis en file pour ses salons Discord ; jamais avant
 * l'heure, jamais deux fois (mise à jour conditionnelle). Devenu incomplet entre-temps : programmation annulée,
 * gestionnaires notifiés.
 *
 * Mode automatique (`executerDevblogAuto`, cron ; désactivé par défaut) :
 *  1. dû ? (actif, bon jour, heure atteinte dans le fuseau du club, pas encore passé aujourd'hui) ; le passage du
 *     jour est RÉSERVÉ par une ligne `devblog_auto` (colonne `jour` UNIQUE) : au plus un devblog automatique par jour ;
 *  2. changements : commits du dépôt déployé depuis le dernier devblog (`auto_etat.commit` ; au premier passage, le
 *     premier déploiement du journal postérieur au dernier devblog publié, sinon l'état actuel) ;
 *  3. filtrage des commits techniques (règles), nettoyage (aucun hash, chemin, fichier, variable, adresse) ;
 *  4. rédaction FR + EN par l'IA (tâche « devblog », non confidentielle : messages de commit seulement), dans la DA
 *     du devblog (exemples), validation STRICTE ;
 *  5. rien de notable : rien n'est créé (le point de départ avance) ; IA en échec ou réponse refusée : BROUILLON de
 *     secours + notification, jamais publié ; « Validation avant publication » : brouillon + notification ; sinon
 *     publié dans l'app et mis en file sur les salons Discord des réglages (@here selon les réglages).
 * Chaque passage qui fait quelque chose est journalisé (`devblog_auto`). « Générer maintenant » (`genererMaintenant`)
 * crée toujours un brouillon, sans toucher au passage du jour ni au point de départ (il avance quand le brouillon est
 * publié).
 */

import { extraireJson } from '../ia/connecteur.mjs';
import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import {
  MAX_COMMITS_IA,
  MAX_COMMITS_LUS,
  REGLAGES_AUTO_DEFAUT,
  brouillonDeSecours,
  estDuAuto,
  filtrerCommits,
  jourClub,
  lireRedaction,
  lireReglagesAuto,
  messagesRedaction,
  nettoyerCommit,
} from './auto-regles.mjs';
import { lireContenu } from './regles.mjs';
import { ciblesParDefaut, ciblesPossibles, ecrireReglage, exigerComplet, lireReglage, mettreEnFileDiscord, notifierGestionnaires, publierDansApp } from './publication.mjs';

const MOTIF_HASH = /^[0-9a-f]{7,40}$/;
/** Tâche passée au connecteur IA (non confidentielle : catégorie « leger », peut partir à l'API). */
export const TACHE_IA_DEVBLOG = 'devblog';

export const lireReglagesEnBase = async base => lireReglagesAuto({}, await lireReglage(base, 'auto', REGLAGES_AUTO_DEFAUT));
export const lireEtatAuto = async base => (await lireReglage(base, 'auto_etat', null)) ?? {};

// ------------------------------------------------------------------ Publication programmée

/** Publie les brouillons programmés dont l'heure est atteinte. Rend `{ publies, annules, discord }`. */
export async function publierProgrammes(base, { maintenant = Date.now() } = {}) {
  const bilan = { publies: 0, annules: 0, discord: 0 };
  const t = iso(maintenant);
  const dus = await base.tous("SELECT * FROM devblog_entrees WHERE programme_le IS NOT NULL AND programme_le <= ? AND statut = 'brouillon' ORDER BY programme_le, id LIMIT 20", [t]);
  for (const l of dus) {
    try {
      exigerComplet(l);
    } catch (e) {
      await base.executer('UPDATE devblog_entrees SET programme_le = NULL, maj_le = ? WHERE id = ? AND programme_le = ?', [t, l.id, l.programme_le]);
      await notifierGestionnaires(base, { id: `devblog-prog:${l.id}:${l.programme_le}`, charge: { etat: 'programme-annule', titre: jsonOu(l.contenu_fr, {})?.titre ?? '', motif: String(e?.message ?? '') }, t });
      bilan.annules++;
      continue;
    }
    if (!(await publierDansApp(base, l.id, { par: l.programme_par ?? null, t, seulementSiProgramme: l.programme_le }))) continue;
    bilan.publies++;
    const connues = new Set((await ciblesPossibles(base)).map(p => p.cle));
    const cibles = jsonOu(l.programme_cibles, []).filter(c => connues.has(c));
    if (cibles.length) {
      await mettreEnFileDiscord(base, l.id, { cibles, here: Number(l.programme_here) === 1, par: l.programme_par ?? null, t });
      bilan.discord += cibles.length;
    }
    await base.executer('UPDATE devblog_entrees SET programme_cibles = NULL WHERE id = ?', [l.id]);
  }
  // Ménage : une programmation restée sur un devblog déjà publié (publié à la main entre-temps) est effacée.
  await base.executer("UPDATE devblog_entrees SET programme_le = NULL, programme_cibles = NULL WHERE programme_le IS NOT NULL AND statut = 'publie'", []);
  return bilan;
}

// ------------------------------------------------------------------ Mode automatique

/** Point de départ : dernier commit couvert, sinon premier déploiement après le dernier devblog publié, sinon HEAD. */
async function pointDeDepart(base, source, tete) {
  const etat = await lireEtatAuto(base);
  if (typeof etat.commit === 'string' && MOTIF_HASH.test(etat.commit)) return etat.commit;
  const dernier = await base.premier("SELECT publie_le FROM devblog_entrees WHERE statut = 'publie' ORDER BY publie_le DESC LIMIT 1", []);
  const deps = (await source.deploiements?.()) ?? [];
  if (dernier?.publie_le) {
    const apres = deps.filter(d => d.de && `${d.le}`.localeCompare(dernier.publie_le.slice(0, 19)) > 0);
    if (apres.length) return apres[0].de;
  }
  return tete;
}

/** Commits retenus depuis le point de départ : `{ tete, de, lus, retenus, changements }` (ou null : source muette). */
export async function changementsDeployes(base, source) {
  const tete = await source.tete();
  if (!tete) return null;
  let de = await pointDeDepart(base, source, tete);
  if (de === tete) return { tete, de, lus: 0, retenus: [], changements: [] };
  if (!(await source.existe(de))) de = null;
  // Point de départ inconnu (historique réécrit) : les derniers commits seulement.
  const commits = (await source.commits(de, tete, { max: de ? MAX_COMMITS_LUS : 30 })) ?? [];
  const { retenus } = filtrerCommits(commits);
  const changements = retenus.map(nettoyerCommit).filter(c => c.sujet).slice(-MAX_COMMITS_IA);
  return { tete, de, lus: commits.length, retenus, changements };
}

/** Rédaction par l'IA, validée : `{ rien }` ou `{ fr, en, moteur }` ; exception si l'IA échoue ou la réponse est refusée. */
export async function redigerDevblog(discuterPour, changements) {
  if (!discuterPour) throw echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
  const r = await discuterPour(TACHE_IA_DEVBLOG, messagesRedaction(changements), { json: true, maxJetons: 5000 });
  const brut = extraireJson(r?.texte);
  return { ...lireRedaction(brut), moteur: r?.moteur ?? null };
}

async function journaliser(base, id, champs) {
  const cles = Object.keys(champs);
  await base.executer(`UPDATE devblog_auto SET ${cles.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cles.map(k => champs[k]), id]);
}

async function creerEntree(base, { id, jour, fr, en, commit, t, par = null }) {
  await base.executer(
    "INSERT INTO devblog_entrees (id, statut, date_maj, version, contenu_fr, contenu_en, origine, auto_commit, cree_par, cree_le, maj_par, maj_le) VALUES (?, 'brouillon', ?, '', ?, ?, 'auto', ?, ?, ?, ?, ?)",
    [id, jour, JSON.stringify(lireContenu(fr)), JSON.stringify(lireContenu(en)), commit, par, t, par, t],
  );
}

/** Le point de départ avance (devblog couvrant jusqu'à `commit`). */
export async function avancerPointDeDepart(base, commit, t) {
  if (!commit || !MOTIF_HASH.test(commit)) return;
  await ecrireReglage(base, 'auto_etat', { commit, le: t }, { t });
}

/**
 * Un passage : rédige et publie (ou pose un brouillon). `manuel` : « Générer maintenant » (toujours un brouillon,
 * aucune réservation du jour, point de départ inchangé). Rend `{ statut, entree?, message? }`.
 */
async function passage(base, { source, discuterPour, maintenant, manuel = false, par = null }) {
  const ms = maintenant;
  const t = iso(ms);
  const jour = jourClub(ms);
  const reglages = await lireReglagesEnBase(base);
  const idJournal = nouvelId();
  if (manuel) {
    await base.executer("INSERT INTO devblog_auto (id, jour, declencheur, statut, demande_par, cree_le) VALUES (?, NULL, 'manuel', 'en_cours', ?, ?)", [idJournal, par, t]);
  } else {
    // Réservation du jour : au plus un passage (donc une publication automatique) par jour, même en parallèle.
    const r = await base.executer("INSERT INTO devblog_auto (id, jour, declencheur, statut, cree_le) VALUES (?, ?, 'auto', 'en_cours', ?) ON CONFLICT (jour) DO NOTHING", [idJournal, jour, t]);
    if (r.changements !== 1) return { statut: 'deja_fait' };
  }
  const finir = async (statut, champs = {}) => {
    await journaliser(base, idJournal, { statut, fini_le: iso(ms), ...champs });
    return { statut, ...champs };
  };

  let ch;
  try {
    ch = await changementsDeployes(base, source);
  } catch {
    ch = null;
  }
  if (!ch) {
    await notifierGestionnaires(base, { id: `devblog-auto:${idJournal}`, charge: { etat: 'echec', motif: 'source' }, t });
    return finir('echec', { message: 'Historique des mises à jour illisible sur le serveur.' });
  }
  const champsCommits = { commits_lus: ch.lus, commits_retenus: ch.retenus.length };
  if (!ch.changements.length) {
    // Rien de notable (ou seulement des commits techniques) : rien n'est créé ; le point de départ avance.
    if (!manuel) await avancerPointDeDepart(base, ch.tete, t);
    return finir('rien', { ...champsCommits, message: ch.lus ? 'Aucun changement notable pour les membres.' : 'Aucune mise à jour déployée depuis le dernier devblog.' });
  }

  const idEntree = manuel ? `devblog-test-${nouvelId().slice(0, 12).toLowerCase()}` : `devblog-auto-${jour}`;
  let redaction = null;
  let motifEchec = null;
  try {
    redaction = await redigerDevblog(discuterPour, ch.changements);
  } catch (e) {
    motifEchec = String(e?.motif ?? e?.code ?? e?.message ?? 'erreur').slice(0, 200);
  }
  if (redaction?.rien) {
    if (!manuel) await avancerPointDeDepart(base, ch.tete, t);
    return finir('rien', { ...champsCommits, moteur: redaction.moteur ?? null, message: 'Aucun changement notable pour les membres (selon l’IA).' });
  }
  if (!redaction) {
    // IA en échec ou réponse refusée : brouillon de secours (jamais publié), notification.
    const secours = brouillonDeSecours(ch.changements);
    await creerEntree(base, { id: idEntree, jour, ...secours, commit: ch.tete, t, par });
    if (!manuel) await avancerPointDeDepart(base, ch.tete, t);
    await notifierGestionnaires(base, { id: `devblog-auto:${idJournal}`, charge: { etat: 'echec', entree: idEntree, motif: 'ia' }, t });
    return finir('echec', { ...champsCommits, entree_id: idEntree, message: `Rédaction par l’IA impossible (${motifEchec}) : brouillon à relire.` });
  }
  await creerEntree(base, { id: idEntree, jour, fr: redaction.fr, en: redaction.en, commit: ch.tete, t, par });
  if (manuel || reglages.validation) {
    if (!manuel) await avancerPointDeDepart(base, ch.tete, t);
    await notifierGestionnaires(base, { id: `devblog-auto:${idJournal}`, charge: { etat: 'brouillon', entree: idEntree, titre: redaction.fr.titre }, t });
    return finir('brouillon', { ...champsCommits, entree_id: idEntree, moteur: redaction.moteur, message: manuel ? 'Brouillon de test créé.' : 'Brouillon créé : à valider avant publication.' });
  }
  // Publication automatique : app, puis salons Discord des réglages.
  await publierDansApp(base, idEntree, { t });
  await avancerPointDeDepart(base, ch.tete, t);
  let message = 'Publié dans l’app.';
  const cibles = reglages.cibles ?? (await ciblesParDefaut(base));
  const connues = new Set((await ciblesPossibles(base)).map(p => p.cle));
  const valides = cibles.filter(c => connues.has(c));
  if (valides.length) {
    await mettreEnFileDiscord(base, idEntree, { cibles: valides, here: reglages.mentionHere, t });
    message = `Publié dans l’app et sur ${valides.length} salon(s) Discord.`;
  }
  await notifierGestionnaires(base, { id: `devblog-auto:${idJournal}`, charge: { etat: 'publie', entree: idEntree, titre: redaction.fr.titre, salons: valides.length }, t });
  return finir('publie', { ...champsCommits, entree_id: idEntree, moteur: redaction.moteur, message });
}

/** Tâche du cron : passage du mode automatique s'il est dû. Rend `{ statut }` (`inactif`, `pas_encore`, `deja_fait`…). */
export async function executerDevblogAuto(base, { source, discuterPour, maintenant = Date.now() } = {}) {
  const reglages = await lireReglagesEnBase(base);
  if (!reglages.actif) return { statut: 'inactif' };
  if (!source) return { statut: 'sans_source' };
  const dernier = await base.premier("SELECT jour FROM devblog_auto WHERE declencheur = 'auto' AND jour = ?", [jourClub(maintenant)]);
  if (dernier) return { statut: 'deja_fait' };
  if (!estDuAuto(reglages, maintenant)) return { statut: 'pas_encore' };
  return passage(base, { source, discuterPour, maintenant });
}

/** « Générer maintenant » : brouillon de test à partir des mises à jour en attente. */
export async function genererMaintenant(base, { source, discuterPour, maintenant = Date.now(), par = null }) {
  return passage(base, { source, discuterPour, maintenant, manuel: true, par });
}

/** Un devblog rédigé automatiquement est publié (à la main) : le point de départ avance jusqu'à ses commits. */
export async function apresPublication(base, ligne, t) {
  if (ligne?.origine !== 'auto' || !ligne.auto_commit) return;
  const etat = await lireEtatAuto(base);
  if (etat.le && String(etat.le) > String(ligne.cree_le)) return;
  await avancerPointDeDepart(base, ligne.auto_commit, t);
}

