/**
 * Rôles « passe-partout » des salons vocaux (rôle Goat, docs/esport/vocaux.md, « Accès à toutes les vocs »).
 *
 * Ces rôles entrent dans TOUTES les vocs : voir, se connecter, parler, partager l'écran, détection de la voix
 * (`DROITS_PASSE_PARTOUT`), et rien d'autre : ni déplacer, ni couper micro ou son, ni gérer les salons ou les rôles. Le
 * rôle lui-même n'a AUCUNE permission de serveur (`permissions: "0"`) : tout passe par des surcharges de salons, qui
 * l'emportent sur les refus de @everyone, de la catégorie et du verrouillage.
 *
 *  - salons créés par le bot (temporaires, verrouillés ou non, salons d'équipe et du staff d'un événement) : surcharges
 *    calculées par `surchargesSalon` (salons.mjs) ; hubs cachés : `surchargesHubMasque` (hubs.mjs) ;
 *  - autres salons (hubs visibles et, option « Aussi sur tous les salons vocaux du serveur », tout salon vocal ou scène
 *    du serveur) : `synchroniserPasse` pose la surcharge du rôle (PUT d'une seule surcharge, jamais celles des autres) et
 *    NOTE l'état d'origine de ce rôle sur le salon (`vocaux_passepartout` dans `tickets_reglages`) : retirer le rôle de la
 *    liste (ou couper l'option) rend exactement cet état, sans toucher à ce qui existait avant ;
 *  - travail borné : `LIMITE_REQUETES` requêtes au plus par passage (le reste au passage suivant), arrêt au premier 429,
 *    salons refusés par Discord notés (et réessayés au plus toutes les 10 minutes par le moteur) ;
 *  - déclenchement : enregistrement des réglages, création d'un salon vocal (CHANNEL_CREATE), reconnexion de la Gateway,
 *    et passage périodique du superviseur (dérive : surcharge retirée à la main).
 */

import { echec, iso, jsonOu } from '../outils.mjs';
import { rest } from '../tickets/discord.mjs';
import { NOM_ROLE_GOAT, hubMasque } from './reglages.mjs';
import { DROITS_PASSE_PARTOUT, appliquerSurcharges, salonsDuServeur } from './salons.mjs';
import { rolesEquipe } from './tournoi.mjs';
import { codeRefusDiscord, signalerAlerte } from '../notifications/signaler.mjs';

export const CLE_SUIVI = 'vocaux_passepartout';
/** Requêtes Discord au plus par passage. */
export const LIMITE_REQUETES = 60;
/** Salon refusé par Discord : nouvel essai (passages périodiques) au plus toutes les 10 minutes. */
export const DELAI_REESSAI_MS = 10 * 60 * 1000;
const VOCAUX = new Set([2, 13]);
const COULEUR_GOAT = 0xf1c40f;

const bits = (...v) => v.reduce((a, b) => a | BigInt(b ?? 0), 0n);
const propre = o => ({ id: String(o.id), type: Number(o.type) === 1 ? 1 : 0, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') });

export async function lireSuivi(base) {
  const l = await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [CLE_SUIVI]);
  const v = jsonOu(l?.valeur, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

async function ecrireSuivi(base, suivi, t) {
  await base.executer(
    'INSERT INTO tickets_reglages (cle, valeur, maj_par, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
    [CLE_SUIVI, JSON.stringify(suivi), null, iso(t)],
  );
}

/** Bilan affiché dans la carte (`tickets_etat`, clé `vocaux`, champ `passePartout`) : lecture puis fusion. */
export async function noterBilanPasse(base, bilan, t) {
  // Salons refusés par Discord (hiérarchie, permission manquante du bot) : alerte `vocal-alerte`, une par cause et par 6 h.
  const causes = new Map();
  for (const e of bilan?.echecs ?? []) {
    if (e.statut === 429) continue;
    const cause = codeRefusDiscord(e);
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
  }
  for (const [cause, nombre] of causes) await signalerAlerte(base, 'vocal', { cle: `vocal:passe-partout:${cause}`, charge: { code: cause, quoi: 'passe-partout', nombre }, maintenant: t });
  const l = await base.premier("SELECT valeur FROM tickets_etat WHERE cle = 'vocaux'", []);
  const actuel = jsonOu(l?.valeur, {});
  await base.executer(
    'INSERT INTO tickets_etat (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le',
    ['vocaux', JSON.stringify({ ...actuel, passePartout: bilan }), iso(t)],
  );
}

const satisfait = o => Boolean(o) && (BigInt(o.allow ?? '0') & DROITS_PASSE_PARTOUT) === DROITS_PASSE_PARTOUT && (BigInt(o.deny ?? '0') & DROITS_PASSE_PARTOUT) === 0n;

/**
 * Synchronise les surcharges des rôles passe-partout sur les salons vocaux et de scène de `salons` (salons Discord avec
 * leurs `permission_overwrites` : lecture REST ou cache de la Gateway). `ctx` : `base`, `fetch`, `jetonBot`, `guildId`,
 * `maintenant`, `journal`. Options : `seulement` (ids : ne traiter que ces salons ; sinon tous, et oublier les salons
 * disparus), `limite` (requêtes), `memo` (Map salon → dernier échec, pour ne pas réessayer sans cesse).
 * Rend `null` s'il n'y a rien à faire, sinon `{ cibles, couverts, ajoutes, restaures, echecs, reste, limiteDebit, le }`.
 */
export async function synchroniserPasse(ctx, reglages, { salons, seulement = null, limite = LIMITE_REQUETES, memo = null } = {}) {
  if (!ctx?.jetonBot || !ctx.guildId) return null;
  const { base, guildId } = ctx;
  const t = ctx.maintenant?.() ?? Date.now();
  const roles = [...new Set((reglages?.rolesPassePartout ?? []).map(String).filter(r => r && r !== guildId))];
  const suivi = await lireSuivi(base);
  if (!roles.length && !Object.keys(suivi).length) return null;
  const viser = id => !seulement || seulement.includes(id);
  const temporaires = new Set((await salonsDuServeur(base, guildId)).map(s => s.salonId));
  const hubs = new Map((reglages?.hubs ?? []).map(h => [h.id, h]));
  const bilan = { cibles: 0, couverts: 0, ajoutes: 0, restaures: 0, echecs: [], reste: 0, limiteDebit: false, le: iso(t) };
  let requetes = 0;
  let change = false;
  const presents = new Set();

  const envoyer = async (salon, role, methode, corps, raison) => {
    if (bilan.limiteDebit) return { ok: false, statut: 429 };
    if (requetes >= limite) {
      bilan.reste++;
      return { ok: false, statut: 0, borne: true };
    }
    requetes++;
    const r = await rest(ctx.fetch, ctx.jetonBot, methode, `/channels/${salon.id}/permissions/${role}`, corps, { raison });
    if (r.statut === 429) bilan.limiteDebit = true;
    return r;
  };

  for (const salon of salons ?? []) {
    const id = String(salon.id);
    if (!VOCAUX.has(Number(salon.type))) continue;
    presents.add(id);
    if (!viser(id)) continue;
    const hub = hubs.get(id);
    // Salons créés par le bot : surcharges de `surchargesSalon` ; hub caché : celles de `surchargesHubMasque`.
    const geree = temporaires.has(id) || (hub && hubMasque(hub));
    const cible = !geree && roles.length > 0 && (reglages?.passePartoutTous !== false || Boolean(hub));
    if (geree && roles.length) {
      bilan.cibles++;
      if (roles.every(r => satisfait((salon.permission_overwrites ?? []).find(o => String(o.id) === r && Number(o.type) !== 1)))) bilan.couverts++;
    }
    if (cible) bilan.cibles++;
    const suiviSalon = suivi[id] ?? {};
    // Salon géré par `surchargesSalon` / `surchargesHubMasque` : l'état noté est gardé tel quel (rien à poser ni à rendre ici).
    const concernes = new Set(geree ? [] : [...(cible ? roles : []), ...Object.keys(suiviSalon)]);
    let ok = true;
    let refus = null;
    for (const role of concernes) {
      const surcharges = (salon.permission_overwrites ?? []).map(propre);
      const actuel = surcharges.find(o => o.id === role && o.type === 0);
      const voulu = cible && roles.includes(role);
      const note = suiviSalon[role];
      if (voulu) {
        if (satisfait(actuel)) continue;
        if (memo && t - (memo.get(id) ?? 0) < DELAI_REESSAI_MS && ctx.respecterMemo !== false) {
          ok = false;
          continue;
        }
        const allow = bits(actuel?.allow) | DROITS_PASSE_PARTOUT;
        const deny = bits(actuel?.deny) & ~DROITS_PASSE_PARTOUT;
        const r = await envoyer(salon, role, 'PUT', { type: 0, allow: allow.toString(), deny: deny.toString() }, 'Esport HQ : accès passe-partout aux vocs');
        if (r.borne || r.statut === 429) {
          ok = false;
          continue;
        }
        if (!r.ok) {
          ok = false;
          refus = r;
          break;
        }
        if (!note) {
          (suivi[id] ??= {})[role] = { existait: Boolean(actuel), allow: actuel?.allow ?? '0', deny: actuel?.deny ?? '0' };
          suiviSalon[role] = suivi[id][role];
        }
        salon.permission_overwrites = [...surcharges.filter(o => !(o.id === role && o.type === 0)), { id: role, type: 0, allow: allow.toString(), deny: deny.toString() }];
        bilan.ajoutes++;
        change = true;
        memo?.delete(id);
      } else if (note) {
        // Rôle retiré (ou option coupée) : l'état d'origine de ce rôle sur ce salon est rendu, rien d'autre ne bouge.
        if (!actuel) {
          delete suivi[id][role];
          change = true;
          continue;
        }
        const allow = (bits(actuel.allow) & ~DROITS_PASSE_PARTOUT) | (bits(note.allow) & DROITS_PASSE_PARTOUT);
        const deny = (bits(actuel.deny) & ~DROITS_PASSE_PARTOUT) | (bits(note.deny) & DROITS_PASSE_PARTOUT);
        const efface = !note.existait && allow === 0n && deny === 0n;
        const r = efface ? await envoyer(salon, role, 'DELETE', undefined, 'Esport HQ : fin de l’accès passe-partout') : await envoyer(salon, role, 'PUT', { type: 0, allow: allow.toString(), deny: deny.toString() }, 'Esport HQ : fin de l’accès passe-partout');
        if (r.borne || r.statut === 429) continue;
        if (!r.ok && r.statut !== 404) {
          refus = r;
          break;
        }
        salon.permission_overwrites = surcharges.filter(o => !(o.id === role && o.type === 0)).concat(efface ? [] : [{ id: role, type: 0, allow: allow.toString(), deny: deny.toString() }]);
        delete suivi[id][role];
        bilan.restaures++;
        change = true;
      }
    }
    if (suivi[id] && !Object.keys(suivi[id]).length) delete suivi[id];
    if (refus) {
      bilan.echecs.push({ id, nom: String(salon.name ?? ''), statut: refus.statut ?? 0, code: refus.code ?? null });
      memo?.set(id, t);
    }
    if (cible && ok && !refus) bilan.couverts++;
    if (bilan.limiteDebit) break;
  }
  // Salons disparus : plus rien à rendre (parcours complet seulement).
  if (!seulement && !bilan.limiteDebit) {
    for (const id of Object.keys(suivi)) {
      if (presents.has(id)) continue;
      delete suivi[id];
      change = true;
    }
  }
  if (change) await ecrireSuivi(base, suivi, t);
  if (bilan.echecs.length) ctx.journal?.warn?.('[esport] vocaux : accès passe-partout refusé par Discord', JSON.stringify(bilan.echecs.slice(0, 20)));
  return bilan;
}

/**
 * Rôles retirés de la liste : sur les salons temporaires ouverts, leur surcharge (copiée du hub à la création ou posée
 * par `surchargesSalon`) est retirée, puis les surcharges des salons sont recalculées. Au plus 50 salons par appel.
 */
export async function retirerPasseTemporaires(ctx, reglages, retires) {
  if (!retires?.length || !ctx?.jetonBot || !ctx.guildId) return 0;
  const { base } = ctx;
  const c = { ...ctx, reglages };
  c.rolesEquipe = s => rolesEquipe(c, s);
  let n = 0;
  for (const s of (await salonsDuServeur(base, ctx.guildId)).slice(0, 50)) {
    const base_ = (s.basePermissions ?? []).map(propre).flatMap(o => {
      if (!retires.includes(o.id) || o.type !== 0) return [o];
      const allow = bits(o.allow) & ~DROITS_PASSE_PARTOUT;
      const deny = bits(o.deny) & ~DROITS_PASSE_PARTOUT;
      return allow === 0n && deny === 0n ? [] : [{ ...o, allow: allow.toString(), deny: deny.toString() }];
    });
    const suivant = { ...s, basePermissions: base_ };
    try {
      await base.executer('UPDATE vocaux_salons SET base_permissions = ? WHERE salon_id = ?', [JSON.stringify(base_), s.salonId]);
      await appliquerSurcharges(c, suivant);
      n++;
    } catch (e) {
      ctx.journal?.warn?.('[esport] vocaux : accès passe-partout d’un salon ouvert non retiré', s.salonId, e?.cle ?? e?.message ?? e);
    }
  }
  return n;
}

/** Salons du serveur (REST, une requête) : pour la synchronisation lancée par l'app (le cache est celui du meneur). */
export async function salonsDuServeurRest(ctx) {
  const r = await rest(ctx.fetch, ctx.jetonBot, 'GET', `/guilds/${ctx.guildId}/channels`);
  return r.ok && Array.isArray(r.corps) ? r.corps : null;
}

/**
 * Après un enregistrement des réglages (ou à la demande) : salons temporaires débarrassés des rôles retirés, puis
 * synchronisation sur le serveur ; bilan noté pour la carte. Au mieux : jamais d'erreur rendue.
 */
export async function appliquerPasse(ctx, avant, apres) {
  try {
    if (!ctx?.jetonBot || !ctx.guildId) return null;
    const anciens = avant?.rolesPassePartout ?? [];
    const retires = anciens.filter(r => !(apres?.rolesPassePartout ?? []).includes(r));
    if (retires.length) await retirerPasseTemporaires(ctx, apres, retires);
    const rien = !(apres?.rolesPassePartout ?? []).length && !anciens.length && !Object.keys(await lireSuivi(ctx.base)).length;
    if (rien) return null;
    const salons = await salonsDuServeurRest(ctx);
    if (!salons) return null;
    const bilan = await synchroniserPasse({ ...ctx, respecterMemo: false }, apres, { salons });
    if (bilan) await noterBilanPasse(ctx.base, bilan, ctx.maintenant?.() ?? Date.now());
    return bilan;
  } catch (e) {
    ctx.journal?.warn?.('[esport] vocaux : accès passe-partout non synchronisé', e?.message ?? e);
    return null;
  }
}

/** Nom d'un rôle créé : texte sans mention ni caractère de contrôle, 100 caractères au plus. */
export function nomRole(v) {
  // eslint-disable-next-line no-control-regex
  const n = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/@(everyone|here)/gi, '$1').replace(/\s+/g, ' ').trim().slice(0, 100);
  return n || NOM_ROLE_GOAT;
}

/** Couleur d'un rôle : `#rrggbb` ou entier ; défaut or ; refusée sinon. */
export function couleurRole(v) {
  if (v === undefined || v === null || v === '') return COULEUR_GOAT;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v).trim());
  if (!m) throw echec(400, 'vocaux-couleur', 'Couleur invalide (format #RRGGBB).');
  return Number.parseInt(m[1], 16);
}

/**
 * Crée le rôle (nom et couleur modifiables) SANS aucune permission (`"0"`), non affiché à part, non mentionnable, puis
 * le place juste sous le rôle du bot (au mieux). `botId` : identifiant du bot. Rend `{ role, positionne }`.
 */
export async function creerRolePasse(ctx, { nom, couleur }) {
  const { fetch: f, jetonBot, guildId } = ctx;
  if (!jetonBot) throw echec(400, 'vocaux-bot', 'Le bot Esport HQ n’est pas configuré sur le serveur de l’app.');
  const corps = { name: nomRole(nom), permissions: '0', color: couleurRole(couleur), hoist: false, mentionable: false };
  const [roles, membre] = await Promise.all([rest(f, jetonBot, 'GET', `/guilds/${guildId}/roles`), rest(f, jetonBot, 'GET', `/guilds/${guildId}/members/${ctx.botId}`)]);
  const r = await rest(f, jetonBot, 'POST', `/guilds/${guildId}/roles`, corps, { raison: 'Esport HQ : rôle passe-partout des salons vocaux (aucune permission)' });
  if (!r.ok || !r.corps?.id) throw echec(502, 'vocaux-role', `Discord a refusé de créer le rôle (${r.code ?? r.statut ?? 0}). Le bot a-t-il « Gérer les rôles » ?`);
  const role = { id: String(r.corps.id), nom: String(r.corps.name ?? corps.name) };
  const rolesBot = membre.ok ? (membre.corps?.roles ?? []) : [];
  const positionBot = Math.max(0, ...(Array.isArray(roles.corps) ? roles.corps : []).filter(x => rolesBot.includes(x.id)).map(x => Number(x.position ?? 0)));
  let positionne = false;
  if (positionBot > 1) {
    const p = await rest(f, jetonBot, 'PATCH', `/guilds/${guildId}/roles`, [{ id: role.id, position: positionBot - 1 }], { raison: 'Esport HQ : rôle passe-partout sous le rôle du bot' });
    positionne = p.ok;
  }
  return { role, positionne };
}
