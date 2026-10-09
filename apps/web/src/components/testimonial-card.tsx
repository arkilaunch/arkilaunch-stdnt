import type { CatalogTestimonial } from '@arkilaunch/shared';

export interface TestimonialCardProps {
  testimonial: CatalogTestimonial;
}

export function TestimonialCard({ testimonial }: TestimonialCardProps) {
  const initials = testimonial.authorName.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase();
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-md bg-surface p-6 [overflow-wrap:anywhere] transition-shadow hover:shadow-md">
      {testimonial.headline && <h3 className="text-heading-md font-semibold text-text">{testimonial.headline}</h3>}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunk text-sm text-text-muted">{initials}</span>
        <div className="min-w-0">
        <p className="text-sm font-semibold text-text">{testimonial.authorName}</p>
        <p className="text-sm text-text-muted">{testimonial.authorTitle}</p>
        </div>
      </div>
      <p className="text-sm text-text">&ldquo;{testimonial.quote}&rdquo;</p>
    </div>
  );
}
