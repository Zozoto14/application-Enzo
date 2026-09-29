# Interface

```
format.ts        mise en forme des montants, dates et pourcentages
theme.ts         couleurs et espacements, clair et sombre
composants.tsx   briques partagées (carte, bouton, champ, alerte)
vues/            modèles de vue : toute la logique d'écran, sans rendu
ecrans/          composants React Native, purement présentationnels
```

```bash
npx jest src/ui src/app
```

## La logique est dans les modèles de vue

`vues/dashboard.ts` prend l'état du portefeuille et rend une `VueDashboard`
dont tous les champs sont **déjà des chaînes formatées**. Les écrans ne
calculent rien et n'appellent aucun formateur.

L'intérêt n'est pas théorique : ces tests vérifient le texte exact que
l'utilisateur lira, sans monter de rendu React ni d'appareil. Un test du
tableau de bord a d'ailleurs révélé un défaut réel de la reprise
d'antériorité — les achats de reprise créaient un solde espèces négatif de
12 068 € qui n'avait jamais existé.

Corollaire tenu partout : **rien n'est assemblé dans le JSX**. La ligne de
détail d'une position (`20 x 4,22 € - PRU 5,12 €`) est composée dans le modèle
de vue, pas entre accolades dans le rendu — un texte fait de fragments React
se cherche mal dans les tests, et se relit mal quand il faut vérifier ce qui
s'affiche.

## Conventions d'affichage

**Le signe est toujours explicite sur une variation.** « +2,40 % » et non
« 2,40 % ». Un gain et une perte doivent se distinguer sans recourir à la
couleur : environ un homme sur douze distingue mal le vert du rouge. La
couleur vient en renfort, jamais seule.

**Zéro ne prend jamais de signe.** « +0,00 % » se lirait comme une hausse.

**Aucun arrondi avant l'affichage.** `Decimal` garde la précision, le
formatage n'en prend qu'une photo.

**Un état vide est annoncé.** Un portefeuille sans position affiche un texte,
pas « 0,00 € » — qui se confond avec une erreur de chargement.

**Un chiffre absent est nommé.** Les titres dont le cours manque sont exclus
des totaux *et* listés à l'écran. Un patrimoine amputé sans explication est
pire qu'un chiffre manquant.

## Deux détails de l'écran de déverrouillage

**L'attente est annoncée.** La vérification enchaîne une dérivation Argon2id
et le contrôle du code TOTP, soit près d'une seconde sur l'appareil. Chaque
appel est différé d'un tour de boucle pour laisser l'indicateur s'afficher —
sans quoi l'écran reste figé, puis saute d'un coup au tableau de bord.

**L'erreur ne distingue pas les deux facteurs.** Le message vient tel quel de
la couche session, qui répond la même chose pour un mot de passe faux et pour
un code faux. Préciser renseignerait un attaquant sur le facteur qu'il tient
déjà. Un test le vérifie.

## Écrans

Déverrouillage, premier lancement, tableau de bord, création de compte,
création de valeur, saisie d'opération, import de positions.

La navigation est un simple aiguillage par état dans `app/App.tsx` : suffisant
pour sept écrans sans pile ni retour arrière, à remplacer par une vraie
bibliothèque de navigation quand il y aura des sous-écrans.

L'ISIN saisi à la main est vérifié **clé de contrôle comprise** (`vues/titre.ts`) :
sur douze caractères recopiés, c'est ce contrôle qui attrape la faute de
frappe avant qu'elle ne crée un doublon silencieux de la même valeur.

Les six avertissements `no-inline-styles` restants sont assumés : les couleurs
viennent du thème et ne peuvent pas entrer dans une `StyleSheet` statique.
