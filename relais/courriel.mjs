/**
 * Messagerie du relais : envoi d'e-mails par le serveur (SMTP de l'hébergeur, voir docs/emails.md).
 *
 * Le transport n'est PAS ici : le serveur Node du relais (relais/serveur/app.mjs) le fournit dans
 * `env.ENVOYER_COURRIEL` quand SMTP_HOST, SMTP_USER, SMTP_PASS et MAIL_FROM sont dans relais.env
 * (esport/serveur/courriel-smtp.mjs, nodemailer). Sans lui (.env incomplet) :
 * 503 `non-configure`, et l'app retombe sur sa messagerie (`mailto:`).
 *
 * Confidentialité : les adresses e-mail vivent dans la base CHIFFRÉE du Fondateur, sur ses
 * appareils. Pour qu'un e-mail parte du serveur, l'app du Fondateur joint l'adresse à la demande
 * d'envoi ; le relais l'utilise pour cet envoi et ne la garde PAS : le journal d'envoi ne contient
 * que l'adresse masquée (`l***@e***.fr`), l'objet, le modèle, la date et le statut. Aucune adresse
 * dans les journaux du serveur. Un e-mail par destinataire (personne ne voit les autres adresses).
 *
 * Routes (jeton MAÎTRE seulement : le Fondateur) :
 *   GET  /courriel/etat       configuré ? (jamais le mot de passe ni le serveur SMTP)
 *   POST /courriel/envoyer    { destinataires: [{ adresse, nom?, langue? }], modele, langue, variables, ref? }
 *   POST /courriel/apercu     { modele, langue, variables } → { objet, texte, html } (aucune adresse, aucun envoi)
 *   GET  /courriel/journal    derniers envois (adresses masquées)
 *   POST /courriel/tester     { adresse? } : connexion SMTP (verify) puis e-mail de test à cette adresse (sinon à la
 *                             boîte d'envoi elle-même) ; codes d'erreur précis (docs/emails.md, « Dépannage »)
 *
 * Langue : chaque destinataire a la sienne (`destinataires[].langue`, résolue par l'app du Fondateur
 * depuis la langue par défaut de son compte, ou forcée par lui) ; `langue` ne sert que si un
 * destinataire n'en a pas. Elle n'est pas rangée ici (confidentialité inchangée) : elle arrive avec
 * la demande d'envoi, comme l'adresse. L'habillage (en-tête, pied, mentions, bouton) est traduit
 * pour chacun ; le corps reste celui de l'auteur. `variables.en` (facultatif : `{ objet, message }`)
 * est la version ANGLAISE du message : les destinataires en anglais la reçoivent à la place du
 * texte principal (deux versions FR/EN, chacun reçoit la sienne).
 */

import { adresseValide, masquerAdresse, rendreCourriel } from './courriel-modeles.mjs';
import { limiter } from './support.mjs';
import { codeErreurSmtp, detailTechnique, expliquerErreurSmtp } from './courriel-erreurs.mjs';

export const MODELES_COURRIEL = ['libre', 'invitation', 'support', 'recap'];
const DESTINATAIRES_MAX = 100;
/** Destinataires par heure et par jour (protège la réputation de la boîte d'envoi). */
export const LIMITE_HEURE = 100;
export const LIMITE_JOUR = 300;
const JOURNAL_MAX = 300;
const GARDE_JOURNAL_S = 180 * 86_400;

const configure = env => typeof env.ENVOYER_COURRIEL === 'function';

async function lireJournal(env) {
  try {
    const brut = await env.BOITE.get('courriel:journal');
    const lu = brut ? JSON.parse(brut) : [];
    return Array.isArray(lu) ? lu : [];
  } catch {
    return [];
  }
}

/** Variables d'un modèle pour une langue : la version anglaise (`variables.en`) remplace objet et message. */
export function variablesPour(variables, langue) {
  const { en, ...base } = variables ?? {};
  if (langue === 'en' && en && typeof en === 'object') return { ...base, ...(typeof en.objet === 'string' ? { objet: en.objet } : {}), ...(typeof en.message === 'string' ? { message: en.message } : {}) };
  return base;
}

/**
 * Envoie un e-mail à chaque destinataire (même rendu, langue propre à chacun si donnée) et note le
 * lot au journal. Rend `{ ok, id, resultats: [{ a (masquée), statut, erreur? }] }`. Utilisée aussi
 * par le support (notification de réponse).
 */
export async function envoyerCourriel(env, { destinataires, modele, langue, variables, ref }) {
  if (!configure(env)) return { ok: false, erreur: 'non-configure', resultats: [] };
  const site = String(env.LIEN_APP || 'https://appdashboard.fr').trim().replace(/\/+$/, '');
  const resultats = [];
  const rendus = new Map();
  for (const d of destinataires) {
    const a = masquerAdresse(d.adresse);
    if (!adresseValide(d.adresse)) {
      resultats.push({ a, statut: 'echec', erreur: 'adresse-invalide' });
      continue;
    }
    const l = d.langue === 'en' || (d.langue === undefined && langue === 'en') ? 'en' : 'fr';
    if (!rendus.has(l)) rendus.set(l, rendreCourriel({ modele, langue: l, variables: variablesPour(variables, l), site }));
    const message = rendus.get(l);
    try {
      await env.ENVOYER_COURRIEL({ a: d.adresse.trim(), nom: typeof d.nom === 'string' ? d.nom.slice(0, 60) : undefined, objet: message.objet, texte: message.texte, html: message.html, langue: l });
      resultats.push({ a, statut: 'envoye', langue: l });
    } catch (e) {
      // Le message d'erreur SMTP peut citer l'adresse : seul un code court sort d'ici (et au journal du serveur).
      const code = codeErreur(e);
      console.warn(`[courriel] échec d'envoi vers ${a} : ${code} (${detailTechnique(e)})`);
      resultats.push({ a, statut: 'echec', erreur: code, langue: l });
    }
  }
  const id = [...crypto.getRandomValues(new Uint8Array(6))].map(o => o.toString(16).padStart(2, '0')).join('');
  const objet = (rendus.values().next().value?.objet ?? String(variables?.objet ?? '')).slice(0, 160);
  const entree = { id, date: new Date().toISOString(), modele, objet, ...(ref ? { ref: String(ref).slice(0, 60) } : {}), resultats };
  if (env.BOITE) {
    try {
      const journal = await lireJournal(env);
      await env.BOITE.put('courriel:journal', JSON.stringify([entree, ...journal].slice(0, JOURNAL_MAX)), { expirationTtl: GARDE_JOURNAL_S });
    } catch {
      // Le journal ne bloque jamais un envoi.
    }
  }
  const envoyes = resultats.filter(r => r.statut === 'envoye').length;
  return { ok: envoyes > 0 && envoyes === resultats.length, id, envoyes, resultats, ...(envoyes < resultats.length ? { erreur: resultats.find(r => r.erreur)?.erreur } : {}) };
}

/** Code d'erreur court, sans adresse ni détail du serveur (relais/courriel-erreurs.mjs). */
export const codeErreur = codeErreurSmtp;

/**
 * « Tester l'envoi » (Administration › Messagerie) : 1. configuration (variables manquantes), 2. connexion et
 * identifiants SMTP (verify), 3. un e-mail de test à `adresse` (celle du Fondateur ; sinon la boîte d'envoi elle-même).
 * Réponse : { ok, etape, code?, explication?, manques?, a? (adresse masquée) } ; jamais le message brut du serveur.
 */
async function testerCourriel(requete, env, o) {
  const diag = env.COURRIEL_DIAGNOSTIC ?? {};
  if (!configure(env)) {
    const manques = Array.isArray(diag.manques) ? diag.manques : [];
    return o.reponse({ ok: false, etape: 'configuration', code: 'non-configure', manques, explication: `${expliquerErreurSmtp('non-configure')}${manques.length ? ` Manquant : ${manques.join(', ')}.` : ''}` }, 503);
  }
  let corps = {};
  try {
    const texte = await requete.text();
    corps = texte ? JSON.parse(texte.slice(0, 4096)) : {};
  } catch {
    return o.erreur('Demande illisible.', 400);
  }
  const adresse = typeof corps?.adresse === 'string' && corps.adresse.trim() ? corps.adresse.trim() : typeof env.MAIL_FROM_AFFICHE === 'string' ? env.MAIL_FROM_AFFICHE : '';
  if (!adresseValide(adresse)) return o.reponse({ ok: false, etape: 'envoi', code: 'adresse-invalide', explication: expliquerErreurSmtp('adresse-invalide') }, 400);
  if (typeof diag.verifier === 'function') {
    try {
      await diag.verifier();
    } catch (e) {
      const code = codeErreur(e);
      console.warn(`[courriel] test : connexion SMTP impossible : ${code} (${detailTechnique(e)})`);
      return o.reponse({ ok: false, etape: 'connexion', code, technique: detailTechnique(e), explication: expliquerErreurSmtp(code) });
    }
  }
  const heure = await limiter(env, 'courriel:limite:heure', LIMITE_HEURE, 3_600_000);
  if (!heure.ok) return o.reponse({ ok: false, etape: 'envoi', code: 'limite', attente: heure.attenteS ?? 0, explication: `Limite d’envoi atteinte (${LIMITE_HEURE} e-mails par heure) : réessayez plus tard.` }, 429);
  const r = await envoyerCourriel(env, {
    destinataires: [{ adresse }],
    modele: 'libre',
    langue: 'fr',
    variables: { objet: 'Test d’envoi AppDashboard', message: `Ceci est un e-mail de test envoyé depuis Administration › Messagerie, le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.\n\nS’il est arrivé, l’envoi d’e-mails par le serveur fonctionne.` },
    ref: 'test',
  });
  await heure.enregistrer(1);
  const res = r.resultats[0];
  if (r.ok) return o.reponse({ ok: true, etape: 'envoi', a: res?.a ?? masquerAdresse(adresse), id: r.id });
  const code = res?.erreur ?? r.erreur ?? 'smtp-erreur';
  return o.reponse({ ok: false, etape: 'envoi', code, a: res?.a ?? masquerAdresse(adresse), explication: expliquerErreurSmtp(code) });
}

function lireDestinataires(liste) {
  if (!Array.isArray(liste) || liste.length === 0) return { refus: 'Choisissez au moins un destinataire.' };
  if (liste.length > DESTINATAIRES_MAX) return { refus: `${DESTINATAIRES_MAX} destinataires au plus par envoi.` };
  const vus = new Set();
  const sortie = [];
  for (const d of liste) {
    const adresse = typeof d === 'string' ? d : d?.adresse;
    if (typeof adresse !== 'string' || adresse.length > 254) return { refus: 'Adresse e-mail illisible.' };
    const cle = adresse.trim().toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    sortie.push({ adresse: adresse.trim(), ...(typeof d?.nom === 'string' ? { nom: d.nom } : {}), ...(d?.langue === 'en' || d?.langue === 'fr' ? { langue: d.langue } : {}) });
  }
  return { destinataires: sortie };
}

/** Modèle et variables d'une demande d'envoi ou d'aperçu (`libre`, `invitation`) : `{ modele, variables }` ou `{ refus }`. */
function lireDemande(corps) {
  const modele = corps?.modele ?? 'libre';
  if (!['libre', 'invitation'].includes(modele)) return { refus: 'Modèle inconnu.' };
  const v = corps?.variables ?? {};
  if (typeof v.objet !== 'string' || !v.objet.trim() || v.objet.length > 160) return { refus: 'L’objet est obligatoire (160 caractères au plus).' };
  if (typeof v.message !== 'string' || v.message.trim().length < 2 || v.message.length > 20_000) return { refus: 'Le message est vide ou trop long (20 000 caractères au plus).' };
  if (modele === 'invitation' && !/^https:\/\/[^\s<>"']{4,2000}$/.test(String(v.lien ?? ''))) return { refus: 'Lien d’invitation invalide.' };
  const variables = { objet: v.objet, message: v.message, ...(modele === 'invitation' ? { lien: v.lien } : {}) };
  if (v.en !== undefined && v.en !== null) {
    if (typeof v.en !== 'object' || typeof v.en.objet !== 'string' || !v.en.objet.trim() || v.en.objet.length > 160) return { refus: 'Version anglaise : l’objet est obligatoire (160 caractères au plus).' };
    if (typeof v.en.message !== 'string' || v.en.message.trim().length < 2 || v.en.message.length > 20_000) return { refus: 'Version anglaise : le message est vide ou trop long (20 000 caractères au plus).' };
    variables.en = { objet: v.en.objet, message: v.en.message };
  }
  return { modele, variables };
}

/** `/courriel/…` ; `o` : `{ reponse, erreur }`. */
export async function routeCourriel(requete, env, portee, chemin, o) {
  if (!portee?.maitre) return o.erreur('Réservé au Fondateur.', 403);
  const m = requete.method;
  if (chemin === '/courriel/etat' && m === 'GET') {
    // `manques` : NOMS des variables absentes de relais.env (jamais une valeur) ; `verification` : test SMTP du démarrage.
    const diag = env.COURRIEL_DIAGNOSTIC;
    return o.reponse({
      configure: configure(env),
      expediteur: typeof env.MAIL_FROM_AFFICHE === 'string' ? env.MAIL_FROM_AFFICHE : null,
      limites: { heure: LIMITE_HEURE, jour: LIMITE_JOUR },
      ...(Array.isArray(diag?.manques) ? { manques: diag.manques } : {}),
      ...(diag?.verification ? { verification: diag.verification() } : {}),
      test: true,
    });
  }
  if (chemin === '/courriel/tester' && m === 'POST') return testerCourriel(requete, env, o);
  if (chemin === '/courriel/journal' && m === 'GET') {
    return o.reponse({ envois: env.BOITE ? await lireJournal(env) : [] });
  }
  // Aperçu : le rendu exact (objet, texte brut, HTML) dans la langue demandée, sans adresse et sans envoi (donc même sans SMTP).
  if (chemin === '/courriel/apercu' && m === 'POST') {
    const texte = await requete.text();
    if (texte.length > 256 * 1024) return o.erreur('Message trop volumineux.', 413);
    let corps;
    try {
      corps = JSON.parse(texte);
    } catch {
      return o.erreur('Demande illisible.', 400);
    }
    const lecture = lireDemande(corps);
    if (lecture.refus) return o.erreur(lecture.refus, 400);
    const l = corps?.langue === 'en' ? 'en' : 'fr';
    const site = String(env.LIEN_APP || 'https://appdashboard.fr').trim().replace(/\/+$/, '');
    return o.reponse({ langue: l, ...rendreCourriel({ modele: lecture.modele, langue: l, variables: variablesPour(lecture.variables, l), site }) });
  }
  if (chemin === '/courriel/envoyer' && m === 'POST') {
    if (!configure(env)) return o.reponse({ erreur: 'L’envoi d’e-mails n’est pas configuré sur le serveur (SMTP).', motif: 'non-configure' }, 503);
    const texte = await requete.text();
    if (texte.length > 256 * 1024) return o.erreur('Message trop volumineux.', 413);
    let corps;
    try {
      corps = JSON.parse(texte);
    } catch {
      return o.erreur('Demande illisible.', 400);
    }
    const lecture = lireDemande(corps);
    if (lecture.refus) return o.erreur(lecture.refus, 400);
    const { modele, variables } = lecture;
    const lu = lireDestinataires(corps?.destinataires);
    if (lu.refus) return o.erreur(lu.refus, 400);
    const n = lu.destinataires.length;
    const heure = await limiter(env, 'courriel:limite:heure', LIMITE_HEURE - n + 1, 3_600_000);
    const jour = await limiter(env, 'courriel:limite:jour', LIMITE_JOUR - n + 1, 86_400_000);
    if (!heure.ok || !jour.ok) {
      const attente = Math.max(heure.attenteS ?? 0, jour.attenteS ?? 0);
      const r = o.reponse({ erreur: `Limite d’envoi atteinte (${LIMITE_HEURE} e-mails par heure, ${LIMITE_JOUR} par jour). Réessayez plus tard.`, motif: 'limite', attente }, 429);
      r.headers.set('Retry-After', String(attente));
      return r;
    }
    const resultat = await envoyerCourriel(env, {
      destinataires: lu.destinataires,
      modele,
      langue: corps?.langue === 'en' ? 'en' : 'fr',
      variables,
      ref: typeof corps?.ref === 'string' ? corps.ref : undefined,
    });
    await heure.enregistrer(n);
    await jour.enregistrer(n);
    return o.reponse(resultat, resultat.envoyes > 0 ? 200 : 502);
  }
  return o.erreur('Adresse inconnue.', 404);
}
