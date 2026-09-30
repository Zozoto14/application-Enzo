/**
 * Relais en mémoire pour les tests Jest : même contrat que relais/worker.mjs
 * (jeton maître, jetons de profil, espaces `p/<id>/`, routes historiques).
 * Les tests `node --test relais/worker.test.mjs` vérifient le vrai relais.
 */

import { jetonDeProfil } from '../portees';

export const RELAIS_TEST = 'https://relais.test';
export const JETON_TEST = 'jeton-maitre-de-test-0123456789';

export function relaisPortees(jetonMaitre = JETON_TEST) {
  const boite = new Map<string, string>();
  const appels: Array<{ methode: string; chemin: string; statut: number }> = [];
  const portee = (entete: string | undefined): { maitre?: true; profil?: string } | undefined => {
    const jeton = (entete ?? '').replace(/^Bearer\s+/, '');
    if (jeton === jetonMaitre) return { maitre: true };
    const m = /^p1\.([a-z0-9]{6,16})\./.exec(jeton);
    return m && m[1] !== 'principal' && jeton === jetonDeProfil(jetonMaitre, m[1]) ? { profil: m[1] } : undefined;
  };
  const requete = (async (url: string, init: RequestInit = {}) => {
    const chemin = url.slice(RELAIS_TEST.length);
    const methode = init.method ?? 'GET';
    const repondre = (corps: unknown, status = 200) => {
      appels.push({ methode, chemin, statut: status });
      return { ok: status < 300, status, json: async () => (typeof corps === 'string' ? JSON.parse(corps) : corps) } as Response;
    };
    const p = portee((init.headers as Record<string, string> | undefined)?.Authorization);
    if (!p) return repondre({ erreur: 'jeton' }, 401);
    if (chemin === '/sante') return repondre({ ok: true, portee: p.maitre ? 'maitre' : 'profil' });
    if (chemin === '/rangs') {
      if (!p.maitre) return repondre({ erreur: 'portée' }, 403);
      if (methode === 'PUT') {
        boite.set('rangs', String(init.body));
        return repondre({ ok: true });
      }
      return repondre(boite.get('rangs') ?? '{"delegations":{}}');
    }
    const espace = /^\/p\/([^/]+)\/boite(?:\/([^/]+))?$/.exec(chemin);
    let cle: string | undefined;
    let prefixe: string;
    if (espace) {
      const id = decodeURIComponent(espace[1]);
      if (!p.maitre && p.profil !== id) {
        // Délégation d'un titulaire (même règle que le vrai relais) : liste, coffre et portefeuille.
        const delegations = (JSON.parse(boite.get('rangs') ?? '{}') as { delegations?: Record<string, string[]> }).delegations ?? {};
        const nom = espace[2] ? decodeURIComponent(espace[2]) : undefined;
        const permis =
          id !== 'principal' &&
          (delegations[p.profil!] ?? []).includes(id) &&
          (nom === undefined ? methode === 'GET' : ['coffre', 'portefeuille'].includes(nom) && (methode === 'GET' || methode === 'PUT'));
        if (!permis) return repondre({ erreur: 'portée' }, 403);
      }
      prefixe = `p:${id}:`;
      cle = espace[2] ? prefixe + decodeURIComponent(espace[2]) : undefined;
    } else if (chemin.startsWith('/boite')) {
      if (!p.maitre) return repondre({ erreur: 'portée' }, 403);
      prefixe = 'appareil:';
      cle = chemin === '/boite' ? undefined : prefixe + chemin.slice('/boite/'.length);
    } else {
      return repondre({ erreur: 'inconnu' }, 404);
    }
    if (cle === undefined) {
      const liste: Record<string, { date: string; taille: number }> = {};
      for (const [k, v] of boite) if (k.startsWith(prefixe)) liste[k.slice(prefixe.length)] = { date: JSON.parse(v).date, taille: v.length };
      return repondre(espace ? { objets: liste } : { appareils: liste });
    }
    if (methode === 'PUT') {
      boite.set(cle, String(init.body));
      return repondre({ ok: true });
    }
    if (methode === 'DELETE') {
      boite.delete(cle);
      return repondre({ ok: true });
    }
    return boite.has(cle) ? repondre(boite.get(cle)!) : repondre({ erreur: 'absent' }, 404);
  }) as unknown as typeof fetch;
  return { boite, appels, requete };
}
