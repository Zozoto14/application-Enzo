/**
 * État de l'app Tâches : données du rôle (Fondateur : les siennes ; ami : la
 * copie partagée), relues après une synchronisation et toutes les 3 s (une
 * réception arrive sans prévenir), et écrites dans la base chiffrée du
 * profil à chaque modification VALIDÉE (jamais à chaque frappe). Chaque
 * modification repart de ce qui est enregistré : une réception arrivée entre
 * deux gestes n'est pas écrasée.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContexteHub } from '../../hub/types';
import { aleatoireParDefaut } from '../../securite/aleatoire';
import { roleTaches, type RoleTaches } from '../acces';
import { jourDe } from '../dates';
import { changerReglages, ecrireDonnees, lireDonnees, type Auteur, type Contexte, type DonneesTaches } from '../modele';
import { CLES_TACHES, lireCopie, type CopieAmi } from '../partage';
import { lireEtatRappels, marquerRappelsLus, type AlerteRappel } from '../rappels';

export interface EtatApp {
  role: RoleTaches;
  donnees: DonneesTaches;
  copie?: CopieAmi;
  noms: Record<Auteur, string>;
  /** « par le Fondateur » / « par Enzo ». */
  parFondateur: string;
  aujourdhui: string;
  maintenant(): number;
  /** Applique une modification ; rend les données enregistrées. */
  maj(changer: (d: DonneesTaches, ctx: Contexte) => DonneesTaches): DonneesTaches;
  rappels: AlerteRappel[];
  rappelsLus(): void;
  /** Fondateur : choisit l'ami (un seul) et lui ouvre l'app ; `undefined` retire le partage. */
  choisirAmi(id: string | undefined, nom?: string): Promise<void>;
}

const enOctetsHex = (o: Uint8Array) => [...o].map(b => b.toString(16).padStart(2, '0')).join('');

export function useEtatTaches(contexte: ContexteHub): EtatApp {
  const role = roleTaches(contexte) ?? 'fondateur';
  const base = contexte.baseProfil;
  const cle = role === 'fondateur' ? CLES_TACHES.donnees : CLES_TACHES.copie;
  const lireBrut = useCallback(() => {
    try {
      return base?.lire(cle) ?? '';
    } catch {
      return '';
    }
  }, [base, cle]);
  const [brut, setBrut] = useState(lireBrut);
  const [brutRappels, setBrutRappels] = useState(() => base?.lire(CLES_TACHES.rappels) ?? '');
  const relire = useCallback(() => {
    const b = lireBrut();
    setBrut(p => (p === b ? p : b));
    const r = base?.lire(CLES_TACHES.rappels) ?? '';
    setBrutRappels(p => (p === r ? p : r));
  }, [lireBrut, base]);
  const version = contexte.profils?.versionComptes ?? 0;
  useEffect(() => relire(), [relire, version]);
  useEffect(() => {
    const t = setInterval(relire, 3000);
    return () => clearInterval(t);
  }, [relire]);

  const copie = useMemo(() => (role === 'ami' ? lireCopie(brut) : undefined), [role, brut]);
  const donnees = useMemo(() => (role === 'ami' ? copie!.donnees : lireDonnees(brut || undefined)), [role, brut, copie]);
  const maintenant = useCallback(() => contexte.maintenant ?? Date.now(), [contexte.maintenant]);
  const nomMoi = contexte.profil?.nom && contexte.profil.nom !== 'Moi' ? contexte.profil.nom : 'Moi';
  const noms: Record<Auteur, string> =
    role === 'fondateur'
      ? { fondateur: nomMoi, ami: donnees.reglages.amiNom ?? 'Ami' }
      : { fondateur: copie?.fondateur ?? 'Fondateur', ami: copie?.ami ?? nomMoi };

  const courant = useRef({ role, cle, base });
  courant.current = { role, cle, base };
  const maj = useCallback(
    (changer: (d: DonneesTaches, ctx: Contexte) => DonneesTaches): DonneesTaches => {
      const { role: r, cle: c, base: b } = courant.current;
      const enregistre = b?.lire(c) ?? '';
      const copieActuelle = r === 'ami' ? lireCopie(enregistre) : undefined;
      const actuelles = copieActuelle ? copieActuelle.donnees : lireDonnees(enregistre || undefined);
      const suivantes = changer(actuelles, { maintenant: maintenant(), auteur: r });
      if (suivantes === actuelles) return actuelles;
      const texte = copieActuelle ? JSON.stringify({ ...copieActuelle, donnees: suivantes }) : ecrireDonnees(suivantes);
      b?.ecrire(c, texte);
      setBrut(texte);
      return suivantes;
    },
    [maintenant],
  );

  const rappels = useMemo(() => lireEtatRappels(brutRappels).nonLus, [brutRappels]);
  const rappelsLus = useCallback(() => {
    const etat = marquerRappelsLus(lireEtatRappels(base?.lire(CLES_TACHES.rappels)));
    const texte = JSON.stringify(etat);
    base?.ecrire(CLES_TACHES.rappels, texte);
    setBrutRappels(texte);
  }, [base]);

  const profils = contexte.profils;
  const choisirAmi = useCallback(
    async (id: string | undefined, nom?: string) => {
      const avant = lireDonnees(base?.lire(CLES_TACHES.donnees) ?? undefined).reglages.ami;
      maj((d, ctx) =>
        changerReglages(
          d,
          id
            ? { ami: id, amiNom: nom, cle: d.reglages.ami === id && d.reglages.cle ? d.reglages.cle : enOctetsHex(aleatoireParDefaut(32)) }
            : { ami: undefined, amiNom: undefined, cle: undefined },
          ctx,
        ),
      );
      // L'app s'ouvre à l'ami choisi, et se ferme à l'ancien (accès `taches` de son compte).
      if (profils?.onAutoriser) {
        const tous = profils.tous ?? [];
        for (const p of tous) {
          if (p.admin) continue;
          const apps = p.apps ?? [];
          const doit = p.id === id;
          if (doit && !apps.includes('taches')) await profils.onAutoriser(p.id, [...apps, 'taches']);
          if (!doit && apps.includes('taches') && (p.id === avant || id !== undefined)) await profils.onAutoriser(p.id, apps.filter(a => a !== 'taches'));
        }
      }
    },
    [base, maj, profils],
  );

  const parFondateur = noms.fondateur === 'Fondateur' ? 'le Fondateur' : noms.fondateur;
  return { role, donnees, copie, noms, parFondateur, aujourdhui: jourDe(maintenant()), maintenant, maj, rappels, rappelsLus, choisirAmi };
}
