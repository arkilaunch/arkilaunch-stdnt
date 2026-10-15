import { and, desc, eq, isNull } from 'drizzle-orm';
import { DEFAULT_RENTAL_TERMS, type AgreementSummary, type RentalTerms } from '@arkilaunch/shared';
import type { Executor } from './with-tenant-tx.js';
import { rentalAgreements, rentalTermsSettings } from './schema/rentals.js';

// No row means the platform template.
export async function getRentalTerms(ex: Executor, tenantId: string): Promise<RentalTerms> {
  const [row] = await ex
    .select({ body: rentalTermsSettings.body, version: rentalTermsSettings.version })
    .from(rentalTermsSettings)
    .where(eq(rentalTermsSettings.tenantId, tenantId))
    .limit(1);
  return row ? { version: `v${row.version}`, body: row.body, isDefault: false } : DEFAULT_RENTAL_TERMS;
}

// The agreement signed for this rental's current quotation (null quotation = deposit-only booking).
export async function findAgreement(ex: Executor, rentalId: string, quotationId: string | null): Promise<AgreementSummary | null> {
  const [row] = await ex
    .select({
      signedName: rentalAgreements.signedName,
      signedAt: rentalAgreements.signedAt,
      termsVersion: rentalAgreements.termsVersion,
      signaturePng: rentalAgreements.signaturePng,
    })
    .from(rentalAgreements)
    .where(
      and(
        eq(rentalAgreements.rentalId, rentalId),
        quotationId ? eq(rentalAgreements.quotationId, quotationId) : isNull(rentalAgreements.quotationId),
      ),
    )
    .orderBy(desc(rentalAgreements.signedAt))
    .limit(1);
  return row ?? null;
}
