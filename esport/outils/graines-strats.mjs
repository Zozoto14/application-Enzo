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

export async function semerStrats(base, teamId, { maintenant = () => Date.now(), noyau, stockage } = {}) {
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const playbook = servicesPlaybook({ base, maintenant, socle: noyau, strats });
  const zed = { compte: 'zed12345', superAdmin: false };
  const ana = { compte: 'ana12345', superAdmin: false };
  const exec = await strats.creer(zed, teamId, { titre: 'Exécution A (split)', type: 'execute', tags: ['A', 'Split'], notes: 'Strat de référence sur Ascent.', donnees: execA() });
  const retake = await strats.creer(ana, teamId, { titre: 'Retake B', type: 'retake', tags: ['B'], donnees: retakeB() });
  await strats.creer(ana, teamId, { titre: 'Idée : fake A', type: 'other', carte: ASCENT, side: 'attaque', visibilite: 'privee' });
  await playbook.creer(zed, teamId, { stratId: exec.id, tags: ['A', 'Exec'], description: 'Notre exécution principale.', statut: 'validee', favori: true });
  await playbook.creer(ana, teamId, { stratId: retake.id, tags: ['B'], description: 'À répéter au prochain entraînement.' });
  await playbook.creer(zed, teamId, { titre: 'Protocole anti-éco', type: 'eco', carte: null, description: 'Stack sur un site, pas de peek seul, on joue les trades.', tags: ['Éco'], statut: 'validee' });
  await playbook.creer(zed, teamId, { titre: 'Ancien default Bind', type: 'default', carte: { cle: 'bind', nom: 'Bind' }, side: 'attaque', statut: 'archivee' });
  return { exec: exec.id, retake: retake.id };
}
