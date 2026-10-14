/**
 * Tâches (V2) : réglages et tri des notifications.
 *
 * Chaque utilisateur a les siens (le Fondateur : `reglages.notifF` ; l'ami :
 * `reglages.notifA`, qui voyage dans ce qu'il renvoie déjà puis lui revient
 * scellé), synchronisés entre ses appareils par la synchronisation existante :
 * aucune écriture sur le relais par notification.
 *
 *  - activation globale ; par type (échéance, rappel avant, retard, tâche
 *    assignée à moi, modification ou commentaire de l'autre sur un projet
 *    partagé, tâche liée à un agent Claude Office terminée, récap « Ma
 *    journée ») un canal : notification du système (PC), pastille 🔔 dans le
 *    hub, les deux, ou aucun ;
 *  - délai de rappel par défaut des nouvelles échéances, heure du récap ;
 *  - heures calmes (plage, et le week-end) : rien ne sonne, la pastille reste ;
 *  - regroupement (une notification résumée quand plusieurs partent ensemble),
 *    son ; projets en sourdine ; « un appareil seulement » pour les
 *    notifications du système.
 *
 * Anti-répétition : chaque événement a une clé retenue sur l'appareil ; il ne
 * repart jamais. Tout est pur : horloge, appareil et noms sont passés.
 */

import { heureValide, instantDe, jourDe } from './dates';
import { maJournee } from './filtres';
import { assignesDe, auteurDeH, estTerminee, pourQui, suffixeAuteur, tachesVivantes, type Auteur, type DonneesTaches, type Tache } from './modele';
import { projetPartage } from './membres';
import { modeProjet } from './partage';
import { TOLERANCE_RAPPEL_MS, type AlerteRappel, type EtatRappels } from './rappels';

export type TypeNotif = 'echeance' | 'rappel' | 'retard' | 'assignee' | 'mention' | 'ami' | 'office' | 'recap' | 'journal';
export type Canal = 'les-deux' | 'systeme' | 'pastille' | 'aucun';

export const TYPES_NOTIF: readonly TypeNotif[] = ['echeance', 'rappel', 'retard', 'assignee', 'mention', 'ami', 'office', 'recap', 'journal'];
export const CANAUX: readonly Canal[] = ['les-deux', 'systeme', 'pastille', 'aucun'];
export const LIBELLES_TYPE: Record<TypeNotif, string> = {
  echeance: 'Échéance atteinte',
  rappel: 'Rappel avant l’échéance',
  retard: 'Tâche en retard',
  assignee: 'Tâche qui m’est assignée',
  mention: 'On me mentionne (@prénom) dans un commentaire',
  ami: 'Modification ou commentaire d’un autre sur un projet partagé',
  office: 'Tâche liée à un agent Claude Office terminée',
  recap: 'Récap quotidien « Ma journée »',
  journal: 'Invite du soir « Note ce que tu as fait aujourd’hui »',
};
export const LIBELLES_CANAL: Record<Canal, string> = { 'les-deux': 'Système + pastille', systeme: 'Système', pastille: 'Pastille', aucun: 'Aucune' };
export const DELAIS_DEFAUT: readonly number[] = [0, 10, 60, 1440];

export interface PrefsNotif {
  actif: boolean;
  types: Record<TypeNotif, Canal>;
  /** Rappel posé par défaut sur une nouvelle échéance (minutes avant ; −1 : aucun). */
  delaiDefaut: number;
  heureRecap: string;
  /** Heure de l'invite du soir (journal du jour). */
  heureJournal: string;
  calme: { actif: boolean; debut: string; fin: string; weekEnd: boolean };
  regrouper: boolean;
  son: boolean;
  /** Projets en sourdine. */
  muets: string[];
  /** Seul cet appareil affiche les notifications du système (les autres gardent la pastille). */
  appareil?: { id: string; nom: string };
}

export const PREFS_DEFAUT: PrefsNotif = {
  actif: true,
  types: { echeance: 'les-deux', rappel: 'les-deux', retard: 'pastille', assignee: 'les-deux', mention: 'les-deux', ami: 'pastille', office: 'les-deux', recap: 'aucun', journal: 'aucun' },
  delaiDefaut: -1,
  heureRecap: '08:30',
  heureJournal: '18:00',
  calme: { actif: false, debut: '22:00', fin: '07:30', weekEnd: false },
  regrouper: true,
  son: true,
  muets: [],
};

const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const heure = (v: unknown, defaut: string) => (typeof v === 'string' && heureValide(v) ? v : defaut);

/** Lit des réglages (non sûrs) : tout ce qui manque prend la valeur par défaut. */
export function lirePrefs(brut: unknown): PrefsNotif {
  const o = dict(brut);
  const types = dict(o.types);
  const calme = dict(o.calme);
  const app = dict(o.appareil);
  return {
    actif: o.actif !== false,
    types: Object.fromEntries(TYPES_NOTIF.map(t => [t, CANAUX.includes(types[t] as Canal) ? (types[t] as Canal) : PREFS_DEFAUT.types[t]])) as Record<TypeNotif, Canal>,
    delaiDefaut: typeof o.delaiDefaut === 'number' && (o.delaiDefaut === -1 || DELAIS_DEFAUT.includes(o.delaiDefaut)) ? o.delaiDefaut : PREFS_DEFAUT.delaiDefaut,
    heureRecap: heure(o.heureRecap, PREFS_DEFAUT.heureRecap),
    heureJournal: heure(o.heureJournal, PREFS_DEFAUT.heureJournal),
    calme: { actif: calme.actif === true, debut: heure(calme.debut, PREFS_DEFAUT.calme.debut), fin: heure(calme.fin, PREFS_DEFAUT.calme.fin), weekEnd: calme.weekEnd === true },
    regrouper: o.regrouper !== false,
    son: o.son !== false,
    muets: (Array.isArray(o.muets) ? o.muets : []).filter((m): m is string => typeof m === 'string' && /^[a-z0-9-]{2,48}$/.test(m)).slice(0, 200),
    ...(typeof app.id === 'string' && /^[a-z0-9-]{4,40}$/.test(app.id) && typeof app.nom === 'string' ? { appareil: { id: app.id, nom: app.nom.slice(0, 40) } } : {}),
  };
}

/** Chez le Fondateur, ses réglages ; chez un membre, les siens (dans sa copie, toujours `notifA`). */
export const champPrefs = (qui: Auteur): 'notifF' | 'notifA' => (qui === 'fondateur' ? 'notifF' : 'notifA');
export const prefsDe = (d: DonneesTaches, qui: Auteur): PrefsNotif => lirePrefs(d.reglages[champPrefs(qui)]);

const minutesDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Heures calmes en cours ? (plage qui peut passer minuit ; week-end entier si coché). */
export function enHeuresCalmes(p: Pick<PrefsNotif, 'calme'>, maintenant: number): boolean {
  if (!p.calme.actif) return false;
  const d = new Date(maintenant);
  if (p.calme.weekEnd && (d.getDay() === 0 || d.getDay() === 6)) return true;
  const m = d.getHours() * 60 + d.getMinutes();
  const a = minutesDe(p.calme.debut);
  const b = minutesDe(p.calme.fin);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

export interface EvenementNotif {
  type: TypeNotif;
  cle: string;
  tacheId: string;
  projetId?: string;
  titre: string;
  texte: string;
  /** Instant de l'événement (ISO). */
  date: string;
}

export interface Environnement {
  /** Identifiant de cet appareil (`taches.appareil`). */
  appareilId?: string;
  noms: Record<Auteur, string>;
}

export interface NotifSysteme {
  titre: string;
  corps: string;
  tacheId?: string;
}

export interface ResultatNotif {
  etat: EtatRappels;
  /** Ajoutées à la pastille 🔔 (et à la liste « Rappels »). */
  pastille: AlerteRappel[];
  /** À montrer par le système (déjà filtrées : heures calmes, appareil, regroupement). */
  systeme: NotifSysteme[];
  /** Notifications du système retenues par les heures calmes (pour le dire dans l'app). */
  calmees: number;
}

const instantH = (h: string) => Date.parse(h.split('|')[0]);

function texteRappel(minutes: number, heureEch: string | undefined): string {
  const a = heureEch && heureValide(heureEch) ? ` (${heureEch.replace(':', ' h ')})` : '';
  if (minutes === 0) return `C’est l’échéance${a}`;
  if (minutes < 60) return `Échéance dans ${minutes} min${a}`;
  if (minutes < 1440) return `Échéance dans ${Math.round(minutes / 60)} h${a}`;
  const j = Math.round(minutes / 1440);
  return j === 1 ? `Échéance demain${a}` : `Échéance dans ${j} jours${a}`;
}

/** Tâches qui concernent `qui` : le Fondateur, les siennes et celles de personne ; un membre, les siennes. */
const pourMoi = (t: Tache, qui: Auteur) => pourQui(t, qui);
/** Nom d'un auteur pour les textes. */
const nomDe = (noms: Record<Auteur, string>, a: Auteur | undefined) => (a ? (noms[a] ?? (a === 'fondateur' ? 'Le Fondateur' : 'Un membre')) : 'Quelqu’un');

/**
 * Ce qui s'est passé depuis la dernière évaluation (avant tout filtrage).
 * `autres` : pour chaque tâche partagée, la dernière trace de l'autre déjà vue
 * (sa modification arrive par la synchronisation, parfois des minutes après
 * avoir été faite : on compare aux traces vues, pas à l'heure). `premiere` :
 * premier passage sur cet appareil, rien n'est rattrapé.
 */
export function evenementsTaches(
  d: DonneesTaches,
  maintenant: number,
  qui: Auteur,
  suivi: { premiere: boolean; autres: Record<string, string> },
  prefs: PrefsNotif,
  noms: Record<Auteur, string>,
): { evenements: EvenementNotif[]; autres: Record<string, string> } {
  const r: EvenementNotif[] = [];
  const autres: Record<string, string> = {};
  const iso = new Date(maintenant).toISOString();
  for (const t of tachesVivantes(d)) {
    const ouverte = !estTerminee(d, t);
    // Rappels et échéance.
    if (t.echeance && ouverte && pourMoi(t, qui)) {
      const echeance = instantDe(t.echeance.jour, t.echeance.heure);
      for (const m of t.rappels) {
        const declenche = echeance - m * 60_000;
        if (declenche > maintenant || maintenant - declenche > TOLERANCE_RAPPEL_MS) continue;
        r.push({ type: m === 0 ? 'echeance' : 'rappel', cle: `${t.id}|${t.echeance.jour}T${t.echeance.heure ?? ''}|${m}`, tacheId: t.id, projetId: t.projetId, titre: t.titre, texte: texteRappel(m, t.echeance.heure), date: new Date(declenche).toISOString() });
      }
      // En retard : une fois, une heure après l'échéance (fin de journée sans heure) — pas en double avec « échéance atteinte ».
      const fin = t.echeance.heure ? echeance + 3_600_000 : instantDe(t.echeance.jour, '23:59') + 60_000;
      if (fin <= maintenant && maintenant - fin <= TOLERANCE_RAPPEL_MS) {
        r.push({ type: 'retard', cle: `${t.id}|retard|${t.echeance.jour}T${t.echeance.heure ?? ''}`, tacheId: t.id, projetId: t.projetId, titre: t.titre, texte: 'En retard : l’échéance est passée', date: new Date(fin).toISOString() });
      }
    }
    // Ce que les autres ont fait depuis la dernière fois (projets partagés seulement).
    const p = d.projets[t.projetId];
    const partage = qui !== 'fondateur' || Boolean(p && (projetPartage(d, p) || modeProjet(d, t.projetId) !== 'aucun'));
    if (!partage) continue;
    const moi = suffixeAuteur(qui);
    const dAutrui = (h: string) => !h.endsWith(moi) && Boolean(auteurDeH(h));
    const traces = [...Object.values(t.h), ...Object.values(t.commentaires).map(c => c.h)].filter(dAutrui).sort();
    const derniere = traces.at(-1);
    if (derniere) autres[t.id] = derniere;
    if (suivi.premiere || !derniere) continue;
    // Tâche jamais vue : seules ses traces des 2 derniers jours comptent (pas de rattrapage d'archives).
    const vue = suivi.autres[t.id] ?? new Date(maintenant - 2 * 86_400_000).toISOString();
    const recent = (h: string | undefined) => Boolean(h && dAutrui(h) && h > vue && !Number.isNaN(instantH(h)));
    // Mention (« @prénom ») dans un commentaire d'un autre : son propre type de notification.
    const mentions = Object.values(t.commentaires).filter(c => !c.supprime && c.auteur !== qui && c.mentions?.includes(qui) && recent(c.h)).sort((a, b) => a.h.localeCompare(b.h));
    for (const c of mentions) {
      r.push({ type: 'mention', cle: `${t.id}|mention|${c.h}`, tacheId: t.id, projetId: t.projetId, titre: t.titre, texte: `${nomDe(noms, c.auteur)} vous mentionne : « ${c.texte.slice(0, 80)} »`, date: iso });
    }
    const hAssign = [t.h.assignes, t.h.assigne].filter((h): h is string => Boolean(h)).sort().at(-1);
    if (assignesDe(t).includes(qui) && recent(hAssign)) {
      r.push({ type: 'assignee', cle: `${t.id}|assignee|${hAssign}`, tacheId: t.id, projetId: t.projetId, titre: t.titre, texte: `${nomDe(noms, auteurDeH(hAssign))} vous a assigné cette tâche`, date: iso });
      continue;
    }
    if (mentions.length) continue;
    const commentaire = Object.values(t.commentaires).filter(c => !c.supprime && c.auteur !== qui && recent(c.h)).sort((a, b) => b.h.localeCompare(a.h))[0];
    const champs = Object.entries(t.h).filter(([c, h]) => c !== 'assigne' && c !== 'assignes' && recent(h));
    if (commentaire) {
      r.push({ type: 'ami', cle: `${t.id}|ami|${commentaire.h}`, tacheId: t.id, projetId: t.projetId, titre: t.titre, texte: `${nomDe(noms, commentaire.auteur)} a commenté : « ${commentaire.texte.slice(0, 80)} »`, date: iso });
    } else if (champs.length) {
      const dernier = champs.map(([, h]) => h).sort().at(-1)!;
      const auteur = auteurDeH(dernier);
      const cree = champs.some(([c]) => c === 'titre') && t.creePar === auteur && t.historique.length <= 2;
      r.push({ type: 'ami', cle: `${t.id}|ami|${dernier}`, tacheId: t.id, projetId: t.projetId, titre: t.titre, texte: cree ? `${nomDe(noms, auteur)} a créé cette tâche` : `${nomDe(noms, auteur)} a modifié cette tâche`, date: iso });
    }
  }
  // Récap quotidien, à l'heure choisie (une fois par jour, pas plus de 12 h après).
  const jour = jourDe(maintenant);
  const heureRecap = instantDe(jour, prefs.heureRecap);
  if (prefs.actif && prefs.types.recap !== 'aucun' && maintenant >= heureRecap && maintenant - heureRecap <= 12 * 3_600_000) {
    const j = maJournee(d, jour, qui);
    const aujourdhui = j.aujourdhui.length + j.choisies.length;
    const morceaux = [j.retard.length ? `${j.retard.length} en retard` : '', aujourdhui ? `${aujourdhui} pour aujourd’hui` : '', j.aVenir.length ? `${j.aVenir.length} à venir cette semaine` : ''].filter(Boolean);
    r.push({ type: 'recap', cle: `recap|${jour}`, tacheId: '', titre: 'Ma journée', texte: morceaux.length ? `${morceaux.join(', ')}.` : 'Rien d’urgent aujourd’hui.', date: new Date(heureRecap).toISOString() });
  }
  // Invite du soir : noter ce qu'on a fait (si un projet peut recevoir ses entrées et qu'il n'a rien noté aujourd'hui).
  const heureJournal = instantDe(jour, prefs.heureJournal);
  if (prefs.actif && prefs.types.journal !== 'aucun' && maintenant >= heureJournal && maintenant - heureJournal <= 6 * 3_600_000) {
    const projets = Object.values(d.projets).filter(p => !p.supprime && (qui === 'fondateur' ? !p.auto : modeProjet(d, p.id) === 'ecriture'));
    const dejaNote = Object.values(d.journal ?? {}).some(e => !e.supprime && e.jour === jour && e.auteur === qui);
    if (projets.length && !dejaNote) r.push({ type: 'journal', cle: `journal|${jour}`, tacheId: '', titre: 'Journal du jour', texte: 'Note ce que tu as fait aujourd’hui (📓 dans le projet).', date: new Date(heureJournal).toISOString() });
  }
  return { evenements: r, autres };
}

const MAX_NON_LUS = 50;
const MAX_SYSTEME = 3;
const DUREE_MEMOIRE_MS = 40 * 86_400_000;

/**
 * Trie les événements selon les réglages : anti-répétition, global, type et
 * canal, sourdine, heures calmes, appareil choisi, regroupement.
 */
export function filtrerNotifications(evenements: readonly EvenementNotif[], etat: EtatRappels, maintenant: number, prefs: PrefsNotif, env: Pick<Environnement, 'appareilId'>): ResultatNotif {
  const vus = { ...etat.vus };
  const pastille: AlerteRappel[] = [];
  const systeme: NotifSysteme[] = [];
  const iso = new Date(maintenant).toISOString();
  for (const e of evenements) {
    if (vus[e.cle]) continue;
    vus[e.cle] = iso;
    if (!prefs.actif) continue;
    const canal = prefs.types[e.type];
    if (canal === 'aucun') continue;
    if (e.projetId && prefs.muets.includes(e.projetId)) continue;
    if (canal === 'les-deux' || canal === 'pastille') pastille.push({ cle: e.cle, tacheId: e.tacheId, titre: e.titre, texte: e.texte, date: e.date, type: e.type });
    if (canal === 'les-deux' || canal === 'systeme') systeme.push({ titre: e.type === 'recap' ? '☀︎ Ma journée' : e.type === 'journal' ? '📓 Journal du jour' : `Tâche : ${e.titre}`, corps: e.texte, ...(e.tacheId ? { tacheId: e.tacheId } : {}) });
  }
  const limite = new Date(maintenant - DUREE_MEMOIRE_MS).toISOString();
  for (const [c, date] of Object.entries(vus)) if (date < limite) delete vus[c];
  let sortie = systeme;
  let calmees = 0;
  if (enHeuresCalmes(prefs, maintenant) || (prefs.appareil && prefs.appareil.id !== env.appareilId)) {
    calmees = enHeuresCalmes(prefs, maintenant) ? systeme.length : 0;
    sortie = [];
  } else if (prefs.regrouper && systeme.length > 1) {
    sortie = [{ titre: `Tâches : ${systeme.length} notifications`, corps: systeme.map(s => (s.titre.startsWith('Tâche : ') ? `${s.titre.slice(8)} — ${s.corps}` : `${s.titre} — ${s.corps}`)).slice(0, 4).join('\n') + (systeme.length > 4 ? `\n… et ${systeme.length - 4} autre(s)` : '') }];
  } else sortie = systeme.slice(0, MAX_SYSTEME);
  return { etat: { ...etat, vus, nonLus: [...etat.nonLus, ...pastille].slice(-MAX_NON_LUS) }, pastille, systeme: sortie, calmees };
}

/**
 * Évaluation complète (le hub l'appelle toutes les 30 s) : événements depuis
 * la dernière fois, plus ceux venus d'ailleurs (`extra` : agent Claude Office
 * terminé), triés selon les réglages. La première évaluation d'un appareil ne
 * rattrape pas l'historique de l'autre (seulement à partir de maintenant).
 */
export function evaluerNotifications(d: DonneesTaches, etat: EtatRappels, maintenant: number, qui: Auteur, env: Environnement, extra: readonly EvenementNotif[] = []): ResultatNotif {
  const prefs = prefsDe(d, qui);
  const ev = evenementsTaches(d, maintenant, qui, { premiere: !etat.depuis, autres: etat.autres ?? {} }, prefs, env.noms);
  const r = filtrerNotifications([...ev.evenements, ...extra], etat, maintenant, prefs, env);
  return { ...r, etat: { ...r.etat, depuis: new Date(maintenant).toISOString(), autres: ev.autres } };
}

/** Nom lisible de l'appareil (« PC Windows », « iPad »…). */
export function nomAppareil(agent: string | undefined): string {
  const a = agent ?? '';
  if (/iPad/.test(a) || (/Macintosh/.test(a) && /Mobile/.test(a))) return 'iPad';
  if (/iPhone/.test(a)) return 'iPhone';
  if (/Android/.test(a)) return 'Android';
  if (/Electron/.test(a) || /AppDashboard/.test(a)) return 'PC (application)';
  if (/Windows/.test(a)) return 'PC Windows (site)';
  if (/Macintosh/.test(a)) return 'Mac';
  return 'Navigateur';
}
