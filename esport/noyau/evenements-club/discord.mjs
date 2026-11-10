/**
 * Rôles Discord des équipes d'un événement du club (docs/esport/evenements.md, « Rôles automatiques »).
 *
 * `ctx` : `{ base, fetch, jetonBot, guildId, maintenant }` (serveur Discord : celui des tickets).
 *  - `synchroniser(ctx, evt, { equipeIds, retirer })` : pour chaque équipe, crée son rôle s'il manque (modèle du nom,
 *    couleur, non mentionnable, sans permission), le renomme si le nom attendu a changé (équipe ou TAG renommés,
 *    modèle changé), le donne aux membres présents qui ne l'ont pas, le retire aux membres enlevés (`retirer` :
 *    [{ equipeId, discordId }]) ; puis place les rôles de l'événement juste en dessous du rôle choisi. Bilan :
 *    `{ creees, renommees, attribues, retires, absents, sansId, refus, limite, hierarchie, position }`.
 *  - `placerRoles(ctx, evt)` : PATCH /guilds/{g}/roles avec les positions qui changent (voir `positionsSous`).
 *  - `supprimerRoleEquipe(ctx, equipe)` : rôle et salon vocal d'une équipe retirée.
 *  - `nettoyerEvenement(ctx, id)` : rôles et salons vocaux des équipes supprimés (fin de l'événement).
 *  - `tachesEvenementsDiscord(base, …)` : cron, nettoyage quand l'événement est terminé / annulé ou N heures après
 *    sa date de fin.
 * Hiérarchie : le bot ne crée, ne déplace et ne donne que des rôles placés SOUS son rôle le plus haut ; le rôle choisi
 * comme repère doit donc être sous celui du bot (vérifié et expliqué).
 */

import { iso } from '../outils.mjs';
import { lireGeneral } from '../tickets/reglages.mjs';
import { rest } from '../tickets/discord.mjs';
import { salonsDuServeur, supprimerLigne } from '../vocaux/salons.mjs';
import { nomRole } from './inscriptions.mjs';

const nomEquipe = e => `${e.tag} ${e.nom}`.trim();

/** Équipes d'un événement et leurs membres (forme de l'API). */
export async function equipesDe(base, evenementId) {
  const equipes = await base.tous(
    'SELECT * FROM club_evenement_equipes WHERE evenement_id = ? ORDER BY position, nom',
    [evenementId],
  );
  const membres = equipes.length
    ? await base.tous(
        `SELECT * FROM club_evenement_membres WHERE equipe_id IN (${equipes.map(() => '?').join(', ')}) ORDER BY position`,
        equipes.map(e => e.id),
      )
    : [];
  return equipes.map(e => ({
    id: e.id,
    nom: e.nom,
    tag: e.tag,
    roleId: e.role_id ?? null,
    roleNom: e.role_nom ?? null,
    ticketId: e.ticket_id ?? null,
    membres: membres
      .filter(m => m.equipe_id === e.id)
      .map(m => ({
        id: m.id,
        poste: m.poste,
        discordId: m.discord_id ?? null,
        nom: m.nom,
        embarkId: m.embark_id,
        roleStatut: m.role_statut ?? null,
      })),
  }));
}

/**
 * Rôles du serveur dans l'ordre de la hiérarchie (le plus haut d'abord), sans @everyone, et la position du rôle le
 * plus haut du bot. `utilisable` : le rôle est SOUS celui du bot (il peut servir de repère). `{ erreur }` sinon.
 */
export async function rolesDuServeur(ctx) {
  const [roles, moi] = await Promise.all([
    rest(ctx.fetch, ctx.jetonBot, 'GET', `/guilds/${ctx.guildId}/roles`),
    rest(ctx.fetch, ctx.jetonBot, 'GET', '/users/@me'),
  ]);
  if (!roles.ok) return { erreur: `discord-${roles.statut}` };
  const membre = moi.corps?.id
    ? await rest(
        ctx.fetch,
        ctx.jetonBot,
        'GET',
        `/guilds/${ctx.guildId}/members/${moi.corps.id}`,
      )
    : { ok: false };
  const liste = (Array.isArray(roles.corps) ? roles.corps : []).filter(
    r => String(r.id) !== ctx.guildId,
  );
  const rolesBot = membre.ok ? (membre.corps?.roles ?? []).map(String) : [];
  const positionBot = membre.ok
    ? Math.max(
        0,
        ...liste
          .filter(r => rolesBot.includes(String(r.id)))
          .map(r => Number(r.position ?? 0)),
      )
    : null;
  return {
    erreur: null,
    positionBot,
    roles: liste
      .map(r => ({
        id: String(r.id),
        nom: String(r.name ?? ''),
        position: Number(r.position ?? 0),
        couleur: Number(r.color)
          ? `#${Number(r.color).toString(16).padStart(6, '0')}`
          : null,
        gere: Boolean(r.managed),
        bot: rolesBot.includes(String(r.id)),
        utilisable:
          positionBot !== null && Number(r.position ?? 0) < positionBot,
      }))
      .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id)),
  };
}

/** Le rôle choisi comme repère peut-il servir ? `{ ok, raison? }` (raison : introuvable, au-dessus-du-bot). */
export function verifierAncre(serveur, ancreId) {
  if (!ancreId) return { ok: true };
  const r = serveur.roles.find(x => x.id === ancreId);
  if (!r) return { ok: false, raison: 'introuvable' };
  if (serveur.positionBot === null) return { ok: true };
  if (r.position >= serveur.positionBot)
    return {
      ok: false,
      raison: 'au-dessus-du-bot',
      positionBot: serveur.positionBot,
      position: r.position,
    };
  return { ok: true };
}

/**
 * Positions qui changent pour que `ids` (rôles de l'événement, dans l'ordre des équipes : la première juste sous le
 * repère) soient placés juste en dessous du rôle `ancreId`. `roles` : [{ id, position }] du serveur, sans @everyone.
 * Rend `[{ id, position }]` (seulement les rôles dont la position change : tous sous le repère, donc sous le bot).
 */
export function positionsSous(roles, ancreId, ids) {
  const montant = [...roles].sort(
    (a, b) =>
      a.position - b.position || String(b.id).localeCompare(String(a.id)),
  );
  const nos = ids.filter(id => montant.some(r => r.id === id));
  const reste = montant.filter(r => !nos.includes(r.id));
  const i = reste.findIndex(r => r.id === ancreId);
  if (i < 0 || !nos.length) return [];
  // Le repère et tout ce qui est au-dessus gardent leur position ; dessous (ordre montant) : le reste, puis nos rôles.
  const p = reste[i].position;
  const dessous = [
    ...reste.slice(0, i),
    ...[...nos].reverse().map(id => ({ id })),
  ];
  const avant = new Map(montant.map(r => [r.id, r.position]));
  return dessous
    .map((r, k) => ({
      id: r.id,
      position: Math.max(1, p - (dessous.length - k)),
    }))
    .filter(x => avant.get(x.id) !== x.position);
}

/** Place les rôles de l'événement sous le rôle repère. Rend `{ ok, raison?, deplaces }`. */
export async function placerRoles(ctx, evt, serveur = null) {
  if (!evt.role_ancre_id) return { ok: true, deplaces: 0 };
  const s = serveur ?? (await rolesDuServeur(ctx));
  if (s.erreur) return { ok: false, raison: s.erreur, deplaces: 0 };
  const v = verifierAncre(s, evt.role_ancre_id);
  if (!v.ok)
    return {
      ok: false,
      raison: v.raison,
      positionBot: v.positionBot ?? null,
      deplaces: 0,
    };
  // Rôle staff de l'événement en premier (juste sous le repère), puis les rôles des équipes dans leur ordre.
  const staff = await ctx.base.premier('SELECT staff_role_id FROM club_evenements WHERE id = ?', [evt.id]);
  const ids = [
    ...(staff?.staff_role_id ? [String(staff.staff_role_id)] : []),
    ...(
      await ctx.base.tous(
        'SELECT role_id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL ORDER BY position, nom',
        [evt.id],
      )
    ).map(l => String(l.role_id)),
  ];
  const charge = positionsSous(s.roles, evt.role_ancre_id, ids);
  if (!charge.length) return { ok: true, deplaces: 0 };
  const r = await rest(
    ctx.fetch,
    ctx.jetonBot,
    'PATCH',
    `/guilds/${ctx.guildId}/roles`,
    charge,
    { raison: 'Esport HQ : rôles d’équipe sous le rôle choisi' },
  );
  if (!r.ok)
    return {
      ok: false,
      raison:
        r.code === 50013 || r.statut === 403
          ? 'hierarchie'
          : `discord-${r.statut}`,
      deplaces: 0,
    };
  return { ok: true, deplaces: charge.length };
}

const corpsRole = (evt, e) => ({
  name: nomRole(evt.modele_role, e),
  permissions: '0',
  mentionable: false,
  hoist: false,
  ...(evt.couleur ? { color: Number.parseInt(evt.couleur.slice(1), 16) } : {}),
});

/** Crée / renomme les rôles, les donne, les retire ; puis les place. Voir l'en-tête. */
export async function synchroniser(
  ctx,
  evt,
  { equipeIds = null, retirer = [], recolorer = false } = {},
) {
  const { base } = ctx;
  const g = ctx.guildId;
  const t = iso(ctx.maintenant());
  const bilan = {
    creees: 0,
    renommees: 0,
    attribues: 0,
    retires: 0,
    absents: [],
    sansId: [],
    refus: [],
    limite: false,
    hierarchie: null,
    position: null,
  };
  const serveur = await rolesDuServeur(ctx);
  if (!serveur.erreur && serveur.positionBot !== null)
    bilan.hierarchie = {
      positionBot: serveur.positionBot,
      ok: serveur.positionBot > 1,
    };
  // Membres enlevés d'une équipe : le rôle leur est retiré (au mieux).
  for (const x of retirer) {
    if (!x.roleId || !x.discordId) continue;
    const r = await rest(
      ctx.fetch,
      ctx.jetonBot,
      'DELETE',
      `/guilds/${g}/members/${x.discordId}/roles/${x.roleId}`,
      undefined,
      { raison: 'Esport HQ : retiré de l’équipe' },
    );
    if (r.ok) bilan.retires++;
  }
  let crees = false;
  for (const e of await equipesDe(base, evt.id)) {
    if (equipeIds && !equipeIds.includes(e.id)) continue;
    let roleId = e.roleId;
    const nom = nomRole(evt.modele_role, e);
    if (!roleId) {
      const r = await rest(
        ctx.fetch,
        ctx.jetonBot,
        'POST',
        `/guilds/${g}/roles`,
        corpsRole(evt, e),
        { raison: 'Esport HQ : rôle d’équipe d’événement' },
      );
      if (r.statut === 429) {
        bilan.limite = true;
        break;
      }
      if (!r.ok || !r.corps?.id) {
        bilan.refus.push({
          equipe: nomEquipe(e),
          quoi: 'creation',
          statut: r.statut,
          code: r.code ?? null,
        });
        continue;
      }
      roleId = String(r.corps.id);
      await base.executer(
        'UPDATE club_evenement_equipes SET role_id = ?, role_nom = ?, maj_le = ? WHERE id = ?',
        [roleId, nom, t, e.id],
      );
      await base.executer(
        'UPDATE club_evenement_membres SET role_statut = NULL WHERE equipe_id = ?',
        [e.id],
      );
      e.membres = e.membres.map(m => ({ ...m, roleStatut: null }));
      bilan.creees++;
      crees = true;
    } else if (e.roleNom !== nom || recolorer) {
      // Équipe, TAG ou modèle changés (ou couleur) : le rôle suit.
      const r = await rest(
        ctx.fetch,
        ctx.jetonBot,
        'PATCH',
        `/guilds/${g}/roles/${roleId}`,
        {
          name: nom,
          color: evt.couleur ? Number.parseInt(evt.couleur.slice(1), 16) : 0,
        },
        { raison: 'Esport HQ : équipe renommée' },
      );
      if (r.ok) {
        await base.executer(
          'UPDATE club_evenement_equipes SET role_nom = ?, maj_le = ? WHERE id = ?',
          [nom, t, e.id],
        );
        bilan.renommees++;
      } else if (r.code === 10011 || r.statut === 404) {
        // Rôle supprimé à la main sur Discord : oublié, recréé au prochain passage.
        await base.executer(
          'UPDATE club_evenement_equipes SET role_id = NULL, role_nom = NULL WHERE id = ?',
          [e.id],
        );
        bilan.refus.push({
          equipe: nomEquipe(e),
          quoi: 'role-disparu',
          statut: r.statut,
          code: r.code ?? null,
        });
        continue;
      } else
        bilan.refus.push({
          equipe: nomEquipe(e),
          quoi: 'renommage',
          statut: r.statut,
          code: r.code ?? null,
        });
    }
    for (const m of e.membres) {
      if (!m.discordId) {
        bilan.sansId.push({ equipe: nomEquipe(e), nom: m.nom });
        continue;
      }
      if (m.roleStatut === 'attribue') continue;
      const r = await rest(
        ctx.fetch,
        ctx.jetonBot,
        'PUT',
        `/guilds/${g}/members/${m.discordId}/roles/${roleId}`,
        undefined,
        { raison: 'Esport HQ : équipe d’événement' },
      );
      let statut = null;
      if (r.ok) {
        statut = 'attribue';
        bilan.attribues++;
      } else if (r.statut === 429) {
        bilan.limite = true;
        break;
      } else if (r.code === 10007 || (r.statut === 404 && r.code !== 10011)) {
        statut = 'absent';
        bilan.absents.push({
          equipe: nomEquipe(e),
          nom: m.nom,
          discordId: m.discordId,
        });
      } else if (r.code === 10011) {
        await base.executer(
          'UPDATE club_evenement_equipes SET role_id = NULL, role_nom = NULL WHERE id = ?',
          [e.id],
        );
        bilan.refus.push({
          equipe: nomEquipe(e),
          quoi: 'role-disparu',
          statut: r.statut,
          code: r.code,
        });
        break;
      } else {
        statut = 'refus';
        bilan.refus.push({
          equipe: nomEquipe(e),
          quoi: 'attribution',
          nom: m.nom,
          statut: r.statut,
          code: r.code ?? null,
        });
      }
      await base.executer(
        'UPDATE club_evenement_membres SET role_statut = ? WHERE id = ?',
        [statut, m.id],
      );
    }
    if (bilan.limite) break;
  }
  if (crees || !evt.roles_crees_le || evt.roles_supprimes_le) {
    const reste = await base.premier(
      'SELECT COUNT(*) AS n FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL',
      [evt.id],
    );
    if (Number(reste?.n ?? 0) > 0)
      await base.executer(
        'UPDATE club_evenements SET roles_crees_le = COALESCE(roles_crees_le, ?), roles_supprimes_le = NULL, maj_le = ? WHERE id = ?',
        [t, t, evt.id],
      );
  }
  // Position : après une création (les rôles naissent tout en bas), ou à la demande (`equipeIds` null : tout).
  if (evt.role_ancre_id && (crees || !equipeIds))
    bilan.position = await placerRoles(
      ctx,
      evt,
      crees ? null : serveur.erreur ? null : serveur,
    );
  return bilan;
}

/** Salons vocaux d'une équipe (hub de l'événement) supprimés. */
async function supprimerSalons(ctx, filtre, raison) {
  let n = 0;
  const echecs = [];
  for (const s of (await salonsDuServeur(ctx.base, ctx.guildId)).filter(
    filtre,
  )) {
    const r = await rest(
      ctx.fetch,
      ctx.jetonBot,
      'DELETE',
      `/channels/${s.salonId}`,
      undefined,
      { raison },
    );
    if (r.ok || r.statut === 404) {
      await supprimerLigne(ctx.base, s.salonId);
      n++;
    } else
      echecs.push({
        quoi: 'salon',
        id: s.salonId,
        statut: r.statut,
        code: r.code ?? null,
      });
  }
  return { n, echecs };
}

/** Équipe retirée : son rôle et son salon vocal supprimés (au mieux). Rend `{ role, salons }`. */
export async function supprimerRoleEquipe(ctx, e) {
  const s = await supprimerSalons(
    ctx,
    x => x.equipeId === e.id,
    'Esport HQ : équipe retirée de l’événement',
  );
  let role = false;
  if (e.role_id) {
    const r = await rest(
      ctx.fetch,
      ctx.jetonBot,
      'DELETE',
      `/guilds/${ctx.guildId}/roles/${e.role_id}`,
      undefined,
      { raison: 'Esport HQ : équipe retirée de l’événement' },
    );
    role = r.ok || r.statut === 404;
  }
  return { role, salons: s.n };
}

/**
 * Supprime les rôles Discord de l'événement et les salons vocaux de ses équipes. Rend `{ roles, salons, echecs }`.
 * Rôle ou salon déjà supprimé : considéré comme fait.
 */
export async function nettoyerEvenement(ctx, evenementId) {
  const { base } = ctx;
  const s = await supprimerSalons(
    ctx,
    x => x.tournoiId === evenementId,
    'Esport HQ : fin de l’événement',
  );
  let roles = 0;
  const echecs = [...s.echecs];
  for (const e of await base.tous(
    'SELECT id, role_id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL',
    [evenementId],
  )) {
    const r = await rest(
      ctx.fetch,
      ctx.jetonBot,
      'DELETE',
      `/guilds/${ctx.guildId}/roles/${e.role_id}`,
      undefined,
      { raison: 'Esport HQ : fin de l’événement' },
    );
    if (r.ok || r.statut === 404) {
      await base.executer(
        'UPDATE club_evenement_equipes SET role_id = NULL, role_nom = NULL, maj_le = ? WHERE id = ?',
        [iso(ctx.maintenant()), e.id],
      );
      await base.executer(
        'UPDATE club_evenement_membres SET role_statut = NULL WHERE equipe_id = ?',
        [e.id],
      );
      roles++;
    } else
      echecs.push({
        quoi: 'role',
        id: e.role_id,
        statut: r.statut,
        code: r.code ?? null,
      });
    if (r.statut === 429) break;
  }
  // Rôle staff de l'événement : retiré des catégories de tickets, puis supprimé.
  const evt = await base.premier('SELECT staff_role_id FROM club_evenements WHERE id = ?', [evenementId]);
  if (evt?.staff_role_id) {
    await retirerDesCategories(base, evt.staff_role_id, null, ctx.maintenant);
    const r = await rest(ctx.fetch, ctx.jetonBot, 'DELETE', `/guilds/${ctx.guildId}/roles/${evt.staff_role_id}`, undefined, { raison: 'Esport HQ : fin de l’événement' });
    if (r.ok || r.statut === 404) {
      await base.executer('UPDATE club_evenements SET staff_role_id = NULL, staff_role_nom = NULL WHERE id = ?', [evenementId]);
      await base.executer('UPDATE club_evenement_staff SET role_statut = NULL WHERE evenement_id = ?', [evenementId]);
      roles++;
    } else echecs.push({ quoi: 'role', id: evt.staff_role_id, statut: r.statut, code: r.code ?? null });
  }
  if (!echecs.length)
    await base.executer(
      'UPDATE club_evenements SET roles_supprimes_le = ?, maj_le = ? WHERE id = ?',
      [iso(ctx.maintenant()), iso(ctx.maintenant()), evenementId],
    );
  return { roles, salons: s.n, echecs };
}

// ------------------------------------------------------------------ Rôle staff de l'événement

/** Bits Discord : voir, envoyer, lire l'historique, joindre des fichiers (tickets) ; voir, se connecter (vocal). */
const PERM_TICKET = String((1n << 10n) | (1n << 11n) | (1n << 15n) | (1n << 16n));
const PERM_VOCAL = String((1n << 10n) | (1n << 20n));

/** Nom du rôle staff : modèle et variable {evenement} (100 caractères au plus). */
export function nomRoleStaff(modele, nomEvenement) {
  const s = String(modele || 'Staff {evenement}')
    .replace(/\{evenement\}/g, nomEvenement ?? '')
    .replace(/@(everyone|here)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || `Staff ${nomEvenement ?? ''}`.trim()).slice(0, 100);
}

const listeJson = v => {
  try {
    const x = JSON.parse(v || '[]');
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
};

/** Retire le rôle des rôles qui traitent les tickets, partout (`garder` : ids de catégories où il reste). */
export async function retirerDesCategories(base, roleId, garder, maintenant) {
  for (const c of await base.tous('SELECT id, roles_discord FROM tickets_categories', [])) {
    if (garder?.includes(c.id)) continue;
    const roles = listeJson(c.roles_discord);
    if (!roles.includes(roleId)) continue;
    await base.executer('UPDATE tickets_categories SET roles_discord = ?, maj_le = ? WHERE id = ?', [JSON.stringify(roles.filter(r => r !== roleId)), iso(maintenant()), c.id]);
  }
}

/**
 * Ajoute le rôle staff aux rôles qui traitent les tickets des catégories de l'événement (nouveaux tickets) et l'ouvre
 * sur les salons des tickets déjà ouverts de ces catégories ; le retire des autres catégories. Rend le nombre de
 * catégories où il a été ajouté.
 */
async function accesTickets(ctx, roleId, categories) {
  let n = 0;
  await retirerDesCategories(ctx.base, roleId, categories, ctx.maintenant);
  for (const id of categories) {
    const c = await ctx.base.premier('SELECT id, roles_discord FROM tickets_categories WHERE id = ?', [id]);
    if (!c) continue;
    const roles = listeJson(c.roles_discord);
    if (!roles.includes(roleId)) {
      await ctx.base.executer('UPDATE tickets_categories SET roles_discord = ?, maj_le = ? WHERE id = ?', [JSON.stringify([...roles, roleId]), iso(ctx.maintenant()), id]);
      n++;
    }
    for (const t of await ctx.base.tous("SELECT salon_id FROM tickets WHERE categorie_id = ? AND statut <> 'ferme' AND salon_id IS NOT NULL", [id])) {
      await rest(ctx.fetch, ctx.jetonBot, 'PUT', `/channels/${t.salon_id}/permissions/${roleId}`, { type: 0, allow: PERM_TICKET, deny: '0' }, { raison: 'Esport HQ : staff de l’événement' });
    }
  }
  return n;
}

/** Ouvre les salons vocaux des équipes de l'événement au rôle staff (voir, se connecter). */
async function accesVocaux(ctx, evenementId, roleId) {
  let n = 0;
  for (const s of (await salonsDuServeur(ctx.base, ctx.guildId)).filter(x => x.tournoiId === evenementId)) {
    const r = await rest(ctx.fetch, ctx.jetonBot, 'PUT', `/channels/${s.salonId}/permissions/${roleId}`, { type: 0, allow: PERM_VOCAL, deny: '0' }, { raison: 'Esport HQ : staff de l’événement' });
    if (r.ok) n++;
  }
  return n;
}

/**
 * Rôle staff de l'événement : créé s'il manque (dès qu'il y a du staff ou une catégorie de tickets), renommé si le nom
 * attendu a changé, donné au staff, retiré à qui n'en fait plus partie (`retirer` : [discordId]) ; ajouté aux catégories
 * de tickets de l'événement et aux salons vocaux des équipes. Rend `{ cree, attribues, retires, absents, refus,
 * categories, vocaux, roleId }`, ou null s'il n'y a rien à faire.
 */
export async function synchroniserStaff(ctx, evtLigne, { retirer = [] } = {}) {
  const { base } = ctx;
  const evt = (await base.premier('SELECT * FROM club_evenements WHERE id = ?', [evtLigne.id])) ?? evtLigne;
  const staff = await base.tous('SELECT * FROM club_evenement_staff WHERE evenement_id = ? ORDER BY position, cree_le', [evt.id]);
  const categories = listeJson(evt.categories_tickets);
  const b = { cree: false, attribues: 0, retires: 0, absents: [], refus: [], categories: 0, vocaux: 0, roleId: evt.staff_role_id ?? null };
  let roleId = evt.staff_role_id;
  if (roleId && retirer.length) {
    for (const did of retirer) {
      const r = await rest(ctx.fetch, ctx.jetonBot, 'DELETE', `/guilds/${ctx.guildId}/members/${did}/roles/${roleId}`, undefined, { raison: 'Esport HQ : retiré du staff de l’événement' });
      if (r.ok) b.retires++;
    }
  }
  if (!roleId && !staff.length && !categories.length) return retirer.length ? b : null;
  const t = iso(ctx.maintenant());
  const nom = nomRoleStaff(evt.staff_modele, evt.nom);
  if (!roleId) {
    const r = await rest(ctx.fetch, ctx.jetonBot, 'POST', `/guilds/${ctx.guildId}/roles`, { name: nom, permissions: '0', mentionable: false, hoist: false }, { raison: 'Esport HQ : staff de l’événement' });
    if (!r.ok || !r.corps?.id) {
      b.refus.push({ equipe: nom, quoi: 'creation', statut: r.statut, code: r.code ?? null });
      return b;
    }
    roleId = String(r.corps.id);
    await base.executer('UPDATE club_evenements SET staff_role_id = ?, staff_role_nom = ?, roles_crees_le = COALESCE(roles_crees_le, ?), roles_supprimes_le = NULL, maj_le = ? WHERE id = ?', [roleId, nom, t, t, evt.id]);
    await base.executer('UPDATE club_evenement_staff SET role_statut = NULL WHERE evenement_id = ?', [evt.id]);
    staff.forEach(m => (m.role_statut = null));
    b.cree = true;
  } else if (evt.staff_role_nom !== nom) {
    const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/guilds/${ctx.guildId}/roles/${roleId}`, { name: nom }, { raison: 'Esport HQ : événement renommé' });
    if (r.ok) await base.executer('UPDATE club_evenements SET staff_role_nom = ? WHERE id = ?', [nom, evt.id]);
  }
  b.roleId = roleId;
  for (const m of staff) {
    if (m.role_statut === 'attribue') continue;
    const r = await rest(ctx.fetch, ctx.jetonBot, 'PUT', `/guilds/${ctx.guildId}/members/${m.discord_id}/roles/${roleId}`, undefined, { raison: 'Esport HQ : staff de l’événement' });
    let statut = 'refus';
    if (r.ok) {
      statut = 'attribue';
      b.attribues++;
    } else if (r.code === 10007 || (r.statut === 404 && r.code !== 10011)) {
      statut = 'absent';
      b.absents.push({ equipe: nom, nom: m.nom, discordId: m.discord_id });
    } else b.refus.push({ equipe: nom, quoi: 'attribution', nom: m.nom, statut: r.statut, code: r.code ?? null });
    await base.executer('UPDATE club_evenement_staff SET role_statut = ? WHERE id = ?', [statut, m.id]);
  }
  b.categories = await accesTickets(ctx, roleId, categories);
  // Salons d'équipe déjà ouverts : le rôle tout juste créé y est ajouté (les suivants l'ont dès leur création).
  if (b.cree) {
    b.vocaux = await accesVocaux(ctx, evt.id, roleId);
    if (evt.role_ancre_id) b.position = await placerRoles(ctx, evt);
  }
  return b;
}

/** Fin de journée (UTC) d'une date AAAA-MM-JJ, ou null. */
export const finDe = fin =>
  typeof fin === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fin)
    ? Date.parse(`${fin}T23:59:59.999Z`)
    : null;

/** Les rôles de l'événement sont-ils « dus » au nettoyage (terminé, annulé, ou fin + délai passée) ? */
export function finiPourDiscord(evt, t) {
  if (['termine', 'annule'].includes(evt.statut)) return true;
  const fin = finDe(evt.fin);
  const h = Number(evt.suppression_h);
  return h > 0 && fin !== null && t >= fin + h * 3_600_000;
}

/** Cron (toutes les 5 min) : rôles des événements finis supprimés avec les salons des équipes. Rend le nombre nettoyé. */
export async function tachesEvenementsDiscord(
  base,
  {
    fetch: fetchDiscord = (...a) => globalThis.fetch(...a),
    jetonBot,
    maintenant = () => Date.now(),
  } = {},
) {
  if (!jetonBot) return 0;
  const general = await lireGeneral(base);
  if (!general.guildId) return 0;
  const t = maintenant();
  let n = 0;
  for (const evt of await base.tous(
    'SELECT * FROM club_evenements WHERE roles_crees_le IS NOT NULL AND roles_supprimes_le IS NULL',
    [],
  )) {
    if (!finiPourDiscord(evt, t)) continue;
    await nettoyerEvenement(
      {
        base,
        fetch: fetchDiscord,
        jetonBot,
        guildId: general.guildId,
        maintenant,
      },
      evt.id,
    );
    n++;
  }
  return n;
}
