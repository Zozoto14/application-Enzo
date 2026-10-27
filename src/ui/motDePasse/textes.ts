/**
 * Textes de l'aide à la saisie d'un mot de passe, en français et en anglais.
 *
 * Petit dictionnaire local : les écrans concernés (invitation, connexion, coffre…) sont aussi
 * ceux d'une personne qui n'a encore aucun compte, donc aucun réglage de langue. La langue vient
 * de l'invitation, du compte ou de l'appareil (voir `langueDeSaisie`). Le français sert de
 * référence : TypeScript refuse un `en` auquel il manque une clé.
 *
 * Le ton est neutre (infinitifs, pas de « tu » ni de « vous ») pour servir aussi bien l'écran
 * des amis (tutoiement) que celui du coffre (vouvoiement).
 */

export type LangueSaisie = 'fr' | 'en';

const fr = {
  'aide.titre': 'Quel mot de passe choisir ?',
  'aide.longueur': 'Au moins {min} caractères.',
  'aide.sansMax': 'Pas de longueur maximale.',
  'aide.caracteres': 'Tout est accepté : lettres, chiffres, espaces au milieu, accents (é, à, ç…) et symboles (! ? # @ …).',
  'aide.majuscules': 'Les majuscules comptent : « Chat » et « chat » sont deux mots de passe différents.',
  'aide.bords.ignores': 'Les espaces au début et à la fin sont ignorés (pratique si le mot de passe est collé).',
  'aide.bords.gardes': 'Éviter les espaces au début et à la fin : ils peuvent être pris en compte tels quels.',
  'aide.courbes': 'Les apostrophes et guillemets courbes (clavier de l’iPhone) sont acceptés : ils sont convertis en droits.',
  'aide.refuses': 'Refusés : les mots de passe qui ne sont que des chiffres, qui reprennent l’identifiant, qui sont très courants (« azerty », « 123456 »…) ou répétitifs (« aaaa »).',
  'aide.forceMin': 'Force « {force} » au moins, exigée pour cette invitation.',
  'aide.conseil': 'Le plus simple : une phrase facile à retenir, par exemple « mon chat mange 3 croquettes ».',
  'aide.rappel': 'Ne pas réutiliser le mot de passe d’un autre site. Au besoin, le noter dans un gestionnaire de mots de passe.',

  'regles.titre': 'Les règles, en direct',
  'regle.longueur': 'Au moins {min} caractères',
  'regle.chiffres': 'Pas seulement des chiffres',
  'regle.identifiant': 'Différent de l’identifiant',
  'regle.courant': 'Pas trop courant, pas répétitif',
  'regle.force': 'Force « {force} » au moins',
  'regle.identiques': 'Les deux saisies sont identiques',
  'regle.ok': 'Règle respectée : {regle}',
  'regle.attente': 'Règle pas encore respectée : {regle}',

  'erreur.manque.one': 'Il manque {n} caractère.',
  'erreur.manque.other': 'Il manque {n} caractères.',
  'erreur.chiffres': 'Que des chiffres : ajouter des lettres ou mieux, une phrase.',
  'erreur.identifiant': 'Trop proche de l’identifiant : choisir autre chose.',
  'erreur.courant': 'Trop courant : choisir autre chose.',
  'erreur.repetitif': 'Trop répétitif : varier les caractères.',
  'erreur.force': 'Pas assez solide : force « {force} » au moins. Ajouter des mots, des chiffres ou des symboles.',
  'erreur.differents': 'Les deux mots de passe ne correspondent pas.',
  'erreur.majuscules': 'Attention : majuscules activées.',

  'force.libelle': 'Force : {niveau}',
  'force.vide': 'Force : à calculer dès les premiers caractères.',
  'force.niveau.0': 'Trop faible',
  'force.niveau.1': 'Correct',
  'force.niveau.2': 'Bien',
  'force.niveau.3': 'Solide',
  'force.niveau.4': 'Excellent',
  'force.sens.0': 'Trop court ou trop simple : il serait deviné très vite.',
  'force.sens.1': 'Acceptable, mais un programme pourrait le deviner en un temps raisonnable.',
  'force.sens.2': 'Plutôt difficile à deviner.',
  'force.sens.3': 'Très difficile à deviner.',
  'force.sens.4': 'Pratiquement impossible à deviner.',
  'force.astuce.12': 'Pour monter d’un cran : atteindre 12 caractères.',
  'force.astuce.16': 'Pour monter d’un cran : atteindre 16 caractères, par exemple en ajoutant un mot.',
  'force.astuce.classes': 'Pour monter d’un cran : ajouter un chiffre, une majuscule ou un symbole.',
  'force.astuce.20': 'Pour monter d’un cran : atteindre 20 caractères, par exemple en ajoutant un mot.',

  'bouton.afficher': 'Afficher',
  'bouton.masquer': 'Masquer',
  'bouton.afficherLong': 'Afficher le mot de passe',
  'bouton.masquerLong': 'Masquer le mot de passe',

} as const;

export type CleTexte = keyof typeof fr;

const en: Record<CleTexte, string> = {
  'aide.titre': 'Which password should I choose?',
  'aide.longueur': 'At least {min} characters.',
  'aide.sansMax': 'There is no maximum length.',
  'aide.caracteres': 'Anything goes: letters, digits, spaces in the middle, accents (é, à, ç…) and symbols (! ? # @ …).',
  'aide.majuscules': 'Capital letters count: “Cat” and “cat” are two different passwords.',
  'aide.bords.ignores': 'Spaces at the start and at the end are ignored (handy when the password is pasted).',
  'aide.bords.gardes': 'Avoid spaces at the start and at the end: they may be counted as they are.',
  'aide.courbes': 'Curly apostrophes and quotes (iPhone keyboard) are fine: they are converted to straight ones.',
  'aide.refuses': 'Not accepted: passwords made only of digits, that reuse the username, that are very common (“azerty”, “123456”…) or repetitive (“aaaa”).',
  'aide.forceMin': 'Strength “{force}” at least, required for this invitation.',
  'aide.conseil': 'The easiest way: a phrase that is easy to remember, for example “my cat eats 3 treats”.',
  'aide.rappel': 'Do not reuse a password from another site. If needed, save it in a password manager.',

  'regles.titre': 'The rules, live',
  'regle.longueur': 'At least {min} characters',
  'regle.chiffres': 'Not only digits',
  'regle.identifiant': 'Different from the username',
  'regle.courant': 'Not too common, not repetitive',
  'regle.force': 'Strength “{force}” at least',
  'regle.identiques': 'Both entries are identical',
  'regle.ok': 'Rule met: {regle}',
  'regle.attente': 'Rule not met yet: {regle}',

  'erreur.manque.one': '{n} character missing.',
  'erreur.manque.other': '{n} characters missing.',
  'erreur.chiffres': 'Digits only: add letters, or better, a phrase.',
  'erreur.identifiant': 'Too close to the username: choose something else.',
  'erreur.courant': 'Too common: choose something else.',
  'erreur.repetitif': 'Too repetitive: vary the characters.',
  'erreur.force': 'Not strong enough: strength “{force}” at least. Add words, digits or symbols.',
  'erreur.differents': 'The two passwords do not match.',
  'erreur.majuscules': 'Warning: Caps Lock is on.',

  'force.libelle': 'Strength: {niveau}',
  'force.vide': 'Strength: shown as soon as you start typing.',
  'force.niveau.0': 'Too weak',
  'force.niveau.1': 'Fair',
  'force.niveau.2': 'Good',
  'force.niveau.3': 'Strong',
  'force.niveau.4': 'Excellent',
  'force.sens.0': 'Too short or too simple: it would be guessed very quickly.',
  'force.sens.1': 'Acceptable, but a program could guess it in a reasonable time.',
  'force.sens.2': 'Rather hard to guess.',
  'force.sens.3': 'Very hard to guess.',
  'force.sens.4': 'Practically impossible to guess.',
  'force.astuce.12': 'To go up a level: reach 12 characters.',
  'force.astuce.16': 'To go up a level: reach 16 characters, for example by adding a word.',
  'force.astuce.classes': 'To go up a level: add a digit, a capital letter or a symbol.',
  'force.astuce.20': 'To go up a level: reach 20 characters, for example by adding a word.',

  'bouton.afficher': 'Show',
  'bouton.masquer': 'Hide',
  'bouton.afficherLong': 'Show the password',
  'bouton.masquerLong': 'Hide the password',

};

const DICTIONNAIRES: Record<LangueSaisie, Record<CleTexte, string>> = { fr, en };

export const CLES_TEXTES = Object.keys(fr) as CleTexte[];
export const TEXTES_PAR_LANGUE = DICTIONNAIRES;

export type VariablesTexte = Record<string, string | number>;

export function texte(langue: LangueSaisie, cle: CleTexte, vars?: VariablesTexte): string {
  const modele = DICTIONNAIRES[langue][cle] ?? fr[cle];
  return vars ? modele.replace(/\{(\w+)\}/g, (brut, nom: string) => (nom in vars ? String(vars[nom]) : brut)) : modele;
}

/** Niveaux de force affichés (0 à 4), dans la langue demandée. */
export function libelleForce(langue: LangueSaisie, force: 0 | 1 | 2 | 3 | 4): string {
  return texte(langue, `force.niveau.${force}` as CleTexte);
}

// ------------------------------------------------------------------ Textes des écrans

const ecranFr = {
  'inv.titre': 'Invitation',
  'inv.bienvenue': 'Bienvenue, {prenom} !',
  'inv.verification': 'Vérification de l’invitation…',
  'inv.intro.avec': '{fondateur} t’invite sur AppDashboard.',
  'inv.intro.sans': 'Tu es invité sur AppDashboard.',
  'inv.intro.suite': 'Choisis ton mot de passe : c’est tout. Invitation valable jusqu’au {jour}, une seule fois.',
  'inv.identifiant': 'Ton identifiant (à retenir)',
  'inv.identifiant.note': 'Majuscules, accents et espaces n’ont pas d’importance pour l’identifiant.',
  'inv.mdp': 'Ton mot de passe',
  'inv.confirmation': 'Confirme ton mot de passe',
  'inv.remplacer': 'Ce navigateur contient déjà un autre compte : il sera retiré de ce navigateur (rien n’est effacé ailleurs). Je confirme.',
  'inv.creation': 'Création de ton accès (chiffrement sur cet appareil)…',
  'inv.valider': 'Créer mon accès',
  'inv.accueil': 'Revenir à l’accueil',

  'secours.titre': 'Mot de passe oublié',
  'secours.intro':
    'Ton identifiant ci-dessus, un de tes codes de récupération (notés sur papier ; chacun ne sert qu’une fois) et ton nouveau mot de passe. Ami : demande plutôt au Fondateur de réinitialiser ton accès.',
  'secours.code': 'Code de récupération',
  'secours.mdp': 'Nouveau mot de passe',
  'secours.confirmation': 'Confirme le nouveau mot de passe',
  'secours.valider': 'Ouvrir mon compte avec ce code',

  'fond.titre.fait': 'Identifiant et mot de passe de connexion',
  'fond.titre.neuf': 'Se connecter partout avec un identifiant',
  'fond.intro.fait': 'Change ton identifiant ou ton mot de passe de connexion. Tes données ne bougent pas.',
  'fond.intro.neuf':
    'Toutes tes données sont maintenant sur le serveur, chiffrées : choisis un identifiant (ton prénom par exemple). Avec ton mot de passe actuel (et ton code à six chiffres s’il est activé), il suffira pour te connecter sur n’importe quel navigateur — plus besoin de code de liaison.',
  'fond.identifiant': 'Identifiant',
  'fond.identifiant.note': 'Majuscules, accents et espaces ne comptent pas.',
  'fond.actuel': 'Mot de passe actuel',
  'fond.code': 'Code à six chiffres',
  'fond.changer': 'Changer de mot de passe (facultatif : sinon, ton mot de passe actuel reste le même partout)',
  'fond.nouveau': 'Nouveau mot de passe',
  'fond.confirmation': 'Confirme le nouveau mot de passe',
  'fond.chiffrement': 'Chiffrement et envoi au serveur…',
  'fond.enregistrer': 'Enregistrer',
  'fond.activer': 'Activer la connexion par identifiant',
  'fond.annuler': 'Annuler',
  'fond.plusTard': 'Plus tard',

  'coffre.titre': 'Protéger vos données',
  'coffre.intro': 'Ce mot de passe chiffre l’intégralité de votre portefeuille sur cet appareil. Utilisez un mot de passe long : une phrase facile à retenir, ou un mot de passe généré par votre gestionnaire.',
  'coffre.mdp': 'Mot de passe',
  'coffre.confirmation': 'Confirmation',

  'recup.mdp': 'Nouveau mot de passe',
  'recup.confirmation': 'Confirmer le nouveau mot de passe',

  'sauv.mdp': 'Mot de passe de la sauvegarde',
  'sauv.confirmation': 'Confirmation',
  'sauv.indication': 'Il peut différer de celui de l’application. Une sauvegarde doit rester lisible même après un changement de mot de passe.',
} as const;

export type CleEcran = keyof typeof ecranFr;

const ecranEn: Record<CleEcran, string> = {
  'inv.titre': 'Invitation',
  'inv.bienvenue': 'Welcome, {prenom}!',
  'inv.verification': 'Checking the invitation…',
  'inv.intro.avec': '{fondateur} is inviting you to AppDashboard.',
  'inv.intro.sans': 'You have been invited to AppDashboard.',
  'inv.intro.suite': 'Choose your password: that is all. The invitation is valid until {jour}, one time only.',
  'inv.identifiant': 'Your username (remember it)',
  'inv.identifiant.note': 'Capital letters, accents and spaces do not matter for the username.',
  'inv.mdp': 'Your password',
  'inv.confirmation': 'Confirm your password',
  'inv.remplacer': 'This browser already holds another account: it will be removed from this browser (nothing is erased elsewhere). I confirm.',
  'inv.creation': 'Creating your access (encrypting on this device)…',
  'inv.valider': 'Create my access',
  'inv.accueil': 'Back to the home page',

  'secours.titre': 'Forgotten password',
  'secours.intro':
    'Your username above, one of your recovery codes (written on paper; each works only once) and your new password. Friends: ask the Founder to reset your access instead.',
  'secours.code': 'Recovery code',
  'secours.mdp': 'New password',
  'secours.confirmation': 'Confirm the new password',
  'secours.valider': 'Open my account with this code',

  'fond.titre.fait': 'Sign-in username and password',
  'fond.titre.neuf': 'Sign in anywhere with a username',
  'fond.intro.fait': 'Change your sign-in username or password. Your data does not move.',
  'fond.intro.neuf':
    'All your data is now on the server, encrypted: choose a username (your first name, for example). With your current password (and your six-digit code if it is on), that is all you need to sign in on any browser — no more link code.',
  'fond.identifiant': 'Username',
  'fond.identifiant.note': 'Capital letters, accents and spaces do not matter.',
  'fond.actuel': 'Current password',
  'fond.code': 'Six-digit code',
  'fond.changer': 'Change my password (optional: otherwise your current password stays the same everywhere)',
  'fond.nouveau': 'New password',
  'fond.confirmation': 'Confirm the new password',
  'fond.chiffrement': 'Encrypting and sending to the server…',
  'fond.enregistrer': 'Save',
  'fond.activer': 'Turn on sign-in by username',
  'fond.annuler': 'Cancel',
  'fond.plusTard': 'Later',

  'coffre.titre': 'Protect your data',
  'coffre.intro': 'This password encrypts your entire portfolio on this device. Use a long password: an easy-to-remember phrase, or one generated by your password manager.',
  'coffre.mdp': 'Password',
  'coffre.confirmation': 'Confirmation',

  'recup.mdp': 'New password',
  'recup.confirmation': 'Confirm the new password',

  'sauv.mdp': 'Backup password',
  'sauv.confirmation': 'Confirmation',
  'sauv.indication': 'It may differ from the app password. A backup must stay readable even after the password is changed.',
};

const ECRANS: Record<LangueSaisie, Record<CleEcran, string>> = { fr: ecranFr, en: ecranEn };

export const CLES_ECRANS = Object.keys(ecranFr) as CleEcran[];
export const TEXTES_ECRANS_PAR_LANGUE = ECRANS;

/** Texte d'un écran (invitation, connexion du Fondateur, mot de passe oublié…). */
export function texteEcran(langue: LangueSaisie, cle: CleEcran, vars?: VariablesTexte): string {
  const modele = ECRANS[langue][cle] ?? ecranFr[cle];
  return vars ? modele.replace(/\{(\w+)\}/g, (brut, nom: string) => (nom in vars ? String(vars[nom]) : brut)) : modele;
}
