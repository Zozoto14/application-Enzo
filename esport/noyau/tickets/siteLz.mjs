/**
 * Liaison avec le site LigneZero (lz.appdashboard.fr) : Tickets › Configuration › Site LZ.
 *
 *  - ÉQUIPES : les équipes des tournois du site et le roster LZ sont lus (et modifiables) depuis l'AppDashboard, par
 *    l'API du site et sa clé de service (CLE_SERVICE de ~/.lignezero/api.env, lue sur le même hébergement : rien à
 *    recopier ; ou LZ_API_URL / LZ_CLE dans esport.env) ;
 *  - DISCORD : pour chaque équipe d'un tournoi ouvert (inscriptions ou en cours), Esport HQ crée un rôle, un salon
 *    texte et un salon vocal privés (catégorie « 🏆 <tournoi> »), donne le rôle aux joueurs dont le Discord ID est
 *    connu, et supprime le tout quand le tournoi est terminé ou l'équipe retirée. Même chose, au choix, pour le
 *    roster LZ (un rôle et des salons par jeu). Fait par le cron (toutes les 5 minutes) ou le bouton « Synchroniser » ;
 *  - INSCRIPTIONS : un ticket ouvert dans une catégorie liée à un tournoi du site (ex. « Inscription The Nuke End »)
 *    devient une inscription en attente ; le staff la valide dans l'app → équipe et joueurs créés sur le site.
 *
 * Suivi des rôles et salons créés : table lz_discord (migration 0060) ; inscriptions : lz_inscriptions.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { P, idDiscord, rest } from './discord.mjs';
import { instructionReglage, lireGeneral, lireReglage } from './reglages.mjs';

export const SITE_DEFAUT = Object.freeze({ discordActif: false, rosterActif: false, inscriptions: [] });
const STATUTS_OUVERTS = ['registration', 'running'];
const DROITS_EQUIPE = (P.VOIR_SALON | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS | (1n << 20n) | (1n << 21n) | (1n << 9n)).toString(); // + se connecter, parler, vidéo
const DROITS_BOT_EQUIPE = (P.VOIR_SALON | P.ENVOYER | P.HISTORIQUE | P.GERER_SALONS | (1n << 20n)).toString();
const VOIR = P.VOIR_SALON.toString();

// ------------------------------------------------------------------ Accès à l'API du site

/** Adresse et clé de l'API du site : variables LZ_API_URL / LZ_CLE, sinon ~/.lignezero/api.env (même hébergement). */
export function configSite(env = process.env, lire = chemin => readFileSync(chemin, 'utf8')) {
  let cle = env.LZ_CLE || '';
  let url = env.LZ_API_URL || '';
  if (!cle || !url) {
    try {
      const texte = lire(env.LZ_ENV || join(homedir(), '.lignezero', 'api.env'));
      const v = Object.fromEntries(
        texte
          .split(/\r?\n/)
          .map(l => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
          .filter(Boolean)
          .map(m => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
      );
      cle ||= v.CLE_SERVICE || '';
      url ||= v.URL_API || (v.URL_SITE ? `${v.URL_SITE.replace(/\/$/, '')}/api` : '');
    } catch {
      /* pas de site sur cet hébergement */
    }
  }
  return { url: (url || 'https://lz.appdashboard.fr/api').replace(/\/$/, ''), cle };
}

export function clientSite({ url, cle }, fetchSite = (...a) => globalThis.fetch(...a)) {
  async function appel(chemin, corps) {
    if (!cle) throw echec(503, 'site-non-configure', 'Site LigneZero introuvable sur cet hébergement (clé de service absente).');
    let r;
    try {
      r = await fetchSite(`${url}${chemin}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw echec(502, 'site-injoignable', 'Le site LigneZero ne répond pas.');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw echec(r.status === 401 || r.status === 403 ? 502 : 400, 'site-refus', `Site LigneZero : ${j?.error?.message ?? `erreur ${r.status}`}`);
    return j.data;
  }
  const rq = d => appel('/rest', d);
  return {
    lister: (table, filters = [], order = []) => rq({ table, action: 'select', columns: '*', filters, order }),
    inserer: (table, rows) => rq({ table, action: 'insert', rows, returning: true }),
    modifier: (table, id, values) => rq({ table, action: 'update', values, filters: [{ col: 'id', op: 'eq', val: id }], returning: true }),
    supprimer: (table, id) => rq({ table, action: 'delete', filters: [{ col: 'id', op: 'eq', val: id }] }),
  };
}

// ------------------------------------------------------------------ Données du site

/** Tournois (hors brouillons), leurs équipes et joueurs ; roster LZ par jeu. */
export async function lireDonneesSite(site) {
  const [tournois, equipes, joueurs, roster, jeux] = await Promise.all([
    site.lister('tournaments', [], [{ col: 'created_at', asc: false }]),
    site.lister('tournament_teams', [], [{ col: 'seed', asc: true, nullsFirst: false }, { col: 'name' }]),
    site.lister('tournament_players', [], [{ col: 'sort_order' }]),
    site.lister('players', [], [{ col: 'sort_order' }]),
    site.lister('games', [], [{ col: 'sort_order' }]).catch(() => []),
  ]);
  const parEquipe = new Map();
  for (const j of joueurs) {
    if (!parEquipe.has(j.team_id)) parEquipe.set(j.team_id, []);
    parEquipe.get(j.team_id).push({ id: j.id, pseudo: j.pseudo, role: j.role, capitaine: j.is_captain, discordId: j.discord_id ?? null, embarkId: j.embark_id ?? null });
  }
  return {
    tournois: tournois.map(t => ({
      id: t.id,
      slug: t.slug,
      nom: t.name,
      statut: t.status,
      ouvert: STATUTS_OUVERTS.includes(t.status),
      equipes: equipes
        .filter(e => e.tournament_id === t.id)
        .map(e => ({ id: e.id, nom: e.name, tag: e.tag, couleur: e.color, statut: e.status, disqualifiee: e.disqualified, joueurs: parEquipe.get(e.id) ?? [] })),
    })),
    roster: jeux
      .map(g => ({ id: g.id, nom: g.name ?? g.id, joueurs: roster.filter(p => p.game_id === g.id).map(p => ({ id: p.id, pseudo: p.pseudo, role: p.role, discordId: p.discord_id ?? null })) }))
      .filter(g => g.joueurs.length),
  };
}

// ------------------------------------------------------------------ Réglages

export const lireSite = base => lireReglage(base, 'site_lz', SITE_DEFAUT);

export function validerSite(c, actuel) {
  const s = { ...actuel };
  if (c.discordActif !== undefined) s.discordActif = c.discordActif === true;
  if (c.rosterActif !== undefined) s.rosterActif = c.rosterActif === true;
  if (c.inscriptions !== undefined) {
    if (!Array.isArray(c.inscriptions) || c.inscriptions.length > 25) throw echec(400, 'site-inscriptions', 'Liste d’inscriptions invalide.');
    s.inscriptions = c.inscriptions
      .map(i => ({ categorieId: String(i?.categorieId ?? ''), tournoiId: String(i?.tournoiId ?? '') }))
      .filter(i => /^[0-9a-f-]{36}$/i.test(i.categorieId) && /^[0-9a-f-]{36}$/i.test(i.tournoiId));
  }
  return s;
}

// ------------------------------------------------------------------ Inscriptions depuis un ticket

/** « Discord ID — Embark ID » (ou pseudo#1234, ou une seule des deux valeurs), une ligne par joueur. */
export function lireLignesJoueurs(texte) {
  return String(texte ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map(l => {
      const morceaux = l.split(/\s*(?:—|–|-{1,2}|\||;|,|\/)\s*|\s+/).filter(Boolean);
      const discordId = morceaux.map(m => m.replace(/^<@!?(\d+)>$/, '$1')).find(m => /^\d{15,25}$/.test(m)) ?? null;
      const embarkId = morceaux.find(m => /#\d{3,5}$/.test(m)) ?? null;
      const pseudo = (embarkId ?? morceaux.find(m => m !== discordId) ?? l).replace(/#\d{3,5}$/, '').slice(0, 40) || 'Joueur';
      return { pseudo, discordId, embarkId };
    });
}

/** Ticket ouvert : s'il est dans une catégorie liée à un tournoi du site, une inscription en attente est notée. */
export async function noterInscription(base, ticket, reponses, { maintenant = () => Date.now() } = {}) {
  const reglages = await lireSite(base);
  const lien = reglages.inscriptions.find(i => i.categorieId === ticket.categorie_id);
  if (!lien) return null;
  const r = Object.fromEntries((reponses ?? []).map(x => [x.id, x.valeur]));
  const donnees = {
    equipe: String(r.equipe ?? '').slice(0, 50),
    tag: String(r.tag ?? '').slice(0, 6),
    joueurs: lireLignesJoueurs(r.joueurs),
    coach: lireLignesJoueurs(r.coach),
    remplacants: lireLignesJoueurs(r.remplacants),
    contact: { discordId: ticket.auteur_discord_id, nom: ticket.auteur_nom },
    numero: ticket.numero,
  };
  const id = nouvelId();
  await base.executer(
    `INSERT INTO lz_inscriptions (id, ticket_id, categorie_id, tournoi_id, donnees, statut, cree_le) VALUES (?, ?, ?, ?, ?, 'attente', ?)`,
    [id, ticket.id, ticket.categorie_id, lien.tournoiId, JSON.stringify(donnees), iso(maintenant())],
  );
  return id;
}

// ------------------------------------------------------------------ Synchronisation Discord

const nomSalon = s =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'equipe';
const couleurInt = c => (/^#?[0-9a-f]{6}$/i.test(String(c ?? '')) ? Number.parseInt(String(c).replace('#', ''), 16) : 0);

/** Ce qui doit exister sur Discord : catégories (tournois, roster) et groupes (équipes, jeux du roster). */
export function cibleDiscord(donnees, reglages) {
  const categories = [];
  const groupes = [];
  for (const t of donnees.tournois.filter(x => x.ouvert)) {
    const cat = `tournoi:${t.id}`;
    categories.push({ cle: cat, nom: `🏆 ${t.nom}`.slice(0, 100) });
    for (const e of t.equipes.filter(x => !x.disqualifiee)) {
      groupes.push({ cle: `equipe:${e.id}`, categorie: cat, role: (e.tag ? `${e.tag} · ${e.nom}` : e.nom).slice(0, 100), salon: nomSalon(e.tag || e.nom), couleur: couleurInt(e.couleur), membres: e.joueurs.map(j => idDiscord(j.discordId)).filter(Boolean) });
    }
  }
  if (reglages.rosterActif && donnees.roster.length) {
    categories.push({ cle: 'roster', nom: '🎮 Roster LZ' });
    for (const g of donnees.roster) {
      groupes.push({ cle: `roster:${g.id}`, categorie: 'roster', role: `LZ · ${g.nom}`.slice(0, 100), salon: nomSalon(`lz-${g.nom}`), couleur: 0xf23127, membres: g.joueurs.map(j => idDiscord(j.discordId)).filter(Boolean) });
    }
  }
  return { categories, groupes };
}

export async function synchroniserDiscord({ base, site, fetch: fetchDiscord, jetonBot, maintenant = () => Date.now(), journal = console }) {
  const reglages = await lireSite(base);
  const general = await lireGeneral(base);
  const guild = general.guildId;
  const bilan = { ok: true, crees: 0, supprimes: 0, membres: 0, absents: 0, erreurs: [] };
  if (!reglages.discordActif) return { ...bilan, ok: false, motif: 'inactif' };
  if (!jetonBot || !guild) return { ...bilan, ok: false, motif: 'bot-ou-serveur' };
  const appel = (m, chemin, corps) => rest(fetchDiscord, jetonBot, m, chemin, corps, { raison: 'Site LigneZero : équipes' });
  const erreur = (quoi, r) => bilan.erreurs.length < 20 && bilan.erreurs.push(`${quoi} (HTTP ${r.statut || '?'})`);
  const moi = (await appel('GET', '/users/@me')).corps?.id;
  const cible = cibleDiscord(await lireDonneesSite(site), reglages);
  const existants = new Map((await base.tous('SELECT * FROM lz_discord', [])).map(l => [l.cle, { ...l, membres: jsonOu(l.membres, []) }]));
  const t = () => iso(maintenant());
  const noter = (l) =>
    base.executer(
      `INSERT INTO lz_discord (cle, type, nom, role_id, texte_id, vocal_id, categorie_id, membres, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (cle) DO UPDATE SET type = excluded.type, nom = excluded.nom, role_id = excluded.role_id, texte_id = excluded.texte_id, vocal_id = excluded.vocal_id, categorie_id = excluded.categorie_id, membres = excluded.membres, maj_le = excluded.maj_le`,
      [l.cle, l.type, l.nom, l.role_id ?? null, l.texte_id ?? null, l.vocal_id ?? null, l.categorie_id ?? null, JSON.stringify(l.membres ?? []), t()],
    );
  const prive = (roleId) => [
    { id: guild, type: 0, allow: '0', deny: VOIR },
    ...(roleId ? [{ id: roleId, type: 0, allow: DROITS_EQUIPE, deny: '0' }] : []),
    ...(moi ? [{ id: moi, type: 1, allow: DROITS_BOT_EQUIPE, deny: '0' }] : []),
  ];

  // Catégories.
  const idsCategories = new Map();
  for (const c of cible.categories) {
    let l = existants.get(c.cle);
    if (!l?.categorie_id) {
      const r = await appel('POST', `/guilds/${guild}/channels`, { name: c.nom, type: 4, permission_overwrites: prive(null) });
      if (!r.ok) { erreur(`catégorie ${c.nom}`, r); continue; }
      l = { cle: c.cle, type: 'categorie', nom: c.nom, categorie_id: r.corps.id, membres: [] };
      bilan.crees++;
      await noter(l);
    } else if (l.nom !== c.nom) {
      await appel('PATCH', `/channels/${l.categorie_id}`, { name: c.nom });
      await noter({ ...l, nom: c.nom });
    }
    idsCategories.set(c.cle, l.categorie_id);
  }

  // Équipes : rôle, salon texte, salon vocal, membres.
  for (const g of cible.groupes) {
    const parent = idsCategories.get(g.categorie) ?? null;
    let l = existants.get(g.cle) ?? { cle: g.cle, type: 'groupe', nom: g.role, membres: [] };
    if (!l.role_id) {
      const r = await appel('POST', `/guilds/${guild}/roles`, { name: g.role, color: g.couleur, mentionable: true, hoist: false, permissions: '0' });
      if (!r.ok) { erreur(`rôle ${g.role}`, r); continue; }
      l = { ...l, role_id: r.corps.id };
      bilan.crees++;
    } else if (l.nom !== g.role) await appel('PATCH', `/guilds/${guild}/roles/${l.role_id}`, { name: g.role, color: g.couleur });
    for (const [champ, type] of [['texte_id', 0], ['vocal_id', 2]]) {
      if (l[champ]) {
        if (l.nom !== g.role) await appel('PATCH', `/channels/${l[champ]}`, { name: type === 2 ? g.role : g.salon });
        continue;
      }
      const r = await appel('POST', `/guilds/${guild}/channels`, { name: type === 2 ? g.role : g.salon, type, parent_id: parent, permission_overwrites: prive(l.role_id) });
      if (r.ok) { l = { ...l, [champ]: r.corps.id }; bilan.crees++; } else erreur(`salon ${g.salon}`, r);
    }
    l = { ...l, nom: g.role, categorie_id: parent };
    // Membres : rôle donné aux nouveaux, retiré à ceux qui ne sont plus dans l'équipe.
    const avant = new Set(l.membres ?? []);
    const presents = [];
    for (const m of g.membres) {
      if (avant.has(m)) { presents.push(m); continue; }
      const r = await appel('PUT', `/guilds/${guild}/members/${m}/roles/${l.role_id}`);
      if (r.ok) { presents.push(m); bilan.membres++; } else if (r.statut === 404) bilan.absents++; else erreur(`rôle pour ${m}`, r);
    }
    for (const m of avant) if (!g.membres.includes(m)) await appel('DELETE', `/guilds/${guild}/members/${m}/roles/${l.role_id}`);
    await noter({ ...l, membres: presents });
  }

  // Nettoyage : ce qui n'est plus voulu (tournoi terminé, équipe retirée, roster désactivé).
  const voulus = new Set([...cible.categories.map(c => c.cle), ...cible.groupes.map(g => g.cle)]);
  const aSupprimer = [...existants.values()].filter(l => !voulus.has(l.cle)).sort((a, b) => (a.type === 'categorie') - (b.type === 'categorie'));
  for (const l of aSupprimer) {
    for (const id of [l.texte_id, l.vocal_id]) if (id) await appel('DELETE', `/channels/${id}`);
    if (l.role_id) await appel('DELETE', `/guilds/${guild}/roles/${l.role_id}`);
    if (l.type === 'categorie' && l.categorie_id) await appel('DELETE', `/channels/${l.categorie_id}`);
    await base.executer('DELETE FROM lz_discord WHERE cle = ?', [l.cle]);
    bilan.supprimes++;
  }
  bilan.ok = bilan.erreurs.length === 0;
  const ins = instructionReglage('site_lz_etat', { ...bilan, le: t() }, null, maintenant());
  await base.executer(ins.sql, ins.params);
  if (bilan.erreurs.length) journal.error?.('[esport] site LZ : synchro Discord', bilan.erreurs.join(' ; '));
  return bilan;
}

// ------------------------------------------------------------------ Services (routes)

export function servicesSiteLz({ base, contexteTickets, fetch: fetchDiscord, jetonBot, maintenant = () => Date.now(), site: siteFourni, envoyerDansTicket }) {
  let siteCache = null;
  const site = () => siteFourni ?? (siteCache ??= clientSite(configSite()));
  const exiger = acteur => contexteTickets(base, acteur, { exiger: 'configurer' });

  async function lireEtat() {
    const l = await base.premier("SELECT valeur FROM tickets_reglages WHERE cle = 'site_lz_etat'", []);
    return jsonOu(l?.valeur, null);
  }

  async function vue(acteur) {
    await exiger(acteur);
    const reglages = await lireSite(base);
    const inscriptions = (await base.tous("SELECT * FROM lz_inscriptions WHERE statut = 'attente' ORDER BY cree_le DESC LIMIT 100", [])).map(i => ({ ...i, donnees: jsonOu(i.donnees, {}) }));
    const categories = (await base.tous('SELECT id, nom_fr FROM tickets_categories WHERE supprime_le IS NULL ORDER BY position, nom_fr', [])).map(c => ({ id: c.id, nom: c.nom_fr }));
    let donnees = null;
    let erreur = null;
    try {
      donnees = await lireDonneesSite(site());
    } catch (e) {
      erreur = e?.message ?? 'Site injoignable';
    }
    return { reglages, etat: await lireEtat(), donnees, erreur, inscriptions, categories };
  }

  async function changer(acteur, corps) {
    await exiger(acteur);
    const s = validerSite(corps ?? {}, await lireSite(base));
    const ins = instructionReglage('site_lz', s, acteur.compte, maintenant());
    await base.executer(ins.sql, ins.params);
    return vue(acteur);
  }

  async function synchroniser(acteur) {
    await exiger(acteur);
    const bilan = await synchroniserDiscord({ base, site: site(), fetch: fetchDiscord, jetonBot, maintenant });
    return { bilan, ...(await vue(acteur)) };
  }

  const texte = (v, max) => (v === undefined ? undefined : v === null ? null : String(v).trim().slice(0, max) || null);
  const discord = v => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const id = String(v).replace(/^<@!?(\d+)>$/, '$1').trim();
    if (!/^\d{15,25}$/.test(id)) throw echec(400, 'site-discord-id', 'Discord ID invalide (un nombre de 17 à 20 chiffres).');
    return id;
  };

  /** Modification d'une équipe, d'un joueur de tournoi ou d'un joueur du roster. */
  async function modifier(acteur, corps) {
    await exiger(acteur);
    const c = corps ?? {};
    const id = String(c.id ?? '');
    if (!id) throw echec(400, 'site-id', 'Élément à modifier manquant.');
    if (c.type === 'equipe') await site().modifier('tournament_teams', id, { name: texte(c.nom, 60) ?? undefined, tag: texte(c.tag, 6) });
    else if (c.type === 'joueur') await site().modifier('tournament_players', id, { pseudo: texte(c.pseudo, 40) ?? undefined, discord_id: discord(c.discordId), embark_id: texte(c.embarkId, 60), is_captain: c.capitaine === undefined ? undefined : c.capitaine === true });
    else if (c.type === 'roster') await site().modifier('players', id, { discord_id: discord(c.discordId) });
    else if (c.type === 'ajout_joueur') await site().inserer('tournament_players', [{ team_id: id, pseudo: texte(c.pseudo, 40) ?? 'Joueur', discord_id: discord(c.discordId) ?? null, embark_id: texte(c.embarkId, 60) ?? null, sort_order: Number(c.ordre) || 0 }]);
    else if (c.type === 'retrait_joueur') await site().supprimer('tournament_players', id);
    else throw echec(400, 'site-type', 'Type inconnu.');
    return vue(acteur);
  }

  /** Inscription validée : équipe et joueurs créés sur le site, message dans le ticket. Refusée : simplement notée. */
  async function traiterInscription(acteur, id, decision) {
    await exiger(acteur);
    const i = await base.premier('SELECT * FROM lz_inscriptions WHERE id = ?', [id]);
    if (!i || i.statut !== 'attente') throw echec(404, 'site-inscription', 'Inscription introuvable ou déjà traitée.');
    const d = jsonOu(i.donnees, {});
    let equipeId = null;
    if (decision === 'valider') {
      const [equipe] = await site().inserer('tournament_teams', [{ tournament_id: i.tournoi_id, name: d.equipe || `Équipe ${d.numero ?? ''}`.trim(), tag: d.tag || null }]);
      equipeId = equipe.id;
      const lignes = [...(d.joueurs ?? []).map((j, n) => ({ ...j, role: null, capitaine: n === 0 })), ...(d.remplacants ?? []).map(j => ({ ...j, role: 'Remplaçant' })), ...(d.coach ?? []).map(j => ({ ...j, role: 'Coach' }))];
      if (lignes.length) {
        await site().inserer('tournament_players', lignes.map((j, n) => ({ team_id: equipeId, pseudo: j.pseudo, role: j.role ?? null, is_captain: Boolean(j.capitaine), discord_id: j.discordId ?? null, embark_id: j.embarkId ?? null, sort_order: n })));
      }
      await envoyerDansTicket?.(i.ticket_id, `✅ Équipe **${d.equipe}** inscrite au tournoi : elle apparaît maintenant sur le site LigneZero.\n> ✅ Team **${d.equipe}** registered: it now appears on the LigneZero website.`).catch(() => undefined);
    }
    await base.executer('UPDATE lz_inscriptions SET statut = ?, equipe_id = ?, traite_le = ?, traite_par = ? WHERE id = ?', [decision === 'valider' ? 'validee' : 'refusee', equipeId, iso(maintenant()), acteur.compte ?? null, id]);
    return vue(acteur);
  }

  return { vue, changer, synchroniser, modifier, traiterInscription };
}
