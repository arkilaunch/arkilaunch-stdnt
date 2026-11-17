import { useState } from 'react';
import type { StatementPdfResponse } from '@arkilaunch/shared';
import { apiErrorText, apiGet } from '../lib/api-client.js';
import { Button } from './button.js';
import { useToast } from './toast.js';
export function DocumentDownload({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function download() {
    setBusy(true);
    try {
      const res = await apiGet<StatementPdfResponse>(path);
      const bytes = Uint8Array.from(atob(res.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error('Could not download document', apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" data-print-hide loading={busy} onClick={() => void download()}>
      {label}
    </Button>
  );
}
