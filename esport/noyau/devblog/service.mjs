/**
 * Devblog de l'Esport (migration 0036, docs/esport/devblog.md) : notes de mise à jour en français et en anglais,
 * fenêtre « Nouveautés » à l'entrée dans l'app (une fois par compte), historique, publication Discord.
 *
 * Droits :
 *  - lire les devblogs PUBLIÉS, voir la fenêtre « Nouveautés », la fermer : tout compte Esport ;
 *  - créer, modifier, publier, supprimer, préparer la version anglaise avec l'IA, publier sur Discord, régler les
 *    salons : le Fondateur, et les comptes à qui il confie la permission du club `devblog.gerer` (rôle du club,
 *    page Rôles et permissions ; désactivée par défaut). Un brouillon est invisible (404) pour les autres.
 *
 * « Nouveautés » : seulement le DERNIER devblog publié, s'il n'a pas encore été vu par ce compte (marque en base,
 * `devblog_vus`) : un nouveau membre ne voit pas défiler les anciens devblogs, seulement le dernier.
 *
 * Publication Discord : une ligne par entrée et par salon (`devblog_discord`, unique) ; l'envoi est fait par
 * `traiterDevblogDiscord` (discord.mjs) juste après la requête et par le cron. Republier un contenu identique ne
 * fait rien ; republier une correction réédite les messages déjà postés.
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { aGlobale } from '../roles/globales.mjs';
import { extraireJson } from '../ia/connecteur.mjs';
import { chiffrerWebhook, finDeWebhook, validerUrlWebhook } from '../discord/chiffrement.mjs';
import { PERMISSION_DEVBLOG, contenuComplet, contenuVide, empreinteTextes, lireContenu, lireDate, lireVersion, messagesDiscord } from './regles.mjs';
import { DATE_PREMIER_DEVBLOG, ID_PREMIER_DEVBLOG, PREMIER_DEVBLOG_EN, PREMIER_DEVBLOG_FR } from './premier.mjs';
import { FUSEAU_DEVBLOG, REGLAGES_AUTO_DEFAUT, echeanceAuto, jourClub, lireInstantProgramme, lireReglagesAuto, texteMuralClub } from './auto-regles.mjs';
import { ciblesPossibles as ciblesDuClub, ecrireReglage as ecrireReglageBase, entreeDiscord, exigerComplet, lireReglage, mettreEnFileDiscord, publierDansApp } from './publication.mjs';
import { apresPublication, changementsDeployes, genererMaintenant, lireEtatAuto, lireReglagesEnBase } from './auto.mjs';

const MOTIF_ID = /^[a-z0-9-]{6,64}$/i;
const MOTIF_SALON_DISCORD = /^\d{5,25}$/;
const MAX_SALONS_CLUB = 20;

/** Ligne de la base → entrée publique (les deux langues : l'app choisit celle du compte). */
export function entreePublique(l, { gestion = false } = {}) {
  return {
    id: l.id,
    statut: l.statut,
    date: l.date_maj,
    version: l.version || null,
    fr: jsonOu(l.contenu_fr, contenuVide()),
    en: jsonOu(l.contenu_en, contenuVide()),
    publieLe: l.publie_le ?? null,
    ...(gestion
      ? {
        creeLe: l.cree_le,
        majLe: l.maj_le,
        origine: l.origine === 'auto' ? 'auto' : 'manuel',
        programmation: l.programme_le ? { le: l.programme_le, mural: texteMuralClub(Date.parse(l.programme_le)), cibles: jsonOu(l.programme_cibles, []), mentionHere: Number(l.programme_here) === 1 } : null,
      }
      : {}),
  };
}

/** L'acteur gère-t-il le devblog (Fondateur, ou permission du club devblog.gerer) ? */
export const gereDevblog = (base, acteur) => aGlobale(base, acteur, PERMISSION_DEVBLOG);

/** Premier devblog posé en brouillon, une seule fois (supprimé, il ne revient pas). */
export async function amorcerDevblog(base, maintenant = Date.now()) {
  const fait = await base.premier("SELECT cle FROM devblog_reglages WHERE cle = 'amorce'", []);
  if (fait) return false;
  const t = iso(maintenant);
  await base.lot([
    {
      sql: "INSERT INTO devblog_entrees (id, statut, date_maj, version, contenu_fr, contenu_en, cree_le, maj_le) VALUES (?, 'brouillon', ?, '', ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
      params: [ID_PREMIER_DEVBLOG, DATE_PREMIER_DEVBLOG, JSON.stringify(PREMIER_DEVBLOG_FR), JSON.stringify(PREMIER_DEVBLOG_EN), t, t],
    },
    { sql: "INSERT INTO devblog_reglages (cle, valeur, maj_le) VALUES ('amorce', '1', ?) ON CONFLICT (cle) DO NOTHING", params: [t] },
  ]);
  return true;
}

/**
 * Consigne de traduction (tâche légère, non confidentielle : seul le texte du devblog part, rien d'autre sur le
 * club ni sur ses membres).
 */
export const CONSIGNE_TRADUCTION = [
  'You translate the release notes ("devblog") of an esports club app from French to English.',
  'Keep the exact same JSON structure, the same number of sections and bullets, in the same order.',
  'Tone: enthusiastic, short sentences, friendly, no technical jargon, no vendor or technology names. Keep emojis as they are.',
  'Bullet "nom" is a short feature name (2-4 words, Title case not required); "description" is one short positive sentence.',
  'Answer with JSON only: {"titre": "...", "intro": "...", "sections": [{"titre": "...", "puces": [{"nom": "...", "description": "..."}]}], "conclusion": "..."}',
].join('\n');

export function servicesDevblog({ base, maintenant = () => Date.now(), discuterPour = null, cle, source = null }) {
  /** Gestionnaire du devblog ? (le premier devblog est posé, en brouillon, à son premier passage). */
  async function gestionnaire(acteur) {
    const g = await gereDevblog(base, acteur);
    if (g) await amorcerDevblog(base, maintenant());
    return g;
  }
  async function exigerGestion(acteur) {
    if (!(await gestionnaire(acteur))) throw echec(403, 'devblog-gerer', 'Réservé au Fondateur (ou à qui il confie la gestion du devblog).');
  }

  async function ligneEntree(id, { gestion }) {
    if (typeof id !== 'string' || !MOTIF_ID.test(id)) throw echec(404, 'devblog-introuvable', 'Devblog introuvable.');
    const l = await base.premier('SELECT * FROM devblog_entrees WHERE id = ?', [id]);
    if (!l || (!gestion && l.statut !== 'publie')) throw echec(404, 'devblog-introuvable', 'Devblog introuvable.');
    return l;
  }

  /** `GET /devblog` : publiés (tous) ; brouillons en plus pour les gestionnaires. */
  async function liste(acteur) {
    const gestion = await gestionnaire(acteur);
    const lignes = await base.tous(
      gestion
        ? "SELECT * FROM devblog_entrees ORDER BY CASE WHEN statut = 'brouillon' THEN 0 ELSE 1 END, COALESCE(publie_le, maj_le) DESC, id"
        : "SELECT * FROM devblog_entrees WHERE statut = 'publie' ORDER BY publie_le DESC, id",
      [],
    );
    return { entrees: lignes.map(l => entreePublique(l, { gestion })), gestion };
  }

  async function detail(acteur, id) {
    const gestion = await gestionnaire(acteur);
    return { entree: entreePublique(await ligneEntree(id, { gestion }), { gestion }), gestion };
  }

  function lireSaisie(corps, existant) {
    return {
      date: lireDate(corps?.date, existant?.date_maj ?? iso(maintenant()).slice(0, 10)),
      version: corps?.version === undefined ? (existant?.version ?? '') : lireVersion(corps.version),
      fr: corps?.fr === undefined ? jsonOu(existant?.contenu_fr, contenuVide()) : lireContenu(corps.fr),
      en: corps?.en === undefined ? jsonOu(existant?.contenu_en, contenuVide()) : lireContenu(corps.en),
    };
  }

  /** `POST /devblog` `{ date?, version?, fr?, en? }` : nouveau brouillon. */
  async function creer(acteur, corps) {
    await exigerGestion(acteur);
    const s = lireSaisie(corps, null);
    const id = nouvelId();
    const t = iso(maintenant());
    await base.executer(
      "INSERT INTO devblog_entrees (id, statut, date_maj, version, contenu_fr, contenu_en, cree_par, cree_le, maj_par, maj_le) VALUES (?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, s.date, s.version, JSON.stringify(s.fr), JSON.stringify(s.en), acteur.compte, t, acteur.compte, t],
    );
    return detail(acteur, id);
  }

  /**
   * `PATCH /devblog/:id` `{ date?, version?, fr?, en?, statut? }`. `statut: 'publie'` publie (versions française ET
   * anglaise complètes) ; `'brouillon'` retire de l'app (les marques « vu » restent).
   */
  async function modifier(acteur, id, corps) {
    await exigerGestion(acteur);
    const l = await ligneEntree(id, { gestion: true });
    const s = lireSaisie(corps, l);
    let statut = l.statut;
    if (corps?.statut !== undefined) {
      if (corps.statut !== 'publie' && corps.statut !== 'brouillon') throw echec(400, 'devblog-statut', 'Statut inconnu (brouillon ou publie).');
      statut = corps.statut;
    }
    if (statut === 'publie') {
      lireContenu(s.fr, { exiger: true, langue: 'fr' });
      lireContenu(s.en, { exiger: true, langue: 'en' });
    }
    const t = iso(maintenant());
    const publieLe = statut === 'publie' ? (l.statut === 'publie' ? l.publie_le : t) : l.publie_le;
    const devientPublie = statut === 'publie' && l.statut !== 'publie';
    await base.executer(
      `UPDATE devblog_entrees SET date_maj = ?, version = ?, contenu_fr = ?, contenu_en = ?, statut = ?, publie_le = ?, publie_par = ?, maj_par = ?, maj_le = ?${devientPublie ? ', programme_le = NULL, programme_cibles = NULL' : ''} WHERE id = ?`,
      [s.date, s.version, JSON.stringify(s.fr), JSON.stringify(s.en), statut, publieLe, devientPublie ? acteur.compte : l.publie_par, acteur.compte, t, id],
    );
    if (devientPublie) await apresPublication(base, l, t);
    return detail(acteur, id);
  }

  async function supprimer(acteur, id) {
    await exigerGestion(acteur);
    await ligneEntree(id, { gestion: true });
    await base.executer('DELETE FROM devblog_entrees WHERE id = ?', [id]);
    return { ok: true };
  }

  /** `GET /devblog/nouveautes` : le dernier devblog publié, s'il n'a pas été vu par ce compte ; sinon `null`. */
  async function nouveautes(acteur) {
    const dernier = await base.premier("SELECT * FROM devblog_entrees WHERE statut = 'publie' ORDER BY publie_le DESC, id LIMIT 1", []);
    if (!dernier) return { entree: null };
    const vu = await base.premier('SELECT vu_le FROM devblog_vus WHERE compte_id = ? AND entree_id = ?', [acteur.compte, dernier.id]);
    return { entree: vu ? null : entreePublique(dernier) };
  }

  /** `POST /devblog/:id/vu` : « J'ai compris » (idempotent). */
  async function marquerVu(acteur, id) {
    await ligneEntree(id, { gestion: false });
    await base.executer('INSERT INTO devblog_vus (compte_id, entree_id, vu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, entree_id) DO NOTHING', [acteur.compte, id, iso(maintenant())]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- IA : version anglaise

  /** `POST /devblog/ia/traduire` `{ fr }` → `{ en }` : proposition à relire (rien n'est enregistré). */
  async function traduire(acteur, corps) {
    await exigerGestion(acteur);
    if (!discuterPour) throw echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
    const fr = lireContenu(corps?.fr, { exiger: true, langue: 'fr' });
    // Seul le texte du devblog part (pas d'emoji : ils sont repris tels quels).
    const source = { titre: fr.titre, intro: fr.intro, sections: fr.sections.map(s => ({ titre: s.titre, puces: s.puces })), conclusion: fr.conclusion };
    const r = await discuterPour('traduction', [
      { role: 'system', content: CONSIGNE_TRADUCTION },
      { role: 'user', content: JSON.stringify(source) },
    ], { json: true, maxJetons: 4000 });
    const brut = extraireJson(r?.texte);
    if (!brut) throw echec(502, 'ia-reponse', 'Réponse de l’IA illisible : réessayez.');
    const sections = Array.isArray(brut.sections) ? brut.sections : [];
    const en = lireContenu({
      titre: brut.titre,
      intro: brut.intro,
      conclusion: brut.conclusion,
      // Même nombre de sections et de puces que le français ; une puce manquante garde le texte français.
      sections: fr.sections.map((s, i) => ({
        emoji: s.emoji,
        titre: sections[i]?.titre || s.titre,
        puces: s.puces.map((p, j) => ({ nom: sections[i]?.puces?.[j]?.nom || p.nom, description: sections[i]?.puces?.[j]?.description || p.description })),
      })),
    });
    return { en, moteur: r?.moteur ?? null };
  }

  // ---------------------------------------------------------------- Discord : salons

  const reglage = (cleR, repli) => lireReglage(base, cleR, repli);
  const ecrireReglage = (cleR, valeur, acteur) => ecrireReglageBase(base, cleR, valeur, { par: acteur.compte, t: iso(maintenant()) });
  const ciblesPossibles = () => ciblesDuClub(base);

  /** `GET /devblog/salons` : salons possibles, cochés par défaut, salon du bot. */
  async function salons(acteur) {
    await exigerGestion(acteur);
    const possibles = await ciblesPossibles();
    const connues = new Set(possibles.map(p => p.cle));
    return { salons: possibles, defaut: (await reglage('cibles', [])).filter(c => connues.has(c)), salonBot: await reglage('salon_bot', null) };
  }

  /**
   * `PUT /devblog/salons` `{ defaut?: [cle], salonBot?: { id, nom } | null, webhook?: { nom, url } }` : salons cochés
   * par défaut (« annonces du club »), salon lié au bot (identifiant du salon), ou nouveau salon du club par webhook
   * (rangé avec ceux de la page Réseaux, chiffré de la même façon).
   */
  async function reglerSalons(acteur, corps) {
    await exigerGestion(acteur);
    let nouveau = null;
    if (corps?.webhook) {
      const nom = String(corps.webhook.nom ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!nom) throw echec(400, 'nom', 'Nom obligatoire.');
      const url = validerUrlWebhook(corps.webhook.url);
      const n = await base.premier('SELECT COUNT(*) AS n FROM cm_rs_salons', []);
      if (Number(n?.n ?? 0) >= MAX_SALONS_CLUB) throw echec(409, 'trop-de-salons', `${MAX_SALONS_CLUB} salons au plus.`);
      const id = nouvelId();
      const t = iso(maintenant());
      await base.executer('INSERT INTO cm_rs_salons (id, nom, url_chiffree, fin, fil_fr, langue, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)', [
        id,
        nom,
        await chiffrerWebhook(cle, `reseaux:${id}`, url),
        finDeWebhook(url),
        'en',
        acteur.compte,
        t,
        t,
      ]);
      nouveau = `salon:${id}`;
    }
    if (corps?.salonBot !== undefined) {
      if (corps.salonBot === null) await base.executer("DELETE FROM devblog_reglages WHERE cle = 'salon_bot'", []);
      else {
        const id = String(corps.salonBot?.id ?? '').trim();
        if (!MOTIF_SALON_DISCORD.test(id)) throw echec(400, 'salon-discord', 'Salon du bot : identifiant numérique du salon Discord (clic droit › Copier l’identifiant).');
        await ecrireReglage('salon_bot', { id, nom: String(corps.salonBot?.nom ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) }, acteur);
      }
    }
    if (corps?.defaut !== undefined || nouveau) {
      const connues = new Set((await ciblesPossibles()).map(p => p.cle));
      const voulues = Array.isArray(corps?.defaut) ? corps.defaut : await reglage('cibles', []);
      await ecrireReglage('cibles', [...new Set([...voulues.filter(c => typeof c === 'string' && connues.has(c)), ...(nouveau ? [nouveau] : [])])], acteur);
    }
    return salons(acteur);
  }

  // ---------------------------------------------------------------- Discord : publication

  /** `GET /devblog/:id/discord?here=1` : aperçu des messages (anglais, fil français) et état par salon. */
  async function etatDiscord(acteur, id, { here = true } = {}) {
    await exigerGestion(acteur);
    const l = await ligneEntree(id, { gestion: true });
    const messages = messagesDiscord(entreeDiscord(l), { here });
    const empreinte = empreinteTextes(messagesDiscord(entreeDiscord(l), { here: false }));
    const noms = new Map((await ciblesPossibles()).map(p => [p.cle, p.nom]));
    const lignes = await base.tous('SELECT * FROM devblog_discord WHERE entree_id = ? ORDER BY cree_le, cible', [id]);
    return {
      apercu: messages,
      pretAPublier: l.statut === 'publie' && contenuComplet(jsonOu(l.contenu_en, null)) && contenuComplet(jsonOu(l.contenu_fr, null)),
      complet: contenuComplet(jsonOu(l.contenu_en, null)) && contenuComplet(jsonOu(l.contenu_fr, null)),
      publications: lignes.map(x => ({
        cible: x.cible,
        nom: noms.get(x.cible) ?? null,
        statut: x.statut,
        operation: x.operation,
        messages: jsonOu(x.message_ids, []).length,
        filFrancais: Boolean(x.fil_id),
        aJour: x.statut === 'envoye' && x.empreinte === empreinte,
        erreur: x.derniere_erreur ?? null,
        envoyeLe: x.envoye_le ?? null,
      })),
    };
  }

  /**
   * `POST /devblog/:id/discord` `{ cibles: [cle], mentionHere? }` : met en file la publication dans chaque salon.
   * Jamais deux fois : une ligne par entrée et par salon. Déjà publié et identique : rien ; contenu corrigé : les
   * messages postés sont réédités (sans nouvelle mention) ; en cours : l'envoi prendra le contenu à jour.
   */
  async function publierDiscord(acteur, id, corps) {
    await exigerGestion(acteur);
    await ligneEntree(id, { gestion: true });
    const here = corps?.mentionHere !== false;
    const resultats = await mettreEnFileDiscord(base, id, { cibles: corps?.cibles, here, par: acteur.compte, t: iso(maintenant()) });
    return { resultats, ...(await etatDiscord(acteur, id, { here })) };
  }

  /** Salons choisis (liste de clés connues), vérifiés. Vide autorisé (l'app seulement). */
  async function lireCibles(cibles) {
    if (cibles === undefined || cibles === null) return [];
    if (!Array.isArray(cibles)) throw echec(400, 'devblog-salons', 'Salons : une liste.');
    const connues = new Set((await ciblesPossibles()).map(p => p.cle));
    const liste = [...new Set(cibles)];
    for (const c of liste) if (typeof c !== 'string' || !connues.has(c)) throw echec(400, 'devblog-salon-inconnu', 'Salon Discord inconnu (supprimé ?) : rechargez la liste.');
    return liste;
  }

  /**
   * `POST /devblog/:id/tout-publier` `{ cibles, mentionHere? }` : « 🚀 Tout publier » en une action : publié dans
   * l'app (s'il était en brouillon ; versions française ET anglaise complètes), puis mis en file sur les salons
   * Discord choisis (par défaut ceux de « annonces du club », envoyés par l'appelant).
   */
  async function toutPublier(acteur, id, corps) {
    await exigerGestion(acteur);
    const l = await ligneEntree(id, { gestion: true });
    exigerComplet(l);
    const cibles = await lireCibles(corps?.cibles);
    const here = corps?.mentionHere !== false;
    const t = iso(maintenant());
    const app = l.statut === 'brouillon' ? await publierDansApp(base, id, { par: acteur.compte, t }) : false;
    if (app) await apresPublication(base, l, t);
    const resultats = cibles.length ? await mettreEnFileDiscord(base, id, { cibles, here, par: acteur.compte, t }) : [];
    return { app: app ? 'publie' : 'deja_publie', resultats, entree: entreePublique(await ligneEntree(id, { gestion: true }), { gestion: true }), ...(await etatDiscord(acteur, id, { here })) };
  }

  /**
   * `PUT /devblog/:id/programmation` `{ le: 'AAAA-MM-JJ HH:MM' (heure du club) | ISO, cibles?, mentionHere? }` :
   * publication programmée d'un brouillon prêt (app + salons choisis). Modifiable et annulable
   * (`DELETE /devblog/:id/programmation`) jusqu'à l'heure.
   */
  async function programmer(acteur, id, corps) {
    await exigerGestion(acteur);
    const l = await ligneEntree(id, { gestion: true });
    if (l.statut !== 'brouillon') throw echec(409, 'devblog-deja-publie', 'Ce devblog est déjà publié.');
    exigerComplet(l);
    const ms = lireInstantProgramme(corps?.le, maintenant());
    const cibles = await lireCibles(corps?.cibles);
    await base.executer('UPDATE devblog_entrees SET programme_le = ?, programme_cibles = ?, programme_here = ?, programme_par = ?, maj_le = ? WHERE id = ?', [
      iso(ms),
      JSON.stringify(cibles),
      corps?.mentionHere === false ? 0 : 1,
      acteur.compte,
      iso(maintenant()),
      id,
    ]);
    return detail(acteur, id);
  }

  async function annulerProgrammation(acteur, id) {
    await exigerGestion(acteur);
    await ligneEntree(id, { gestion: true });
    await base.executer('UPDATE devblog_entrees SET programme_le = NULL, programme_cibles = NULL, maj_le = ? WHERE id = ?', [iso(maintenant()), id]);
    return detail(acteur, id);
  }

  // ---------------------------------------------------------------- Mode automatique

  async function vueAuto() {
    const reglages = await lireReglagesEnBase(base);
    const ms = maintenant();
    const faitAujourdhui = Boolean(await base.premier("SELECT jour FROM devblog_auto WHERE declencheur = 'auto' AND jour = ?", [jourClub(ms)]));
    const journal = await base.tous('SELECT * FROM devblog_auto ORDER BY cree_le DESC, id LIMIT 20', []);
    const etat = await lireEtatAuto(base);
    return {
      reglages,
      defaut: REGLAGES_AUTO_DEFAUT,
      fuseau: FUSEAU_DEVBLOG,
      prochain: reglages.actif ? (t => (t ? iso(t) : null))(echeanceAuto(reglages, ms, { dejaFaitAujourdhui: faitAujourdhui })) : null,
      source: Boolean(source),
      ia: Boolean(discuterPour),
      couvertJusquau: etat.le ?? null,
      cibles: reglages.cibles ?? (await reglage('cibles', [])),
      journal: journal.map(j => ({
        id: j.id,
        le: j.cree_le,
        declencheur: j.declencheur,
        statut: j.statut,
        entree: j.entree_id ?? null,
        commitsLus: Number(j.commits_lus ?? 0),
        commitsRetenus: Number(j.commits_retenus ?? 0),
        moteur: j.moteur ?? null,
        message: j.message ?? null,
      })),
    };
  }

  /** `GET /devblog/auto` : réglages, prochain passage, journal ; `en_attente` : mises à jour notables en attente. */
  async function lireAuto(acteur, { attente = false } = {}) {
    await exigerGestion(acteur);
    const v = await vueAuto();
    if (attente && source) {
      try {
        const ch = await changementsDeployes(base, source);
        v.enAttente = ch ? { lus: ch.lus, retenus: ch.retenus.length } : null;
      } catch {
        v.enAttente = null;
      }
    }
    return v;
  }

  /** `PUT /devblog/auto` `{ actif?, frequence?, heure?, jour?, validation?, mentionHere?, cibles? }`. */
  async function reglerAuto(acteur, corps) {
    await exigerGestion(acteur);
    const avant = await lireReglagesEnBase(base);
    const connues = new Set((await ciblesPossibles()).map(p => p.cle));
    const r = lireReglagesAuto(corps, avant, { connues });
    await ecrireReglage('auto', r, acteur);
    // Première activation : le point de départ est posé (premier déploiement après le dernier devblog, sinon
    // l'état actuel) pour ne pas raconter tout l'historique du dépôt.
    if (r.actif && !avant.actif && source && !(await lireEtatAuto(base)).commit) {
      try {
        const ch = await changementsDeployes(base, source);
        if (ch?.de) await ecrireReglageBase(base, 'auto_etat', { commit: ch.de, le: iso(maintenant()) }, { par: acteur.compte, t: iso(maintenant()) });
      } catch {
        // Source illisible : le premier passage reprendra.
      }
    }
    return vueAuto();
  }

  /** `POST /devblog/auto/generer` : « Générer maintenant » (brouillon de test). */
  async function generer(acteur) {
    await exigerGestion(acteur);
    if (!source) throw echec(503, 'devblog-source', 'Historique des mises à jour indisponible sur ce serveur.');
    const r = await genererMaintenant(base, { source, discuterPour, maintenant: maintenant(), par: acteur.compte });
    return { resultat: { statut: r.statut, entree: r.entree_id ?? null, message: r.message ?? null }, ...(await vueAuto()) };
  }

  return { liste, detail, creer, modifier, supprimer, nouveautes, marquerVu, traduire, salons, reglerSalons, etatDiscord, publierDiscord, toutPublier, programmer, annulerProgrammation, lireAuto, reglerAuto, generer };
}
