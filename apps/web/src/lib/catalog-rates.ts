import { useQuery } from '@tanstack/react-query';
import { getAccessToken } from './auth-client.js';
import { isSelectableCompany } from './cart-validation.js';
import { catalogQueries, companiesQueries } from './queries.js';

// Prices are for signed-in, verified customers only; the API enforces it (GET /catalog/rates).
export function useCatalogRates() {
  const signedIn = Boolean(getAccessToken());
  const { data: companies } = useQuery({ ...companiesQueries.mine(), enabled: signedIn });
  const verified = Boolean(companies?.some(isSelectableCompany));
  const { data } = useQuery({ ...catalogQueries.rates(), enabled: verified });
  const rateById = new Map(data?.items.map((r) => [r.equipmentId, r.rateValue]));
  const priceNote = !signedIn ? 'Log in to see prices' : verified ? 'Price on request' : 'Verify your company to see prices';
  return { rateById, priceNote };
}
