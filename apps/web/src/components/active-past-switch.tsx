export function ActivePastSwitch({ value, onChange, label = 'Show requests' }: { value: 'active' | 'past'; onChange: (value: 'active' | 'past') => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit rounded-md border border-border p-0.5">
      {(['active', 'past'] as const).map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={value === item}
          onClick={() => onChange(item)}
          className={[
            'min-h-9 rounded-sm px-4 text-sm font-semibold',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring',
            value === item ? 'bg-text text-text-inverse' : 'text-text-muted hover:text-text',
          ].join(' ')}
        >
          {item === 'active' ? 'Active' : 'Past'}
        </button>
      ))}
    </div>
  );
}
