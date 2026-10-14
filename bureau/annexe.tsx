/**
 * Fenêtre annexe de l'application de bureau : une app du hub dans sa propre
 * fenêtre, sur la session de la fenêtre principale (voir
 * `src/hub/multi/fenetres.ts`).
 *
 * Rien n'est ouvert ici : ni coffre, ni base, ni synchronisation, ni
 * préchargement. L'annexe reçoit la session déjà ouverte et le contrôle des
 * profils (sans « Changer de compte »), et se ferme dès que la fenêtre
 * principale se ferme, se recharge ou se verrouille.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { App } from '../src/app/App';
import { GardeErreur } from '../src/ui/GardeErreur';
import { assurerThemeDocument } from '../src/ui/theme';
import { changerDEspace } from '../src/profils/espace';
import type { ControleProfils } from '../src/ui/ecrans/CarteProfils';
import type { Session } from '../src/session/session';
import { ecrireBornes, sessionPourAnnexe, type ContexteAnnexe } from '../src/hub/multi/fenetres';
import { useFondDocument } from './Bureau';

/** Le contrôle des profils de la fenêtre principale, sans changement de compte depuis l'annexe. */
function profilsPourAnnexe(brut: unknown): ControleProfils | undefined {
  const controle = brut as ControleProfils | undefined;
  if (!controle) {
    return undefined;
  }
  return { ...controle, peutChanger: false, onChanger: () => undefined, onConnexion: undefined };
}

export function RacineAnnexe({ contexte }: { contexte: ContexteAnnexe }) {
  const sombre = useColorScheme() === 'dark';
  useFondDocument(sombre);
  assurerThemeDocument();
  const session = useMemo(() => sessionPourAnnexe(contexte.session as Session, contexte), [contexte]);
  const [profils, setProfils] = useState(() => profilsPourAnnexe(contexte.profils()));
  const [, setVersion] = useState(0);

  // Même espace local que le compte ouvert dans la fenêtre principale (thème, réglages de l'appareil).
  useState(() => {
    const id = profils?.actuel.id;
    if (id) changerDEspace(id);
    return true;
  });

  // Écritures faites ailleurs : les droits ou les comptes ont pu changer.
  useEffect(
    () =>
      contexte.ecouter(() => {
        setProfils(profilsPourAnnexe(contexte.profils()));
        setVersion(n => n + 1);
      }),
    [contexte],
  );

  // La fenêtre principale fermée, rechargée ou verrouillée : l'annexe se ferme aussi.
  useEffect(() => {
    const fenetre = globalThis as unknown as Window;
    const fermer = () => {
      try {
        contexte.fermee();
      } catch {
        // Fenêtre principale déjà partie.
      }
      fenetre.close();
    };
    const verifier = () => {
      let vivante = false;
      try {
        vivante = Boolean(fenetre.opener && !fenetre.opener.closed && (contexte.session as Session).statut() === 'deverrouille');
      } catch {
        vivante = false;
      }
      if (!vivante) fermer();
    };
    const minuterie = setInterval(verifier, 1000);
    // Taille et place retenues pour la prochaine ouverture de cette app dans une fenêtre.
    const retenir = () => {
      ecrireBornes(contexte.app, { x: fenetre.screenX, y: fenetre.screenY, largeur: fenetre.outerWidth, hauteur: fenetre.outerHeight });
    };
    let attente: ReturnType<typeof setTimeout> | undefined;
    const redimension = () => {
      if (attente) clearTimeout(attente);
      attente = setTimeout(retenir, 400);
    };
    const depart = () => {
      retenir();
      try {
        contexte.fermee();
      } catch {
        // Fenêtre principale déjà partie.
      }
    };
    fenetre.addEventListener('resize', redimension);
    fenetre.addEventListener('pagehide', depart);
    return () => {
      clearInterval(minuterie);
      if (attente) clearTimeout(attente);
      fenetre.removeEventListener('resize', redimension);
      fenetre.removeEventListener('pagehide', depart);
    };
  }, [contexte]);

  return (
    <GardeErreur quoi="cette fenêtre">
      <App session={session} profils={profils} hub annexe={contexte} />
    </GardeErreur>
  );
}
