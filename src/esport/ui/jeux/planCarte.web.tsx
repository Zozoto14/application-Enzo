/** Plan d'une map sur le site et l'app PC : Konva n'est téléchargé qu'à l'ouverture des détails d'une map. */
import React from 'react';

export const PlanCarte = React.lazy(() => import('./EditeurCarte'));
