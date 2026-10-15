/**
 * Rédaction de la page du jour : un texte naturel en français, écrit
 * localement par des modèles de phrases variés (aucune IA, aucun appel externe).
 *
 * Sections (seulement celles qui ont de la matière), chiffres clés et « fait
 * marquant ». Le choix des tournures est reproductible (`texte.ts`) : une même
 * journée redonne le même texte, deux jours voisins ne se ressemblent pas.
 *
 * Point d'extension IA : `RedacteurExterne` (`hub/journal/contrat.ts`) peut
 * remplacer l'intro, les sections et la clôture ; il est désactivé par défaut
 * et, s'il échoue, les modèles écrivent (`rediger` ne dépend jamais de lui).
 */

import type { EvenementJournal, RedacteurExterne, ResumeExterne, TexteExterne } from '../hub/journal/contrat';
import { COMPTEURS, rythmeDe, type CandidatMarquant, type ResumeJour, type Rythme } from './agregation';
import { jourLongMaj, jourSemaine } from './dates';
import type { ChiffreCle, FaitMarquant, SectionPage, TexteAuto } from './modele';
import { abreger, duree, eur, guill, liste, listeCourte, majuscule, pct, phrase, pluriel, tirer } from './texte';

const TYPES_OPERATION: Record<string, string> = { ACHAT: 'achat', VENTE: 'vente', DIVIDENDE: 'dividende', VERSEMENT: 'versement', RETRAIT: 'retrait', FRAIS: 'frais' };

const sansDoublon = (l: readonly string[]) => [...new Set(l.filter(Boolean))];
const nombreOu = (n: number | undefined, defaut = 0) => (typeof n === 'number' ? n : defaut);

// ------------------------------------------------------------------ Sections

function sectionTaches(r: ResumeJour): SectionPage | undefined {
  const terminees = r.evenements.filter(e => e.genre === 'tache-terminee');
  const creees = r.evenements.filter(e => e.genre === 'tache-creee');
  if (!terminees.length && !creees.length) return undefined;
  const g = (s: string) => `${r.jour}|taches|${s}`;
  const paragraphes: string[] = [];
  const titres = terminees.map(e => guill(abreger(e.titre, 70)));
  const projets = sansDoublon(terminees.map(e => e.groupe ?? ''));
  const dansProjet = projets.length === 1 ? ` dans ${guill(projets[0])}` : '';
  const n = terminees.length;
  if (n === 1) {
    paragraphes.push(
      tirer(
        [
          `J’ai bouclé ${titres[0]}${dansProjet}.`,
          `Côté tâches, ${titres[0]} est enfin derrière moi${dansProjet}.`,
          `Une tâche terminée aujourd’hui : ${titres[0]}${dansProjet}.`,
        ],
        g('1'),
      ),
    );
  } else if (n >= 2) {
    const l = listeCourte(titres, 4);
    paragraphes.push(
      tirer(
        [
          `${majuscule(pluriel(n, 'tâche'))} terminées${dansProjet} : ${l}.`,
          `J’ai coché ${pluriel(n, 'tâche')}${dansProjet} — ${l}.`,
          `La liste a bien avancé avec ${pluriel(n, 'tâche')} de bouclées${dansProjet} : ${l}.`,
        ],
        g('n'),
      ),
    );
  }
  const c = creees.length;
  if (c > 0) {
    const nouvelles = listeCourte(creees.map(e => guill(abreger(e.titre, 60))), 3);
    const ouverture = n === 0 ? tirer(['Pas de tâche bouclée, mais ', 'Rien de coché aujourd’hui, en revanche '], g('o')) : tirer(['En parallèle, ', 'Dans le même temps, '], g('p'));
    paragraphes.push(`${ouverture}${c === 1 ? 'une nouvelle tâche a rejoint' : `${c} nouvelles tâches ont rejoint`} la liste : ${nouvelles}.`);
  }
  return { id: 'taches', titre: 'Les tâches', famille: 'taches', paragraphes };
}

function sectionOffice(r: ResumeJour): SectionPage | undefined {
  const s = r.evenements.filter(e => e.genre === 'session-office');
  if (!s.length) return undefined;
  const g = (x: string) => `${r.jour}|office|${x}`;
  const minutes = s.reduce((t, e) => t + nombreOu(e.nombre), 0);
  const projets = sansDoublon(s.map(e => e.groupe ?? ''));
  const surProjets = projets.length ? ` sur ${listeCourte(projets.map(guill), 3)}` : '';
  const dureeTxt = minutes > 0 ? `, ${duree(minutes)} au total` : '';
  const paragraphes = [
    s.length === 1
      ? tirer(
          [
            `Une session de Claude s’est terminée${surProjets}${dureeTxt}.`,
            `Claude a mené une session à son terme${surProjets}${dureeTxt}.`,
            `J’ai laissé Claude travailler${surProjets} : une session terminée${dureeTxt}.`,
          ],
          g('1'),
        )
      : tirer(
          [
            `${s.length} sessions de Claude se sont terminées${surProjets}${dureeTxt}.`,
            `Claude a enchaîné ${s.length} sessions${surProjets}${dureeTxt}.`,
            `Côté Claude Office : ${s.length} sessions closes${surProjets}${dureeTxt}.`,
          ],
          g('n'),
        ),
  ];
  const faits = s.map(e => e.titre).filter(t => t && t.toLowerCase() !== 'session');
  if (faits.length) {
    const l = listeCourte(faits.slice(0, 4).map(t => guill(abreger(t, 90))), 3);
    paragraphes.push(
      s.length === 1
        ? tirer([`Elle a servi à : ${l}.`, `Au programme : ${l}.`, `La demande, en bref : ${l}.`], g('f1'))
        : tirer([`Elles ont servi à : ${l}.`, `Au programme : ${l}.`, `Ce qui a été demandé, en vrac : ${l}.`], g('f')),
    );
  }
  return { id: 'office', titre: 'Avec Claude', famille: 'office', paragraphes };
}

/** « ép. 4 », « ép. 4 à 6 », « ép. 4, 6 et 9 ». */
export function episodes(numeros: readonly number[]): string {
  const n = [...new Set(numeros)].sort((a, b) => a - b);
  if (n.length === 0) return '';
  if (n.length === 1) return `ép. ${n[0]}`;
  const continu = n.every((v, i) => i === 0 || v === n[i - 1] + 1);
  return continu ? `ép. ${n[0]} à ${n[n.length - 1]}` : `ép. ${liste(n.map(String))}`;
}

function sectionTsuzuku(r: ResumeJour): SectionPage | undefined {
  const vus = r.evenements.filter(e => e.genre === 'episode-vu');
  if (!vus.length) return undefined;
  const g = (x: string) => `${r.jour}|tsuzuku|${x}`;
  const groupes = new Map<string, EvenementJournal[]>();
  for (const e of vus) groupes.set(e.groupe ?? e.titre, [...(groupes.get(e.groupe ?? e.titre) ?? []), e]);
  const morceaux = [...groupes].map(([titre, evts]) => {
    const films = evts.filter(e => e.nombre === undefined);
    const num = evts.flatMap(e => (typeof e.nombre === 'number' ? [e.nombre] : []));
    if (!num.length && films.length) return guill(titre);
    return `${guill(titre)} (${episodes(num)})`;
  });
  const total = vus.length;
  const paragraphes = [
    groupes.size === 1 && total >= 3
      ? tirer(
          [`Soirée marathon : ${morceaux[0]}, ${total} d’affilée.`, `Je me suis laissé embarquer par ${morceaux[0]} — ${pluriel(total, 'épisode')} dans la journée.`, `${morceaux[0]} : ${pluriel(total, 'épisode')} avalés dans la journée.`],
          g('m'),
        )
      : tirer(
          [`Côté détente, j’ai regardé ${liste(morceaux)}.`, `Pour me détendre : ${liste(morceaux)}.`, `Pause sur Tsuzuku avec ${liste(morceaux)}.`],
          g('d'),
        ),
  ];
  return { id: 'tsuzuku', titre: 'Détente', famille: 'tsuzuku', paragraphes };
}

function libelleOperation(e: EvenementJournal): string {
  const type = TYPES_OPERATION[e.groupe ?? ''] ?? 'opération';
  const quantite = typeof e.nombre === 'number' && (e.groupe === 'ACHAT' || e.groupe === 'VENTE') ? `${String(e.nombre).replace('.', ',')} × ` : '';
  const montant = typeof e.montant === 'number' ? ` (${eur(e.montant)})` : '';
  return `${type} ${quantite}${e.titre}${montant}`;
}

function sectionPortefeuille(r: ResumeJour): SectionPage | undefined {
  const ops = r.evenements.filter(e => e.genre === 'operation-bourse');
  const variation = r.evenements.find(e => e.genre === 'variation-portefeuille');
  if (!ops.length && !variation) return undefined;
  const g = (x: string) => `${r.jour}|bourse|${x}`;
  const paragraphes: string[] = [];
  if (ops.length) {
    const l = listeCourte(ops.map(libelleOperation), 4);
    paragraphes.push(
      ops.length === 1
        ? tirer([`Une opération au journal : ${l}.`, `Au carnet d’ordres du jour : ${l}.`, `J’ai enregistré une opération — ${l}.`], g('1'))
        : tirer([`${ops.length} opérations enregistrées : ${l}.`, `Du mouvement sur le portefeuille : ${l}.`, `Au journal des opérations : ${l}.`], g('n')),
    );
  }
  if (variation && typeof variation.pourcentage === 'number') {
    const p = variation.pourcentage;
    const montant = typeof variation.montant === 'number' ? ` (${eur(variation.montant, true)})` : '';
    if (Math.abs(p) < 0.1) {
      paragraphes.push(tirer([`Le portefeuille n’a presque pas bougé (${pct(p)})${montant}.`, `Séance sans relief pour le portefeuille : ${pct(p)}${montant}.`], g('v0')));
    } else if (p > 0) {
      paragraphes.push(
        p >= 2
          ? tirer([`Belle séance : le portefeuille gagne ${pct(p, false)}${montant}.`, `Le portefeuille s’envole de ${pct(p, false)}${montant}.`], g('v++'))
          : tirer([`Le portefeuille progresse de ${pct(p, false)}${montant}.`, `Petite hausse pour le portefeuille : ${pct(p)}${montant}.`], g('v+')),
      );
    } else {
      paragraphes.push(
        p <= -2
          ? tirer([`Séance difficile : le portefeuille cède ${pct(Math.abs(p), false)}${montant}.`, `Coup de froid sur le portefeuille : ${pct(p)}${montant}.`], g('v--'))
          : tirer([`Le portefeuille recule de ${pct(Math.abs(p), false)}${montant}.`, `Léger repli du portefeuille : ${pct(p)}${montant}.`], g('v-')),
      );
    }
  }
  return { id: 'portefeuille', titre: 'Côté bourse', famille: 'portefeuille', paragraphes };
}

function sectionAffaires(r: ResumeJour): SectionPage | undefined {
  const paiements = r.evenements.filter(e => e.genre === 'paiement-abonnement');
  const relances = r.evenements.filter(e => e.genre === 'relance-prospect');
  if (!paiements.length && !relances.length) return undefined;
  const g = (x: string) => `${r.jour}|affaires|${x}`;
  const paragraphes: string[] = [];
  if (paiements.length) {
    const total = paiements.reduce((t, e) => t + nombreOu(e.montant), 0);
    const noms = listeCourte(paiements.map(e => e.titre), 4);
    const somme = total > 0 ? `, ${eur(total)} au total` : '';
    const somme1 = total > 0 ? ` (${eur(total)})` : '';
    paragraphes.push(
      paiements.length === 1
        ? tirer([`Un abonnement réglé : ${noms}${somme1}.`, `${noms} a payé son abonnement${somme1}.`], g('p1'))
        : tirer([`${paiements.length} abonnements réglés (${noms})${somme}.`, `Les paiements sont tombés : ${noms}${somme}.`], g('pn')),
    );
  }
  if (relances.length) {
    const noms = listeCourte(relances.map(e => e.titre), 4);
    paragraphes.push(
      relances.length === 1
        ? tirer([`Une relance de prospect faite aujourd’hui : ${noms}.`, `J’ai relancé ${noms}.`], g('r1'))
        : tirer([`${relances.length} prospects relancés : ${noms}.`, `Journée de relances : ${noms}.`], g('rn')),
    );
  }
  return { id: 'affaires', titre: 'Côté affaires', famille: paiements.length ? 'abonnements' : 'prospects', paragraphes };
}

function sectionDecisions(r: ResumeJour): SectionPage | undefined {
  const d = r.evenements.filter(e => e.genre === 'decision');
  if (!d.length) return undefined;
  const g = (x: string) => `${r.jour}|decisions|${x}`;
  const l = listeCourte(d.map(e => guill(abreger(e.titre, 100))), 3);
  return {
    id: 'decisions',
    titre: 'Décisions',
    famille: 'decisions',
    paragraphes: [d.length === 1 ? tirer([`J’ai tranché : ${l}.`, `Une décision prise et notée : ${l}.`], g('1')) : tirer([`${d.length} décisions enregistrées : ${l}.`, `J’ai pris ${d.length} décisions : ${l}.`], g('n'))],
  };
}

function sectionAutres(r: ResumeJour): SectionPage | undefined {
  const a = r.evenements.filter(e => e.genre === 'autre' || (e.famille === 'autre' && !['meteo'].includes(e.genre)));
  if (!a.length) return undefined;
  return { id: 'autres', titre: 'Autres traces', famille: 'autre', paragraphes: [`${listeCourte(a.map(e => phrase(abreger(e.titre, 100)).replace(/\.$/, '')), 5)}.`] };
}

// ------------------------------------------------------------------ Chiffres, fait marquant, intro

function chiffres(r: ResumeJour): ChiffreCle[] {
  const c = r.compteurs;
  const sortie: ChiffreCle[] = [];
  const ajouter = (id: string, libelle: string, valeur: string) => sortie.push({ id, libelle, valeur });
  if (c[COMPTEURS.tachesTerminees]) ajouter('taches-finies', 'Tâches terminées', String(c[COMPTEURS.tachesTerminees]));
  if (c[COMPTEURS.tachesCreees]) ajouter('taches-creees', 'Tâches créées', String(c[COMPTEURS.tachesCreees]));
  if (c[COMPTEURS.sessions]) ajouter('sessions', 'Sessions Claude', c[COMPTEURS.minutesOffice] ? `${c[COMPTEURS.sessions]} · ${duree(c[COMPTEURS.minutesOffice])}` : String(c[COMPTEURS.sessions]));
  if (c[COMPTEURS.episodes]) ajouter('episodes', 'Épisodes vus', String(c[COMPTEURS.episodes]));
  if (c[COMPTEURS.operations]) ajouter('operations', 'Opérations en bourse', String(c[COMPTEURS.operations]));
  if (COMPTEURS.variation in c) ajouter('variation', 'Portefeuille', pct(c[COMPTEURS.variation]));
  if (c[COMPTEURS.paiements]) ajouter('paiements', 'Abonnements encaissés', c[COMPTEURS.encaisse] ? eur(c[COMPTEURS.encaisse]) : String(c[COMPTEURS.paiements]));
  if (c[COMPTEURS.relances]) ajouter('relances', 'Prospects relancés', String(c[COMPTEURS.relances]));
  if (c[COMPTEURS.decisions]) ajouter('decisions', 'Décisions', String(c[COMPTEURS.decisions]));
  return sortie;
}

function texteMarquant(m: CandidatMarquant, jour: string): FaitMarquant {
  const g = `${jour}|marquant`;
  let texte = '';
  const e = m.evenement;
  if (m.type === 'taches') {
    texte = tirer([`${m.n} tâches terminées en une journée : le rythme était là.`, `Un vrai coup d’accélérateur : ${m.n} tâches bouclées.`, `${m.n} tâches rayées de la liste — la journée a été productive.`], g);
  } else if (m.type === 'marathon') {
    texte = tirer([`Un marathon : ${m.n} épisodes de ${guill(m.groupe ?? '')} dans la journée.`, `${guill(m.groupe ?? '')} m’a retenu pour ${m.n} épisodes.`], g);
  } else if (e) {
    switch (e.genre) {
      case 'variation-portefeuille': {
        const p = nombreOu(e.pourcentage);
        texte = p >= 0 ? tirer([`Le portefeuille a gagné ${pct(p, false)} : la meilleure nouvelle du jour.`, `Une séance en vert : ${pct(p)} pour le portefeuille.`], g) : tirer([`Le portefeuille a reculé de ${pct(Math.abs(p), false)} : la séance à retenir.`, `Journée en rouge pour la bourse : ${pct(p)}.`], g);
        break;
      }
      case 'operation-bourse':
        texte = tirer([`Le geste du jour en bourse : ${libelleOperation(e)}.`, `À retenir côté bourse : ${libelleOperation(e)}.`], g);
        break;
      case 'decision':
        texte = tirer([`La décision du jour : ${guill(abreger(e.titre, 120))}.`, `Ce qui compte aujourd’hui, c’est la décision ${guill(abreger(e.titre, 120))}.`], g);
        break;
      case 'paiement-abonnement':
        texte = tirer([`${e.titre} a réglé son abonnement${typeof e.montant === 'number' ? ` (${eur(e.montant)})` : ''}.`, `Un paiement d’abonnement est arrivé : ${e.titre}${typeof e.montant === 'number' ? `, ${eur(e.montant)}` : ''}.`], g);
        break;
      case 'session-office':
        texte = tirer([`La plus longue session de Claude${e.groupe ? ` sur ${guill(e.groupe)}` : ''} a duré ${duree(nombreOu(e.nombre))}.`, `Claude a travaillé ${duree(nombreOu(e.nombre))} d’affilée${e.groupe ? ` sur ${guill(e.groupe)}` : ''}.`], g);
        break;
      case 'tache-terminee':
        texte = tirer([`${majuscule(guill(abreger(e.titre, 100)))} est terminée.`, `La tâche ${guill(abreger(e.titre, 100))} est enfin bouclée.`], g);
        break;
      case 'episode-vu':
        texte = tirer([`Un épisode de ${guill(e.groupe ?? e.titre)} pour finir la journée en douceur.`, `Pause bien méritée avec ${guill(e.groupe ?? e.titre)}.`], g);
        break;
      case 'relance-prospect':
        texte = `J’ai relancé ${e.titre}.`;
        break;
      default:
        texte = phrase(majuscule(abreger(e.titre, 140)));
    }
  }
  return { texte: phrase(texte), famille: m.famille };
}

const ACCROCHES: Record<Rythme, readonly string[]> = {
  calme: ['Une journée tranquille', 'Une page légère', 'Un jour sans bruit'],
  normal: ['Une journée bien tenue', 'Une journée régulière', 'Un jour dans le rythme'],
  dense: ['Une journée bien remplie', 'Une journée à plein régime', 'Un jour qui n’a pas chômé'],
};

function intro(r: ResumeJour, rythme: Rythme, meteo: EvenementJournal | undefined): string {
  const g = `${r.jour}|intro`;
  const n = r.evenements.filter(e => e.genre !== 'meteo').length;
  const jourSem = jourSemaine(r.jour);
  const finDeSemaine = jourSem >= 6;
  const ouverture = jourLongMaj(r.jour);
  let corps: string;
  if (rythme === 'calme' && n === 0) {
    corps = tirer(
      [
        'Aucune trace d’activité dans les apps aujourd’hui : une journée de pause, ou passée loin de l’écran.',
        'Rien à signaler dans les apps : la journée s’est déroulée ailleurs.',
        'Les apps sont restées silencieuses aujourd’hui — c’est aussi ça, une bonne journée.',
      ],
      g,
    );
  } else if (rythme === 'calme') {
    corps = tirer(
      [
        `Une journée ${finDeSemaine ? 'de week-end ' : ''}calme, avec ${pluriel(n, 'trace')} dans les apps.`,
        `Peu de mouvement aujourd’hui : ${pluriel(n, 'événement')} à noter.`,
        `${finDeSemaine ? 'Un week-end paisible' : 'Une journée discrète'} — ${pluriel(n, 'fait')} à retenir.`,
        `Un rythme doux aujourd’hui : ${pluriel(n, 'trace')} seulement dans les apps.`,
      ],
      g,
    );
  } else if (rythme === 'dense') {
    corps = tirer(
      [
        `Une journée chargée : ${n} événements ont laissé leur trace dans les apps.`,
        `Ça n’a pas arrêté — ${n} faits à raconter.`,
        `Les apps ont tourné à plein : ${n} événements à consigner.`,
        `${finDeSemaine ? 'Même un week-end, ' : ''}la journée a été pleine : ${n} événements au compteur.`,
      ],
      g,
    );
  } else {
    corps = tirer(
      [
        `Une journée ${finDeSemaine ? 'de week-end ' : ''}bien tenue, avec ${pluriel(n, 'événement')} dans les apps.`,
        `Voici ce que les apps ont retenu de ${finDeSemaine ? 'ce week-end' : 'la journée'} : ${pluriel(n, 'fait')}.`,
        `${pluriel(n, 'événement')} aujourd’hui, de quoi faire un bon récit.`,
        `Rien d’extravagant, mais ${pluriel(n, 'fait')} méritent d’être gardés.`,
      ],
      g,
    );
  }
  const temps = meteo ? ` ${tirer([`Météo du jour : ${meteo.titre}.`, `Côté ciel : ${meteo.titre}.`, `Dehors, ${meteo.titre.charAt(0).toLowerCase()}${meteo.titre.slice(1)}.`], `${g}|meteo`)}` : '';
  return `${ouverture}. ${majuscule(corps)}${temps}`;
}

function cloture(r: ResumeJour, rythme: Rythme): string {
  const g = `${r.jour}|cloture`;
  const base: Record<Rythme, readonly string[]> = {
    calme: ['Demain est une autre page.', 'Une page courte, et c’est très bien ainsi.', 'On referme doucement le carnet pour aujourd’hui.'],
    normal: ['Bonne soirée : la journée est consignée.', 'Journée consignée, on repart demain.', 'Le carnet est à jour, la suite attendra demain.'],
    dense: ['Quelle journée ! Place au repos.', 'Beaucoup de choses faites : le carnet peut se refermer.', 'Une page bien remplie — bonne nuit.'],
  };
  return `${tirer(base[rythme], g)} ${tirer(['Ajoute ta note pour garder la couleur de ta journée.', 'Un mot de ta part donnera sa couleur à cette page.', 'Tu peux ajouter ta note et ton humeur ci-dessous.'], `${g}|note`)}`;
}

// ------------------------------------------------------------------ Page

export interface OptionsRedaction {
  /** Vrai : la page a été demandée alors que la journée n'est pas finie. */
  enCours?: boolean;
}

/** Rédige la page d'un jour avec les modèles de phrases. */
export function rediger(r: ResumeJour, options: OptionsRedaction = {}): TexteAuto {
  const rythme = rythmeDe(r);
  const meteo = r.evenements.find(e => e.genre === 'meteo');
  const sections = [sectionTaches(r), sectionOffice(r), sectionTsuzuku(r), sectionPortefeuille(r), sectionAffaires(r), sectionDecisions(r), sectionAutres(r)].filter((s): s is SectionPage => Boolean(s));
  const finale = cloture(r, rythme);
  return {
    accroche: tirer(ACCROCHES[rythme], `${r.jour}|accroche`),
    intro: intro(r, rythme, meteo),
    sections,
    chiffres: chiffres(r),
    ...(r.marquant ? { marquant: texteMarquant(r.marquant, r.jour) } : {}),
    cloture: options.enCours ? `${finale} (Page écrite avant la fin de la journée : elle peut être réécrite plus tard.)` : finale,
    moteur: 'modeles',
  };
}

// ------------------------------------------------------------------ Rédacteur externe (point d'extension)

export const DELAI_REDACTEUR_MS = 20_000;

/** Ce qu'un rédacteur externe reçoit : des faits, sans montant ni identifiant. */
export function resumePourRedacteur(r: ResumeJour): ResumeExterne {
  return {
    jour: r.jour,
    evenements: r.evenements.map(e => ({ famille: e.famille, genre: e.genre, ...(e.heure ? { heure: e.heure } : {}), titre: e.titre, ...(e.groupe ? { groupe: e.groupe } : {}), ...(e.nombre !== undefined ? { nombre: e.nombre } : {}), ...(e.pourcentage !== undefined ? { pourcentage: e.pourcentage } : {}) })),
  };
}

/**
 * Texte d'un rédacteur externe, fusionné avec ce que les modèles ont calculé
 * (chiffres clés, fait marquant). `undefined` : rédacteur absent, en échec,
 * trop lent ou réponse invalide — l'appelant garde alors le texte des modèles.
 */
export async function redigerAvecExterne(r: ResumeJour, base: TexteAuto, redacteur: RedacteurExterne | undefined, delai = DELAI_REDACTEUR_MS): Promise<TexteAuto | undefined> {
  if (!redacteur) return undefined;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    const reponse = await Promise.race<TexteExterne | undefined>([
      redacteur.rediger(resumePourRedacteur(r)),
      new Promise<undefined>(ok => {
        minuterie = setTimeout(() => ok(undefined), delai);
      }),
    ]);
    if (!reponse || typeof reponse.intro !== 'string' || !reponse.intro.trim() || !Array.isArray(reponse.sections)) return undefined;
    const sections: SectionPage[] = reponse.sections.slice(0, 12).flatMap(s =>
      s && typeof s.titre === 'string' && Array.isArray(s.paragraphes) ? [{ id: String(s.id ?? '').slice(0, 40), titre: s.titre.slice(0, 120), paragraphes: (s.paragraphes as readonly unknown[]).filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(p => p.slice(0, 4000)).slice(0, 12) }] : [],
    );
    return { ...base, intro: `${jourLongMaj(r.jour)}. ${reponse.intro.slice(0, 4000)}`, sections, cloture: typeof reponse.cloture === 'string' && reponse.cloture.trim() ? reponse.cloture.slice(0, 4000) : base.cloture, moteur: 'ia' };
  } catch {
    return undefined;
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}
