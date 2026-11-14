import { useEffect, useRef, useState } from 'react';
import Avatar from '../Avatar';
import { useCall } from '../../context/CallContext';

function formatTimer(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Call overlays (module 8): incoming ring, outgoing ring and the in-call
// panel. Rendered once inside the chat shell; state lives in CallContext.
export default function CallUI() {
  const {
    status,
    call,
    muted,
    cameraOff,
    durationSec,
    notice,
    localStream,
    remoteStream,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
  } = useCall();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [speakerSupported] = useState(
    () =>
      typeof HTMLMediaElement !== 'undefined' &&
      'setSinkId' in HTMLMediaElement.prototype &&
      !!navigator.mediaDevices?.enumerateDevices
  );

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, status]);

  useEffect(() => {
    const el = call?.callType === 'video' ? remoteVideoRef.current : remoteAudioRef.current;
    if (el && remoteStream) el.srcObject = remoteStream;
  }, [remoteStream, call?.callType, status]);

  async function toggleSpeaker() {
    const el = call?.callType === 'video' ? remoteVideoRef.current : remoteAudioRef.current;
    if (!el || !speakerSupported) return;
    try {
      if (speakerOn) {
        await el.setSinkId('');
        setSpeakerOn(false);
      } else {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
        if (outputs.length) {
          await el.setSinkId(outputs[0].deviceId);
          setSpeakerOn(true);
        }
      }
    } catch (err) {
      /* speaker routing is best-effort per platform */
    }
  }

  if (notice && status === 'idle') {
    return <div className="call-notice">{notice}</div>;
  }
  if (status === 'idle' || !call) return null;

  const peer = call.peer || {};
  const isVideo = call.callType === 'video';
  // Blurred-photo backdrop (presentation only, item 12): the peer's photo,
  // heavily blurred under a dark gradient; a plain gradient without a photo.
  const backdrop = (
    <div className="call-backdrop" aria-hidden="true">
      {peer.profilePicture && <img src={peer.profilePicture} alt="" className="call-backdrop-img" />}
    </div>
  );

  if (status === 'incoming') {
    return (
      <div className="call-overlay">
        <div className="call-card">
          {backdrop}
          <Avatar name={peer.username || '?'} src={peer.profilePicture} size={120} />
          <h3>{peer.username || 'Someone'}</h3>
          <p className="call-sub">{isVideo ? '📹 Incoming video call…' : '📞 Incoming voice call…'}</p>
          <div className="call-actions">
            <button className="call-btn reject" onClick={rejectCall} title="Decline">
              ✕
            </button>
            <button className="call-btn accept" onClick={acceptCall} title="Accept">
              {isVideo ? '📹' : '📞'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'outgoing') {
    return (
      <div className="call-overlay">
        <div className="call-card">
          {backdrop}
          <Avatar name={peer.username || '?'} src={peer.profilePicture} size={120} />
          <h3>{peer.username || '…'}</h3>
          <p className="call-sub">{isVideo ? '📹 Video calling…' : '📞 Ringing…'}</p>
          {isVideo && <video ref={localVideoRef} className="call-preview" autoPlay muted playsInline />}
          <div className="call-actions">
            <button className="call-btn reject" onClick={endCall} title="Cancel call">
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ongoing
  return (
    <div className="call-overlay">
      <div className={`call-card incall ${isVideo ? 'video' : ''}`}>
        {isVideo ? (
          <div className="call-video-wrap">
            <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
            <video ref={localVideoRef} className="call-local-video" autoPlay muted playsInline />
          </div>
        ) : (
          <>
            {backdrop}
            <audio ref={remoteAudioRef} autoPlay />
            <Avatar name={peer.username || '?'} src={peer.profilePicture} size={120} />
          </>
        )}
        <div className="call-head">
          <h3>{peer.username || '…'}</h3>
          <p className="call-sub">{formatTimer(durationSec)}</p>
        </div>
        <div className="call-actions">
          <button
            className={`call-btn control ${muted ? 'off' : ''}`}
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🎤'}
          </button>
          {isVideo && (
            <button
              className={`call-btn control ${cameraOff ? 'off' : ''}`}
              onClick={toggleCamera}
              title={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {cameraOff ? '🚫📷' : '📷'}
            </button>
          )}
          {speakerSupported && (
            <button
              className={`call-btn control ${speakerOn ? '' : 'off'}`}
              onClick={toggleSpeaker}
              title="Toggle speaker"
            >
              🔊
            </button>
          )}
          <button className="call-btn reject" onClick={endCall} title="End call">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
