/**
 * Textes FR/EN des mises à jour (bandeau « Nouvelle version », pastille « Mise à jour en cours… », page
 * « Mises à jour »). Langue : celle de l'app (`langueCourante`, réglée par le compte ou l'appareil).
 */

import { formaterDate, langueCourante, type Langue } from '../../esport/i18n';

const FR = {
  'bandeau.texte': 'Nouvelle version disponible',
  'bandeau.bouton': 'Mettre à jour',
  'bandeau.bouton_bureau': 'Mettre à jour (redémarre l’app)',
  'bandeau.auto': 'Elle s’installera d’elle-même dès que l’app sera inactive (rien de ce que vous tapez n’est perdu).',
  'bandeau.encours': 'Mise à jour…',
  'bandeau.plus_tard': 'Plus tard',
  'pastille.encours': 'Mise à jour en cours… (≈ {n} min)',
  'pastille.encours_sans': 'Mise à jour en cours…',
  'pastille.ajour': 'À jour',
  'pastille.echec': 'Mise à jour non publiée',
  'pastille.bloque': 'Mise à jour bloquée',
  'pastille.titre_echec': 'La mise à jour n’a pas pu être publiée (tests en échec). Prévenez le développeur.',
  'pastille.titre_bloque': 'Le site n’a pas été mis à jour depuis plus de 30 minutes alors que la nouvelle version est prête.',
  'pastille.titre_encours': 'Une nouvelle version est en préparation : le site sera à jour dans ≈ {n} min.',
  'pastille.titre_ajour': 'Le site est à jour.',
  'page.titre': 'Mises à jour',
  'page.intro': 'Où en est la publication des nouveautés : versions en ligne, dernier déploiement, état de la construction sur GitHub.',
  'page.chargement': 'Lecture de l’état des mises à jour…',
  'page.indisponible': 'Le serveur Esport ne donne pas encore l’état des mises à jour (il sera à jour au prochain déploiement).',
  'page.injoignable': 'Le serveur Esport ne répond pas : état des mises à jour inconnu.',
  'page.etat': 'État',
  'page.etat.a-jour': 'À jour : le site publié est le dernier construit.',
  'page.etat.en-cours.build': 'Construction en cours sur GitHub (tests puis site) : en ligne dans ≈ {n} min.',
  'page.etat.en-cours.publication': 'Nouvelle version prête : copie sur le serveur dans ≈ {n} min.',
  'page.etat.echec': 'La mise à jour n’a pas pu être publiée (tests en échec). Le site reste sur la version précédente : prévenez le développeur.',
  'page.etat.bloque': 'La nouvelle version est prête depuis plus de 30 minutes mais le site n’a pas changé : la tâche de déploiement du serveur semble arrêtée ou en échec (voir le journal).',
  'page.etat.inconnu': 'État de GitHub inconnu pour l’instant.',
  'page.versions': 'Versions en service',
  'page.version.app': 'Cette app (ouverte)',
  'page.version.site': 'Site (public_html)',
  'page.version.serveur': 'Serveur Esport',
  'page.version.relais': 'Relais',
  'page.version.github': 'Dernier commit sur GitHub (main)',
  'page.redemarrage_attente': 'redémarrage en attente',
  'page.serveurs': 'Serveurs (version en service)',
  'page.serveur.ligne': '{nom} : version {commit} (démarré {depuis})',
  'page.serveur.nom.relais': 'Relais',
  'page.serveur.nom.esport': 'Serveur Esport',
  'page.depuis.min': 'il y a {n} min',
  'page.depuis.h': 'il y a {n} h',
  'page.depuis.j': 'il y a {n} j',
  'page.serveur.pas_redemarre': '{nom} n’a pas redémarré : il tourne {commit} alors que {deploye} est déployé. Cliquez « Restart » dans cPanel › Setup Node.js App ({racine}), puis lisez ~/logs/{app}.log.',
  'page.relais.ancien': 'Relais : version inconnue (il tourne une version d’avant ce suivi : il n’a pas redémarré). Cliquez « Restart » dans cPanel › Setup Node.js App (application-enzo/relais), puis lisez ~/logs/relais.log.',
  'page.relais.chargement': 'Relais : lecture de la version…',
  'page.relais.probleme': 'Relais : {message}',
  'page.journaux': 'Journaux des serveurs : ~/logs/relais.log et ~/logs/esport.log (Terminal de cPanel : tail -n 50 ~/logs/relais.log).',
  'page.deploiement': 'Dernier déploiement',
  'page.verification': 'Dernière vérification du serveur',
  'page.demande_attente': 'Vérification demandée, en attente du prochain passage (moins d’une minute en général).',
  'page.github': 'Construction GitHub (« Site (o2switch) »)',
  'page.github.en-cours': 'en cours',
  'page.github.reussi': 'réussie',
  'page.github.echec': 'en échec',
  'page.github.annule': 'annulée',
  'page.github.limite': 'Limite de l’API publique de GitHub atteinte : dernière réponse connue affichée (nouvel essai vers {heure}).',
  'page.github.injoignable': 'GitHub ne répond pas : dernière réponse connue affichée.',
  'page.github.voir': 'Voir sur GitHub',
  'page.journal': 'Journal de déploiement (10 dernières lignes)',
  'page.journal.vide': 'Journal vide (le serveur n’a encore rien déployé, ou le journal est ailleurs).',
  'page.verifier': 'Vérifier maintenant',
  'page.verifier.aide': 'Demande au serveur de chercher une nouvelle version tout de suite (au prochain passage de sa tâche, moins d’une minute).',
  'page.verifier.ok': 'Demande envoyée : le serveur vérifie au prochain passage.',
  'page.verifier.echec': 'Demande impossible : {motif}',
  'page.recharger': 'Recharger l’app',
  'page.actualiser': 'Actualiser',
  'page.inconnu': 'inconnue',
  'page.il_y_a': 'il y a {n} min',
  'page.a_l_instant': 'à l’instant',
  'reglage.titre': 'Mettre à jour automatiquement',
  'reglage.aide': 'Quand une nouvelle version est en ligne, l’app se recharge d’elle-même si elle est inactive ou en arrière-plan et qu’aucune saisie n’est en cours. Sinon, un bandeau propose « Mettre à jour ».',
  'reglage.oui': 'Activé',
  'reglage.non': 'Désactivé',
} as const;

export type CleMaj = keyof typeof FR;

const EN: Record<CleMaj, string> = {
  'bandeau.texte': 'New version available',
  'bandeau.bouton': 'Update',
  'bandeau.bouton_bureau': 'Update (restarts the app)',
  'bandeau.auto': 'It will install itself as soon as the app is idle (nothing you are typing is lost).',
  'bandeau.encours': 'Updating…',
  'bandeau.plus_tard': 'Later',
  'pastille.encours': 'Update in progress… (≈ {n} min)',
  'pastille.encours_sans': 'Update in progress…',
  'pastille.ajour': 'Up to date',
  'pastille.echec': 'Update not published',
  'pastille.bloque': 'Update stuck',
  'pastille.titre_echec': 'The update could not be published (tests failing). Let the developer know.',
  'pastille.titre_bloque': 'The site hasn’t been updated for more than 30 minutes although the new version is ready.',
  'pastille.titre_encours': 'A new version is being prepared: the site will be up to date in ≈ {n} min.',
  'pastille.titre_ajour': 'The site is up to date.',
  'page.titre': 'Updates',
  'page.intro': 'Where the release of new features stands: versions online, last deployment, build status on GitHub.',
  'page.chargement': 'Reading the update status…',
  'page.indisponible': 'The Esport server doesn’t report the update status yet (it will after the next deployment).',
  'page.injoignable': 'The Esport server isn’t responding: update status unknown.',
  'page.etat': 'Status',
  'page.etat.a-jour': 'Up to date: the published site is the latest build.',
  'page.etat.en-cours.build': 'Build in progress on GitHub (tests then site): online in ≈ {n} min.',
  'page.etat.en-cours.publication': 'New version ready: copied to the server in ≈ {n} min.',
  'page.etat.echec': 'The update could not be published (tests failing). The site stays on the previous version: let the developer know.',
  'page.etat.bloque': 'The new version has been ready for more than 30 minutes but the site hasn’t changed: the server’s deployment task seems stopped or failing (see the log).',
  'page.etat.inconnu': 'GitHub status unknown for now.',
  'page.versions': 'Versions in service',
  'page.version.app': 'This app (open)',
  'page.version.site': 'Site (public_html)',
  'page.version.serveur': 'Esport server',
  'page.version.relais': 'Relay',
  'page.version.github': 'Latest commit on GitHub (main)',
  'page.redemarrage_attente': 'restart pending',
  'page.serveurs': 'Servers (running version)',
  'page.serveur.ligne': '{nom}: version {commit} (started {depuis})',
  'page.serveur.nom.relais': 'Relay',
  'page.serveur.nom.esport': 'Esport server',
  'page.depuis.min': '{n} min ago',
  'page.depuis.h': '{n} h ago',
  'page.depuis.j': '{n} d ago',
  'page.serveur.pas_redemarre': '{nom} has not restarted: it runs {commit} while {deploye} is deployed. Click “Restart” in cPanel › Setup Node.js App ({racine}), then read ~/logs/{app}.log.',
  'page.relais.ancien': 'Relay: unknown version (it runs a version older than this tracking: it has not restarted). Click “Restart” in cPanel › Setup Node.js App (application-enzo/relais), then read ~/logs/relais.log.',
  'page.relais.chargement': 'Relay: reading the version…',
  'page.relais.probleme': 'Relay: {message}',
  'page.journaux': 'Server logs: ~/logs/relais.log and ~/logs/esport.log (cPanel Terminal: tail -n 50 ~/logs/relais.log).',
  'page.deploiement': 'Last deployment',
  'page.verification': 'Server’s last check',
  'page.demande_attente': 'Check requested, waiting for the next run (usually under a minute).',
  'page.github': 'GitHub build (“Site (o2switch)”)',
  'page.github.en-cours': 'in progress',
  'page.github.reussi': 'succeeded',
  'page.github.echec': 'failed',
  'page.github.annule': 'cancelled',
  'page.github.limite': 'GitHub public API limit reached: showing the last known answer (next try around {heure}).',
  'page.github.injoignable': 'GitHub isn’t responding: showing the last known answer.',
  'page.github.voir': 'View on GitHub',
  'page.journal': 'Deployment log (last 10 lines)',
  'page.journal.vide': 'Empty log (the server hasn’t deployed anything yet, or the log is elsewhere).',
  'page.verifier': 'Check now',
  'page.verifier.aide': 'Asks the server to look for a new version right away (on its task’s next run, under a minute).',
  'page.verifier.ok': 'Request sent: the server checks on its next run.',
  'page.verifier.echec': 'Request failed: {motif}',
  'page.recharger': 'Reload the app',
  'page.actualiser': 'Refresh',
  'page.inconnu': 'unknown',
  'page.il_y_a': '{n} min ago',
  'page.a_l_instant': 'just now',
  'reglage.titre': 'Update automatically',
  'reglage.aide': 'When a new version is online, the app reloads by itself if it is idle or in the background and nothing is being typed. Otherwise, a banner offers “Update”.',
  'reglage.oui': 'On',
  'reglage.non': 'Off',
};

const DICTIONNAIRES: Record<Langue, Record<CleMaj, string>> = { fr: FR, en: EN };

export function tm(cle: CleMaj, vars?: Record<string, string | number>, langue: Langue = langueCourante()): string {
  const modele = DICTIONNAIRES[langue][cle] ?? FR[cle];
  return vars ? modele.replace(/\{(\w+)\}/g, (brut, nom: string) => (nom in vars ? String(vars[nom]) : brut)) : modele;
}

/** Date et heure courtes (« 30/10 14:05 »), dans la langue de l'app. */
export function dateCourte(d: string | number | null | undefined): string {
  if (d == null || d === '') return tm('page.inconnu');
  // Lignes du journal : « 2026-10-30 14:05:00 », heure du serveur (pas de fuseau) : affichée telle quelle.
  if (typeof d === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(d)) return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
  return formaterDate(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ilYa(d: string | null | undefined, maintenant = Date.now()): string {
  const t = d ? Date.parse(d) : NaN;
  if (!Number.isFinite(t)) return tm('page.inconnu');
  const n = Math.round((maintenant - t) / 60_000);
  return n <= 0 ? tm('page.a_l_instant') : tm('page.il_y_a', { n });
}

/** Depuis combien de temps (« il y a 3 j ») à partir d'une durée en secondes. */
export function depuis(dureeS: number | null | undefined): string {
  if (dureeS == null || !Number.isFinite(dureeS)) return tm('page.inconnu');
  const min = Math.floor(dureeS / 60);
  if (min < 1) return tm('page.a_l_instant');
  if (min < 60) return tm('page.depuis.min', { n: min });
  const h = Math.floor(min / 60);
  return h < 24 ? tm('page.depuis.h', { n: h }) : tm('page.depuis.j', { n: Math.floor(h / 24) });
}
