/**
 * Qualité du texte des transcriptions (cœur portable, sans dépendance au serveur) :
 *
 *  - `construirePromptVocabulaire` : « prompt initial » de Whisper construit avec le vocabulaire de la team
 *    (glossaire, pseudos des membres, adversaires, agents / maps / modes du profil de jeu, termes esport) :
 *    Whisper écrit alors « Jett », « Ascent » ou le pseudo d'un joueur au lieu d'un mot approchant ;
 *  - `filtrerRepetitions`, `nettoyerAnnotations`, `estHallucination`, `nettoyerSegments` : garde-fous contre
 *    les défauts connus de Whisper (boucles « merci merci merci… », génériques inventés dans les silences
 *    « Sous-titres réalisés par la communauté d'Amara.org », annotations [Musique]) ;
 *  - `recollerSegments` : recollage de deux blocs d'audio qui se chevauchent (découpe aux silences avec une
 *    petite marge) sans doublon ni mot répété à la jointure.
 *
 * Format des segments : `[[début, fin, texte], …]` (secondes), comme `validerSegments`.
 */

const sansAccents = t =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Mot comparable : minuscules, sans accents ni ponctuation (« Jett, » → « jett »). */
export const motNormalise = m =>
  sansAccents(m)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Texte comparable (mots normalisés séparés par une espace). */
export const texteNormalise = t =>
  String(t ?? '')
    .split(/\s+/)
    .map(motNormalise)
    .filter(Boolean)
    .join(' ');

// ------------------------------------------------------------------ Prompt de vocabulaire

/** Termes esport courants (écrits comme les joueurs les disent), ajoutés après le vocabulaire de la team. */
export const TERMES_ESPORT = ['scrim', 'VOD', 'round', 'eco', 'force buy', 'full buy', 'clutch', 'trade', 'entry', 'lurk', 'flank', 'rotate', 'retake', 'peek', 'spawn', 'ult', 'cooldown', 'BO3'];
/** Termes propres à un jeu (selon la base ou le nom du profil). */
export const TERMES_JEU = {
  valorant: ['Spike', 'plant', 'defuse', 'smoke', 'flash', 'molly', 'util', 'site A', 'site B', 'mid', 'heaven', 'Op'],
  thefinals: ['cashout', 'vault', 'cash box', 'wipe', 'revive', 'defib', 'statue', 'gateway'],
};

/** Élément de vocabulaire propre : une ligne courte, sans caractère de contrôle ni symbole bizarre. */
export function elementVocabulaire(v) {
  const t = String(v ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>{}[\]|\\`"]/g, ' ')
    .replace(/#.*$/, '') // Riot ID « Pseudo#TAG » → « Pseudo »
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 2 && t.length <= 40 ? t : null;
}

/** Liste propre et sans doublon (insensible à la casse et aux accents), dans l'ordre donné. */
export function listeVocabulaire(...listes) {
  const vus = new Set();
  const sortie = [];
  for (const l of listes) {
    for (const v of l ?? []) {
      const e = elementVocabulaire(typeof v === 'object' && v ? v.nom : v);
      if (!e) continue;
      const cle = sansAccents(e).toLowerCase();
      if (vus.has(cle)) continue;
      vus.add(cle);
      sortie.push(e);
    }
  }
  return sortie;
}

/** Clé de termes de jeu d'un profil (base « valorant », ou nom « The Finals »). */
export function cleTermesJeu({ base, cle, nom } = {}) {
  const t = `${base ?? ''} ${cle ?? ''} ${nom ?? ''}`.toLowerCase().replace(/[^a-z]/g, '');
  if (t.includes('valorant')) return 'valorant';
  if (t.includes('thefinals') || t.includes('finals')) return 'thefinals';
  return null;
}

/** Glossaire libre de la team (Paramètres) : une ligne ou une virgule par terme. */
export function lireGlossaire(texte) {
  return listeVocabulaire(
    String(texte ?? '')
      .split(/[\n,;]+/)
      .slice(0, 200),
  );
}

/**
 * Vocabulaire de la team, regroupé et ordonné par importance (le prompt de Whisper est court : ~224 jetons).
 * Entrées : `glossaire` (liste), `pseudos`, `adversaires`, `personnages`, `cartes`, `modes`, `jeu` ({ nom,
 * base, cle }), `equipe` (nom).
 */
export function vocabulaireTeam({ glossaire = [], pseudos = [], adversaires = [], personnages = [], cartes = [], modes = [], jeu = null, equipe = '' } = {}) {
  const termes = [...(TERMES_JEU[cleTermesJeu(jeu ?? {})] ?? []), ...TERMES_ESPORT];
  const tout = new Set();
  const groupe = l => listeVocabulaire(l).filter(x => {
    const k = sansAccents(x).toLowerCase();
    if (tout.has(k)) return false;
    tout.add(k);
    return true;
  });
  return {
    equipe: elementVocabulaire(equipe) ?? '',
    jeu: elementVocabulaire(jeu?.nom) ?? '',
    glossaire: groupe(glossaire),
    pseudos: groupe(pseudos),
    adversaires: groupe(adversaires),
    personnages: groupe(personnages),
    cartes: groupe(cartes),
    modes: groupe(modes),
    termes: groupe(termes),
  };
}

/** Tous les mots du vocabulaire (pour la post-correction : glossaire à respecter). */
export const motsDuVocabulaire = v => (v ? [...v.glossaire, ...v.pseudos, ...v.adversaires, ...v.personnages, ...v.cartes, ...v.modes, ...v.termes] : []);

const ETIQUETTES = {
  fr: { intro: (e, j) => `Réunion${e ? ` de l’équipe ${e}` : ' d’équipe esport'}${j ? ` sur ${j}` : ''}.`, glossaire: 'Vocabulaire', pseudos: 'Joueurs', adversaires: 'Adversaires', personnages: 'Agents', cartes: 'Maps', modes: 'Modes', termes: 'Termes' },
  en: { intro: (e, j) => `${e ? `${e} team` : 'Esports team'} meeting${j ? ` about ${j}` : ''}.`, glossaire: 'Vocabulary', pseudos: 'Players', adversaires: 'Opponents', personnages: 'Agents', cartes: 'Maps', modes: 'Modes', termes: 'Terms' },
};

/**
 * Prompt initial de Whisper : une ou deux phrases « comme une transcription précédente » qui contiennent les
 * bons mots, bien orthographiés (Whisper les reprend). Ordre de priorité : glossaire de la team, pseudos,
 * adversaires, agents, maps, modes, termes esport ; coupé à `maxCaracteres` (≈ 150 à 200 jetons).
 */
export function construirePromptVocabulaire(vocabulaire, { langue = 'fr', maxCaracteres = 600 } = {}) {
  if (!vocabulaire) return '';
  const e = ETIQUETTES[langue === 'en' ? 'en' : 'fr'];
  let texte = e.intro(vocabulaire.equipe, vocabulaire.jeu);
  for (const cle of ['glossaire', 'pseudos', 'adversaires', 'personnages', 'cartes', 'modes', 'termes']) {
    const liste = vocabulaire[cle] ?? [];
    if (!liste.length) continue;
    const debut = ` ${e[cle]} : `;
    if (texte.length + debut.length + liste[0].length + 1 > maxCaracteres) continue;
    let morceau = debut + liste[0];
    for (const x of liste.slice(1)) {
      if (texte.length + morceau.length + x.length + 3 > maxCaracteres) break;
      morceau += `, ${x}`;
    }
    texte += `${morceau}.`;
  }
  return texte.length > maxCaracteres ? texte.slice(0, maxCaracteres) : texte;
}

// ------------------------------------------------------------------ Garde-fous contre les défauts de Whisper

/**
 * Coupe les boucles de répétition (mots) : un groupe de 2 à 12 mots répété 3 fois ou plus de suite n'est
 * gardé qu'une fois ; un mot seul répété 4 fois ou plus n'est gardé que 2 fois (« non non »).
 */
export function filtrerRepetitions(texte) {
  const mots = String(texte ?? '').split(/\s+/).filter(Boolean);
  if (mots.length < 4) return mots.join(' ');
  const cles = mots.map(motNormalise);
  const sortie = [];
  let i = 0;
  while (i < mots.length) {
    let saut = 0;
    let gardes = 0;
    for (let n = 12; n >= 1; n--) {
      if (i + n * 2 > mots.length) continue;
      const bloc = cles.slice(i, i + n);
      if (!bloc.join('')) continue;
      let k = 1;
      while (i + (k + 1) * n <= mots.length && cles.slice(i + k * n, i + (k + 1) * n).every((x, j) => x === bloc[j])) k++;
      const seuil = n === 1 ? 4 : 3;
      if (k >= seuil) {
        saut = k * n;
        gardes = n === 1 ? 2 : n;
        break;
      }
    }
    if (saut) {
      sortie.push(...mots.slice(i, i + gardes));
      i += saut;
    } else {
      sortie.push(mots[i]);
      i += 1;
    }
  }
  return sortie.join(' ');
}

/** Annotations ajoutées par Whisper ([Musique], (rires), ♪…) : retirées du texte. */
export function nettoyerAnnotations(texte) {
  return String(texte ?? '')
    .replace(/[[(（]\s*(musique|music|rires?|laughs?|laughter|applaudissements|applause|silence|bruit|bruits|noise|inaudible|blank_audio|blank audio|sous-titres?|soupir|toux|cough)[^\])）]{0,20}[\])）]/gi, ' ')
    .replace(/[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Phrases que Whisper invente dans les silences ou la musique (génériques de vidéos), comparées normalisées. */
export const HALLUCINATIONS = [
  'sous-titres réalisés par la communauté d’amara.org',
  'sous-titres réalisés para la communauté d’amara.org',
  'sous-titrage st’ 501',
  'sous-titrage société radio-canada',
  'sous-titrage fr',
  'sous-titres par',
  'merci d’avoir regardé cette vidéo',
  'merci d’avoir regardé',
  'merci de nous avoir regardés',
  'abonnez-vous',
  'n’oubliez pas de vous abonner',
  'à bientôt pour une nouvelle vidéo',
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'subtitles by the amara.org community',
  'transcribed by',
].map(texteNormalise);

/** Le segment n'est-il qu'une hallucination connue (presque tout son texte) ? */
export function estHallucination(texte) {
  const n = texteNormalise(nettoyerAnnotations(texte));
  if (!n) return true;
  if (n.length > 140) return false;
  return HALLUCINATIONS.some(h => n.includes(h) && h.length >= n.length * 0.6);
}

/**
 * Nettoie des segments `[[d, f, t]]` : annotations retirées, boucles coupées, hallucinations connues et
 * segments vides retirés, répétition exacte d'un segment précédent (≥ 10 caractères, boucle de Whisper d'une
 * fenêtre à l'autre) retirée.
 */
export function nettoyerSegments(segments) {
  const sortie = [];
  let precedent = '';
  for (const s of segments ?? []) {
    const [d, f, t] = Array.isArray(s) ? s : [s?.debut, s?.fin, s?.texte];
    const texte = filtrerRepetitions(nettoyerAnnotations(t));
    if (!texte || estHallucination(texte)) continue;
    const n = texteNormalise(texte);
    if (n && n === precedent && n.length >= 10) continue;
    precedent = n;
    sortie.push([d, f, texte]);
  }
  return sortie;
}

/**
 * Recolle les segments d'un nouveau bloc d'audio (`nouveaux`, en secondes absolues) à ceux déjà acquis. Le bloc
 * a commencé un peu AVANT `coupe` (chevauchement) : les segments dont le milieu tombe avant `coupe` sont déjà
 * dans `acquis` (ils sont retirés), et les mots répétés à la jointure (fin du dernier segment acquis = début du
 * premier nouveau) ne sont gardés qu'une fois. Rend la liste complète, triée.
 */
export function recollerSegments(acquis, nouveaux, coupe) {
  const garder = (nouveaux ?? []).filter(([d, f]) => (Number(d) + Number(f)) / 2 >= coupe - 0.05).map(([d, f, t]) => [Math.max(Number(d), coupe - 0.5), Number(f), String(t)]);
  const sortie = [...(acquis ?? [])];
  const dernier = sortie[sortie.length - 1];
  if (dernier && garder.length) {
    const finMots = String(dernier[2]).split(/\s+/).filter(Boolean);
    const premier = garder[0];
    const debutMots = String(premier[2]).split(/\s+/).filter(Boolean);
    const a = finMots.map(motNormalise);
    const b = debutMots.map(motNormalise);
    let commun = 0;
    for (let k = Math.min(12, a.length, b.length); k >= 2; k--) {
      if (a.slice(a.length - k).every((x, j) => x === b[j])) {
        commun = k;
        break;
      }
    }
    if (commun) {
      const reste = debutMots.slice(commun).join(' ');
      if (reste) garder[0] = [premier[0], premier[1], reste];
      else garder.shift();
    }
  }
  for (const s of garder) {
    const precedent = sortie[sortie.length - 1];
    if (precedent && s[0] < precedent[1]) s[0] = Math.min(precedent[1], s[1]);
    if (s[1] < s[0]) s[1] = s[0];
    sortie.push(s);
  }
  return sortie;
}
