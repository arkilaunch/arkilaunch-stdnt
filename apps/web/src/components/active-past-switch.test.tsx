import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivePastSwitch } from './active-past-switch.js';

describe('ActivePastSwitch', () => {
  it('uses the same Active and Past controls in customer and admin contexts', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ActivePastSwitch value="active" onChange={onChange} label="Show bookings" />);
    expect(screen.getByRole('group', { name: 'Show bookings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    expect(onChange).toHaveBeenCalledWith('past');
    rerender(<ActivePastSwitch value="past" onChange={onChange} label="Show bookings" />);
    expect(screen.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'true');
  });
});
