# Hub : pages « Applications » et « Administration », registre des apps

## Ajouter une app = une entrée de registre

Chaque app du hub est une entrée de `src/hub/registre.tsx` (contrat `AppHub`, `src/hub/types.ts`).
Le hub en fait une tuile sur la bonne page, l'Administration une case d'autorisation (apps publiques) ;
rien d'autre à modifier. Champs qui décident **où** et **pour qui** :

| Champ | Rôle |
|---|---|
| `page` | Catégorie : `'publique'` → page « Applications » ; `'administration'` → page « Administration ». Absent : publique. |
| `adminSeulement` | Réservée : jamais proposée dans les autorisations d'un ami. |
| `rangs` | Avec `adminSeulement` : rangs qui l'ouvrent (ex. `['fondateur']`). Le compte historique voit tout. |
| `gestionnaire` | Avec `adminSeulement` et sans `rangs` : ouverte aux rangs d'administration (l'Administration, limitée pour un Gestionnaire). |
| `disponible` | Faux quand la plateforme ne peut pas la faire tourner. |

Exemple (une future app « Prospects ») :

```ts
{ id: 'prospects', nom: 'Prospects', categorie: 'Admin', page: 'administration',
  description: '…', icone: '◎', teinte: 'quatre', adminSeulement: true, rangs: ['fondateur'],
  Racine: Prospects }
```

## Les deux pages

Logique pure dans `src/hub/pages.ts` (testée dans `pages.test.tsx`) :

- `appsDePage(registre, contexte, page)` : apps visibles (`permissions.ts`) d'une page ;
- `pagesVisibles(registre, contexte)` : « Applications » toujours, « Administration » seulement si au
  moins une de ses apps est visible pour le profil (un ami ne l'a jamais ; un Gestionnaire l'a, pour
  l'Administration limitée ; un Fondateur y voit Administration et Abonnements) ;
- `pageEffective` : une page demandée mais non permise retombe sur « Applications ».

Navigation : onglets « ▦ Applications · ◈ Administration » en haut du hub sur bureau ; entrée « Admin »
de la barre basse sur téléphone (`NavigationMobile.onAdministration`). La page est tenue par l'hôte
(`App.tsx`, `pageHub`) : en quittant une app, on revient sur la page d'où on l'a ouverte.

## App « Abonnements »

`src/hub/abonnements/` : `registre.ts` (entrée, page Administration, Fondateurs), `AppAbonnements.tsx`
(écran, onglets Suivi · Réglages, verrouillage sur inactivité comme le panneau d'Administration),
`Suivi.tsx` (ex-section de l'Administration), `ReglagesAbonnements.tsx` (ex-Paramètres › Administration).

Les données n'ont pas bougé : `DonneesAdmin.abonnements` dans la base chiffrée du Fondateur, même
synchronisation et fusion (`admin/fusionDonnees.ts`), même journal, même projection vers l'espace de
chaque ami (rappel amical). Aucune migration. L'Administration n'a plus d'onglet Abonnements ; le
rappel de son tableau de bord et la cloche du hub (« Voir les abonnements ») ouvrent l'app.
