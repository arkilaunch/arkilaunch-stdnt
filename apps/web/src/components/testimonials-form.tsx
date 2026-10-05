import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TestimonialWriteSchema,
  type CatalogTestimonial,
  type CatalogTestimonialListResponse,
} from '@arkilaunch/shared';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { catalogQueries } from '../lib/queries.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Surface } from './surface.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { useToast } from './toast.js';

const path = '/tenants/me/testimonials';
const key = ['tenant-testimonials'] as const;
const empty = { headline: '', quote: '', authorName: '', authorTitle: '' };

export function TestimonialsForm() {
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiGet<CatalogTestimonialListResponse>(path),
  });
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CatalogTestimonial | null>(null);
  const [error, setError] = useState('');
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: catalogQueries.testimonials().queryKey }),
    ]);
  }
  const save = useMutation({
    mutationFn: () => {
      const input = TestimonialWriteSchema.parse({
        ...draft,
        headline: draft.headline.trim() || null,
      });
      return editing ? apiPatch(`${path}/${editing}`, input) : apiPost(path, input);
    },
    onSuccess: async () => {
      setDraft(empty);
      setEditing(null);
      setError('');
      await refresh();
      toast.success('Testimonial saved');
    },
    onError: (e) => setError(apiErrorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`${path}/${id}`),
    onSuccess: async (_, id) => {
      setDeleting(null);
      if (editing === id) {
        setDraft(empty);
        setEditing(null);
      }
      await refresh();
      toast.success('Testimonial deleted');
    },
    onError: (e) => toast.error('Could not delete testimonial', apiErrorText(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const result = TestimonialWriteSchema.safeParse({
      ...draft,
      headline: draft.headline.trim() || null,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check the testimonial fields.');
      return;
    }
    setError('');
    save.mutate();
  }
  return (
    <Surface className="flex min-w-0 flex-col gap-5 p-4" aria-label="Testimonials">
      <h2 className="text-heading-md text-text">Testimonials</h2>
      <p className="text-sm text-text-muted">
        Enter real customer quotes only. Saved testimonials appear on your storefront.
      </p>
      {list.isPending && <p role="status">Loading testimonials…</p>}
      {list.isError && (
        <div role="alert">
          {apiErrorText(list.error)}{' '}
          <Button variant="secondary" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {list.data?.items.length === 0 && <p>No testimonials yet.</p>}
      <ul className="flex flex-col gap-3">
        {list.data?.items.map((item) => (
          <li
            key={item.id}
            className="flex min-w-0 flex-col gap-3 rounded-sm border border-border p-3 sm:flex-row sm:items-start"
          >
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {item.headline && <h3 className="font-semibold">{item.headline}</h3>}
              <p>{item.quote}</p>
              <p className="text-sm text-text-muted">
                {item.authorName}
                {item.authorTitle ? ` · ${item.authorTitle}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={save.isPending || remove.isPending}
                onClick={() => {
                  setEditing(item.id);
                  setDraft({
                    headline: item.headline ?? '',
                    quote: item.quote,
                    authorName: item.authorName,
                    authorTitle: item.authorTitle,
                  });
                  setError('');
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                disabled={save.isPending || remove.isPending}
                onClick={() => setDeleting(item)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
        <h3 className="font-semibold">{editing ? 'Edit testimonial' : 'Add testimonial'}</h3>
        <Input
          label="Headline"
          maxLength={60}
          value={draft.headline}
          onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="testimonial-quote">Quote</label>
          <textarea
            id="testimonial-quote"
            required
            maxLength={280}
            rows={3}
            value={draft.quote}
            onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
            className="min-w-0 rounded-input border border-border-strong bg-surface px-3 py-2 text-text"
          />
        </div>
        <Input
          label="Author name"
          required
          maxLength={80}
          value={draft.authorName}
          onChange={(e) => setDraft({ ...draft, authorName: e.target.value })}
        />
        <Input
          label="Author title"
          maxLength={80}
          value={draft.authorTitle}
          onChange={(e) => setDraft({ ...draft, authorTitle: e.target.value })}
        />
        {error && (
          <p role="alert" className="text-sm text-text">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            loading={save.isPending}
            disabled={list.isPending || list.isError || remove.isPending}
          >
            {editing ? 'Save testimonial' : 'Add testimonial'}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEditing(null);
                setDraft(empty);
                setError('');
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete testimonial?"
        body="This quote will be removed from your storefront."
        confirmLabel="Delete testimonial"
        tone="danger"
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </Surface>
  );
}
