/**
 * Collecteur des statistiques d'usage de l'Esport (côté app), voir docs/esport/statistiques.md.
 *
 * Ce qu'il note, et rien d'autre : la page ou la section ouverte (identifiant de route stable, par ex.
 * « team.agenda.planning ») et la durée passée dessus (mesurée ici, envoyée quand on change de page ou que
 * l'app passe en arrière-plan), les actions clés (connexion, création d'événement, RSVP, dépôt de résumé,
 * repère, ressource publiée…), les erreurs JS (message tronqué, page), le type d'appareil et la langue.
 * Jamais de contenu saisi, aucun traceur tiers.
 *
 * Sobriété (hébergement mutualisé) : les événements sont gardés en mémoire et partent PAR LOT, au plus un
 * envoi par intervalle (45 s), seulement s'il y a quelque chose à envoyer ; jamais deux envois en même
 * temps ; en cas d'échec, les envois s'espacent (2, 4, 8 intervalles). Au départ de la page (onglet masqué,
 * fermeture), un dernier lot part avec `keepalive`. Si le Fondateur a coupé la collecte, le serveur répond
 * `{ actif: false }` et le collecteur s'arrête.
 */

export type Appareil = 'pc' | 'tablette' | 'telephone' | 'app_pc';
export interface EvenementUsage {
  g: 'page' | 'action' | 'erreur';
  p?: string;
  t?: string;
  a?: string;
  d?: number;
  m?: string;
  /** Âge de l'événement à l'envoi (ms). */
  il?: number;
}
export interface LotUsage {
  session: string;
  appareil: Appareil;
  langue: 'fr' | 'en';
  evenements: EvenementUsage[];
}
export type EnvoyerUsage = (lot: LotUsage, options: { keepalive: boolean }) => Promise<{ actif?: boolean } | void | undefined>;

export interface OptionsCollecteur {
  envoyer: EnvoyerUsage;
  appareil: Appareil;
  langue(): 'fr' | 'en';
  maintenant?(): number;
  /** Intervalle entre deux lots (défaut 45 s ; entre 30 et 60 s en production). */
  intervalleMs?: number;
  minuterie?: { setInterval(f: () => void, ms: number): unknown; clearInterval(id: unknown): void };
  hasard?(): string;
}

export interface Collecteur {
  /** Page ouverte (identifiant de route) ; la durée de la précédente est notée. */
  page(id: string, teamId?: string | null): void;
  action(cle: string, teamId?: string | null): void;
  erreur(message: string): void;
  /** Onglet masqué, app en arrière-plan ou fermeture : durée de la page, puis envoi avec `keepalive`. */
  masquer(): void;
  /** Retour au premier plan (nouvelle session après 30 minutes d'absence). */
  montrer(): void;
  /** Envoie un lot maintenant (au plus 100 événements). */
  vider(keepalive?: boolean): Promise<void>;
  arreter(): void;
  readonly etat: { actif: boolean; session: string; enAttente: number; pageCourante: string | null; envois: number };
}

export const INTERVALLE_DEFAUT_MS = 45_000;
export const MAX_PAR_LOT = 100;
const MAX_TAMPON = 400;
const DUREE_MIN_PAGE_MS = 300;
const NOUVELLE_SESSION_MS = 30 * 60_000;
const MAX_ERREURS_SESSION = 20;
const RECUL_MAX = 8;

const hasardDefaut = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?(): string } }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 24);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 24).padEnd(12, '0');
};

export function creerCollecteur(o: OptionsCollecteur): Collecteur {
  const maintenant = o.maintenant ?? Date.now;
  const minuterie = o.minuterie ?? { setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>) };
  const hasard = o.hasard ?? hasardDefaut;
  let session = hasard();
  let actif = true;
  let tampon: Array<EvenementUsage & { _t: number }> = [];
  let courante: { id: string; team: string | null; debut: number } | null = null;
  let masqueDepuis: number | null = null;
  let enCours = false;
  let recul = 0;
  let aSauter = 0;
  let envois = 0;
  let erreursSession = 0;
  const dernieresErreurs = new Map<string, number>();

  const noter = (e: EvenementUsage) => {
    if (!actif) return;
    tampon.push({ ...e, _t: maintenant() });
    if (tampon.length > MAX_TAMPON) tampon = tampon.slice(tampon.length - MAX_TAMPON);
  };

  const fermerPage = () => {
    if (!courante) return;
    const d = maintenant() - courante.debut;
    if (d >= DUREE_MIN_PAGE_MS) noter({ g: 'page', p: courante.id, d, ...(courante.team ? { t: courante.team } : {}) });
  };

  const lot = (evenements: Array<EvenementUsage & { _t: number }>): LotUsage => ({
    session,
    appareil: o.appareil,
    langue: o.langue(),
    evenements: evenements.map(({ _t, ...e }) => ({ ...e, il: Math.max(0, maintenant() - _t) })),
  });

  async function vider(keepalive = false): Promise<void> {
    if (!actif || tampon.length === 0) return;
    if (keepalive) {
      // Départ de la page : la réponse n'arrivera peut-être jamais ; le lot est considéré comme parti.
      // Deux lots au plus (le navigateur borne le total des envois `keepalive` à 64 Ko).
      for (let i = 0; i < 2 && tampon.length > 0; i++) {
        const partie = tampon.slice(0, MAX_PAR_LOT);
        tampon = tampon.slice(partie.length);
        envois++;
        Promise.resolve()
          .then(() => o.envoyer(lot(partie), { keepalive: true }))
          .catch(() => undefined);
      }
      return;
    }
    if (enCours) return;
    enCours = true;
    const partie = tampon.slice(0, MAX_PAR_LOT);
    tampon = tampon.slice(partie.length);
    envois++;
    try {
      const r = await o.envoyer(lot(partie), { keepalive: false });
      recul = 0;
      if (r && r.actif === false) arreter();
    } catch {
      // Remis en tête du tampon ; prochains essais espacés (pas de rafale si le serveur peine).
      tampon = [...partie, ...tampon].slice(-MAX_TAMPON);
      recul = Math.min(RECUL_MAX, recul ? recul * 2 : 2);
      aSauter = recul - 1;
    } finally {
      enCours = false;
    }
  }

  const tic = () => {
    if (!actif || masqueDepuis !== null) return;
    if (aSauter > 0) {
      aSauter--;
      return;
    }
    void vider(false);
  };
  const minuteur = minuterie.setInterval(tic, o.intervalleMs ?? INTERVALLE_DEFAUT_MS);

  function arreter() {
    actif = false;
    tampon = [];
    courante = null;
    minuterie.clearInterval(minuteur);
  }

  noter({ g: 'action', a: 'connexion' });

  return {
    page(id, teamId) {
      if (!actif) return;
      const team = teamId ?? null;
      if (courante && courante.id === id && courante.team === team) return;
      fermerPage();
      courante = { id, team, debut: maintenant() };
    },
    action(cle, teamId) {
      noter({ g: 'action', a: cle, ...(teamId ? { t: teamId } : {}) });
    },
    erreur(message) {
      if (!actif || erreursSession >= MAX_ERREURS_SESSION) return;
      const m = String(message ?? '').slice(0, 300);
      if (!m) return;
      const cle = `${courante?.id ?? ''}|${m}`;
      const vu = dernieresErreurs.get(cle);
      if (vu !== undefined && maintenant() - vu < 60_000) return;
      dernieresErreurs.set(cle, maintenant());
      erreursSession++;
      noter({ g: 'erreur', m, ...(courante ? { p: courante.id } : {}) });
    },
    masquer() {
      if (!actif || masqueDepuis !== null) return;
      fermerPage();
      if (courante) courante = { ...courante, debut: maintenant() };
      masqueDepuis = maintenant();
      void vider(true);
    },
    montrer() {
      if (!actif || masqueDepuis === null) return;
      if (maintenant() - masqueDepuis > NOUVELLE_SESSION_MS) {
        session = hasard();
        erreursSession = 0;
        noter({ g: 'action', a: 'connexion' });
      }
      masqueDepuis = null;
      if (courante) courante = { ...courante, debut: maintenant() };
    },
    vider,
    arreter,
    get etat() {
      return { actif, session, enAttente: tampon.length, pageCourante: courante?.id ?? null, envois };
    },
  };
}

// ------------------------------------------------------------------ Actions clés (appels réussis de l'API)

const T = '/teams/([0-9a-f-]{36})';
const MOTIFS_ACTIONS: ReadonlyArray<readonly [string, RegExp, string]> = [
  ['POST', new RegExp(`^${T}/planning$`), 'evenement.cree'],
  ['PUT', new RegExp(`^${T}/planning/[^/]+/occurrences/[^/]+/rsvp$`), 'rsvp'],
  ['PUT', new RegExp(`^${T}/planning/[^/]+/occurrences/[^/]+/presence$`), 'presence.marquee'],
  ['PUT', new RegExp(`^${T}/dispos/moi/regles$`), 'disponibilite'],
  ['POST', new RegExp(`^${T}/dispos/moi/exceptions$`), 'disponibilite'],
  ['POST', new RegExp(`^${T}/resumes$`), 'resume.depose'],
  ['PUT', new RegExp(`^${T}/resumes/[^/]+/pdf$`), 'resume.publie'],
  ['POST', new RegExp(`^${T}/review$`), 'review.creee'],
  ['POST', new RegExp(`^${T}/review/[^/]+/reperes$`), 'repere.ajoute'],
  ['POST', new RegExp(`^${T}/review/[^/]+/reperes/[^/]+/commentaires$`), 'review.commentaire'],
  ['POST', new RegExp(`^${T}/strats$`), 'strat.creee'],
  ['PUT', new RegExp(`^${T}/strats/[^/]+$`), 'strat.modifiee'],
  ['POST', new RegExp(`^${T}/playbook$`), 'playbook.ajout'],
  ['POST', new RegExp(`^${T}/ressources$`), 'ressource.publiee'],
  ['POST', new RegExp(`^${T}/taches$`), 'tache.creee'],
  ['POST', new RegExp(`^${T}/objectifs$`), 'objectif.cree'],
  ['POST', new RegExp(`^${T}/scouting/adversaires$`), 'scouting.fiche'],
  ['POST', new RegExp(`^${T}/tournois$`), 'tournoi.cree'],
  ['POST', new RegExp(`^${T}/resultats$`), 'resultat.saisi'],
];

/** Action clé d'un appel réussi de l'API (`undefined` : rien à noter). */
export function actionDAppel(methode: string, chemin: string): { action: string; team: string } | undefined {
  const c = chemin.split('?')[0];
  for (const [m, motif, action] of MOTIFS_ACTIONS) {
    if (m !== methode) continue;
    const r = motif.exec(c);
    if (r) return { action, team: r[1] };
  }
  return undefined;
}

// ------------------------------------------------------------------ Appareil

/** Type d'appareil, sans empreinte : PC, tablette, téléphone ou app PC (Electron). */
export function appareilDe(env: { os: string; isPad?: boolean; largeur?: number; userAgent?: string; maxTouchPoints?: number; electron?: boolean }): Appareil {
  if (env.os === 'ios') return env.isPad ? 'tablette' : 'telephone';
  if (env.os === 'android') return (env.largeur ?? 0) >= 600 ? 'tablette' : 'telephone';
  if (env.electron) return 'app_pc';
  const ua = env.userAgent ?? '';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1)) return 'tablette';
  if (/iPhone|iPod|Mobi|Windows Phone/.test(ua)) return 'telephone';
  if (/Android/.test(ua)) return 'tablette';
  return 'pc';
}
