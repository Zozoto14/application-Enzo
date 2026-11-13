/**
 * Graines de développement des lineups (migration 0082) : pour la team Valorant, des lineups sur Ascent et Bind
 * (validés, proposés par des joueurs, favoris, points posés sur la minimap, liens avec les strats, une image
 * générée pour l'un d'eux) ; pour la team The Finals, des placements de gadgets et une défense de cashout.
 * Passe par le service (mêmes contrôles que l'app) ; l'image de démonstration est posée directement dans le
 * stockage (un envoi par morceaux n'a pas de sens ici).
 */

import { deflateSync } from 'node:zlib';
import { servicesLineups } from '../noyau/lineups/service.mjs';
import { servicesStrats } from '../noyau/strats/service.mjs';

/** PNG de démonstration (dégradé sombre, sol clair, repère de visée au centre), sans dépendance. */
export function pngDemo(largeur = 480, hauteur = 270, teinte = [70, 110, 160]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = octets => {
    let c = 0xffffffff;
    for (const o of octets) c = table[(c ^ o) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloc = (type, donnees) => {
    const t = Buffer.from(type, 'ascii');
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([longueur, t, donnees, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const lignes = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const debut = y * (largeur * 3 + 1);
    const sol = y > hauteur * 0.62;
    for (let x = 0; x < largeur; x++) {
      const viseur = (Math.abs(x - largeur / 2) < 2 && Math.abs(y - hauteur / 2) < 14) || (Math.abs(y - hauteur / 2) < 2 && Math.abs(x - largeur / 2) < 14);
      const k = sol ? 0.55 + (y / hauteur) * 0.35 : 0.25 + (y / hauteur) * 0.5 + (x / largeur) * 0.15;
      const i = debut + 1 + x * 3;
      for (let c = 0; c < 3; c++) lignes[i + c] = viseur ? 255 : Math.min(255, Math.round((sol ? [120, 110, 95][c] : teinte[c]) * k));
    }
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(lignes)), bloc('IEND', Buffer.alloc(0))]));
}

/** Pose une image de démonstration sur un lineup (ligne de `fichiers`, octets dans le stockage). */
async function poserImage(base, stockage, teamId, lineupId, role, position, octets, compte, maintenant) {
  if (!stockage) return;
  const id = globalThis.crypto.randomUUID();
  const cle = `teams/${teamId}/lineups/${globalThis.crypto.randomUUID()}.media`;
  await stockage.deposer(cle, octets, { type: 'image/png' });
  const t = new Date(maintenant()).toISOString();
  await base.lot([
    { sql: "INSERT INTO fichiers (id, team_id, entite_type, entite_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, cree_le, meta) VALUES (?, ?, 'lineup_media', ?, ?, 'image/png', ?, ?, ?, ?, ?, ?)", params: [id, teamId, lineupId, cle, octets.length, `${role}.png`, 'demo', compte, t, JSON.stringify({ format: 'png' })] },
    { sql: 'INSERT INTO lineup_medias (id, lineup_id, team_id, fichier_id, role, position, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [globalThis.crypto.randomUUID(), lineupId, teamId, id, role, position, compte, t] },
  ]);
}

const ASCENT = { cle: 'ascent', nom: 'Ascent' };
const BIND = { cle: 'bind', nom: 'Bind' };

/** Lineups de la team Valorant. `stratIds` : { exec, retake } (graines-strats.mjs), pour les liens. */
export async function semerLineups(base, teamId, { maintenant = () => Date.now(), noyau, stockage, stratIds = {} } = {}) {
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const lineups = servicesLineups({ base, stockage, cleSession: undefined, maintenant, socle: noyau, strats });
  const zed = { compte: 'zed12345', superAdmin: false };
  const lea = { compte: 'lea12345', superAdmin: false };
  const sam = { compte: 'sam12345', superAdmin: false };
  const omen = { cle: 'omen', nom: 'Omen' };
  const sova = { cle: 'sova', nom: 'Sova' };
  const viper = { cle: 'viper', nom: 'Viper' };
  const killjoy = { cle: 'killjoy', nom: 'Killjoy' };
  const smoke = await lineups.creer(zed, teamId, {
    titre: 'Smoke Heaven depuis A main',
    carte: ASCENT,
    personnage: omen,
    capacite: { cle: 'Ability2', nom: 'Dark Cover' },
    side: 'attaque',
    zone: { nom: 'A Heaven' },
    posture: 'debout',
    visee: 'Le coin haut gauche de la fenêtre, un cran au-dessus du toit.',
    timing: 'À 1:25, avant le contact',
    instructions: 'Collé au mur de A main, à côté de la caisse. Coupe la vue de Heaven pendant toute l’entrée.',
    difficulte: 1,
    tags: ['Exec A', 'Smoke'],
    depart: { x: 215, y: 610 },
    arrivee: { x: 300, y: 330 },
  });
  await poserImage(base, stockage, teamId, smoke.id, 'position', 0, pngDemo(480, 270, [70, 110, 160]), 'zed12345', maintenant);
  await poserImage(base, stockage, teamId, smoke.id, 'visee', 1, pngDemo(480, 270, [150, 90, 70]), 'zed12345', maintenant);
  await poserImage(base, stockage, teamId, smoke.id, 'resultat', 2, pngDemo(480, 270, [80, 140, 100]), 'zed12345', maintenant);
  const smokeCt = await lineups.creer(zed, teamId, {
    titre: 'Smoke CT (one-way)',
    carte: ASCENT,
    personnage: omen,
    capacite: { cle: 'Ability2', nom: 'Dark Cover' },
    side: 'attaque',
    zone: { nom: 'A CT' },
    posture: 'debout',
    visee: 'Le haut de l’arche, à la jonction des deux pierres.',
    instructions: 'Posée haut : on voit les pieds de celui qui sort de CT.',
    difficulte: 2,
    tags: ['Exec A', 'Smoke', 'One-way'],
    depart: { x: 235, y: 640 },
    arrivee: { x: 420, y: 260 },
  });
  const recon = await lineups.creer(lea, teamId, {
    titre: 'Flèche de reco A site',
    carte: ASCENT,
    personnage: sova,
    capacite: { cle: 'Ability2', nom: 'Recon Bolt' },
    side: 'attaque',
    zone: { nom: 'A Site' },
    posture: 'debout',
    visee: 'Deux rebonds, charge pleine, sur le bord de la gouttière.',
    timing: 'Dès l’ouverture des barrières',
    instructions: 'Révèle le site, Heaven et le générateur. À lancer depuis le lobby.',
    difficulte: 3,
    tags: ['Info'],
    depart: { x: 150, y: 720 },
    arrivee: { x: 330, y: 400 },
  });
  await lineups.creer(sam, teamId, {
    titre: 'Molly post-plant par défaut',
    carte: ASCENT,
    personnage: killjoy,
    capacite: { cle: 'Grenade', nom: 'Nanoswarm' },
    side: 'attaque',
    zone: { nom: 'A Site' },
    posture: 'accroupi',
    visee: 'Le sommet du lampadaire.',
    timing: 'Au son du defuse',
    instructions: 'Depuis A main, à l’abri. Couvre le spike posé par défaut.',
    difficulte: 2,
    tags: ['Post-plant'],
    depart: { x: 200, y: 660 },
    arrivee: { x: 345, y: 385 },
  });
  await lineups.creer(zed, teamId, {
    titre: 'Mur B main depuis le spawn',
    carte: ASCENT,
    personnage: viper,
    capacite: { cle: 'Ability2', nom: 'Toxic Screen' },
    side: 'defense',
    zone: { nom: 'B Main' },
    posture: 'debout',
    visee: 'L’angle du toit, aligné sur la ligne du HUD.',
    instructions: 'Coupe B main et le marché d’un seul mur.',
    difficulte: 2,
    tags: ['Défense B'],
    depart: { x: 640, y: 180 },
    arrivee: { x: 760, y: 520 },
  });
  await lineups.creer(zed, teamId, {
    titre: 'Smoke hookah',
    carte: BIND,
    personnage: omen,
    capacite: { cle: 'Ability2', nom: 'Dark Cover' },
    side: 'attaque',
    zone: { nom: 'B Window' },
    posture: 'debout',
    visee: 'Le bord droit de l’enseigne.',
    difficulte: 1,
    tags: ['Exec B', 'Smoke'],
    depart: { x: 300, y: 620 },
    arrivee: { x: 420, y: 420 },
  });
  await lineups.creer(lea, teamId, {
    titre: 'Recon showers',
    carte: BIND,
    personnage: sova,
    capacite: { cle: 'Ability2', nom: 'Recon Bolt' },
    side: 'attaque',
    zone: { nom: 'A Short' },
    posture: 'saut',
    visee: 'En sautant, viser la pointe du palmier.',
    difficulte: 3,
    tags: ['Info'],
  });
  await lineups.favori(lea, teamId, smoke.id, true);
  await lineups.favori(zed, teamId, recon.id, true);
  if (stratIds.exec) {
    await lineups.lierStrat(zed, teamId, smoke.id, stratIds.exec, { etape: 2 });
    await lineups.lierStrat(zed, teamId, smokeCt.id, stratIds.exec, { etape: 2 });
    await lineups.lierStrat(zed, teamId, recon.id, stratIds.exec, { etape: 1 });
  }
  return { smoke: smoke.id, recon: recon.id };
}

/** Placements de la team The Finals (gadgets, défense de cashout). */
export async function semerLineupsFinals(base, teamId, { maintenant = () => Date.now(), noyau, stockage } = {}) {
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const lineups = servicesLineups({ base, stockage, cleSession: undefined, maintenant, socle: noyau, strats });
  const fondateur = { compte: 'principal', superAdmin: true };
  const monaco = { cle: 'monaco', nom: 'Monaco' };
  await lineups.creer(fondateur, teamId, {
    titre: 'Dome Shield sur la station (toit)',
    carte: monaco,
    personnage: { cle: 'heavy', nom: 'Heavy' },
    capacite: { cle: 'dome-shield', nom: 'Dome Shield' },
    side: 'cashout',
    zone: { nom: 'Cashout du toit' },
    posture: 'debout',
    visee: 'Aux pieds, contre la station : le dôme couvre le vol.',
    timing: 'Dès que le vol commence',
    instructions: 'Le Heavy reste dans le dôme, le Medium tient l’escalier.',
    difficulte: 1,
    tags: ['Défense de cashout'],
    depart: { x: 500, y: 450 },
    arrivee: { x: 520, y: 420 },
  });
  await lineups.creer(fondateur, teamId, {
    titre: 'Jump Pad pour monter sur le toit',
    carte: monaco,
    personnage: { cle: 'medium', nom: 'Medium' },
    capacite: { cle: 'jump-pad', nom: 'Jump Pad' },
    side: 'cashout',
    zone: { nom: 'Ruelle sud' },
    posture: 'course',
    visee: 'Au pied du mur, légèrement incliné vers la façade.',
    instructions: 'Toute l’équipe monte en une fois ; le Light part en flank.',
    difficulte: 2,
    tags: ['Rotation'],
    depart: { x: 300, y: 640 },
    arrivee: { x: 470, y: 480 },
  });
  await lineups.creer(fondateur, teamId, {
    titre: 'Smoke sur la station pour le vol',
    carte: monaco,
    personnage: { cle: 'light', nom: 'Light' },
    capacite: { cle: 'smoke-grenade', nom: 'Smoke Grenade' },
    side: 'final-round',
    zone: { nom: 'Place centrale' },
    posture: 'saut',
    visee: 'Par-dessus le muret, sur la station.',
    difficulte: 2,
    tags: ['Vol'],
    depart: { x: 700, y: 300 },
    arrivee: { x: 560, y: 400 },
  });
}
