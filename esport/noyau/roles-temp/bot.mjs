/**
 * Rôles temporaires : commande /role-temp du bot (docs/esport/bot-discord.md, « Rôles temporaires »), branchée dans le
 * bot existant (discord/bot/interactions.mjs : même adresse, signature vérifiée).
 *
 *   /role-temp donner membre:@x [duree:24h] [raison:…] [equipe:…]   donne (ou prolonge) le rôle de la team
 *   /role-temp retirer membre:@x [equipe:…]                          le retire tout de suite
 *   /role-temp liste [equipe:…]                                      rôles actifs de la team (qui, jusqu'à quand)
 *
 * La team est celle de l'appelant : son compte Esport lié (/lier), membre actif d'une team avec un rôle autorisé
 * (equipes.mjs). S'il est dans plusieurs teams, l'option `equipe` (autocomplétion limitée à SES teams) précise laquelle.
 * Chaque sous-commande peut être désactivée ou réservée à des rôles Discord (réglage `roles_temp_commandes`, comme /voc
 * et les tickets) ; un administrateur du serveur n'est jamais bloqué par les rôles.
 *
 * `interaction(i)` rend la réponse pour Discord, ou `undefined` si l'interaction n'est pas pour les rôles temporaires.
 */

import { lireLangue } from '../langues.mjs';
import { sur } from '../tickets/textes.mjs';
import { LIMITES_ROLES_TEMP, lireCommandesRolesTemp } from './reglages.mjs';
import { choisirEquipe, equipesDuMembre } from './equipes.mjs';
import { RefusRoleTemp, donnerRoleTemp, lireDuree, octroiActif, octroisActifs, retirerRoleTemp } from './moteur.mjs';
import { dureeTexte, horodatage, tr } from './textes.mjs';

const EPHEMERE = 64;
const T = { COMMANDE: 2, AUTOCOMPLETE: 4 };
const PERMISSION_ADMIN = 0x8n;
const ID = /^\d{5,25}$/;
const H = 3_600_000;

export const estInteractionRolesTemp = i => (i?.type === T.COMMANDE || i?.type === T.AUTOCOMPLETE) && i?.data?.name === 'role-temp';

const avis = texte => ({ type: 4, data: { content: String(texte).slice(0, 2000), flags: EPHEMERE, allowed_mentions: { parse: [] } } });

/** Sous-commande et options de /role-temp. */
function commande(i) {
  const premier = i.data?.options?.[0];
  if (!premier || Number(premier.type) !== 1) return { nom: '', options: {}, focus: null };
  const options = Object.fromEntries((premier.options ?? []).map(o => [o.name, o.value]));
  return { nom: premier.name, options, focus: (premier.options ?? []).find(o => o.focused) ?? null };
}

const nomMembre = m => String(m?.nick || m?.user?.global_name || m?.user?.username || '').slice(0, 100);

export function creerBotRolesTemp({ base, maintenant = () => Date.now(), fetch: fetchDiscord, jetonBot, botId = null }) {
  const acteur = i => String((i.member?.user ?? i.user)?.id ?? '');

  async function langueDe(i) {
    const id = acteur(i);
    const l = ID.test(id) ? await base.premier('SELECT c.langue FROM discord_comptes dc JOIN comptes c ON c.id = dc.compte_id WHERE dc.discord_user_id = ?', [id]) : null;
    return lireLangue(l?.langue) ?? (/^fr([-_]|$)/i.test(String(i.locale ?? '')) ? 'fr' : 'en');
  }

  const adminServeur = i => {
    try {
      return (BigInt(i.member?.permissions ?? '0') & PERMISSION_ADMIN) !== 0n;
    } catch {
      return false;
    }
  };

  async function exigerCommande(i, nom) {
    const c = (await lireCommandesRolesTemp(base))[nom];
    if (!c || c.actif === false) throw new RefusRoleTemp('commande_desactivee');
    if (c.roles.length && !adminServeur(i) && !c.roles.some(r => (i.member?.roles ?? []).includes(r))) throw new RefusRoleTemp('commande_interdite');
  }

  const ctxMoteur = () => ({ base, fetch: fetchDiscord, jetonBot, maintenant, botId });

  /** Team visée par la commande (erreurs en refus). */
  async function equipeVisee(i, options, { obligatoire = true } = {}) {
    if (!i.guild_id) throw new RefusRoleTemp('autre_serveur');
    const r = await equipesDuMembre(base, acteur(i), i.guild_id);
    if (!r.lie) throw new RefusRoleTemp('lier');
    if (!r.equipes.length) throw new RefusRoleTemp(r.raison);
    const liste = r.equipes.map(e => e.nom).join(', ');
    if (!obligatoire && !options.equipe) return { ...r, equipe: null, liste };
    const c = choisirEquipe(r.equipes, options.equipe);
    if (c.erreur) throw new RefusRoleTemp(c.erreur, { liste });
    return { ...r, equipe: c.equipe, liste };
  }

  const cible = (i, options) => {
    const id = String(options.membre ?? '');
    const u = i.data?.resolved?.users?.[id];
    const m = i.data?.resolved?.members?.[id];
    return { id, bot: Boolean(u?.bot), nom: nomMembre({ ...(m ?? {}), user: u ?? { id } }) || id };
  };

  const par = (i, r) => ({ compte: r.compte, discordId: acteur(i), nom: nomMembre(i.member) || (i.member?.user ?? i.user)?.username || '' });

  async function donner(i, langue, options) {
    const r = await equipeVisee(i, options);
    const m = cible(i, options);
    if (!ID.test(m.id)) throw new RefusRoleTemp('membre_absent', { membre: '—' });
    if (m.bot) throw new RefusRoleTemp('pas_bot');
    let dureeMs = r.equipe.reglages.dureeDefautH * H;
    if (options.duree !== undefined && String(options.duree).trim() !== '') {
      dureeMs = lireDuree(options.duree);
      if (dureeMs === null) throw new RefusRoleTemp('duree_invalide', { min: dureeTexte(langue, LIMITES_ROLES_TEMP.dureeMinH), max: dureeTexte(langue, LIMITES_ROLES_TEMP.dureeMaxH) });
    }
    const res = await donnerRoleTemp(ctxMoteur(), { teamId: r.equipe.id, membreId: m.id, membreNom: m.nom, dureeMs, raison: options.raison, par: par(i, r), langue });
    const fin = Date.parse(res.octroi.expireLe);
    return avis(tr(langue, res.prolonge ? 'prolonge_ok' : 'donne_ok', { role: sur(res.octroi.roleNom || r.equipe.reglages.roleNom, 100), membre: `<@${m.id}>`, team: sur(r.equipe.nom, 80), fin: horodatage(fin, 'f'), relatif: horodatage(fin, 'R') }));
  }

  async function retirer(i, langue, options) {
    const r = await equipeVisee(i, options, { obligatoire: false });
    const m = cible(i, options);
    if (!ID.test(m.id)) throw new RefusRoleTemp('membre_absent', { membre: '—' });
    // Sans option `equipe` : l'octroi actif de la personne parmi les teams de l'appelant.
    let o = null;
    if (r.equipe) o = await octroiActif(base, r.equipe.id, m.id);
    else {
      const trouves = [];
      for (const e of r.equipes) {
        const x = await octroiActif(base, e.id, m.id);
        if (x) trouves.push(x);
      }
      if (trouves.length > 1) throw new RefusRoleTemp('equipe_ambigue', { liste: r.equipes.filter(e => trouves.some(x => x.teamId === e.id)).map(e => e.nom).join(', ') });
      o = trouves[0] ?? null;
    }
    if (!o) throw new RefusRoleTemp('aucun_octroi', { membre: `<@${m.id}>` });
    const equipe = r.equipes.find(e => e.id === o.teamId);
    const { deja } = await retirerRoleTemp(ctxMoteur(), o, { par: par(i, r), langue });
    return avis(tr(langue, deja ? 'retire_deja' : 'retire_ok', { role: sur(o.roleNom, 100), membre: `<@${o.membreId}>`, team: sur(equipe?.nom ?? '', 80) }));
  }

  async function liste(i, langue, options) {
    const r = await equipeVisee(i, options, { obligatoire: false });
    const equipes = r.equipe ? [r.equipe] : r.equipes;
    const blocs = [];
    for (const e of equipes) {
      const actifs = await octroisActifs(base, e.id);
      const entete = actifs.length ? tr(langue, 'liste_titre', { team: sur(e.nom, 80), role: sur(e.reglages.roleNom, 100), n: actifs.length, max: e.reglages.maxSimultanes }) : tr(langue, 'liste_vide', { team: sur(e.nom, 80) });
      const lignes = actifs.map(o => `- ${tr(langue, 'liste_ligne', { membre: `<@${o.membreId}>`, relatif: horodatage(Date.parse(o.expireLe), 'R'), raison: o.raison ? ` (${sur(o.raison, 60)})` : '' })}`);
      blocs.push([entete, ...lignes].join('\n'));
    }
    return avis(blocs.join('\n\n'));
  }

  async function commandeRecue(i, langue) {
    const { nom, options } = commande(i);
    if (!i.guild_id) throw new RefusRoleTemp('autre_serveur');
    await exigerCommande(i, nom);
    if (nom === 'donner') return donner(i, langue, options);
    if (nom === 'retirer') return retirer(i, langue, options);
    if (nom === 'liste') return liste(i, langue, options);
    return avis(tr(langue, 'erreur'));
  }

  /** Autocomplétion : `equipe` (SES teams seulement), `duree` (durées usuelles, et ce qui est tapé s'il est valide). */
  async function autocomplete(i, langue) {
    const { focus } = commande(i);
    const saisie = String(focus?.value ?? '').trim().toLocaleLowerCase('fr');
    let choix = [];
    if (focus?.name === 'equipe' && i.guild_id) {
      const r = await equipesDuMembre(base, acteur(i), i.guild_id);
      choix = r.equipes.filter(e => !saisie || e.nom.toLocaleLowerCase('fr').includes(saisie)).map(e => ({ name: e.nom.slice(0, 100), value: e.id }));
    } else if (focus?.name === 'duree') {
      const usuelles = [1, 6, 12, 24, 48, 72, 168].map(h => ({ name: dureeTexte(langue, h), value: h >= 48 && h % 24 === 0 ? `${h / 24}j` : `${h}h` }));
      const ms = lireDuree(saisie);
      choix = ms !== null && saisie && !usuelles.some(c => c.value === saisie) ? [{ name: saisie.slice(0, 100), value: saisie.slice(0, 20) }, ...usuelles] : usuelles;
    }
    return { type: 8, data: { choices: choix.slice(0, 25) } };
  }

  async function interaction(i) {
    if (!estInteractionRolesTemp(i)) return undefined;
    const langue = await langueDe(i);
    try {
      if (i.type === T.AUTOCOMPLETE) return await autocomplete(i, langue);
      return await commandeRecue(i, langue);
    } catch (e) {
      if (i.type === T.AUTOCOMPLETE) return { type: 8, data: { choices: [] } };
      if (e instanceof RefusRoleTemp) return avis(tr(langue, e.cle, e.vars));
      console.error('[esport] rôles temporaires : interaction', e?.message ?? e);
      return avis(tr(langue, 'erreur'));
    }
  }

  return { interaction };
}
