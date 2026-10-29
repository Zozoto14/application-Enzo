/**
 * Visuels CM : champs dynamiques. Un texte de calque contient des champs « {adversaire} », « {score} »… que
 * l'on remplace par les DONNÉES du visuel (calculées par le serveur depuis le résumé publiable, en français
 * et en anglais). Un champ inconnu reste écrit tel quel (pour qu'on voie la faute de frappe). Une liste
 * (maps, classement, roster, programme, parcours) répète sa ligne pour chaque élément.
 *
 * Aucun HTML : le texte est dessiné tel quel dans le canevas (pas d'interprétation, pas d'injection).
 */

import { trViLangue } from '../../i18n/visuels';
import type { Calque, CalqueListe, DonneesLangue, DonneesVisuel, Langue, LigneListe, SourceListe } from './types';

/** Champs texte connus (ordre d'affichage dans l'éditeur). */
export const CHAMPS_TEXTE = [
  'team', 'adversaire', 'score', 'score_nous', 'score_eux', 'issue', 'tournoi', 'tour', 'date', 'heure', 'fuseau', 'date_heure', 'date_courte', 'jour',
  'bo', 'format', 'lieu', 'place', 'classement', 'points', 'participants', 'mvp', 'mvp_agent', 'joueur', 'poste', 'semaine', 'bilan', 'cashprize', 'gains',
  'organisateur', 'genre_match', 'titre', 'phrase', 'jeu', 'club', 'adversaires', 'victoire', 'elo', 'ancienne_structure', 'badges',
] as const;

/** Champs de chaque ligne d'une liste. */
export const CHAMPS_LISTES: Readonly<Record<SourceListe, readonly string[]>> = {
  manches: ['numero', 'carte', 'mode', 'score', 'issue', 'place', 'points'],
  classement: ['place', 'place_texte', 'equipe', 'points'],
  roster: ['pseudo', 'role'],
  programme: ['jour', 'date', 'heure', 'fuseau', 'team', 'adversaire', 'tournoi', 'tour'],
  parcours: ['tour', 'adversaire', 'score', 'issue'],
};

const MOTIF_CHAMP = /\{([a-z_0-9]{1,30})\}/g;

/** Remplace les champs connus de `valeurs` ; les autres restent tels quels. */
export function remplir(texte: string, valeurs: Record<string, string | boolean | undefined>): string {
  return texte.replace(MOTIF_CHAMP, (tout, nom: string) => {
    const v = valeurs[nom];
    return v === undefined || typeof v === 'boolean' ? tout : v;
  });
}

/** Champs utilisés par un texte (aide de l'éditeur). */
export const champsDe = (texte: string): string[] => [...new Set([...texte.matchAll(MOTIF_CHAMP)].map(m => m[1]))];

/** Le calque s'affiche-t-il avec ces données ? (`si` : serie, classement, champ:<nom>, « ! » pour l'inverse). */
export function conditionRemplie(si: string | null, d: DonneesVisuel, langue: Langue): boolean {
  if (!si) return true;
  const inverse = si.startsWith('!');
  const cond = inverse ? si.slice(1) : si;
  let ok: boolean;
  if (cond === 'serie' || cond === 'classement') ok = d.systeme === cond;
  else {
    const nom = cond.slice(6);
    const l = d[langue];
    ok = Boolean((l.champs[nom] ?? '').trim() || (l.listes[nom as SourceListe]?.length ?? 0) > 0 || d.images[nom as keyof DonneesVisuel['images']]);
  }
  return inverse ? !ok : ok;
}

/** Calques visibles d'un document pour ces données (masqués et conditions non remplies retirés). */
export const calquesVisibles = (calques: Calque[], d: DonneesVisuel, langue: Langue): Calque[] => calques.filter(c => !c.masque && conditionRemplie(c.si, d, langue));

/** Texte d'un calque texte dans une langue, champs remplis, majuscules appliquées. */
export function texteFinal(texte: { fr: string; en: string }, d: DonneesLangue, langue: Langue, majuscules = false): string {
  const t = remplir(texte[langue] || texte[langue === 'fr' ? 'en' : 'fr'] || '', d.champs);
  return majuscules ? t.toLocaleUpperCase(langue === 'fr' ? 'fr-FR' : 'en-GB') : t;
}

/** Lignes d'une liste (texte rempli, et indicateur « en avant » : notre équipe, manche gagnée). */
export function lignesListe(c: CalqueListe, d: DonneesLangue, langue: Langue): Array<{ texte: string; enAvant: boolean }> {
  const lignes: LigneListe[] = (d.listes[c.source] ?? []).slice(0, c.max);
  return lignes.map(l => {
    const valeurs: Record<string, string | boolean | undefined> = { ...d.champs, ...l };
    const t = remplir(c.ligne[langue] || c.ligne.fr, valeurs);
    return { texte: c.majuscules ? t.toLocaleUpperCase(langue === 'fr' ? 'fr-FR' : 'en-GB') : t, enAvant: l.nous === true || l.victoire === true };
  });
}

// ------------------------------------------------------------------ Données d'exemple (modèles sans source)

/** Données d'exemple (aperçu des modèles, éditeur sans source) : série Valorant BO3 ou classement à 4 équipes. */
export function donneesExemple(systeme: 'serie' | 'classement' = 'serie'): DonneesVisuel {
  const langue = (l: Langue): DonneesLangue => {
    const t = (cle: Parameters<typeof trViLangue>[1]) => trViLangue(l, cle);
    const serie = systeme === 'serie';
    return {
      champs: {
        club: t('exemple.club'),
        team: t('exemple.team'),
        adversaire: serie ? t('exemple.adversaire') : t('exemple.adversaires'),
        adversaires: serie ? t('exemple.adversaire') : t('exemple.adversaires'),
        score: serie ? '2-1' : '#1',
        score_nous: serie ? '2' : '',
        score_eux: serie ? '1' : '',
        issue: serie ? t('exemple.victoire') : '',
        victoire: serie ? '1' : '',
        tournoi: t('exemple.tournoi'),
        tour: t('exemple.tour'),
        date: t('exemple.date'),
        date_courte: t('exemple.date_courte'),
        jour: t('exemple.jour'),
        heure: '20:00',
        fuseau: 'CEST',
        date_heure: `${t('exemple.date')} · 20:00 CEST`,
        bo: serie ? 'BO3' : '',
        format: serie ? '5v5' : '3v3v3v3',
        lieu: t('exemple.lieu'),
        place: t('exemple.place'),
        classement: t('exemple.classement'),
        points: serie ? '' : '16',
        participants: serie ? '16' : '4',
        mvp: 'Kai',
        mvp_agent: 'Jett',
        joueur: 'Kai',
        poste: t('exemple.poste'),
        elo: '2450',
        ancienne_structure: t('exemple.team'),
        badges: t('exemple.badges'),
        semaine: t('exemple.semaine'),
        bilan: t('exemple.bilan'),
        cashprize: t('exemple.cashprize'),
        gains: t('exemple.gains'),
        organisateur: t('exemple.organisateur'),
        genre_match: t('exemple.genre_match'),
        titre: t('exemple.tournoi'),
        phrase: '',
        jeu: serie ? 'Valorant' : 'The Finals',
      },
      listes: {
        manches: serie
          ? [
              { numero: '1', carte: 'Ascent', mode: '', score: '13-9', issue: t('exemple.victoire'), place: '', points: '', victoire: true },
              { numero: '2', carte: 'Bind', mode: '', score: '7-13', issue: t('exemple.defaite'), place: '', points: '', victoire: false },
              { numero: '3', carte: 'Haven', mode: '', score: '14-12', issue: t('exemple.victoire'), place: '', points: '', victoire: true },
            ]
          : [
              { numero: '1', carte: 'Monaco', mode: 'Cashout', score: '', issue: '', place: t('exemple.place2'), points: '6', victoire: false },
              { numero: '2', carte: 'Seoul', mode: 'Cashout', score: '', issue: '', place: t('exemple.place'), points: '10', victoire: true },
            ],
        classement: serie
          ? []
          : [
              { place: '1', place_texte: t('exemple.place'), equipe: t('exemple.team'), points: '16', nous: true },
              { place: '2', place_texte: t('exemple.place2'), equipe: 'Orion', points: '11', nous: false },
              { place: '3', place_texte: t('exemple.place3'), equipe: 'Vega', points: '9', nous: false },
              { place: '4', place_texte: t('exemple.place4'), equipe: 'Lynx', points: '4', nous: false },
            ],
        roster: ['Kai', 'Vex', 'Nox', 'Mira', 'Ryu'].map((pseudo, i) => ({ pseudo, role: i < 5 ? t('exemple.titulaire') : t('exemple.remplacant') })),
        programme: [
          { jour: t('exemple.jour'), date: t('exemple.date_courte'), heure: '20:00', fuseau: 'CEST', team: t('exemple.team'), adversaire: t('exemple.adversaire'), tournoi: t('exemple.tournoi'), tour: t('exemple.tour') },
          { jour: t('exemple.jour2'), date: t('exemple.date_courte2'), heure: '18:30', fuseau: 'CEST', team: t('exemple.team2'), adversaire: 'Orion', tournoi: t('exemple.tournoi2'), tour: '' },
          { jour: t('exemple.jour3'), date: t('exemple.date_courte3'), heure: '21:00', fuseau: 'CEST', team: t('exemple.team'), adversaire: 'Vega', tournoi: t('exemple.tournoi'), tour: t('exemple.tour2') },
        ],
        parcours: [
          { tour: t('exemple.tour3'), adversaire: 'Lynx', score: '2-0', issue: t('exemple.victoire'), victoire: true },
          { tour: t('exemple.tour'), adversaire: t('exemple.adversaire'), score: '2-1', issue: t('exemple.victoire'), victoire: true },
          { tour: t('exemple.tour2'), adversaire: 'Orion', score: '1-2', issue: t('exemple.defaite'), victoire: false },
        ],
      },
    };
  };
  return { systeme, jeu: { cle: systeme === 'serie' ? 'valorant' : 'the-finals', base: systeme === 'serie' ? 'valorant' : null }, team: null, fr: langue('fr'), en: langue('en'), images: systeme === 'serie' ? { map_1: { asset: 'map:ascent' }, map_2: { asset: 'map:bind' }, map_3: { asset: 'map:haven' }, agent_mvp: { asset: 'agent:jett' } } : {}, empreinte: '' };
}
