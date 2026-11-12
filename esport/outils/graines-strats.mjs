/**
 * Graines de développement des strats et du playbook (phase 6) : deux strats
 * (une exécution A sur Ascent en trois étapes, un retake B sur Bind), une
 * strat privée, et un playbook (entrées liées, une entrée textuelle, une
 * validée, une archivée). Les images pointent vers le CDN de valorant-api.com
 * (repli générique dans l'app si le réseau manque). Passe par les services.
 */

import { COULEURS_JOUEURS } from '../noyau/strats/document.mjs';
import { servicesPlaybook } from '../noyau/strats/playbook.mjs';
import { servicesStrats } from '../noyau/strats/service.mjs';

const CDN = 'https://media.valorant-api.com';
// Identifiants publics de valorant-api.com (cartes et agents), stables d'une version du jeu à l'autre.
const ASCENT = { cle: 'ascent', nom: 'Ascent', image: `${CDN}/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/displayicon.png` };
const BIND = { cle: 'bind', nom: 'Bind', image: `${CDN}/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/displayicon.png` };
const agent = (cle, nom, uuid) => ({ agent: cle, nom, icone: `${CDN}/agents/${uuid}/displayicon.png` });
const OMEN = agent('omen', 'Omen', '8e253930-4c05-31dd-1b6c-968525494517');
const JETT = agent('jett', 'Jett', 'add6443a-41bd-e414-f6ad-e58d267f4e95');
const SOVA = agent('sova', 'Sova', '320b2a48-4d9b-a075-30f1-1f93a9b638fa');
const KILLJOY = agent('killjoy', 'Killjoy', '1e58de9c-4950-5125-93e9-a0aee9f98746');
const SAGE = agent('sage', 'Sage', '569fdd95-4d10-43ab-ca70-79becc718b46');

const joueurs = (agents) => COULEURS_JOUEURS.map((couleur, i) => ({ nom: ['Léa', 'Kai', 'Inès', 'Sam', 'Max'][i], couleur, agent: agents[i] ?? null }));

function execA() {
  const c = COULEURS_JOUEURS;
  return {
    format: 'esport-strat',
    version: 2,
    jeu: 'valorant',
    carte: ASCENT,
    side: 'attaque',
    joueurs: joueurs(['jett', 'omen', 'sova', 'killjoy', 'sage']),
    etapes: [
      {
        id: 'e1',
        titre: 'Mise en place',
        note: 'Tout le monde à A lobby, Sova prépare la flèche de reco.',
        objets: [
          { id: 'a1', type: 'agent', x: 180, y: 640, ...JETT, joueur: 0, couleur: c[0] },
          { id: 'a2', type: 'agent', x: 220, y: 700, ...OMEN, joueur: 1, couleur: c[1] },
          { id: 'a3', type: 'agent', x: 150, y: 720, ...SOVA, joueur: 2, couleur: c[2] },
          { id: 'a4', type: 'agent', x: 260, y: 760, ...KILLJOY, joueur: 3, couleur: c[3] },
          { id: 'a5', type: 'agent', x: 300, y: 690, ...SAGE, joueur: 4, couleur: c[4] },
          { id: 't1', type: 'texte', x: 120, y: 560, texte: 'A lobby', couleur: '#ffffff', taille: 26 },
        ],
      },
      {
        id: 'e2',
        titre: 'Utilitaires',
        note: 'Smokes heaven et CT, mur de Sage pour couper le tree.',
        objets: [
          { id: 'c1', type: 'capacite', x: 300, y: 330, agent: 'omen', capacite: 'Ability2', nom: 'Dark Cover', icone: null, joueur: 1, couleur: c[1], zone: { forme: 'cercle', rayon: 42 } },
          { id: 'c2', type: 'capacite', x: 420, y: 260, agent: 'omen', capacite: 'Ability2', nom: 'Dark Cover', icone: null, joueur: 1, couleur: c[1], zone: { forme: 'cercle', rayon: 42 } },
          { id: 'c3', type: 'capacite', x: 380, y: 470, agent: 'sage', capacite: 'Ability1', nom: 'Barrier Orb', icone: null, joueur: 4, couleur: c[4], zone: { forme: 'mur', dx: 90, dy: -40, epaisseur: 10 } },
          { id: 'c4', type: 'capacite', x: 240, y: 520, agent: 'sova', capacite: 'Ability2', nom: 'Recon Bolt', icone: null, joueur: 2, couleur: c[2], zone: { forme: 'cone', rayon: 160, angle: -45, ouverture: 70 } },
        ],
      },
      {
        id: 'e3',
        titre: 'Entrée',
        note: 'Jett dash sur site, le reste suit en trade.',
        objets: [
          { id: 'f1', type: 'fleche', points: [180, 640, 250, 520, 330, 420], couleur: c[0], epaisseur: 5 },
          { id: 'f2', type: 'fleche', points: [220, 700, 300, 560, 360, 470], couleur: c[1], epaisseur: 4, tirets: true },
          { id: 'r1', type: 'forme', forme: 'rect', x: 280, y: 300, l: 200, h: 180, couleur: '#f97316', remplie: true },
        ],
      },
    ],
  };
}

function retakeB() {
  const c = COULEURS_JOUEURS;
  return {
    format: 'esport-strat',
    version: 2,
    jeu: 'valorant',
    carte: BIND,
    side: 'defense',
    joueurs: joueurs(['sage', 'omen', 'sova', 'killjoy', 'jett']),
    etapes: [
      {
        id: 'e1',
        titre: 'Retake par le hall',
        note: 'Attendre l’ult de Sova avant d’entrer.',
        objets: [
          { id: 'a1', type: 'agent', x: 720, y: 520, ...SAGE, joueur: 0, couleur: c[0] },
          { id: 'a2', type: 'agent', x: 760, y: 560, ...OMEN, joueur: 1, couleur: c[1] },
          { id: 'f1', type: 'fleche', points: [720, 520, 640, 420, 560, 360], couleur: c[0], epaisseur: 5 },
        ],
      },
    ],
  };
}

/** Strat au format courant (v3) : phases, économie, utilitaires à l'échelle et ordonnés, trajets minutés, vision. */
function execAv3() {
  const c = COULEURS_JOUEURS;
  const cap = (id, x, y, ag, slot, nom, j, zone, ordre, t) => ({ id, type: 'capacite', x, y, agent: ag, capacite: slot, nom, icone: null, joueur: j, couleur: c[j], zone, ordre, t });
  return {
    format: 'esport-strat',
    version: 3,
    jeu: 'valorant',
    modele: 'valorant',
    carte: ASCENT,
    side: 'attaque',
    economie: 'full',
    joueurs: joueurs(['jett', 'omen', 'sova', 'killjoy', 'sage']).slice(0, 5).map((j, i) => ({ ...j, role: ['Entry', 'Smokes', 'Initiateur', 'Lurk', 'Support'][i] })),
    etapes: [
      {
        id: 'e1',
        titre: 'Setup A lobby',
        note: 'Sova prépare la flèche de reco depuis le lobby.',
        phase: 'setup',
        duree: 6,
        objets: [
          { id: 'a1', type: 'agent', x: 180, y: 640, ...JETT, joueur: 0, couleur: c[0], angle: -60 },
          { id: 'a2', type: 'agent', x: 220, y: 700, ...OMEN, joueur: 1, couleur: c[1] },
          { id: 'a3', type: 'agent', x: 150, y: 720, ...SOVA, joueur: 2, couleur: c[2] },
          { id: 'a4', type: 'agent', x: 520, y: 760, ...KILLJOY, joueur: 3, couleur: c[3] },
          { id: 'a5', type: 'agent', x: 300, y: 690, ...SAGE, joueur: 4, couleur: c[4] },
          cap('c1', 300, 420, 'sova', 'Ability2', 'Recon Bolt', 2, { forme: 'trajet', dx: -150, dy: 300, rayon: 30 }, 1, 2),
          { id: 'v1', type: 'vision', x: 520, y: 760, angle: -90, ouverture: 90, portee: 30, joueur: 3, couleur: c[3] },
        ],
      },
      {
        id: 'e2',
        titre: 'Exécution A',
        note: 'Smokes heaven et CT, mur de Sage, flash de Jett puis entrée.',
        phase: 'execute',
        duree: 8,
        objets: [
          { id: 'a1', type: 'agent', x: 180, y: 640, ...JETT, joueur: 0, couleur: c[0] },
          { id: 'a2', type: 'agent', x: 220, y: 700, ...OMEN, joueur: 1, couleur: c[1] },
          cap('c2', 300, 330, 'omen', 'Ability2', 'Dark Cover', 1, { forme: 'cercle', rayon: 4.1 }, 1, 0),
          cap('c3', 420, 260, 'omen', 'Ability2', 'Dark Cover', 1, { forme: 'cercle', rayon: 4.1 }, 2, 0.5),
          cap('c4', 380, 470, 'sage', 'Grenade', 'Barrier Orb', 4, { forme: 'mur', angle: -25, longueur: 10.5, largeur: 1, courbure: 0 }, 3, 1.5),
          cap('c5', 330, 420, 'jett', 'Grenade', 'Cloudburst', 0, { forme: 'cercle', rayon: 3.35 }, 4, 3),
          { id: 'f1', type: 'fleche', points: [180, 640, 250, 520, 330, 420], couleur: c[0], epaisseur: 5, joueur: 0, t0: 3, t1: 7 },
          { id: 'f2', type: 'fleche', points: [220, 700, 300, 560, 360, 470], couleur: c[1], epaisseur: 4, tirets: true, joueur: 1, t0: 4, t1: 8 },
        ],
      },
      {
        id: 'e3',
        titre: 'Post-plant',
        note: 'Molly sur le spike depuis le générateur.',
        phase: 'post-plant',
        duree: 5,
        objets: [{ id: 'm1', type: 'marqueur', x: 360, y: 360, genre: 'plant', etiquette: 'Plant default', couleur: '#f59e0b' }],
      },
    ],
  };
}

/** Profil The Finals (modèle « thefinals ») et sa team de démonstration, avec une strat de cashout. */
export async function semerTheFinals(base, { maintenant = () => Date.now(), noyau, stockage } = {}) {
  const { validerDonnees } = await import('../noyau/jeux/schema.mjs');
  const t = new Date(maintenant()).toISOString();
  const donnees = validerDonnees({
    formats: [{ cle: '3v3v3v3', nom: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1, 3] }],
    modes: [{ cle: 'cashout', nom: 'Cashout', formats: ['3v3v3v3'] }],
    cartes: ['Monaco', 'Seoul', 'Skyway Stadium', 'Las Vegas', 'Kyoto'].map(nom => ({ nom, modes: ['cashout'], niveaux: [{ nom: 'RDC' }, { nom: 'Étage 1' }, { nom: 'Toit' }] })),
    classes: [{ cle: 'light', nom: 'Light' }, { cle: 'medium', nom: 'Medium' }, { cle: 'heavy', nom: 'Heavy' }],
    personnages: [
      { cle: 'light', nom: 'Light', classe: 'light', capacites: [{ nom: 'Grappling Hook', categorie: 'specialisation', forme: 'ligne', longueur: 20, aVerifier: true }, { nom: 'Smoke Grenade', categorie: 'gadget', forme: 'cercle', rayon: 6, duree: 15, aVerifier: true }] },
      { cle: 'medium', nom: 'Medium', classe: 'medium', capacites: [{ nom: 'Zipline', categorie: 'gadget', forme: 'ligne', longueur: 40, aVerifier: true }, { nom: 'Jump Pad', categorie: 'gadget', forme: 'cercle', rayon: 2, aVerifier: true }] },
      { cle: 'heavy', nom: 'Heavy', classe: 'heavy', capacites: [{ nom: 'Dome Shield', categorie: 'gadget', forme: 'cercle', rayon: 4.5, duree: 12, aVerifier: true }, { nom: 'Mesh Shield', categorie: 'specialisation', forme: 'mur', longueur: 3, largeur: 0.3, aVerifier: true }] },
    ],
    roster: { titulaires: 3, remplacants: 1 },
  }).donnees;
  await base.executer(
    "INSERT INTO jeux (cle, nom, couleur, statut, donnees, version, modele_strat, cree_le, maj_le) VALUES ('the-finals', 'The Finals', '#d31f3c', 'actif', ?, 1, 'thefinals', ?, ?) ON CONFLICT (cle) DO NOTHING",
    [JSON.stringify(donnees), t, t],
  );
  const fondateur = { compte: 'principal', superAdmin: true };
  const { team } = await noyau.creerTeam(fondateur, { nom: 'The Final LZ0', jeu: 'the-finals', preset: 'valorant_complet', description: 'Team The Finals de démonstration.' });
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const c = COULEURS_JOUEURS;
  await strats.creer(fondateur, team.id, {
    titre: 'Cashout Monaco : prise par le toit',
    type: 'execute',
    tags: ['Cashout'],
    donnees: {
      format: 'esport-strat',
      version: 3,
      carte: { cle: 'monaco', nom: 'Monaco', image: null },
      side: 'attaque',
      joueurs: [
        { nom: 'Léa', couleur: c[0], agent: 'light', role: 'Flank' },
        { nom: 'Kai', couleur: c[1], agent: 'medium', role: 'Support' },
        { nom: 'Max', couleur: c[2], agent: 'heavy', role: 'Anchor' },
      ],
      etapes: [
        {
          id: 'e1',
          titre: 'Rotation vers le cashout',
          note: 'Équipe 2 probable au sud : on passe par le toit.',
          phase: 'approche',
          duree: 8,
          objets: [
            { id: 'a1', type: 'agent', x: 200, y: 800, agent: 'light', nom: 'Light', icone: null, joueur: 0, couleur: c[0], niveau: 0 },
            { id: 'a2', type: 'agent', x: 240, y: 820, agent: 'medium', nom: 'Medium', icone: null, joueur: 1, couleur: c[1], niveau: 0 },
            { id: 'a3', type: 'agent', x: 220, y: 860, agent: 'heavy', nom: 'Heavy', icone: null, joueur: 2, couleur: c[2], niveau: 0 },
            { id: 'm1', type: 'marqueur', x: 520, y: 420, genre: 'cashout', etiquette: 'Cashout', couleur: '#22c55e', niveau: 2 },
            { id: 'm2', type: 'marqueur', x: 760, y: 640, genre: 'ennemi', etiquette: '', couleur: '#f43f5e', equipe: 2 },
            { id: 'm3', type: 'marqueur', x: 460, y: 480, genre: 'destruction-sol', etiquette: 'Casser le toit', couleur: '#f97316', niveau: 2 },
            { id: 'f1', type: 'fleche', points: [200, 800, 300, 600, 460, 480], couleur: c[0], epaisseur: 5, tirets: true, joueur: 0, t0: 0, t1: 7, niveau: 0 },
          ],
        },
        {
          id: 'e2',
          titre: 'Prise et tenue',
          note: 'Dome Shield sur la station, Zipline pour l’équipe.',
          phase: 'prise',
          duree: 10,
          objets: [
            { id: 'c1', type: 'capacite', x: 520, y: 420, agent: 'heavy', capacite: 'dome-shield', nom: 'Dome Shield', icone: null, joueur: 2, couleur: c[2], zone: { forme: 'cercle', rayon: 4.5 }, ordre: 1, niveau: 2 },
            { id: 'c2', type: 'capacite', x: 380, y: 560, agent: 'medium', capacite: 'zipline', nom: 'Zipline', icone: null, joueur: 1, couleur: c[1], zone: { forme: 'ligne', angle: -40, longueur: 30 }, ordre: 2, niveau: 1 },
            { id: 'm4', type: 'marqueur', x: 820, y: 220, genre: 'tiers', etiquette: 'Équipe 3 en tiers', couleur: '#f59e0b', equipe: 3 },
          ],
        },
      ],
    },
  });
  return team.id;
}

export async function semerStrats(base, teamId, { maintenant = () => Date.now(), noyau, stockage } = {}) {
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const playbook = servicesPlaybook({ base, maintenant, socle: noyau, strats });
  const zed = { compte: 'zed12345', superAdmin: false };
  const ana = { compte: 'ana12345', superAdmin: false };
  const exec = await strats.creer(zed, teamId, { titre: 'Exécution A (split)', type: 'execute', tags: ['A', 'Split'], notes: 'Strat de référence sur Ascent.', donnees: execA() });
  const retake = await strats.creer(ana, teamId, { titre: 'Retake B', type: 'retake', tags: ['B'], donnees: retakeB() });
  await strats.creer(zed, teamId, { titre: 'Exécution A (full buy, minutée)', type: 'execute', tags: ['A', 'Full'], notes: 'Format courant : phases, ordre des utilitaires, trajets minutés.', donnees: execAv3() });
  await strats.creer(ana, teamId, { titre: 'Idée : fake A', type: 'other', carte: ASCENT, side: 'attaque', visibilite: 'privee' });
  await playbook.creer(zed, teamId, { stratId: exec.id, tags: ['A', 'Exec'], description: 'Notre exécution principale.', statut: 'validee', favori: true });
  await playbook.creer(ana, teamId, { stratId: retake.id, tags: ['B'], description: 'À répéter au prochain entraînement.' });
  await playbook.creer(zed, teamId, { titre: 'Protocole anti-éco', type: 'eco', carte: null, description: 'Stack sur un site, pas de peek seul, on joue les trades.', tags: ['Éco'], statut: 'validee' });
  await playbook.creer(zed, teamId, { titre: 'Ancien default Bind', type: 'default', carte: { cle: 'bind', nom: 'Bind' }, side: 'attaque', statut: 'archivee' });
  return { exec: exec.id, retake: retake.id };
}
