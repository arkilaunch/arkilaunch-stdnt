import { useEffect, useRef, type PointerEvent } from 'react';
import { Button } from './button.js';

const WIDTH = 600;
const HEIGHT = 200;

// Native canvas, pointer events for mouse, touch and pen. Emits a PNG data URL after each stroke, null when cleared.
export function SignaturePad({ onChange, label = 'Signature' }: { onChange: (png: string | null) => void; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }, []);

  // The canvas is drawn at a fixed 600x200 and scaled by CSS, so map client pixels back.
  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT };
  }

  function start(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    const { x, y } = point(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  }

  function end(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(e.currentTarget.toDataURL('image/png'));
  }

  function clear() {
    canvas.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{label}</span>
        <Button variant="ghost" onClick={clear}>
          Clear
        </Button>
      </div>
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`${label} pad: draw with your finger, pen or mouse`}
        className="aspect-[3/1] w-full touch-none rounded-input border border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
    </div>
  );
}
