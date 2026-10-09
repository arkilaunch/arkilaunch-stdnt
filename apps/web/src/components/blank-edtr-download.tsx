import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorText } from '../lib/api-client.js';
import { edtrQueries, usersQueries } from '../lib/queries.js';
import { useTenant } from '../lib/tenant.js';
import { Button } from './button.js';
import { useToast } from './toast.js';

// The empty eDTR: no booking, QR or dates, for sampling, training or a hand-filled fallback. It names no customer, so
// anyone who records field logs may print it. A scan of it has no QR, so the OCR worker flags it for staff to identify.
export function BlankEdtrDownload({ page, label = 'Blank eDTR template' }: { page?: 'legal' | 'letter'; label?: string }) {
  const toast = useToast();
  const tenant = useTenant();
  const me = useQuery(usersQueries.me());
  const settings = useQuery(edtrQueries.settings());
  const [busy, setBusy] = useState<'pdf' | 'png' | null>(null);
  const paper = page ?? settings.data?.paperSize ?? 'legal';

  async function download(kind: 'pdf' | 'png') {
    setBusy(kind);
    try {
      const sheet = await import('../lib/edtr-sheet.js');
      const input = {
        companyName: me.data?.tenantName ?? tenant?.name ?? '',
        page: paper,
        logoDataUri: await sheet.logoDataUri(tenant?.logoUrl),
        accent: tenant?.primaryColor ?? null,
        tin: me.data?.tenantTin ?? null,
      };
      const png = await sheet.svgToPng(sheet.buildEdtrSheetSvg(input), paper);
      sheet.downloadBlob(kind === 'png' ? png : await sheet.pngToPdf(png, paper), sheet.edtrSheetFilename(input, kind));
    } catch (e) {
      toast.error('Could not build the sheet', apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-text-muted">{label}:</span>
      <Button variant="ghost" loading={busy === 'pdf'} onClick={() => void download('pdf')}>
        PDF
      </Button>
      <Button variant="ghost" loading={busy === 'png'} onClick={() => void download('png')}>
        PNG
      </Button>
    </div>
  );
}
