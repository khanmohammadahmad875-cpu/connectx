import { useEffect, useRef, useState } from 'react';

// Voice message playback (Module 5): play/pause, seekable waveform progress
// and 1x / 1.5x / 2x playback speeds. The waveform peaks were computed in the
// browser at record time and stored with the message (audioMeta.waveform).
const SPEEDS = [1, 1.5, 2];

function fmt(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VoiceMessage({ message }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // seconds
  const [speedIdx, setSpeedIdx] = useState(0);
  const metaDuration = message.audioMeta?.duration || 0;
  const [duration, setDuration] = useState(metaDuration);
  const peaks = (message.audioMeta?.waveform || []).length
    ? message.audioMeta.waveform
    : Array.from({ length: 32 }, () => 0.4);
  const frac = duration > 0 ? Math.min(1, progress / duration) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  function seek(e) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setProgress(audio.currentTime);
  }

  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  return (
    <div className="voice-msg">
      <audio ref={audioRef} src={message.attachmentUrl} preload="metadata" />
      <button className="voice-play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="voice-wave" onClick={seek} role="presentation">
        {peaks.map((p, i) => (
          <span
            key={i}
            className={`voice-bar ${i / peaks.length <= frac ? 'played' : ''}`}
            style={{ height: `${Math.max(12, Math.round(p * 100))}%` }}
          />
        ))}
      </div>
      <span className="voice-time">{fmt(playing || progress > 0 ? progress : duration)}</span>
      <button className="voice-speed" onClick={cycleSpeed} title="Playback speed">
        {SPEEDS[speedIdx]}x
      </button>
    </div>
  );
}
