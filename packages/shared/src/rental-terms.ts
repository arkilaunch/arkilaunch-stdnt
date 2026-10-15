import { z } from 'zod';

export const MAX_RENTAL_TERMS = 50_000;
// ~100 KB of PNG once base64 encoded; the pad exports at most 600x200.
export const MAX_SIGNATURE_PNG = 140_000;

export const RentalTermsSchema = z.object({ version: z.string(), body: z.string(), isDefault: z.boolean() });
export type RentalTerms = z.infer<typeof RentalTermsSchema>;

export const RentalTermsUpdateSchema = z.object({ body: z.string().trim().min(200).max(MAX_RENTAL_TERMS) }).strict();
export type RentalTermsUpdate = z.infer<typeof RentalTermsUpdateSchema>;

// iVBORw0KGgo is the base64 of the PNG signature, so the prefix doubles as a magic-byte check.
export const SignaturePngSchema = z
  .string()
  .max(MAX_SIGNATURE_PNG)
  .regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/, 'Draw your signature');

export const AgreementSignSchema = z
  .object({
    signedName: z.string().trim().min(2).max(120),
    termsVersion: z.string().min(1).max(40),
    signaturePng: SignaturePngSchema,
  })
  .strict();
export type AgreementSign = z.infer<typeof AgreementSignSchema>;

export const AgreementSummarySchema = z.object({
  signedName: z.string(),
  signedAt: z.coerce.date(),
  termsVersion: z.string(),
  signaturePng: z.string(),
});
export type AgreementSummary = z.infer<typeof AgreementSummarySchema>;

// ponytail: draft from the thesis lessee terms (docs/clr-arkilaunch.md E8); counsel must review before launch.
export const DEFAULT_RENTAL_TERMS: RentalTerms = {
  version: 'default-1',
  isDefault: true,
  body: `EQUIPMENT RENTAL AGREEMENT (TEMPLATE - SUBJECT TO COUNSEL REVIEW)

1. Parties. This agreement is between the rental company named on the booking (the "Lessor") and the company named on the booking (the "Lessee"), represented by the person signing below, who confirms they are authorised to bind the Lessee.

2. Equipment and term. The Lessor rents the equipment listed on the accepted quotation for the dates shown on the booking. Any extension must be requested and approved before the return date.

3. Charges and deposit. The Lessee pays the amounts on the accepted quotation, including the consumable deposit and mobilisation and demobilisation. Rental hours are drawn down from the deposit as recorded on the daily time records. Any deduction from the deposit is reconciled against those records or approved by a person; no deduction is made automatically from unverified data.

4. Use and care. The Lessee uses the equipment only at the declared project site, for its intended purpose, by qualified operators, and in line with the manufacturer's guidance and applicable law. The Lessee may not sublet or move the equipment without the Lessor's written consent.

5. Site access and monitoring. The Lessee gives the Lessor reasonable access to the site to inspect, service or recover the equipment. Weather at the site is monitored as described in the Lessor's terms.

6. Loss and damage. The Lessee is responsible for loss of, or damage to, the equipment from delivery until it is returned, other than fair wear and tear. Damage found on return is assessed and agreed before it is charged.

7. Return. The Lessee returns the equipment on the return date in the condition it was delivered, fair wear and tear excepted. Equipment kept past the return date is charged at the applicable rate.

8. Cancellation. Cancellation terms are those shown on the booking and quotation at the time of acceptance.

9. Governing law. This agreement is governed by the laws of the Republic of the Philippines.

10. Electronic signature. The Lessee agrees that ticking the acceptance box, typing their name and drawing their signature is an electronic signature under Republic Act No. 8792 (E-Commerce Act) and binds the Lessee as a handwritten signature would.`,
};
