/**
 * Salons vocaux temporaires : interactions Discord (boutons et fenêtres du panneau de contrôle, commande /voc),
 * branchées dans le bot existant (discord/bot/interactions.mjs : même adresse, signature vérifiée), comme les tickets.
 * Aucun compte Esport lié n'est demandé : tout membre du serveur du club peut gérer SON salon.
 *
 * Qui peut agir sur un salon : son propriétaire, ou le staff (un des rôles du staff réglés, ou un administrateur du
 * serveur). Les autres reçoivent un refus éphémère. Salon d'équipe de tournoi : ni renommer, ni déverrouiller.
 *
 * Identifiants (`custom_id`) : `vc:<action>:<salon>` — `r` (renommer → fenêtre `vc:rm:`), `l` / `u` (verrouiller,
 * déverrouiller), `n` (limite → fenêtre `vc:nm:`), `k` (expulser → menu `vc:ks:`), `a` (liste d'amis → menus `vc:aa:`
 * ajouter, `vc:ar:` retirer), `t` (transférer → menu `vc:ts:`).
 *
 * `interaction(i)` rend la réponse pour Discord, ou `undefined` si l'interaction n'est pas pour les salons vocaux. Une
 * réponse peut porter `apres` (mise à jour du panneau, lancée une fois la réponse partie).
 */

import { lireLangue } from '../langues.mjs';
import { lireGeneral } from '../tickets/reglages.mjs';
import { lireVocaux } from './reglages.mjs';
import { RefusVocal, ajouterAmis, expulser, limiter, lireSalon, majPanneau, nomMembre, renommer, retirerAmi, transferer, verrouiller } from './salons.mjs';
import { tv } from './textes.mjs';

const EPHEMERE = 64;
const T = { COMPOSANT: 3, FENETRE: 5 };
const PERMISSION_ADMIN = 0x8n;
const ID = /^\d{5,25}$/;

export const estInteractionVocaux = i => String(i?.data?.custom_id ?? '').startsWith('vc:');

const avis = texte => ({ type: 4, data: { content: String(texte).slice(0, 2000), flags: EPHEMERE, allowed_mentions: { parse: [] } } });
const fenetre = (custom_id, titre, champs) => ({ type: 9, data: { custom_id, title: String(titre).slice(0, 45), components: champs.map(c => ({ type: 1, components: [c] })) } });
const valeursFenetre = i => Object.fromEntries((i.data?.components ?? []).flatMap(r => r.components ?? []).map(c => [String(c.custom_id), String(c.value ?? '')]));
const menu = (contenu, composants) => ({ type: 4, data: { flags: EPHEMERE, content: contenu, allowed_mentions: { parse: [] }, components: composants.map(c => ({ type: 1, components: [c] })) } });

/**
 * `options.tournoi` : `{ rolesEquipe(ctx, salon), equipeDe(salon) }` (salons d'équipe de tournoi, tournoi.mjs).
 * `botId` : identifiant du bot (celui de l'application).
 */
export function creerBotVocaux({ base, maintenant = () => Date.now(), fetch: fetchDiscord, jetonBot, botId = null, tournoi = null }) {
  async function langueDe(i) {
    const u = i.member?.user ?? i.user;
    const l = u?.id ? await base.premier('SELECT c.langue FROM discord_comptes dc JOIN comptes c ON c.id = dc.compte_id WHERE dc.discord_user_id = ?', [u.id]) : null;
    return lireLangue(l?.langue) ?? (/^fr([-_]|$)/i.test(String(i.locale ?? '')) ? 'fr' : 'en');
  }

  const adminServeur = i => {
    try {
      return (BigInt(i.member?.permissions ?? '0') & PERMISSION_ADMIN) !== 0n;
    } catch {
      return false;
    }
  };

  async function contexte(i) {
    const general = await lireGeneral(base);
    const reglages = await lireVocaux(base);
    if (!general.guildId) throw new RefusVocal('non_configure');
    if (i.guild_id !== general.guildId) throw new RefusVocal('autre_serveur');
    const ctx = { base, fetch: fetchDiscord, jetonBot, maintenant, botId, guildId: general.guildId, reglages, general, mode: general.langue ?? 'auteur' };
    if (tournoi?.rolesEquipe) ctx.rolesEquipe = s => tournoi.rolesEquipe(ctx, s);
    return ctx;
  }

  const estStaff = (i, ctx) => adminServeur(i) || ctx.reglages.rolesStaff.some(r => (i.member?.roles ?? []).includes(r));
  const acteur = i => String((i.member?.user ?? i.user)?.id ?? '');

  async function salonPour(i, ctx, salonId) {
    const s = await lireSalon(base, salonId);
    if (!s || s.guildId !== ctx.guildId) throw new RefusVocal('pas_salon');
    if (s.proprietaireId !== acteur(i) && !estStaff(i, ctx)) throw new RefusVocal('pas_proprietaire');
    return s;
  }

  const panneauApres = (ctx, s) => async () => {
    const equipe = s.equipeId && tournoi?.equipeDe ? await tournoi.equipeDe(s) : '';
    await majPanneau(ctx, s, { equipe });
  };
  const ok = (ctx, s, texte) => ({ ...avis(texte), apres: panneauApres(ctx, s) });

  // ---------------------------------------------------------------- Actions communes (boutons, menus, commandes)

  async function faireExpulser(i, ctx, s, cible, langue) {
    const r = await expulser(ctx, s, cible);
    return ok(ctx, r.salon, tv(langue, r.salon.verrouille ? 'expulse_verrou' : 'expulse_ok', { membre: r.nom || `<@${cible}>` }));
  }

  async function faireTransferer(i, ctx, s, cible, langue) {
    const suivant = await transferer(ctx, s, cible);
    return ok(ctx, suivant, tv(langue, 'transfere_ok', { membre: suivant.proprietaireNom || `<@${cible}>` }));
  }

  /** Personnes choisies dans un menu d'utilisateurs (données résolues de Discord). */
  const personnesChoisies = i =>
    (i.data?.values ?? [])
      .map(String)
      .filter(id => ID.test(id))
      .map(id => {
        const u = i.data?.resolved?.users?.[id];
        const m = i.data?.resolved?.members?.[id];
        return { id, nom: nomMembre({ ...(m ?? {}), user: u ?? { id } }) || id, bot: Boolean(u?.bot) };
      });

  // ---------------------------------------------------------------- Composants

  async function composant(i, langue) {
    const id = String(i.data?.custom_id ?? '');
    const m = /^vc:([a-z]{1,2}):(\d{5,25})$/.exec(id);
    if (!m) return avis(tv(langue, 'erreur'));
    const [, action, salonId] = m;
    const ctx = await contexte(i);
    const s = await salonPour(i, ctx, salonId);
    const autres = s.occupants.filter(o => o.id !== acteur(i) && o.id !== ctx.botId);
    switch (action) {
      case 'r':
        if (s.tournoiId) throw new RefusVocal('tournoi_nom');
        return fenetre(`vc:rm:${s.salonId}`, tv(langue, 'fenetre_renommer'), [{ type: 4, custom_id: 'nom', style: 1, label: tv(langue, 'champ_nom').slice(0, 45), required: true, min_length: 1, max_length: 100, value: s.nom.slice(0, 100) }]);
      case 'l':
        return ok(ctx, await verrouiller(ctx, s, true), tv(langue, 'verrouille_ok'));
      case 'u':
        return ok(ctx, await verrouiller(ctx, s, false), tv(langue, 'deverrouille_ok'));
      case 'n':
        return fenetre(`vc:nm:${s.salonId}`, tv(langue, 'fenetre_limite'), [{ type: 4, custom_id: 'places', style: 1, label: tv(langue, 'champ_places').slice(0, 45), required: true, min_length: 1, max_length: 2, value: String(s.limite) }]);
      case 'k':
        if (!autres.length) throw new RefusVocal('personne');
        return menu(tv(langue, 'choisir_expulser'), [{ type: 3, custom_id: `vc:ks:${s.salonId}`, placeholder: tv(langue, 'choisir_expulser').slice(0, 100), options: autres.slice(0, 25).map(o => ({ label: (o.nom || o.id).slice(0, 100), value: o.id })) }]);
      case 'ks':
        return faireExpulser(i, ctx, s, String(i.data?.values?.[0] ?? ''), langue);
      case 'a': {
        if (s.tournoiId) throw new RefusVocal('tournoi_verrou');
        const composants = [{ type: 5, custom_id: `vc:aa:${s.salonId}`, placeholder: tv(langue, 'choisir_ami').slice(0, 100), min_values: 1, max_values: 10 }];
        if (s.amis.length) composants.push({ type: 3, custom_id: `vc:ar:${s.salonId}`, placeholder: tv(langue, 'choisir_retirer_ami').slice(0, 100), options: s.amis.slice(0, 25).map(a => ({ label: (a.nom || a.id).slice(0, 100), value: a.id })) });
        return menu(tv(langue, 'amis_aide'), composants);
      }
      case 'aa': {
        const personnes = personnesChoisies(i);
        const suivant = await ajouterAmis(ctx, s, personnes);
        return ok(ctx, suivant, tv(langue, 'amis_ajoutes', { membres: personnes.filter(p => !p.bot).map(p => p.nom).join(', ') || '—' }));
      }
      case 'ar': {
        const cible = String(i.data?.values?.[0] ?? '');
        const nom = s.amis.find(a => a.id === cible)?.nom || `<@${cible}>`;
        return ok(ctx, await retirerAmi(ctx, s, cible), tv(langue, 'ami_retire', { membre: nom }));
      }
      case 't': {
        const candidats = s.occupants.filter(o => o.id !== s.proprietaireId && o.id !== ctx.botId);
        if (!candidats.length) throw new RefusVocal('personne');
        return menu(tv(langue, 'choisir_transfert'), [{ type: 3, custom_id: `vc:ts:${s.salonId}`, placeholder: tv(langue, 'choisir_transfert').slice(0, 100), options: candidats.slice(0, 25).map(o => ({ label: (o.nom || o.id).slice(0, 100), value: o.id })) }]);
      }
      case 'ts':
        return faireTransferer(i, ctx, s, String(i.data?.values?.[0] ?? ''), langue);
      default:
        return avis(tv(langue, 'erreur'));
    }
  }

  async function fenetreRecue(i, langue) {
    const id = String(i.data?.custom_id ?? '');
    const m = /^vc:(rm|nm):(\d{5,25})$/.exec(id);
    if (!m) return avis(tv(langue, 'erreur'));
    const ctx = await contexte(i);
    const s = await salonPour(i, ctx, m[2]);
    const v = valeursFenetre(i);
    if (m[1] === 'rm') {
      const suivant = await renommer(ctx, s, v.nom ?? '');
      return ok(ctx, suivant, tv(langue, 'renomme', { nom: suivant.nom }));
    }
    const texte = String(v.places ?? '').trim();
    if (!/^\d{1,2}$/.test(texte)) throw new RefusVocal('limite_invalide');
    const suivant = await limiter(ctx, s, Number(texte));
    return ok(ctx, suivant, suivant.limite ? tv(langue, 'limite_ok', { n: suivant.limite }) : tv(langue, 'limite_aucune'));
  }

  async function interaction(i) {
    if (!estInteractionVocaux(i)) return undefined;
    const langue = await langueDe(i);
    try {
      if (i.type === T.COMPOSANT) return await composant(i, langue);
      if (i.type === T.FENETRE) return await fenetreRecue(i, langue);
      return avis(tv(langue, 'erreur'));
    } catch (e) {
      if (e instanceof RefusVocal) return avis(tv(langue, e.cle, e.vars));
      console.error('[esport] vocaux : interaction', e?.message ?? e);
      return avis(tv(langue, 'erreur'));
    }
  }

  return { interaction };
}
