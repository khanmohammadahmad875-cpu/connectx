import { useCallback, useEffect, useRef, useState } from 'react';

// WhatsApp-style in-chat camera: a live viewfinder that opens on the
// front camera, a flip button to switch front/back, a shutter button,
// then a preview with Retake / Send. Sending hands a JPEG File to the
// parent, which runs the normal upload + message flow.
export default function CameraCapture({ onPhoto, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState('user'); // 'user' = front, 'environment' = back
  const [shot, setShot] = useState(null); // { url, blob }
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (mode) => {
      stop();
      setError('');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        setError('Could not open the camera. Please check the camera permission.');
      }
    },
    [stop]
  );

  // Run the viewfinder whenever there is no captured shot to preview.
  useEffect(() => {
    if (!shot) start(facing);
  }, [shot, facing, start]);

  // Stop the camera for good when the overlay closes.
  useEffect(() => stop, [stop]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (facing === 'user') {
      // Front-camera photos are saved the way the user saw themselves.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setShot({ url: URL.createObjectURL(blob), blob });
        stop();
      },
      'image/jpeg',
      0.92
    );
  }

  async function send() {
    if (!shot || sending) return;
    setSending(true);
    const file = new File([shot.blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    try {
      await onPhoto(file);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="cam-overlay">
      <div className="cam-stage">
        {shot ? (
          <>
            <img src={shot.url} className="cam-preview-img" alt="Captured from camera" />
            <div className="cam-actions">
              <button className="cam-btn ghost" onClick={() => setShot(null)} disabled={sending}>
                ↩ Retake
              </button>
              <button className="cam-btn send" onClick={send} disabled={sending}>
                {sending ? 'Sending…' : 'Send ➤'}
              </button>
            </div>
          </>
        ) : (
          <>
            <video
              ref={videoRef}
              className={`cam-video ${facing === 'user' ? 'mirror' : ''}`}
              autoPlay
              playsInline
              muted
            />
            {error && <p className="cam-error">{error}</p>}
            <p className="cam-hint">{facing === 'user' ? '📷 Front camera' : '📷 Back camera'}</p>
            <div className="cam-actions">
              <button
                className="cam-flip"
                onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
                title="Switch camera (front / back)"
              >
                🔄
              </button>
              <button className="cam-shutter" onClick={capture} title="Take photo" aria-label="Take photo" />
              <span className="cam-flip ghost-slot" aria-hidden="true" />
            </div>
          </>
        )}
        <button className="cam-close" onClick={onClose} title="Close camera">
          ✕
        </button>
      </div>
    </div>
  );
}
