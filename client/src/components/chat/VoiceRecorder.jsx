import { useEffect, useRef, useState } from 'react';
import { uploadFile } from '../../services/api';

// Voice recording bar (Module 5). Replaces the composer while recording:
// MediaRecorder captures audio, an AnalyserNode samples live levels which
// become the stored waveform peaks, and the user can cancel or send.
// The recording is uploaded through the normal uploads pipeline and sent as
// a message of type "audio" with { duration, waveform } metadata.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];
const EXT_BY_MIME = [
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
];

function extFor(mime) {
  const hit = EXT_BY_MIME.find(([m]) => (mime || '').includes(m));
  return hit ? hit[1] : 'webm';
}

function fmt(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VoiceRecorder({ onSend, onCancel }) {
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const startedRef = useRef(0);
  const levelsRef = useRef([]);
  const discardRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const mimeType = MIME_CANDIDATES.find((m) => window.MediaRecorder?.isTypeSupported(m)) || '';
        const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunksRef.current.push(e.data);
        };
        recorder.onstop = handleStop;
        recorder.start(250);
        startedRef.current = Date.now();

        // Live waveform: sample the analyser's time-domain RMS a few times
        // per second; levels double as the live display and the stored peaks.
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          ctxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          let last = 0;
          const tick = (t) => {
            if (t - last > 120) {
              last = t;
              analyser.getByteTimeDomainData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i += 4) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
              }
              const rms = Math.min(1, Math.sqrt(sum / (data.length / 4)) * 2.4);
              levelsRef.current = [...levelsRef.current.slice(-47), rms];
              setLevels(levelsRef.current);
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (err) {
        setError('Microphone access was denied or is unavailable.');
      }
    })();
    const timer = setInterval(() => {
      if (startedRef.current) setSeconds((Date.now() - startedRef.current) / 1000);
    }, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
      cleanup(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup(stopRecorder = true) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (stopRecorder && recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch (err) {
        /* already stopped */
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function handleStop() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (discardRef.current) return;
    const recorder = recorderRef.current;
    const mime = recorder?.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: mime });
    const duration = Math.max(0.5, (Date.now() - startedRef.current) / 1000);
    // Resample sampled levels to at most 48 stored peaks.
    const sampled = levelsRef.current;
    const peaks = sampled.length
      ? sampled.map((v) => Math.round(Math.min(1, Math.max(0.05, v)) * 100) / 100)
      : Array.from({ length: 24 }, () => 0.4);
    setSending(true);
    try {
      const file = new File([blob], `voice-${Date.now()}.${extFor(mime)}`, { type: mime.split(';')[0] });
      const result = await uploadFile(file);
      await onSend({
        content: '',
        messageType: 'audio',
        attachmentUrl: result.url,
        audioMeta: { duration: Math.round(duration * 10) / 10, waveform: peaks },
      });
      onCancel();
    } catch (err) {
      setError(err.message || 'Could not send the voice message');
      setSending(false);
    }
  }

  function cancel() {
    discardRef.current = true;
    cleanup(true);
    onCancel();
  }

  function send() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop(); // handleStop uploads + sends
    }
  }

  if (error) {
    return (
      <div className="voice-recorder">
        <span className="form-error">{error}</span>
        <button className="btn small ghost" onClick={cancel}>Close</button>
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      <span className="rec-dot" />
      <span className="rec-time">{fmt(seconds)}</span>
      <span className="rec-wave">
        {levels.map((v, i) => (
          <span key={i} className="rec-bar" style={{ height: `${Math.max(12, v * 100)}%` }} />
        ))}
      </span>
      <button className="btn small ghost danger-text" onClick={cancel} disabled={sending}>
        🗑 Cancel
      </button>
      <button className="btn small primary" onClick={send} disabled={sending}>
        {sending ? 'Sending…' : '➤ Send'}
      </button>
    </div>
  );
}
