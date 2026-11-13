/**
 * Logique pure des plans de match (testée sans écran) : tri et filtres de la liste, contenu vide et lignes par défaut
 * selon le modèle du jeu, veto type d'un format (BO1, BO3, BO5), contenu envoyé au serveur, « mon rôle » d'un joueur,
 * avancement de la checklist, document imprimable (Markdown).
 */

import { normaliser } from '../lineups/logique';
import type { Reference } from '../lineups/api';
import type { ModeleStrat } from '../strats/modeles';
import type { ActionVeto, CampVeto, CartePlan, ContenuPlan, EtapeVeto, FiltresPlans, FormatPlan, LigneCompo, Plan, ResumePlan, SaisieContenu, StratPlan, TypeRound } from './api';

/** Rôles proposés dans une composition (jargon commun au français et à l'anglais ; le champ reste libre). */
export const ROLES_SUGGERES: Record<'valorant' | 'thefinals' | 'generique', readonly string[]> = {
  valorant: ['IGL', 'Entry', 'Second entry', 'Lurk', 'Support', 'Anchor', 'Flex'],
  thefinals: ['IGL', 'Entry', 'Support', 'Anchor', 'Flank'],
  generique: ['IGL', 'Entry', 'Support', 'Flex'],
};
export const rolesSuggeres = (modele: ModeleStrat): readonly string[] => ROLES_SUGGERES[modele === 'valorant' || modele === 'thefinals' ? modele : 'generique'];

/** Joueurs d'une composition selon le jeu : 5 pour Valorant, 3 pour The Finals. */
export const tailleCompo = (modele: ModeleStrat): number => (modele === 'thefinals' ? 3 : 5);
/** Le veto (picks et bans, BO1 / BO3 / BO5) ne concerne pas The Finals (arènes et modes attendus). */
export const avecVeto = (modele: ModeleStrat): boolean => modele !== 'thefinals';

let compteur = 0;
/** Identifiant court d'un élément du contenu (clé d'affichage, case de la checklist). */
export function idCourt(): string {
  compteur = (compteur + 1) % 1_000_000;
  return `${Date.now().toString(36)}${compteur.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(-14);
}

export const ligneCompo = (champs: Partial<LigneCompo> = {}): LigneCompo => ({ id: idCourt(), membre: null, nom: '', personnage: null, role: '', arme: '', specialisation: '', gadgets: [], reserve: [], note: '', ...champs });

export const carteVide = (carte: Reference, modele: ModeleStrat, compo?: readonly LigneCompo[]): CartePlan<string> => ({
  id: idCourt(),
  carte,
  mode: '',
  // La composition de la map précédente est reprise (mêmes joueurs, personnages à ajuster).
  compo: compo?.length ? compo.map(l => ({ ...l, id: idCourt() })) : Array.from({ length: tailleCompo(modele) }, () => ligneCompo()),
  strats: [],
  lineups: [],
  conditions: '',
  tendances: '',
  calls: '',
  notes: '',
});

export const contenuVide = (): SaisieContenu => ({ veto: [], cartes: [], checklist: [], notes: '' });

/** Checklist d'avant-match proposée à la création (clés de texte : traduites par l'écran). */
export const CHECKLIST_DEFAUT = ['checklist.defaut.presents', 'checklist.defaut.echauffement', 'checklist.defaut.comms', 'checklist.defaut.compo', 'checklist.defaut.veto'] as const;

const etape = (action: ActionVeto, camp: CampVeto): EtapeVeto => ({ id: idCourt(), action, camp, carte: null, replis: [], note: '' });

/**
 * Veto type d'un format, sur un pool de 7 maps, en commençant par nous (chaque étape se bascule ensuite) :
 * BO1 : six bans alternés puis la map restante ; BO3 : ban, ban, pick, pick, ban, ban, decider ;
 * BO5 : ban, ban, puis quatre picks alternés, decider.
 */
export function vetoType(format: FormatPlan): EtapeVeto[] {
  const alterne = (actions: ActionVeto[]) => actions.map((a, i) => etape(a, a === 'decider' ? 'nous' : i % 2 === 0 ? 'nous' : 'eux'));
  if (format === 'bo1') return alterne(['ban', 'ban', 'ban', 'ban', 'ban', 'ban', 'decider']);
  if (format === 'bo3') return alterne(['ban', 'ban', 'pick', 'pick', 'ban', 'ban', 'decider']);
  if (format === 'bo5') return alterne(['ban', 'ban', 'pick', 'pick', 'pick', 'pick', 'decider']);
  return [];
}

/** Nombre de maps jouées au plus dans un format (0 : libre). */
export const mapsDuFormat = (format: FormatPlan): number => (format === 'bo1' ? 1 : format === 'bo3' ? 3 : format === 'bo5' ? 5 : 0);

// ------------------------------------------------------------------ Liste

/** Instant de référence d'un plan (début de l'événement, sinon son jour à midi) ; null sans date. */
export function instantPlan(p: Pick<ResumePlan, 'debut' | 'dateMatch'>): number | null {
  if (p.debut) {
    const t = Date.parse(p.debut);
    if (!Number.isNaN(t)) return t;
  }
  if (p.dateMatch) {
    const t = Date.parse(`${p.dateMatch}T12:00:00.000Z`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Un plan « à venir » : pas encore joué, et daté d'aujourd'hui ou plus tard (ou sans date). */
export function aVenir(p: ResumePlan, maintenant: number): boolean {
  if (p.statut === 'joue') return false;
  const t = instantPlan(p);
  return t === null || t >= maintenant - 12 * 3_600_000;
}

/** Ordre de la liste : à venir d'abord (le plus proche en tête, sans date à la fin), puis passés (le plus récent en tête). */
export function trierPlans(plans: readonly ResumePlan[], maintenant: number): ResumePlan[] {
  const cle = (p: ResumePlan) => {
    const t = instantPlan(p);
    return aVenir(p, maintenant) ? [0, t ?? Number.MAX_SAFE_INTEGER] : [1, -(t ?? 0)];
  };
  return [...plans].sort((a, b) => {
    const [ga, ta] = cle(a);
    const [gb, tb] = cle(b);
    return ga - gb || ta - tb || (a.majLe < b.majLe ? 1 : a.majLe > b.majLe ? -1 : 0);
  });
}

/** Clé d'un adversaire dans les filtres : son identifiant de fiche, sinon son nom (sans accents ni casse). */
export const cleAdversaire = (a: ResumePlan['adversaire']): string => (a ? (a.id ?? `nom:${normaliser(a.nom)}`) : '');

export function filtrerPlans(plans: readonly ResumePlan[], f: FiltresPlans = {}): ResumePlan[] {
  const carte = normaliser(f.carte);
  return plans.filter(p => {
    if (f.statut && p.statut !== f.statut) return false;
    if (f.adversaire && cleAdversaire(p.adversaire) !== f.adversaire) return false;
    if (carte && !p.cartes.some(c => normaliser(c) === carte)) return false;
    return true;
  });
}

export interface OptionFiltre {
  id: string;
  nom: string;
  n: number;
}
/** Adversaires et maps présents dans la liste (seules les valeurs qui servent sont proposées). */
export function facettesPlans(plans: readonly ResumePlan[]): { adversaires: OptionFiltre[]; cartes: OptionFiltre[] } {
  const compter = (valeurs: Array<{ id: string; nom: string }>): OptionFiltre[] => {
    const m = new Map<string, OptionFiltre>();
    for (const v of valeurs) {
      const o = m.get(v.id);
      if (o) o.n += 1;
      else m.set(v.id, { ...v, n: 1 });
    }
    return [...m.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  };
  return {
    adversaires: compter(plans.flatMap(p => (p.adversaire?.nom ? [{ id: cleAdversaire(p.adversaire), nom: p.adversaire.nom }] : []))),
    cartes: compter(plans.flatMap(p => [...new Set(p.cartes.map(c => normaliser(c)))].map(id => ({ id, nom: p.cartes.find(c => normaliser(c) === id) ?? id })))),
  };
}

// ------------------------------------------------------------------ Contenu

/** Contenu tel que le serveur l'attend : lineups par identifiant, sans les champs de lecture. */
export function versSaisie(contenu: ContenuPlan): SaisieContenu {
  return {
    veto: contenu.veto.map(v => ({ id: v.id, action: v.action, camp: v.camp, carte: v.carte, replis: v.replis, note: v.note })),
    cartes: contenu.cartes.map(c => ({
      id: c.id,
      carte: c.carte,
      mode: c.mode,
      compo: c.compo.map(l => ({ id: l.id, membre: l.membre, nom: l.nom, personnage: l.personnage, role: l.role, arme: l.arme, specialisation: l.specialisation, gadgets: l.gadgets, reserve: l.reserve, note: l.note })),
      strats: c.strats.map(s => ({ id: s.id, side: s.side, type: s.type, strat: s.strat, playbook: s.playbook, titre: s.titre, note: s.note })),
      lineups: c.lineups.map(l => l.id),
      conditions: c.conditions,
      tendances: c.tendances,
      calls: c.calls,
      notes: c.notes,
    })),
    checklist: contenu.checklist.map(e => ({ id: e.id, texte: e.texte })),
    notes: contenu.notes,
  };
}

/** Une ligne de composition est-elle renseignée (un joueur, un personnage ou un rôle) ? */
export const ligneRemplie = (l: LigneCompo): boolean => Boolean(l.membre || l.nom.trim() || l.personnage || l.role.trim() || l.arme.trim() || l.specialisation.trim() || l.gadgets.some(g => g.trim()));

/** Nom affiché d'une ligne : le pseudo du membre, sinon le nom libre. */
export const nomLigne = (l: LigneCompo, pseudos?: ReadonlyMap<string, string>): string => (l.membre ? (l.pseudo ?? pseudos?.get(l.membre) ?? l.nom) : l.nom) || '';

export interface MonRole {
  carteId: string;
  carte: string;
  personnage: string | null;
  role: string;
  arme: string;
  specialisation: string;
  gadgets: string[];
  note: string;
}
/** Ce que le lecteur joue, map par map (lignes de composition qui le désignent). */
export function monRole(plan: Pick<Plan, 'contenu'>): MonRole[] {
  return plan.contenu.cartes.flatMap(c =>
    c.compo
      .filter(l => l.moi)
      .map(l => ({ carteId: c.id, carte: c.carte.nom, personnage: l.personnage?.nom ?? null, role: l.role, arme: l.arme, specialisation: l.specialisation, gadgets: l.gadgets.filter(Boolean), note: l.note })),
  );
}

/** Avancement de la checklist : cases cochées parmi celles qui existent encore. */
export function avancementChecklist(contenu: Pick<ContenuPlan, 'checklist'>, coches: readonly string[]): { faits: number; total: number } {
  const ids = new Set(coches);
  return { faits: contenu.checklist.filter(e => ids.has(e.id)).length, total: contenu.checklist.length };
}

/** Strats d'une map regroupées par side (ordre d'apparition des sides, ordre du plan dans chaque side). */
export function stratsParSide(strats: readonly StratPlan[]): Array<{ side: string; strats: StratPlan[] }> {
  const groupes: Array<{ side: string; strats: StratPlan[] }> = [];
  for (const s of strats) {
    const g = groupes.find(x => x.side === s.side);
    if (g) g.strats.push(s);
    else groupes.push({ side: s.side, strats: [s] });
  }
  return groupes;
}

/** Déplace un élément d'une liste d'un cran (haut : -1, bas : +1) ; liste inchangée au bord. */
export function deplacer<T>(liste: readonly T[], index: number, sens: -1 | 1): T[] {
  const cible = index + sens;
  if (index < 0 || index >= liste.length || cible < 0 || cible >= liste.length) return [...liste];
  const copie = [...liste];
  [copie[index], copie[cible]] = [copie[cible], copie[index]];
  return copie;
}

// ------------------------------------------------------------------ Document imprimable

export interface TextesImpression {
  contre(nom: string): string;
  statut(s: Plan['statut']): string;
  format(f: FormatPlan): string;
  action(a: ActionVeto): string;
  camp(c: CampVeto): string;
  type(t: TypeRound): string;
  side(s: string): string;
  titres: { veto: string; compo: string; strats: string; lineups: string; conditions: string; tendances: string; calls: string; notes: string; checklist: string; replis: string; reserve: string; scouting: string };
}

const ligneMd = (texte: string): string => texte.replace(/\s*\n+\s*/g, ' ').trim();
const blocMd = (texte: string): string[] =>
  texte
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

/**
 * Plan en Markdown pour l'impression (boîte d'impression du navigateur : papier ou PDF). Le rendu échappe chaque
 * texte ; ce document ne quitte pas l'appareil.
 */
export function markdownPlan(plan: Plan, t: TextesImpression, dateTexte: string | null): string {
  const lignes: string[] = [`# ${ligneMd(plan.titre)}`, ''];
  const entete = [plan.adversaire?.nom ? t.contre(plan.adversaire.nom) : null, dateTexte, plan.format ? t.format(plan.format) : null, t.statut(plan.statut)].filter(Boolean);
  lignes.push(entete.join(' · '), '');
  if (plan.contenu.veto.length) {
    lignes.push(`## ${t.titres.veto}`, '');
    plan.contenu.veto.forEach((v, i) => {
      const replis = v.replis.length ? ` (${t.titres.replis} : ${v.replis.map(r => r.nom).join(', ')})` : '';
      lignes.push(`${i + 1}. ${t.camp(v.camp)} · ${t.action(v.action)}${v.carte ? ` **${ligneMd(v.carte.nom)}**` : ''}${replis}${v.note ? ` : ${ligneMd(v.note)}` : ''}`);
    });
    lignes.push('');
  }
  for (const c of plan.contenu.cartes) {
    lignes.push(`## ${ligneMd(c.carte.nom)}${c.mode ? ` (${t.side(c.mode)})` : ''}`, '');
    const compo = c.compo.filter(ligneRemplie);
    if (compo.length) {
      lignes.push(`### ${t.titres.compo}`, '');
      for (const l of compo) {
        const detail = [l.personnage?.nom, l.role, l.arme, l.specialisation, l.gadgets.filter(Boolean).join(', '), l.reserve.filter(Boolean).length ? `${t.titres.reserve} : ${l.reserve.filter(Boolean).join(', ')}` : ''].filter((x): x is string => Boolean(x)).map(ligneMd);
        lignes.push(`- **${ligneMd(nomLigne(l) || '?')}**${detail.length ? ` : ${detail.join(' · ')}` : ''}${l.note ? ` (${ligneMd(l.note)})` : ''}`);
      }
      lignes.push('');
    }
    if (c.strats.length) {
      lignes.push(`### ${t.titres.strats}`, '');
      for (const g of stratsParSide(c.strats)) {
        if (g.side) lignes.push(`**${t.side(g.side)}**`, '');
        g.strats.forEach((s, i) => lignes.push(`${i + 1}. ${t.type(s.type)} : ${ligneMd(s.titre)}${s.note ? ` (${ligneMd(s.note)})` : ''}`));
        lignes.push('');
      }
    }
    if (c.lineups.length) {
      lignes.push(`### ${t.titres.lineups}`, '');
      for (const l of c.lineups) lignes.push(`- ${ligneMd(l.titre)}${[l.personnage, l.capacite, l.zone].filter(Boolean).length ? ` (${[l.personnage, l.capacite, l.zone].filter(Boolean).join(', ')})` : ''}`);
      lignes.push('');
    }
    for (const [titre, texte] of [
      [t.titres.conditions, c.conditions],
      [t.titres.tendances, c.tendances],
      [t.titres.calls, c.calls],
      [t.titres.notes, c.notes],
    ] as const) {
      if (!texte.trim()) continue;
      lignes.push(`### ${titre}`, '', ...blocMd(texte).map(l => `- ${l}`), '');
    }
  }
  if (plan.contenu.checklist.length) {
    const coches = new Set(plan.coches);
    lignes.push(`## ${t.titres.checklist}`, '', ...plan.contenu.checklist.map(e => `- [${coches.has(e.id) ? 'x' : ' '}] ${ligneMd(e.texte)}`), '');
  }
  if (plan.contenu.notes.trim()) lignes.push(`## ${t.titres.notes}`, '', ...blocMd(plan.contenu.notes), '');
  return lignes.join('\n');
}
