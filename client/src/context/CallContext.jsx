import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { connectSocket, getSocket } from '../socket/socket';
import { RTC_CONFIG } from '../utils/rtc';

// Voice/video calls (module 8) — 1-to-1 WebRTC with Socket.IO signalling.
// The server verifies membership/parties for every event; this context owns
// the peer connection and the call state machine:
//   idle → outgoing (ringing) → ongoing → idle
//   idle → incoming (ringing) → ongoing → idle
const CallContext = createContext(null);

export function useCall() {
  return useContext(CallContext);
}

export function CallProvider({ children }) {
  const [status, setStatus] = useState('idle'); // idle|outgoing|incoming|ongoing
  const [call, setCall] = useState(null); // { callId, conversationId, callType, peer }
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [notice, setNotice] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingIceRef = useRef([]);
  const callRef = useRef(null);
  callRef.current = call;
  const statusRef = useRef('idle');
  statusRef.current = status;
  const timerRef = useRef(null);
  const pendingOfferRef = useRef(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      try {
        pcRef.current.close();
      } catch (err) {
        /* already closed */
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    pendingIceRef.current = [];
    pendingOfferRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    setDurationSec(0);
    setCall(null);
    setStatus('idle');
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setDurationSec(0);
    const started = Date.now();
    timerRef.current = setInterval(() => {
      setDurationSec(Math.floor((Date.now() - started) / 1000));
    }, 500);
  }, []);

  const createPeer = useCallback(
    (activeCall) => {
      const socket = getSocket();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate && socket && activeCall.callId) {
          socket.emit('call_ice', { callId: activeCall.callId, candidate: e.candidate });
        }
      };
      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) setRemoteStream(e.streams[0]);
      };
      return pc;
    },
    []
  );

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        /* stale candidates are harmless */
      }
    }
  }, []);

  const getMedia = useCallback(async (callType) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video',
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  // --- Outgoing --------------------------------------------------------------
  const startCall = useCallback(
    async ({ conversationId, peer, callType }) => {
      if (statusRef.current !== 'idle') return;
      setNotice('');
      const socket = getSocket();
      if (!socket) {
        setNotice('Not connected. Please try again.');
        return;
      }
      const provisional = { callId: null, conversationId, callType, peer };
      setCall(provisional);
      setStatus('outgoing');
      try {
        const stream = await getMedia(callType);
        const pc = createPeer(provisional);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const ack = await new Promise((resolve) => {
          socket
            .timeout(9000)
            .emit('call_invite', { conversationId, callType, offer }, (err, res) =>
              resolve(err ? { ok: false, error: 'Could not reach the server' } : res)
            );
        });
        if (!ack || !ack.ok) {
          const msg = ack && ack.busy ? `${peer.username} is busy right now` : ack?.error || 'Call failed';
          cleanup();
          setNotice(msg);
          return;
        }
        provisional.callId = ack.callId;
        setCall({ ...provisional });
      } catch (err) {
        cleanup();
        setNotice(
          err && err.name === 'NotAllowedError'
            ? 'Microphone/camera permission was denied.'
            : 'Could not start the call.'
        );
      }
    },
    [cleanup, createPeer, getMedia]
  );

  // --- Incoming ----------------------------------------------------------------
  const acceptCall = useCallback(async () => {
    const active = callRef.current;
    const socket = getSocket();
    if (!active || !socket || statusRef.current !== 'incoming') return;
    try {
      const stream = await getMedia(active.callType);
      const pc = createPeer(active);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(pendingOfferRef.current);
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call_accept', { callId: active.callId, answer });
      setStatus('ongoing');
      startTimer();
    } catch (err) {
      socket.emit('call_end', { callId: active.callId });
      cleanup();
      setNotice('Could not access microphone/camera.');
    }
  }, [cleanup, createPeer, flushIce, getMedia, startTimer]);

  const rejectCall = useCallback(() => {
    const active = callRef.current;
    const socket = getSocket();
    if (active && socket) socket.emit('call_reject', { callId: active.callId });
    cleanup();
  }, [cleanup]);

  const endCall = useCallback(() => {
    const active = callRef.current;
    const socket = getSocket();
    if (active && socket && active.callId) {
      socket.emit('call_end', { callId: active.callId });
    }
    cleanup();
  }, [cleanup]);

  // --- Media toggles -------------------------------------------------------------
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setCameraOff(next);
  }, [cameraOff]);

  // --- Signalling listeners -------------------------------------------------------
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return undefined;

    const onIncoming = (payload) => {
      if (statusRef.current !== 'idle') return; // server also guards with busy
      pendingOfferRef.current = payload.offer;
      setNotice('');
      setCall({
        callId: payload.callId,
        conversationId: payload.conversationId,
        callType: payload.callType,
        peer: payload.caller,
      });
      setStatus('incoming');
    };
    const onAccepted = async ({ callId, answer }) => {
      const active = callRef.current;
      if (!active || active.callId !== callId || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(answer);
        await flushIce();
        setStatus('ongoing');
        startTimer();
      } catch (err) {
        /* a failed handshake surfaces as a dropped call via call_ended */
      }
    };
    const onIce = async ({ callId, candidate }) => {
      const active = callRef.current;
      if (!active || active.callId !== callId || !candidate) return;
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          /* ignore */
        }
      } else {
        pendingIceRef.current.push(candidate);
      }
    };
    const onEnded = ({ callId, status: finalStatus, reason }) => {
      const active = callRef.current;
      if (!active || active.callId !== callId) return;
      const wasRinging = statusRef.current === 'outgoing' || statusRef.current === 'incoming';
      cleanup();
      if (wasRinging && finalStatus === 'declined') setNotice('Call declined');
      else if (wasRinging && finalStatus === 'missed' && reason === 'timeout') {
        setNotice('No answer');
      } else if (wasRinging && finalStatus === 'missed') setNotice('Call ended');
    };

    socket.on('incoming_call', onIncoming);
    socket.on('call_accepted', onAccepted);
    socket.on('call_ice', onIce);
    socket.on('call_ended', onEnded);
    return () => {
      socket.off('incoming_call', onIncoming);
      socket.off('call_accepted', onAccepted);
      socket.off('call_ice', onIce);
      socket.off('call_ended', onEnded);
    };
  }, [cleanup, flushIce, startTimer]);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const value = {
    status,
    call,
    muted,
    cameraOff,
    durationSec,
    notice,
    localStream,
    remoteStream,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
