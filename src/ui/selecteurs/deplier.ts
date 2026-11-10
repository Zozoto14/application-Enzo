/**
 * Tests : déplie un sélecteur repliable (SelecteurRepliable) avant d'en toucher un élément, s'il est replié.
 * `testID` est celui du sélecteur ; l'élément garde l'identifiant `${testID}-${id}` des anciennes pastilles.
 */
import { fireEvent, screen } from '@testing-library/react-native';

export async function deplier(testID: string, id?: string): Promise<void> {
  const bouton = await screen.findByTestId(`${testID}-modifier`);
  if (id !== undefined ? screen.queryByTestId(`${testID}-${id}`) : screen.queryByTestId(`${testID}-liste`)) return;
  await fireEvent.press(bouton);
}

/** Déplie si besoin, puis touche l'élément. */
export async function choisirDans(testID: string, id: string): Promise<void> {
  await deplier(testID, id);
  await fireEvent.press(screen.getByTestId(`${testID}-${id}`));
}
