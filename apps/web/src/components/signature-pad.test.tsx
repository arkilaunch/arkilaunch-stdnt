import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SignaturePad } from './signature-pad.js';

// jsdom has no canvas backend: stub the 2D context and the export.
function stubCanvas() {
  const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(), fillText: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw0KGgoAAAA');
  return ctx;
}
afterEach(() => vi.restoreAllMocks());

describe('SignaturePad', () => {
  it('emits a PNG after a stroke and null after Clear', () => {
    const ctx = stubCanvas();
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const pad = screen.getByRole('img', { name: /signature pad/i });

    fireEvent.pointerMove(pad, { clientX: 5, clientY: 5 });
    expect(ctx.lineTo).not.toHaveBeenCalled();
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(pad, { clientX: 40, clientY: 20 });
    fireEvent.pointerUp(pad);
    expect(onChange).toHaveBeenLastCalledWith('data:image/png;base64,iVBORw0KGgoAAAA');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('signs from the keyboard by stamping the typed name', () => {
    const ctx = stubCanvas();
    const onChange = vi.fn();
    const { rerender } = render(<SignaturePad onChange={onChange} typedName="" />);
    const stamp = screen.getByRole('button', { name: 'Use my typed name as signature' });
    expect(stamp).toBeDisabled();
    rerender(<SignaturePad onChange={onChange} typedName="Juan Dela Cruz" />);
    fireEvent.click(stamp);
    expect(ctx.fillText).toHaveBeenCalledWith('Juan Dela Cruz', 300, 100, 560);
    expect(onChange).toHaveBeenLastCalledWith('data:image/png;base64,iVBORw0KGgoAAAA');
  });
});
