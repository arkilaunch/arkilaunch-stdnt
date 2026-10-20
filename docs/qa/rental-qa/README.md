# Rental QA visual evidence

All images use synthetic browser fixtures or synthetic document data. No production customer data or live tenant changes are involved.

| Surface | Evidence |
|---|---|
| Compact mobile checkout | [Screenshot](checkout-compact-360.png) |
| Agreement modal | [Screenshot](agreement-modal-360.png) |
| Tenant storefront with qualified starting prices | [Screenshot](storefront-1440.png) |
| Downloaded invoice PDF | [First page](invoice-pdf-page.png) |
| Browser invoice print | [First page](invoice-print-page.png) |

Browser coverage: `pnpm --filter @arkilaunch/web e2e rental-qa.spec.ts document-print.spec.ts --project=desktop --workers=1`. The signing and storefront tests include 360px and 1440px viewports. Print coverage includes invoices, SOAs and quotations, Inter/Plex branding, wide/tall logos, accented customer names and long tables. It creates PDF/PNG artifacts under `apps/web/artifacts/rental-qa/` (ignored).

Server document tests: `pnpm --filter @arkilaunch/api exec vitest run src/billing/document-pdf.spec.ts src/billing/statement-pdf.spec.ts src/fleet/leakage-report-pdf.spec.ts`. Download authorization, receipt eligibility and immutable agreement snapshots are covered in `apps/api/test/rental-qa.spec.ts`. The renderer receives authoritative DTO values without repricing.

Visual verification rendered every page of twelve PDFs: six server documents (invoice, receipt, SOA, agreement, report, unbranded fallback) and six browser print documents across two tenant brands. Checks included retained first/last rows and accented names, repeated table headings, page numbering, footer bounds, logo scaling and absence of blank pages. EDTR geometry was not changed; its existing tests remain required.
