import { useQuery } from '@tanstack/react-query';
import { catalogQueries } from './queries.js';

// Rates ride on the public catalog; verification gates booking, not browsing.
export function useCatalogRates() {
  const { data } = useQuery(catalogQueries.equipment());
  const rateById = new Map(data?.items.map((eq) => [eq.id, eq.rateValue]));
  return { rateById, priceNote: 'Price on request' };
}
