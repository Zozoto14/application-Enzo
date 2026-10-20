/**
 * Faux serveur de la review et du scouting pour les tests de l'écran (jest) :
 * répond à `client.requete(chemin, méthode, corps)` comme l'API, avec un état
 * en mémoire. Les droits suivent la liste de permissions donnée.
 */

import { SANS_REACTION, type AdversaireListe, type DetailAdversaire, type DetailReview, type DroitsReview, type Reactions, type Repere, type ReviewListee, type ValeurReaction } from './api';

const ID_VIDEO = 'dQw4w9WgXcQ';

export interface AppelReview {
  chemin: string;
  methode: string;
  corps?: unknown;
}

export function droitsReviewDe(permissions: readonly string[]): DroitsReview {
  const a = (p: string) => permissions.includes(p);
  return { creer: a('video_review.create'), annoter: a('video_review.annotate'), supprimer: a('video_review.delete'), reagir: a('video_review.react') };
}

const MEMBRES = [
  { compte: 'lea12345', pseudo: 'Léa' },
  { compte: 'kai12345', pseudo: 'Kai' },
  { compte: 'coach123', pseudo: 'Coach Zed' },
];

export function repereDe(champs: Partial<Repere> & { id: string }): Repere {
  return {
    debut: 83,
    fin: null,
    categorie: 'erreur',
    titre: 'Peek trop large',
    note: 'Il fallait **trader**.',
    cible: { compte: 'lea12345', pseudo: 'Léa' },
    auteur: { compte: 'coach123', pseudo: 'Coach Zed' },
    creeLe: '2026-10-20T10:00:00.000Z',
    majLe: '2026-10-20T10:00:00.000Z',
    peutModifier: true,
    peutSupprimer: true,
    dessin: null,
    reactions: SANS_REACTION,
    commentaires: [],
    ...champs,
  };
}

export function fauxReviewScouting(permissions: readonly string[], { reperes: reperesInitiaux }: { reperes?: Repere[] } = {}) {
  const appels: AppelReview[] = [];
  const droits = droitsReviewDe(permissions);
  const reperes: Repere[] = reperesInitiaux ?? [
    repereDe({ id: 'r1', debut: 83, titre: 'Peek trop large', categorie: 'erreur', commentaires: [{ id: 'k1', texte: 'Compris', auteur: { compte: 'lea12345', pseudo: 'Léa' }, creeLe: '2026-10-20T11:00:00.000Z', peutSupprimer: droits.supprimer }] }),
    repereDe({ id: 'r2', debut: 3725, fin: 3745, titre: 'Clutch 1v3', categorie: 'bonne_action', note: '', cible: { compte: 'kai12345', pseudo: 'Kai' }, auteur: { compte: 'kai12345', pseudo: 'Kai' } }),
    repereDe({ id: 'r3', debut: 200, titre: 'Fumée trop tôt', categorie: 'utilitaires', cible: null }),
  ];
  const reviews: ReviewListee[] = [
    { id: 'rv1', titre: 'Faucons vs Nova', url: `https://www.youtube.com/watch?v=${ID_VIDEO}`, videoId: ID_VIDEO, reference: 'Match J4', creePar: { compte: 'coach123', pseudo: 'Coach Zed' }, creeLe: '2026-10-20T09:00:00.000Z', majLe: '2026-10-20T09:00:00.000Z', reperes: reperes.length },
  ];
  const adversaires: Array<AdversaireListe & { detail: DetailAdversaire }> = [];
  const gerer = permissions.includes('scouting.manage');
  const droitsScouting = { gerer, creerReview: permissions.includes('video_review.create'), voirReview: permissions.includes('video_review.view') };
  let n = 0;

  const requete = async <T>(chemin: string, methode = 'GET', corps?: unknown): Promise<T> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    const b = (corps ?? {}) as Record<string, unknown>;
    let r: unknown = { ok: true };
    let m: RegExpExecArray | null;
    // ---- Review (les routes du scouting, dont « …/vods/:x/review », sont traitées plus bas : on les écarte d'abord)
    if (/\/review$/.test(c) && methode === 'GET' && !/\/scouting\//.test(c)) r = { reviews, droits };
    else if (/\/review$/.test(c) && methode === 'POST' && !/\/scouting\//.test(c)) {
      const nouvelle: ReviewListee = { id: `rv${reviews.length + 1}`, titre: String(b.titre), url: String(b.url), videoId: ID_VIDEO, reference: String(b.reference ?? ''), creePar: { compte: 'coach123', pseudo: 'Coach Zed' }, creeLe: '2026-10-20T12:00:00.000Z', majLe: '', reperes: 0 };
      reviews.push(nouvelle);
      r = { ...nouvelle, depart: null };
    } else if ((m = /\/review\/([^/]+)\/export\.md$/.exec(c))) r = { nom: 'Review - Faucons vs Nova.md', type: 'text/markdown; charset=utf-8', contenu: '# Faucons vs Nova\n\n### [01:23] Peek trop large\n' };
    else if ((m = /\/review\/([^/]+)\/reperes\/([^/]+)(?:\/commentaires\/([^/]+))?\/reaction$/.exec(c))) {
      // Réaction de « Léa » (le compte de l'écran) : une par cible, changée ou retirée.
      const rep = reperes.find(x => x.id === m![2])!;
      const valeur = (b.valeur ?? null) as ValeurReaction | null;
      const maj = (avant: Reactions = SANS_REACTION): Reactions => {
        const sans = { like: avant.qui.like.filter(p => p.compte !== 'lea12345'), dislike: avant.qui.dislike.filter(p => p.compte !== 'lea12345') };
        if (valeur) sans[valeur] = [...sans[valeur], { compte: 'lea12345', pseudo: 'Léa' }];
        return { like: sans.like.length, dislike: sans.dislike.length, moi: valeur, qui: sans };
      };
      if (m[3]) rep.commentaires = rep.commentaires.map(k => (k.id === m![3] ? { ...k, reactions: maj(k.reactions) } : k));
      else rep.reactions = maj(rep.reactions);
      r = { ...rep };
    } else if ((m = /\/review\/([^/]+)\/reperes\/([^/]+)\/commentaires\/([^/]+)$/.exec(c)) && methode === 'DELETE') {
      const rep = reperes.find(x => x.id === m![2])!;
      rep.commentaires = rep.commentaires.filter(k => k.id !== m![3]);
      r = rep;
    } else if ((m = /\/review\/([^/]+)\/reperes\/([^/]+)\/commentaires$/.exec(c))) {
      const rep = reperes.find(x => x.id === m![2])!;
      rep.commentaires = [...rep.commentaires, { id: `kn${++n}`, texte: String(b.texte), auteur: { compte: 'lea12345', pseudo: 'Léa' }, creeLe: '2026-10-20T12:00:00.000Z', peutSupprimer: true }];
      r = rep;
    } else if ((m = /\/review\/([^/]+)\/reperes\/([^/]+)$/.exec(c))) {
      const i = reperes.findIndex(x => x.id === m![2]);
      if (methode === 'DELETE') reperes.splice(i, 1);
      else Object.assign(reperes[i], { ...b, fin: b.duree ? Number(b.debut) + Number(b.duree) : null, cible: b.cible ? { compte: String(b.cible), pseudo: MEMBRES.find(x => x.compte === b.cible)?.pseudo ?? '?' } : null });
      r = methode === 'DELETE' ? { ok: true } : reperes[i];
    } else if ((m = /\/review\/([^/]+)\/reperes$/.exec(c))) {
      const nouveau = repereDe({
        id: `r${10 + reperes.length}`,
        debut: Number(b.debut),
        fin: b.duree ? Number(b.debut) + Number(b.duree) : null,
        categorie: b.categorie as Repere['categorie'],
        titre: String(b.titre),
        note: String(b.note ?? ''),
        cible: b.cible ? { compte: String(b.cible), pseudo: MEMBRES.find(x => x.compte === b.cible)?.pseudo ?? '?' } : null,
        auteur: { compte: 'lea12345', pseudo: 'Léa' },
      });
      reperes.push(nouveau);
      reperes.sort((x, y) => x.debut - y.debut);
      r = nouveau;
    } else if ((m = /\/review\/([^/]+)$/.exec(c)) && methode === 'GET') {
      const rv = reviews.find(x => x.id === m![1])!;
      const review = { id: rv.id, titre: rv.titre, url: rv.url, videoId: rv.videoId, reference: rv.reference, creePar: rv.creePar, creeLe: rv.creeLe, majLe: rv.majLe };
      r = { review, reperes: [...reperes], membres: MEMBRES, droits, moi: 'lea12345', equipe: 'Faucons' } satisfies DetailReview;
    } else if ((m = /\/review\/([^/]+)$/.exec(c)) && methode === 'DELETE') r = { ok: true };
    // ---- Scouting
    else if (/\/scouting\/adversaires$/.test(c) && methode === 'GET') r = { adversaires: adversaires.map(a => ({ id: a.id, nom: a.nom, logoUrl: a.logoUrl, notes: a.notes, creeLe: a.creeLe, majLe: a.majLe, joueurs: a.joueurs, vods: a.vods, confrontations: a.confrontations, derniere: a.derniere })), droits: { gerer } };
    else if (/\/scouting\/adversaires$/.test(c) && methode === 'POST') {
      const id = `a${adversaires.length + 1}`;
      const fiche = { id, nom: String(b.nom), logoUrl: (b.logoUrl as string | null) ?? null, notes: String(b.notes ?? ''), creeLe: '', majLe: '' };
      adversaires.push({ ...fiche, joueurs: 0, vods: 0, confrontations: 0, derniere: null, detail: { adversaire: fiche, joueurs: [], tendances: [], vods: [], confrontations: [], droits: droitsScouting } });
      r = fiche;
    } else if ((m = /\/scouting\/adversaires\/([^/]+)\/vods\/([^/]+)\/review$/.exec(c))) {
      const a = adversaires.find(x => x.id === m![1])!;
      const vod = a.detail.vods.find(v => v.id === m![2])!;
      vod.reviewId = 'rv1';
      r = { reviewId: 'rv1', cree: true };
    } else if ((m = /\/scouting\/adversaires\/([^/]+)\/(joueurs|tendances|vods)(?:\/([^/]+))?$/.exec(c))) {
      const a = adversaires.find(x => x.id === m![1])!;
      const liste = a.detail[m[2] as 'joueurs' | 'tendances' | 'vods'] as Array<{ id: string }>;
      if (methode === 'DELETE') liste.splice(liste.findIndex(x => x.id === m![3]), 1);
      else if (methode === 'POST') {
        const id = `x${++n}`;
        if (m[2] === 'joueurs') a.detail.joueurs.push({ id, pseudo: String(b.pseudo), riotId: String(b.riotId ?? ''), role: String(b.role ?? ''), agents: (b.agents as string[]) ?? [], notes: String(b.notes ?? '') });
        if (m[2] === 'tendances') a.detail.tendances.push({ id, map: String(b.map), side: b.side as 'attaque', notes: String(b.notes ?? ''), tauxVictoire: (b.tauxVictoire as number | null) ?? null, compos: (b.compos as string[][]) ?? [] });
        if (m[2] === 'vods') a.detail.vods.push({ id, url: String(b.url), titre: String(b.titre), youtube: /youtu/.test(String(b.url)), reviewId: null });
        r = { id };
      }
      a.joueurs = a.detail.joueurs.length;
      a.vods = a.detail.vods.length;
    } else if ((m = /\/scouting\/adversaires\/([^/]+)$/.exec(c))) {
      const a = adversaires.find(x => x.id === m![1])!;
      if (methode === 'GET') r = a.detail;
      else if (methode === 'PATCH') {
        Object.assign(a.detail.adversaire, b);
        a.nom = a.detail.adversaire.nom;
        r = a.detail.adversaire;
      }
    }
    return r as T;
  };
  return { requete, appels, reperes, adversaires };
}
