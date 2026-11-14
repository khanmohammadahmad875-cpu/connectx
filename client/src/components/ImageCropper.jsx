import { useCallback, useEffect, useRef, useState } from 'react';

// WhatsApp-style square photo cropper (polish item 4): circular-mask preview,
// drag to reposition, zoom slider + wheel + pinch, rotate, Cancel/Done.
// Pure canvas, no dependency. onDone receives a 512×512 JPEG File that flows
// through the existing uploads pipeline exactly like the original file.
const VIEW = 300;
const OUT = 512;

export default function ImageCropper({ file, onCancel, onDone }) {
  const [img, setImg] = useState(null); // { el, w, h } current (possibly rotated) source
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pointers = useRef(new Map());
  const pinchStart = useRef(null);
  const viewRef = useRef(null);

  useEffect(() => {
    let url = '';
    let cancelled = false;
    const el = new Image();
    url = URL.createObjectURL(file);
    el.onload = () => {
      if (!cancelled) {
        setImg({ el, w: el.naturalWidth, h: el.naturalHeight });
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    el.onerror = () => { if (!cancelled) setError('Could not read that image'); };
    el.src = url;
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  const baseScale = img ? Math.max(VIEW / img.w, VIEW / img.h) : 1;
  const scale = baseScale * zoom;
  const dispW = img ? img.w * scale : 0;
  const dispH = img ? img.h * scale : 0;

  const clampOffset = useCallback(
    (o, z) => {
      if (!img) return o;
      const s = Math.max(VIEW / img.w, VIEW / img.h) * z;
      const maxX = Math.max(0, (img.w * s - VIEW) / 2);
      const maxY = Math.max(0, (img.h * s - VIEW) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, o.x)),
        y: Math.min(maxY, Math.max(-maxY, o.y)),
      };
    },
    [img]
  );

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.min(3, Math.max(1, pinchStart.current.zoom * (dist / Math.max(1, pinchStart.current.dist))));
      setZoom(next);
      setOffset((o) => clampOffset(o, next));
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, zoom));
  }

  function endPointer(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }

  function onWheel(e) {
    const next = Math.min(3, Math.max(1, zoom + (e.deltaY < 0 ? 0.08 : -0.08)));
    setZoom(next);
    setOffset((o) => clampOffset(o, next));
  }

  function rotate() {
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = img.h;
    c.height = img.w;
    const cx = c.getContext('2d');
    cx.translate(c.width / 2, c.height / 2);
    cx.rotate(Math.PI / 2);
    cx.drawImage(img.el, -img.w / 2, -img.h / 2);
    const el = new Image();
    el.onload = () => {
      setImg({ el, w: c.width, h: c.height });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    el.src = c.toDataURL('image/png');
  }

  function done() {
    if (!img || busy) return;
    setBusy(true);
    try {
      const out = document.createElement('canvas');
      out.width = OUT;
      out.height = OUT;
      const cx = out.getContext('2d');
      // Source rect: the VIEW-sized square centred on (offset) in displayed
      // coordinates, mapped back to source pixels.
      const srcSize = VIEW / scale;
      const srcX = img.w / 2 - offset.x / scale - srcSize / 2;
      const srcY = img.h / 2 - offset.y / scale - srcSize / 2;
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, OUT, OUT);
      cx.drawImage(img.el, srcX, srcY, srcSize, srcSize, 0, 0, OUT, OUT);
      out.toBlob(
        (blob) => {
          setBusy(false);
          if (!blob) {
            setError('Could not crop that image');
            return;
          }
          onDone(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.92
      );
    } catch {
      setBusy(false);
      setError('Could not crop that image');
    }
  }

  return (
    <div className="modal-backdrop cropper-backdrop" role="dialog" aria-modal="true" aria-label="Crop photo">
      <div className="modal-card cropper-card">
        <h3 className="cropper-title">Crop photo</h3>
        <div
          ref={viewRef}
          className="cropper-view"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
        >
          {img && (
            <img
              src={img.el.src}
              alt=""
              draggable={false}
              className="cropper-img"
              style={{
                width: dispW,
                height: dispH,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
          <div className="cropper-mask" aria-hidden="true" />
        </div>
        <label className="cropper-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => {
              const next = Number(e.target.value);
              setZoom(next);
              setOffset((o) => clampOffset(o, next));
            }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="cropper-actions">
          <button type="button" className="btn ghost" onClick={rotate} disabled={!img || busy}>↻ Rotate</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={done} disabled={!img || busy}>
            {busy ? 'Working…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
