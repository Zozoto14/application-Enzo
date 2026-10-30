/**
 * Devblog automatique et programmé : règles PURES, sans base ni réseau (docs/esport/devblog.md, « Publication
 * automatique »).
 *
 *  - `lireReglagesAuto` : réglages du mode automatique (désactivé par défaut) ;
 *  - `echeanceAuto` / `estDuAuto` : quand le cron rédige (fuseau du club) ;
 *  - `lireInstantProgramme` : date et heure d'une publication programmée (heure murale du club) ;
 *  - `filtrerCommits` : les commits sans intérêt pour les membres (tests, docs, refactor, CI, dépendances,
 *    journaux…) sont écartés ;
 *  - `nettoyerCommit` / `contientFuite` : rien d'interne ne sort (hash, chemins, noms de fichiers, variables
 *    d'environnement, adresses, e-mails, options de ligne de commande) ;
 *  - `CONSIGNE_REDACTION` + `EXEMPLES_REDACTION` (few-shot : devblog du 23/10 et premier devblog) ;
 *  - `lireRedaction` : validation STRICTE du JSON produit par l'IA (jamais de publication d'un texte invalide) ;
 *  - `brouillonDeSecours` : brouillon posé quand l'IA échoue (à relire, jamais publié tel quel).
 */

import { echec } from '../outils.mjs';
import { instantMural, partiesLocales, texteDate } from '../planning/temps.mjs';
import { LONGUEURS, MAX_PUCES, MAX_SECTIONS, contenuComplet, lireContenu } from './regles.mjs';
import { PREMIER_DEVBLOG_EN, PREMIER_DEVBLOG_FR } from './premier.mjs';

/** Fuseau du club (heures des réglages et des programmations). */
export const FUSEAU_DEVBLOG = 'Europe/Paris';
export const FREQUENCES = ['apres_maj', 'hebdo'];
/** Programmation : au plus 90 jours à l'avance. */
export const PROGRAMMATION_MAX_JOURS = 90;
/** Au plus tant de commits lus et envoyés à l'IA par devblog. */
export const MAX_COMMITS_LUS = 200;
export const MAX_COMMITS_IA = 60;

/** Réglages par défaut : désactivé ; « après chaque mise à jour » regroupées à 18:00 ; publication sans validation. */
export const REGLAGES_AUTO_DEFAUT = Object.freeze({ actif: false, frequence: 'apres_maj', heure: '18:00', jour: 5, validation: false, mentionHere: true, cibles: null });

const MOTIF_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Réglages saisis (complétés par `existant`). `cibles` : null = les salons cochés par défaut (« annonces du
 * club ») ; sinon une liste de clés de salons. `connues` : clés valides (filtrage).
 */
export function lireReglagesAuto(saisie, existant = REGLAGES_AUTO_DEFAUT, { connues = null } = {}) {
  const s = saisie && typeof saisie === 'object' && !Array.isArray(saisie) ? saisie : {};
  const e = { ...REGLAGES_AUTO_DEFAUT, ...(existant ?? {}) };
  const r = { ...e };
  if (s.actif !== undefined) {
    if (typeof s.actif !== 'boolean') throw echec(400, 'devblog-auto', 'Mode automatique : oui ou non.');
    r.actif = s.actif;
  }
  if (s.frequence !== undefined) {
    if (!FREQUENCES.includes(s.frequence)) throw echec(400, 'devblog-auto-frequence', 'Fréquence : après chaque mise à jour ou une fois par semaine.');
    r.frequence = s.frequence;
  }
  if (s.heure !== undefined) {
    if (typeof s.heure !== 'string' || !MOTIF_HEURE.test(s.heure.trim())) throw echec(400, 'devblog-auto-heure', 'Heure : au format HH:MM.');
    r.heure = s.heure.trim();
  }
  if (s.jour !== undefined) {
    const j = Number(s.jour);
    if (!Number.isInteger(j) || j < 1 || j > 7) throw echec(400, 'devblog-auto-jour', 'Jour de la semaine : de 1 (lundi) à 7 (dimanche).');
    r.jour = j;
  }
  for (const k of ['validation', 'mentionHere']) {
    if (s[k] !== undefined) {
      if (typeof s[k] !== 'boolean') throw echec(400, 'devblog-auto', 'Mode automatique : oui ou non.');
      r[k] = s[k];
    }
  }
  if (s.cibles !== undefined) {
    if (s.cibles === null) r.cibles = null;
    else if (!Array.isArray(s.cibles)) throw echec(400, 'devblog-salons', 'Salons : une liste.');
    else r.cibles = [...new Set(s.cibles.filter(c => typeof c === 'string' && (!connues || connues.has(c))))].slice(0, 30);
  }
  if (!FREQUENCES.includes(r.frequence)) r.frequence = REGLAGES_AUTO_DEFAUT.frequence;
  if (!MOTIF_HEURE.test(r.heure)) r.heure = REGLAGES_AUTO_DEFAUT.heure;
  if (!Number.isInteger(r.jour) || r.jour < 1 || r.jour > 7) r.jour = REGLAGES_AUTO_DEFAUT.jour;
  return r;
}

const minutesDe = heure => {
  const m = MOTIF_HEURE.exec(heure) ?? MOTIF_HEURE.exec(REGLAGES_AUTO_DEFAUT.heure);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Jour (AAAA-MM-JJ) dans le fuseau du club. */
export const jourClub = ms => {
  const p = partiesLocales(FUSEAU_DEVBLOG, ms);
  return texteDate({ annee: p.annee, mois: p.mois, jour: p.jour });
};

/**
 * Prochain passage prévu (ms UTC) à partir de `ms` : aujourd'hui à l'heure choisie si elle n'est pas passée (et
 * que c'est le bon jour en hebdomadaire), sinon le jour suivant qui convient. `dejaFaitAujourdhui` : le passage du
 * jour a eu lieu (on cherche à partir de demain).
 */
export function echeanceAuto(reglages, ms, { dejaFaitAujourdhui = false } = {}) {
  const r = lireReglagesAuto({}, reglages);
  const minutes = minutesDe(r.heure);
  const p = partiesLocales(FUSEAU_DEVBLOG, ms);
  for (let d = 0; d <= 8; d++) {
    const jour = new Date(Date.UTC(p.annee, p.mois - 1, p.jour + d));
    const date = { annee: jour.getUTCFullYear(), mois: jour.getUTCMonth() + 1, jour: jour.getUTCDate() };
    const iso = (jour.getUTCDay() + 6) % 7 + 1;
    if (r.frequence === 'hebdo' && iso !== r.jour) continue;
    if (d === 0 && dejaFaitAujourdhui) continue;
    // Aujourd'hui, heure déjà passée : le passage reste dû (le cron ne passe que toutes les 5 minutes).
    return instantMural(FUSEAU_DEVBLOG, date, minutes);
  }
  return null;
}

/** Le cron doit-il rédiger maintenant ? (mode actif, bon jour, heure atteinte, pas déjà passé aujourd'hui.) */
export function estDuAuto(reglages, ms, { dernierJour = null } = {}) {
  const r = lireReglagesAuto({}, reglages);
  if (!r.actif) return false;
  const jour = jourClub(ms);
  if (dernierJour === jour) return false;
  const p = partiesLocales(FUSEAU_DEVBLOG, ms);
  if (r.frequence === 'hebdo' && p.jourSemaine !== r.jour) return false;
  return p.heure * 60 + p.minute >= minutesDe(r.heure);
}

/**
 * Instant d'une publication programmée : « AAAA-MM-JJ HH:MM » (ou « AAAA-MM-JJTHH:MM ») en heure du club, ou ISO
 * complet avec fuseau. Doit être dans le futur (au moins 1 minute) et à moins de 90 jours.
 */
export function lireInstantProgramme(v, maintenant) {
  const t = String(v ?? '').trim();
  let ms = NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (m) ms = instantMural(FUSEAU_DEVBLOG, { annee: Number(m[1]), mois: Number(m[2]), jour: Number(m[3]) }, Number(m[4]) * 60 + Number(m[5]));
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) ms = Date.parse(t);
  if (!Number.isFinite(ms)) throw echec(400, 'devblog-programme', 'Date et heure de publication : AAAA-MM-JJ HH:MM (heure de Paris).');
  if (ms < maintenant + 60_000) throw echec(400, 'devblog-programme-passe', 'Choisissez une date et une heure à venir.');
  if (ms > maintenant + PROGRAMMATION_MAX_JOURS * 86_400_000) throw echec(400, 'devblog-programme-loin', 'Au plus 90 jours à l’avance.');
  return ms;
}

/** « AAAA-MM-JJ HH:MM » (heure du club) d'un instant. */
export function texteMuralClub(ms) {
  const p = partiesLocales(FUSEAU_DEVBLOG, ms);
  const deux = n => String(n).padStart(2, '0');
  return `${p.annee}-${deux(p.mois)}-${deux(p.jour)} ${deux(p.heure)}:${deux(p.minute)}`;
}

// ------------------------------------------------------------------ Commits : filtrage

/** Zones (avant « : » du sujet) purement techniques. */
const ZONES_TECHNIQUES = /^(jest|tests?|e2e|ci|cd|docs?|documentation|readme|lint|eslint|prettier|refactor\w*|d[ée]pendances?|deps?|build|typage|types?|tsc|deployer\.sh|d[ée]ploiement|migrations?|scripts?|outils?|chore|style|perf|journaux|journal|logs?|workflow|github|actions)$/i;
/** Préfixes « conventional commits » techniques. */
const PREFIXE_CONVENTIONNEL = /^(test|tests|docs?|refactor|chore|ci|build|style|deps?|lint|revert|wip)(\([^)]*\))?!?\s*:/i;
/** Mots qui, dans le sujet, signalent un changement sans intérêt pour les membres. */
const MOTS_TECHNIQUES = [
  /\b(jest|e2e|eslint|prettier|tsc|lint|node_modules|dependabot|renovate|bump|lockfile|typo|coquilles?|commentaires?)\b/i,
  /\brefactor\w*/i,
  /(^|[:—–-]\s*)(documentation|docs?|readme)\b/i,
  /\btests?\s+(unitaires?|de bout en bout|instables?|adapt[ée]s?|ajout[ée]s?|corrig[ée]s?)\b/i,
  /^tests?\b/i,
  /\b(journaux|journalisation|logs?)\b/i,
  /\bdiagnostics?\b/i,
  /\blien symbolique\b/i,
  /\btravail en cours\b|\bwip\b/i,
  /\bd[ée]lais?\b.*\bsous charge\b/i,
  /\bCI\b/,
  /\b(lien|liens) symboliques?\b/i,
];

/** Un commit est-il technique (sans intérêt pour les membres) ? Règles sur le sujet. */
export function estTechnique(commit) {
  const sujet = String(commit?.sujet ?? '').trim();
  if (!sujet) return true;
  if (/^(merge|revert|fixup!|squash!)\b/i.test(sujet)) return true;
  if (PREFIXE_CONVENTIONNEL.test(sujet)) return true;
  const zone = /^([^:]{1,40}?)\s*:/.exec(sujet)?.[1]?.trim();
  if (zone && ZONES_TECHNIQUES.test(zone)) return true;
  return MOTS_TECHNIQUES.some(m => m.test(sujet));
}

/** `{ retenus, ecartes }` : commits retenus pour le devblog (ordre gardé). */
export function filtrerCommits(commits) {
  const retenus = [];
  const ecartes = [];
  for (const c of commits ?? []) (estTechnique(c) ? ecartes : retenus).push(c);
  return { retenus, ecartes };
}

// ------------------------------------------------------------------ Rien d'interne ne sort

const MOTIFS_FUITE = [
  // Identifiants de commit (au moins un chiffre ET une lettre a-f, 7 à 40 caractères).
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i,
  // Variables d'environnement (MAJUSCULES_AVEC_SOULIGNÉ), références $VAR / ${VAR} / process.env.
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/,
  /\$\{?[A-Za-z_]\w*/,
  /process\.env/i,
  // Chemins et noms de fichiers.
  /(^|[\s(«"'`])(~|\.{1,2})?\/[\w.:-]+/,
  /[\w.:-]+\/[\w.:-]+\/[\w.:-]*/,
  /\b(esport|src|relais|docs|scripts|bureau|android|ios|public|node_modules|serveur|noyau|tests?|migrations|adaptateurs|outils)\/[\w.-]+/i,
  /\b[\w-]+(\/[\w.-]+)+\.[a-z0-9]{1,5}\b/i,
  /\b[\w.-]+\.(mjs|cjs|js|jsx|ts|tsx|json|sql|sh|bash|md|ya?ml|env|css|scss|html?|py|toml|lock|conf|cfg|ini|txt|log|cpp|hpp|c|h|gguf|onnx|bin|so|dll|exe|zip|gz)\b/i,
  // Adresses, e-mails, options de ligne de commande, code entre accents graves.
  /\bhttps?:\/\//i,
  /\bwww\.[\w-]+\./i,
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
  /(^|\s)--?[a-z][\w-]{2,}/i,
  /`/,
];

/** Noms de fournisseurs et de technologies interdits dans un devblog (ton « membres », sans jargon). */
const MOTS_INTERDITS = /\b(nvidia|mistral|gpt[\w.-]*|openai|chatgpt|whisper(\.cpp)?|onnx|llama(\.cpp)?|gguf|postgres(ql)?|sqlite|node(\.?js)?|npm|react( native)?|vitejs|jest|eslint|typescript|javascript|github|git|o2switch|cpanel|passenger|cloudflare|docker|claude|anthropic|api|sql|json|webhooks?|cron|serveur node|ia locale)\b/i;

/** Le texte contient-il quelque chose d'interne (hash, chemin, fichier, variable, adresse, e-mail…) ? */
export function contientFuite(texte) {
  const t = String(texte ?? '');
  return MOTIFS_FUITE.some(m => m.test(t));
}

/** Nom de fournisseur ou de technologie (refusé dans le texte publié) ? */
export const contientJargon = texte => MOTS_INTERDITS.test(String(texte ?? ''));

/** Texte d'un commit débarrassé de tout ce qui est interne (avant l'envoi à l'IA). */
export function nettoyerLigne(v, max = 200) {
  return String(v ?? '')
    .normalize('NFC')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/(^|[\s(«"'])(~|\.{1,2})?\/[^\s,;)»"']*/g, '$1 ')
    .replace(/[^\s,;(«"']*[\w.:-]\/[\w.:-]+\/[^\s,;)»"']*/g, ' ')
    .replace(/\b(esport|src|relais|docs|scripts|bureau|android|ios|public|node_modules|serveur|noyau|tests?|migrations|adaptateurs|outils)\/[\w.-]+/gi, ' ')
    .replace(/\b[\w.-]+\/[\w.-]+\.(mjs|cjs|js|jsx|ts|tsx|json|sql|sh|md|ya?ml|env|css|html?|py|log|txt)\b/gi, ' ')
    .replace(/\b[\w.-]+\.(mjs|cjs|js|jsx|ts|tsx|json|sql|sh|bash|md|ya?ml|env|css|scss|html?|py|toml|lock|conf|cfg|ini|txt|log|cpp|hpp|c|h|gguf|onnx|bin|so|dll|exe|zip|gz)\b/gi, ' ')
    .replace(/process\.env\.\w+/gi, ' ')
    .replace(/\$\{?[A-Za-z_]\w*\}?/g, ' ')
    .replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, ' ')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, ' ')
    .replace(/(^|\s)--?[a-z][\w-]{2,}(=\S*)?/gi, '$1 ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\(\s*[,;·]?\s*\)/g, ' ')
    .replace(/\s+([,;.)])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Commit → texte envoyé à l'IA : sujet + au plus 5 puces du corps, nettoyés ; sans hash, sans date, sans auteur. */
export function nettoyerCommit(c) {
  const sujet = nettoyerLigne(c?.sujet, 200);
  const puces = String(c?.corps ?? '')
    .split('\n')
    .map(l => l.trim())
    // Lignes de fin (Co-Authored-By, Signed-off-by, Claude-Session…) écartées.
    .filter(l => l && !/^[\w-]{2,40}:\s/.test(l))
    .filter(l => /^[-*•]\s+/.test(l))
    .map(l => nettoyerLigne(l.replace(/^[-*•]\s+/, ''), 200))
    .filter(Boolean)
    .slice(0, 5);
  return { sujet, puces };
}

// ------------------------------------------------------------------ Rédaction par l'IA

export const CONSIGNE_REDACTION = [
  'You write the release notes ("devblog") of an esports club app, for the club members (players, staff, community managers).',
  'Input: a JSON list of changes that were deployed (short commit summaries, in French, sometimes technical).',
  'Output: the devblog in FRENCH and ENGLISH, in the EXACT house style shown in the examples:',
  '- "titre": always "Nouvelle Mise à Jour !" in French and "New Update!" in English (rendered as "🚀 DEVBLOG — <titre> 🛠️");',
  '- "intro": one friendly sentence ("Salut à tous ! …" / "Hi everyone! …") ending with a colon;',
  '- "sections": 1 to 6 sections grouped by theme, each with ONE emoji, a short bold title, and bullets {"nom": short feature name (1-4 words), "description": one short positive sentence};',
  '- a last section "🔧 Corrections" / "🔧 Fixes" only for fixes members can notice;',
  '- "conclusion": one short thankful sentence ending with 🚀 (the @here mention is added automatically, never write it).',
  'Rules: positive tone, simple words, NO technical jargon, NO vendor, product or technology names (no AI model, database, hosting, framework or library names), NO file names, paths, commit ids, environment variables, links, e-mails or mentions.',
  'Skip changes that do not matter to members (tests, documentation, refactoring, CI, dependencies, logs, internal tools, deployment). Merge related changes into one bullet. Never invent a feature that is not in the input.',
  'The French and English versions have the SAME sections, in the same order, with the same number of bullets and the same emojis.',
  'If nothing in the input matters to members, answer {"rien": true}.',
  'Answer with JSON only: {"fr": {"titre": "...", "intro": "...", "sections": [{"emoji": "...", "titre": "...", "puces": [{"nom": "...", "description": "..."}]}], "conclusion": "..."}, "en": { same structure }}',
].join('\n');

/** Devblog du 23/10/2026 (posté à la main par le Fondateur) : la DA de référence, avec les changements d'alors. */
export const DEVBLOG_23_10 = Object.freeze({
  changements: [
    { sujet: 'Synchro serveur : écran de connexion sans code de liaison, migration du Fondateur, style au nom', puces: [] },
    { sujet: 'Langue du compte : choix à la création, réglage sur la fiche et dans Esport › Membres, Messagerie bilingue', puces: [] },
    { sujet: 'Esport : page « Statistiques » réservée au Fondateur (statistiques d’usage internes)', puces: [] },
    { sujet: 'Esport : module « Ressources », le canal de ressources de la team', puces: [] },
    { sujet: 'Esport : vidéos déposées sur le site et transcription automatique des réunions en PDF', puces: [] },
    { sujet: 'Support refait (demandes rangées, Discord, réponses), e-mails envoyés par le serveur, Discord ID des membres Esport', puces: [] },
    { sujet: 'Client : rechargement unique sur morceau périmé juste après une mise à jour', puces: [] },
    { sujet: 'Jest : délais plus généreux sous charge', puces: [] },
  ],
  fr: {
    titre: 'Nouvelle Mise à Jour !',
    intro: 'Salut à tous ! Une nouvelle mise à jour vient d’arriver sur l’app. Voici ce qui change :',
    sections: [
      { emoji: '🔐', titre: 'Compte & Connexion', puces: [
        { nom: 'Connexion simplifiée', description: 'Plus besoin de code de liaison : connectez-vous avec votre identifiant, sur tous vos appareils.' },
        { nom: 'Langue du compte', description: 'Choisissez le français ou l’anglais dès la création de votre compte, et changez-la quand vous voulez.' },
      ] },
      { emoji: '🎮', titre: 'Esport', puces: [
        { nom: 'Ressources', description: 'Un nouvel espace pour partager les ressources de la team.' },
        { nom: 'Réunions', description: 'Déposez la vidéo d’une réunion et recevez son compte rendu en PDF automatiquement.' },
        { nom: 'Statistiques', description: 'Une nouvelle page pour suivre l’activité de l’app.' },
      ] },
      { emoji: '💬', titre: 'Support', puces: [
        { nom: 'Support refait', description: 'Vos demandes sont mieux rangées et les réponses arrivent plus vite.' },
      ] },
      { emoji: '🔧', titre: 'Corrections', puces: [
        { nom: 'Mises à jour', description: 'Fini les pages qui ne s’ouvraient plus juste après une mise à jour.' },
      ] },
    ],
    conclusion: 'Merci pour vos retours et bonne navigation ! 🚀',
  },
  en: {
    titre: 'New Update!',
    intro: 'Hi everyone! A new update just landed in the app. Here’s what’s new:',
    sections: [
      { emoji: '🔐', titre: 'Account & Sign-in', puces: [
        { nom: 'Easier sign-in', description: 'No more link code: sign in with your username, on all your devices.' },
        { nom: 'Account language', description: 'Pick French or English when you create your account, and switch whenever you like.' },
      ] },
      { emoji: '🎮', titre: 'Esport', puces: [
        { nom: 'Resources', description: 'A new space to share your team’s resources.' },
        { nom: 'Meetings', description: 'Upload a meeting video and get its summary as a PDF automatically.' },
        { nom: 'Statistics', description: 'A new page to follow the app’s activity.' },
      ] },
      { emoji: '💬', titre: 'Support', puces: [
        { nom: 'Support revamped', description: 'Your requests are better organised and answers come faster.' },
      ] },
      { emoji: '🔧', titre: 'Fixes', puces: [
        { nom: 'Updates', description: 'No more pages failing to open right after an update.' },
      ] },
    ],
    conclusion: 'Thanks for your feedback and enjoy! 🚀',
  },
});

/** Premier devblog (brouillon du 30/10, commit a1d1e27) : deux sections, avec les changements qu'elles résument. */
const SECTIONS_PREMIER = [0, 3];
export const EXEMPLE_PREMIER = Object.freeze({
  changements: [
    { sujet: 'Esport : profils de jeu, assistant IA et mises à jour proposées', puces: [] },
    { sujet: 'Esport : modules Tournois et Résultats (section Compétition)', puces: [] },
    { sujet: 'Esport › Discord : un ping une seule fois par événement, relances et joueur seul par MP', puces: [] },
    { sujet: 'Discord : messages en anglais d’abord, version française dans un fil', puces: [] },
    { sujet: 'Esport › Discord : tester les MP du bot (MP de test, simulation de relance)', puces: [] },
    { sujet: 'Esport IA : plusieurs moteurs (NVIDIA Mistral Large + gpt-oss-20b + IA locale), ordre de repli par tâche', puces: [] },
  ],
  fr: { ...PREMIER_DEVBLOG_FR, sections: SECTIONS_PREMIER.map(i => PREMIER_DEVBLOG_FR.sections[i]) },
  en: { ...PREMIER_DEVBLOG_EN, sections: SECTIONS_PREMIER.map(i => PREMIER_DEVBLOG_EN.sections[i]) },
});

export const EXEMPLES_REDACTION = [DEVBLOG_23_10, EXEMPLE_PREMIER];

/** Messages envoyés à l'IA (consigne, deux exemples, puis les changements nettoyés). */
export function messagesRedaction(changements) {
  const sortie = [{ role: 'system', content: CONSIGNE_REDACTION }];
  for (const ex of EXEMPLES_REDACTION) {
    sortie.push({ role: 'user', content: JSON.stringify({ changements: ex.changements }) });
    sortie.push({ role: 'assistant', content: JSON.stringify({ fr: ex.fr, en: ex.en }) });
  }
  sortie.push({ role: 'user', content: JSON.stringify({ changements }) });
  return sortie;
}

const PICTO = /\p{Extended_Pictographic}/u;

/** Erreur de rédaction (réponse de l'IA refusée) : jamais publiée. */
const refusRedaction = motif => {
  const e = new Error(`Rédaction refusée : ${motif}`);
  e.code = 'devblog-redaction';
  e.motif = motif;
  return e;
};

/** Contrôle strict d'une langue de la réponse (avant nettoyage : rien n'est tronqué en silence). */
function verifierLangue(brut, langue) {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw refusRedaction(`${langue} absent`);
  const chaine = (v, max, champ) => {
    if (typeof v !== 'string' || !v.trim()) throw refusRedaction(`${langue}.${champ} vide`);
    if (v.length > max) throw refusRedaction(`${langue}.${champ} trop long`);
  };
  chaine(brut.titre, LONGUEURS.titre, 'titre');
  chaine(brut.intro, LONGUEURS.intro, 'intro');
  chaine(brut.conclusion, LONGUEURS.conclusion, 'conclusion');
  if (!Array.isArray(brut.sections) || brut.sections.length < 1 || brut.sections.length > Math.min(8, MAX_SECTIONS)) throw refusRedaction(`${langue}.sections : 1 à 8`);
  brut.sections.forEach((s, i) => {
    if (!s || typeof s !== 'object') throw refusRedaction(`${langue}.sections[${i}]`);
    chaine(s.emoji, LONGUEURS.emoji, `sections[${i}].emoji`);
    if (!PICTO.test(s.emoji) || /[A-Za-z0-9]/.test(s.emoji)) throw refusRedaction(`${langue}.sections[${i}].emoji : un emoji`);
    chaine(s.titre, LONGUEURS.titreSection, `sections[${i}].titre`);
    if (!Array.isArray(s.puces) || s.puces.length < 1 || s.puces.length > Math.min(12, MAX_PUCES)) throw refusRedaction(`${langue}.sections[${i}].puces : 1 à 12`);
    s.puces.forEach((p, j) => {
      if (!p || typeof p !== 'object') throw refusRedaction(`${langue}.sections[${i}].puces[${j}]`);
      chaine(p.nom, LONGUEURS.nom, `sections[${i}].puces[${j}].nom`);
      chaine(p.description, LONGUEURS.description, `sections[${i}].puces[${j}].description`);
    });
  });
  const texte = JSON.stringify(brut);
  if (/@(here|everyone)|<@|<#|@&/.test(texte) || /(^|\s)@\w/.test(texte)) throw refusRedaction(`${langue} : mention`);
  if (contientFuite(texte)) throw refusRedaction(`${langue} : élément interne (fichier, chemin, identifiant, variable ou adresse)`);
  if (contientJargon(texte)) throw refusRedaction(`${langue} : nom de technologie ou de fournisseur`);
}

/**
 * Réponse de l'IA (objet déjà extrait) → `{ rien: true }` ou `{ fr, en }` validés et nettoyés. Refus (exception
 * `devblog-redaction`) dès qu'une règle n'est pas tenue : structure, longueurs, emoji, mêmes sections dans les deux
 * langues, aucune mention, aucune fuite, aucun nom de technologie.
 */
export function lireRedaction(brut) {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw refusRedaction('réponse illisible');
  if (brut.rien === true && !brut.fr && !brut.en) return { rien: true };
  verifierLangue(brut.fr, 'fr');
  verifierLangue(brut.en, 'en');
  if (brut.fr.sections.length !== brut.en.sections.length) throw refusRedaction('sections différentes entre le français et l’anglais');
  brut.fr.sections.forEach((s, i) => {
    if (s.puces.length !== brut.en.sections[i].puces.length) throw refusRedaction(`section ${i + 1} : puces différentes entre le français et l’anglais`);
  });
  const fr = lireContenu(brut.fr);
  const en = lireContenu(brut.en);
  // Même emoji dans les deux langues (celui du français fait foi).
  en.sections.forEach((s, i) => {
    s.emoji = fr.sections[i].emoji;
  });
  if (!contenuComplet(fr) || !contenuComplet(en)) throw refusRedaction('contenu incomplet');
  return { fr, en };
}

/**
 * Brouillon de secours quand l'IA échoue : une section « ✨ Nouveautés » avec le sujet nettoyé de chaque commit
 * retenu (même texte en anglais, à traduire avec « Préparer avec l'IA »). Toujours un BROUILLON, jamais publié.
 */
export function brouillonDeSecours(changements) {
  const puces = changements
    .map(c => c.sujet)
    .filter(Boolean)
    .slice(0, MAX_PUCES)
    .map(s => {
      const m = /^([^:]{1,60}?)\s*:\s*(.+)$/.exec(s);
      return m ? { nom: m[1].replace(/^Esport\s*›\s*/i, '').slice(0, LONGUEURS.nom), description: m[2] } : { nom: '', description: s };
    });
  const fr = lireContenu({
    titre: 'Nouvelle Mise à Jour !',
    intro: 'Salut à tous ! Une nouvelle mise à jour est en ligne. Voici ce qui change :',
    sections: [{ emoji: '✨', titre: 'Nouveautés', puces }],
    conclusion: 'Merci pour vos retours et bonne navigation ! 🚀',
  });
  const en = lireContenu({
    titre: 'New Update!',
    intro: 'Hi everyone! A new update is live. Here’s what’s new:',
    sections: [{ emoji: '✨', titre: 'What’s new', puces }],
    conclusion: 'Thanks for your feedback and enjoy! 🚀',
  });
  return { fr, en };
}
