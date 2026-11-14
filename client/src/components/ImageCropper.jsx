import { useCallback, useEffect, useRef, useState } from 'react';

// WhatsApp-style square photo cropper (polish item 4): circular-mask preview,
// drag to reposition, zoom slider + wheel + pinch, rotate, Cancel/Done.
// Pure canvas, no dependency. onDone receives a 512×512 JPEG File that flows
// through the existing uploads pipeline exactly like the original file.
//
// Decoding a phone photo is NOT a single attempt: Android WebView pickers
// hand back files with empty/odd MIME types and camera originals can be far
// too large to decode at natural size. The loader below tries, in order:
// (a) createImageBitmap (downscaling anything over MAX_SIDE via a canvas),
// (b) Image + object URL, (c) FileReader data URL. If every strategy fails
// (e.g. a HEIC photo Chromium cannot decode at all) the user is offered the
// original file as-is instead of a dead end.
const VIEW = 300;
const OUT = 512;
const MAX_SIDE = 2048;

function imageFromURL(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('image decode failed'));
    el.src = url;
  });
}

async function loadViaObjectURL(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return { el: await imageFromURL(url), url };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// Strategy (a): createImageBitmap. Huge images are re-encoded at MAX_SIDE
// through an intermediate canvas so the crop UI never holds a 50 MP source.
async function decodeWithBitmap(file) {
  const bmp = await createImageBitmap(file);
  try {
    const longest = Math.max(bmp.width, bmp.height);
    if (longest <= MAX_SIDE) return await loadViaObjectURL(file);
    const s = MAX_SIDE / longest;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('downscale failed');
    return await loadViaObjectURL(blob);
  } finally {
    if (bmp.close) bmp.close();
  }
}

// Strategy (c): FileReader → data URL → Image.
async function decodeWithReader(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
  return { el: await imageFromURL(dataUrl), url: '' };
}

export default function ImageCropper({ file, onCancel, onDone }) {
  const [img, setImg] = useState(null); // { el, w, h } current (possibly rotated) source
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false); // every decode strategy failed
  const pointers = useRef(new Map());
  const pinchStart = useRef(null);
  const viewRef = useRef(null);

  // The component is mounted fresh for each picked file at every call site,
  // so state starts clean; the decode chain below resolves asynchronously.
  useEffect(() => {
    let cancelled = false;
    let liveUrl = '';
    (async () => {
      const attempts = [];
      if (typeof createImageBitmap === 'function') {
        attempts.push(() => decodeWithBitmap(file));
      }
      attempts.push(() => loadViaObjectURL(file));
      attempts.push(() => decodeWithReader(file));
      for (const attempt of attempts) {
        try {
          const { el, url } = await attempt();
          if (cancelled) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          liveUrl = url;
          setImg({ el, w: el.naturalWidth, h: el.naturalHeight });
          setZoom(1);
          setOffset({ x: 0, y: 0 });
          return;
        } catch {
          /* fall through to the next decode strategy */
        }
      }
      if (!cancelled) setFailed(true);
    })();
    return () => {
      cancelled = true;
      if (liveUrl) URL.revokeObjectURL(liveUrl);
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
        {failed ? (
          <div className="cropper-fallback">
            <p className="form-error">This photo's format couldn't be opened for cropping.</p>
            <p className="info-sub">You can still upload the photo as-is, without cropping it.</p>
            <button type="button" className="btn primary" onClick={() => onDone(file)}>
              Upload original photo
            </button>
          </div>
        ) : (
          <>
            <div
              ref={viewRef}
              className="cropper-view"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onWheel={onWheel}
            >
              {img ? (
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
              ) : (
                <p className="cropper-loading">Loading photo…</p>
              )}
              <div className="cropper-mask" aria-hidden="true" />
            </div>
            {img && (
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
            )}
          </>
        )}
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
