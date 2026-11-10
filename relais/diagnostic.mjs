/**
 * Diagnostic des connexions d'un compte, pour le Fondateur (Administration › Utilisateurs › fiche) :
 *
 *   GET    /v10/diagnostic/connexions/<compte>?h=<empreinte de l'identifiant>
 *          → { tentatives, verrou, adresses, inconnus, revoque }
 *   DELETE /v10/diagnostic/connexions/<compte>?h=<…>   « Débloquer » : lève le verrou de l'identifiant
 *          et la limite des adresses vues dans ses tentatives récentes.
 *
 * Réservé au jeton maître ou à la session du Fondateur. Rien de secret : des dates, des codes d'issue,
 * des adresses masquées (voir connexions.mjs).
 */

import { etatLimiteIp, leverLimiteIp, lireInconnus, lireTentatives, noterTentative } from './connexions.mjs';

const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const MOTIF_H = /^[0-9a-f]{64}$/;

async function lireJson(boite, cle) {
  try {
    const brut = await boite.get(cle);
    return brut ? JSON.parse(brut) : undefined;
  } catch {
    return undefined;
  }
}

export async function routeDiagnosticConnexions(requete, env, portee, compte, { reponse, erreur }) {
  if (!portee?.maitre) return erreur('Réservé au Fondateur.', portee ? 403 : 401);
  if (!MOTIF_COMPTE.test(compte)) return erreur('Compte invalide.', 400);
  const h = new URL(requete.url).searchParams.get('h') ?? '';
  if (h && !MOTIF_H.test(h)) return erreur('Identifiant invalide.', 400);
  const maintenant = Date.now();
  const tentatives = [...(await lireTentatives(env, compte)), ...(h ? await lireTentatives(env, `h:${h}`) : [])].sort((a, b) => b.le - a.le).slice(0, 30);
  const empreintes = [...new Set(tentatives.map(t => t.ipH).filter(x => typeof x === 'string'))].slice(0, 10);

  if (requete.method === 'DELETE') {
    let leve = 0;
    if (h && (await env.BOITE.get(`limite:acces:${h}`))) {
      await env.BOITE.delete(`limite:acces:${h}`);
      leve++;
    }
    for (const e of empreintes) if (await leverLimiteIp(env, e)) leve++;
    await noterTentative(env, compte, 'debloque', 'inconnue', maintenant);
    return reponse({ ok: true, leve });
  }
  if (requete.method !== 'GET') return erreur('Méthode non autorisée.', 405);

  const limite = h ? await lireJson(env.BOITE, `limite:acces:${h}`) : undefined;
  const verrou = limite ? { echecs: Number(limite.echecs) || 0, jusqua: Number(limite.jusqua) > maintenant ? Number(limite.jusqua) : 0 } : null;
  const adresses = [];
  for (const e of empreintes) {
    const etat = await etatLimiteIp(env, e, maintenant);
    if (etat) adresses.push({ ip: tentatives.find(t => t.ipH === e)?.ip ?? 'inconnue', ...etat });
  }
  const revoque = compte !== 'principal' && Boolean(await env.BOITE.get(`revoque:${compte}`));
  const inconnus = (await lireInconnus(env)).slice(0, 10);
  return reponse({
    compte,
    tentatives: tentatives.map(({ le, issue, ip }) => ({ le: new Date(le).toISOString(), issue, ip })),
    verrou,
    adresses,
    inconnus: inconnus.map(i => ({ le: new Date(i.le).toISOString(), ip: i.ip })),
    revoque,
    heure: maintenant,
  });
}
