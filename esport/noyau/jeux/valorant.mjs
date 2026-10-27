/**
 * Profils préconfigurés (posés par la migration 0021_profils_jeu.sql) : Valorant, à partir des données
 * déjà présentes dans l'app (maps et agents de l'éditeur de strats, images des maps du Discord, postes du
 * catalogue), et « Autre jeu » (profil générique des teams créées avant les profils avec ce choix).
 *
 * Le test esport/test/profils-jeu.test.mjs vérifie que la migration pose EXACTEMENT ces données.
 * The Finals n'est pas préconfiguré : ses modes et maps changent à chaque saison, l'assistant IA le
 * prépare (brouillon relu par le Fondateur), voir docs/esport/profils-jeu.md.
 */

import { validerDonnees } from './schema.mjs';

/** Maps (ordre alphabétique) et identifiant de leur vignette sur media.valorant-api.com (Discord, noyau/discord/embeds.mjs). */
const CARTES = [
  ['Abyss', '224b0a95-48b9-f703-1bd8-67aca101a61f'],
  ['Ascent', '7eaecc1b-4337-bbf6-6ab9-04b8f06b3319'],
  ['Bind', '2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba'],
  ['Breeze', '2fb9a4fd-47b8-4e7d-a969-74b4046ebd53'],
  ['Corrode', null],
  ['Fracture', 'b529448b-4d60-346e-e89e-00a4c527a405'],
  ['Haven', '2bee0dc9-4ffe-519b-1cbd-7fbe763a6047'],
  ['Icebox', 'e2ad5c54-4114-a870-9641-8ea21279579a'],
  ['Lotus', '2fe4ed3a-450a-948b-6d6b-e89a78e680a9'],
  ['Pearl', 'fd267378-4d1d-484f-ff52-77821ed10dc2'],
  ['Split', 'd960549e-485c-e861-8d71-aa9d1aed12a2'],
  ['Sunset', '92584fbe-486a-b1b2-9faa-39b0f486b498'],
];

/** Agents et leur rôle (liste de repli de l'éditeur de strats, src/esport/strats/assets.ts). */
const AGENTS = [
  ['Astra', 'controleur'], ['Breach', 'initiateur'], ['Brimstone', 'controleur'], ['Chamber', 'sentinelle'], ['Clove', 'controleur'], ['Cypher', 'sentinelle'],
  ['Deadlock', 'sentinelle'], ['Fade', 'initiateur'], ['Gekko', 'initiateur'], ['Harbor', 'controleur'], ['Iso', 'duelliste'], ['Jett', 'duelliste'],
  ['KAY/O', 'initiateur'], ['Killjoy', 'sentinelle'], ['Neon', 'duelliste'], ['Omen', 'controleur'], ['Phoenix', 'duelliste'], ['Raze', 'duelliste'],
  ['Reyna', 'duelliste'], ['Sage', 'sentinelle'], ['Skye', 'initiateur'], ['Sova', 'initiateur'], ['Tejo', 'initiateur'], ['Viper', 'controleur'],
  ['Vyse', 'sentinelle'], ['Waylay', 'duelliste'], ['Yoru', 'duelliste'],
];

/** Données du profil Valorant (déjà validées : exactement ce que la migration enregistre). */
export function profilValorant() {
  return validerDonnees({
    formats: [{ cle: '5v5', nom: '5v5', equipes: 2, joueursParEquipe: 5, bo: [1, 3, 5], notes: '' }],
    score: {
      type: 'rounds',
      roundsGagnants: 13,
      roundsParMiTemps: 12,
      prolongations: { active: true, regle: 'À 12-12 : prolongations, victoire avec deux rounds d’écart.' },
      notes: '',
    },
    modes: [{ cle: 'competition', nom: 'Compétition', description: '5v5, 13 rounds gagnants, changement de côté après 12 rounds.', formats: ['5v5'], actif: true }],
    cartes: CARTES.map(([nom, id]) => ({ nom, image: id ? `https://media.valorant-api.com/maps/${id}/listviewicon.png` : null, actif: true, modes: ['competition'] })),
    classes: [
      { cle: 'duelliste', nom: 'Duelliste' },
      { cle: 'initiateur', nom: 'Initiateur' },
      { cle: 'controleur', nom: 'Contrôleur' },
      { cle: 'sentinelle', nom: 'Sentinelle' },
    ],
    personnages: AGENTS.map(([nom, classe]) => ({ nom, classe, image: null, actif: true })),
    roster: { titulaires: 5, remplacants: 2 },
    rolesJoueurs: ['Duelliste', 'Contrôleur', 'Initiateur', 'Sentinelle', 'Flex', 'IGL'].map(nom => ({ nom })),
    champs: [],
    libelles: { personnages: 'Agents', classes: 'Rôles', cartes: 'Maps' },
    sources: [
      { url: 'https://playvalorant.com/fr-fr/', titre: 'Site officiel' },
      { url: 'https://liquipedia.net/valorant/Main_Page', titre: 'Liquipedia' },
    ],
  }).donnees;
}

/** Profil générique « Autre jeu » (teams créées avec ce choix avant les profils de jeu). */
export function profilAutre() {
  return validerDonnees({ formats: [], modes: [], cartes: [], personnages: [], roster: null, score: null }).donnees;
}

export const PROFILS_PRECONFIGURES = [
  { cle: 'valorant', nom: 'Valorant', couleur: '#ff4655', base: 'valorant', donnees: profilValorant },
  { cle: 'autre', nom: 'Autre jeu', couleur: '#8b8b9a', base: null, donnees: profilAutre },
];
