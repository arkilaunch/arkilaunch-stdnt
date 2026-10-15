import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { storefrontLayoutRoute } from './_storefront.js';
import { Button, buttonClass } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { EquipmentSchematic } from '../components/equipment-schematic.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';
import { formatPeso } from '../lib/format.js';
import { ApiError } from '../lib/api-client.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';
import { addToCart, defaultRentalWindow } from '../lib/cart-client.js';
import { getAccessToken } from '../lib/auth-client.js';
import { pageTitle } from '../lib/brand.js';
import { useTenantName } from '../lib/tenant.js';
import { useCatalogRates } from '../lib/catalog-rates.js';

function EquipmentDetailPage() {
  const { equipmentId } = equipmentDetailRoute.useParams();
  const navigate = useNavigate();
  const signedIn = Boolean(getAccessToken());
  const { rateById, priceNote } = useCatalogRates();
  const {
    data: equipment,
    isPending,
    error,
    refetch,
  } = useQuery(catalogQueries.equipmentDetail(equipmentId));

  // The same title the edge Worker writes (lib/brand.ts).
  const tenantName = useTenantName();
  useEffect(() => {
    const title = equipment && tenantName ? pageTitle(`/equipment/${equipmentId}`, tenantName, equipment.model) : null;
    if (title) document.title = title;
  }, [equipment, tenantName, equipmentId]);

  if (isPending) {
    return <Skeleton label="Loading equipment" rows={2} className="px-6 py-10 sm:px-10" />;
  }

  if (error && !(error instanceof ApiError && error.status === 404)) {
    return (
      <div className="px-6 py-10 sm:px-10">
        <LoadError
          message="This listing could not be loaded just now. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (!equipment) {
    return (
      <div className="px-6 py-10 sm:px-10">
        <EmptyState
          title="Equipment not found"
          description="That listing may have been rented out or removed."
          action={
            <Link to="/equipment" className={buttonClass('secondary')}>Back to equipments</Link>
          }
        />
      </div>
    );
  }

  const unavailable = equipment.availabilityStatus !== 'available';
  const imageUrl = equipment.photoUri ?? equipmentImageUrl(equipment.model);

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <div
        className={[
'flex aspect-video items-center justify-center overflow-hidden rounded-md bg-bg',
          imageUrl ? '' : 'p-10',
        ].join(' ')}
      >
        <EquipmentSchematic
          typeName={equipment.equipmentTypeName}
          {...(imageUrl ? { imageUrl } : {})}
          className="max-h-full"
        />
      </div>
      {imageUrl && equipment.photoCredit && (
        // A reference photo is credited to its source, never passed off as this unit.
        <p className="-mt-4 text-xs text-text-muted">
          Reference photo:{' '}
          {equipment.photoSourceUrl ? (
            <a href={equipment.photoSourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {equipment.photoCredit}
            </a>
          ) : (
            equipment.photoCredit
          )}
        </p>
      )}
      <div>
        <h1 className="text-display-md text-text">{equipment.model}</h1>
        <p className="text-sm text-text-muted">{equipment.equipmentTypeName}</p>
        {rateById.get(equipment.id) != null ? (
          <p className="mt-2 text-heading-md text-text" data-testid="equipment-price">
            {formatPeso(rateById.get(equipment.id)!)}
            <span className="text-sm font-normal text-text-muted"> / hour</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-text-muted" data-testid="equipment-price">{priceNote}</p>
        )}
      </div>
      {(equipment.optionGroups ?? []).length > 0 && (
        <div className="grid gap-2 text-sm">
          <dl className="grid gap-2">
            {(equipment.optionGroups ?? []).map((group) => (
              <div key={group.name} className="flex flex-wrap gap-x-2">
                <dt className="text-text-muted">{group.name}:</dt>
                <dd className="text-text">{group.values.join(' · ')}</dd>
              </div>
            ))}
          </dl>
          <p className="text-text-muted">You choose these in your cart.</p>
        </div>
      )}
      <Button
        variant="primary"
        className="w-fit"
        disabled={unavailable}
        onClick={() => {
          addToCart({
            equipmentId: equipment.id,
            model: equipment.model,
            equipmentTypeName: equipment.equipmentTypeName,
            photoUri: equipment.photoUri,
            ...defaultRentalWindow(),
          });
          void navigate(
            signedIn
              ? { to: '/account/cart' }
              : { to: '/login', search: { redirect: '/account/cart' } },
          );
        }}
      >
        {signedIn ? 'Rent this unit' : 'Sign in to rent'}
      </Button>
    </div>
  );
}

export const equipmentDetailRoute = createRoute({
  getParentRoute: () => storefrontLayoutRoute,
  path: '/equipment/$equipmentId',
  component: EquipmentDetailPage,
});
