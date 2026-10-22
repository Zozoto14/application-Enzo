/**
 * Téléchargeur des aperçus de liens pour le serveur Node (o2switch, serveur local) : node:http et
 * node:https, avec une RÉSOLUTION DNS VÉRIFIÉE AU MOMENT DE LA CONNEXION (option `lookup`) : toutes
 * les adresses du nom doivent être publiques, sinon la connexion n'est même pas tentée. Un nom qui
 * change d'adresse entre une vérification et la connexion (DNS rebinding) ne passe donc pas.
 *
 * Même contrat que `telechargeurFetch` (noyau/ressources/apercu.mjs) : aucune redirection suivie,
 * délai, lecture bornée, HTML seulement ; rend `{ statut, type, location, corps }`.
 */

import { lookup as lookupDns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { ipInterdite } from '../noyau/ressources/apercu.mjs';

/** `lookup` de Node qui refuse toute adresse privée, locale ou réservée. */
export function lookupPublic(hote, options, rappel) {
  const cb = typeof options === 'function' ? options : rappel;
  const opts = typeof options === 'function' ? {} : (options ?? {});
  lookupDns(hote, { ...opts, all: true }, (err, adresses) => {
    if (err) return cb(err);
    const liste = Array.isArray(adresses) ? adresses : [{ address: adresses, family: opts.family ?? 4 }];
    if (liste.length === 0 || liste.some(a => ipInterdite(a.address))) {
      const e = new Error('Adresse refusée');
      e.code = 'apercu-adresse';
      return cb(e);
    }
    if (opts.all) return cb(null, liste);
    return cb(null, liste[0].address, liste[0].family);
  });
}

export function telechargeurNode({ lookup = lookupPublic } = {}) {
  return (adresse, { delai = 4000, max = 512 * 1024 } = {}) =>
    new Promise((ok, ko) => {
      const url = new URL(adresse);
      const module = url.protocol === 'https:' ? https : http;
      let fini = false;
      const terminer = (f, v) => {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        f(v);
      };
      const req = module.request(
        url,
        {
          method: 'GET',
          lookup,
          headers: { 'User-Agent': 'AppDashboardEsport/1.0 (apercu de lien)', Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity' },
        },
        res => {
          const type = String(res.headers['content-type'] ?? '');
          const location = res.headers.location ?? null;
          const statut = res.statusCode ?? 0;
          if (statut < 200 || statut >= 300 || !/html|xml/i.test(type)) {
            res.resume();
            terminer(ok, { statut, type, location, corps: '' });
            req.destroy();
            return;
          }
          const morceaux = [];
          let total = 0;
          res.on('data', m => {
            morceaux.push(m);
            total += m.length;
            if (total >= max) {
              terminer(ok, { statut, type, location, corps: Buffer.concat(morceaux).subarray(0, max).toString('utf8') });
              req.destroy();
            }
          });
          res.on('end', () => terminer(ok, { statut, type, location, corps: Buffer.concat(morceaux).toString('utf8') }));
          res.on('error', e => terminer(ko, e));
        },
      );
      const minuteur = setTimeout(() => {
        const e = new Error('Délai dépassé');
        e.name = 'TimeoutError';
        terminer(ko, e);
        req.destroy();
      }, delai);
      req.on('error', e => terminer(ko, e));
      req.end();
    });
}
