/**
 * Permissions Discord du bot Esport HQ : UNE liste centrale, par fonctionnalité. Le lien d'invitation (Administration
 * › Bot Esport HQ, Tickets › Configuration › Connexion, Discord d'une team) demande l'union de toutes les permissions
 * listées ici, et « Vérifier le serveur Discord » dit, fonctionnalité par fonctionnalité, ce qui manque au bot.
 *
 * Une nouvelle fonctionnalité du bot (salons vocaux temporaires…) AJOUTE son entrée à `FONCTIONNALITES_PERMISSIONS`
 * (clés de `BITS` ; une clé nouvelle s'ajoute à `BITS` avec son bit Discord et son libellé côté app,
 * src/esport/i18n/bot.ts « perm.<cle> »). Feuille pure : aucun réseau, aucune base.
 */

/** Bits des permissions Discord (https://discord.com/developers/docs/topics/permissions). */
export const BITS = Object.freeze({
  gerer_salons: 1n << 4n,
  reactions: 1n << 6n,
  voir_salons: 1n << 10n,
  envoyer: 1n << 11n,
  integrer: 1n << 14n,
  joindre: 1n << 15n,
  historique: 1n << 16n,
  mentionner: 1n << 17n,
  connecter: 1n << 20n,
  deplacer_membres: 1n << 24n,
  gerer_roles: 1n << 28n,
  creer_fils_publics: 1n << 35n,
  creer_fils_prives: 1n << 36n,
  envoyer_fils: 1n << 38n,
});

/**
 * Permissions de chaque fonctionnalité du bot.
 *  - annonces : messages des teams et fil français (bot-discord.md) ;
 *  - tickets  : salons privés, rôles, pièces jointes, refus d'écriture (le bot ne peut refuser dans un salon que des
 *               permissions qu'il a lui-même : réactions, fils) (tickets.md).
 */
export const FONCTIONNALITES_PERMISSIONS = [
  { id: 'annonces', permissions: ['voir_salons', 'envoyer', 'integrer', 'historique', 'mentionner', 'creer_fils_publics', 'envoyer_fils'] },
  { id: 'tickets', permissions: ['voir_salons', 'gerer_salons', 'gerer_roles', 'envoyer', 'historique', 'joindre', 'integrer', 'reactions', 'creer_fils_prives', 'creer_fils_publics', 'envoyer_fils'] },
];

const bit = cle => {
  const b = BITS[cle];
  if (b === undefined) throw new Error(`Permission Discord inconnue : ${cle}`);
  return b;
};

/** Entier des permissions d'une liste de clés (BigInt). */
export const entierPermissions = cles => cles.reduce((p, c) => p | bit(c), 0n);

/** Union des permissions de toutes les fonctionnalités (BigInt). */
export const permissionsInvitation = (fonctionnalites = FONCTIONNALITES_PERMISSIONS) => fonctionnalites.reduce((p, f) => p | entierPermissions(f.permissions), 0n);

/** Lien d'invitation du bot avec toutes les permissions (public : l'Application ID n'est pas un secret). */
export function lienInvitationBot(applicationId, fonctionnalites = FONCTIONNALITES_PERMISSIONS) {
  if (!/^\d{5,25}$/.test(String(applicationId ?? ''))) return null;
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${permissionsInvitation(fonctionnalites)}`;
}

/** Ce qui manque au bot (`p` : ses permissions, BigInt), par fonctionnalité : `[{ id, manquantes: [cle] }]`. */
export function manquantesParFonctionnalite(p, fonctionnalites = FONCTIONNALITES_PERMISSIONS) {
  return fonctionnalites.map(f => ({ id: f.id, manquantes: f.permissions.filter(c => (p & bit(c)) !== bit(c)) }));
}
