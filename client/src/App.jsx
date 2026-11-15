import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PreferencesProvider } from './context/PreferencesContext';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Chat from './pages/Chat';
import Home from './pages/Home';

// Heavier pages load on demand (code splitting): the first paint only
// downloads the shell + login + chat/home, so the app opens noticeably
// faster on mobile data. The Suspense fallback is the branded splash.
const Reels = lazy(() => import('./pages/Reels'));
const Posts = lazy(() => import('./pages/Posts'));
const Weather = lazy(() => import('./pages/Weather'));
const Business = lazy(() => import('./pages/Business'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Documents = lazy(() => import('./pages/Documents'));
const Security = lazy(() => import('./pages/Security'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));
import LoadingScreen, { useSplashMin } from './components/LoadingScreen';
import './App.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const splash = useSplashMin(loading);
  if (splash) {
    return <LoadingScreen />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  const splash = useSplashMin(loading);
  if (splash) return <LoadingScreen />;
  if (user) return <Navigate to="/home" replace />;
  return children;
}

// Stale-bundle self-heal: some phones (above all the APK's WebView, kept
// alive in the background) hold on to an old page across deploys, so a
// fix that is already live still shows the old behaviour there — a status
// tab that will not open, an old notifications panel. On focus (and every
// few minutes) this re-fetches index.html — served no-cache — and compares
// its main bundle name with the one this page booted from; if the deploy
// has moved on, the page reloads once onto the new build. The
// sessionStorage guard makes a reload loop impossible.
function FreshnessGuard() {
  useEffect(() => {
    let checking = false;
    async function checkFresh() {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const res = await fetch(`/?_fresh=${Date.now()}`, { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
        const booted = document
          .querySelector('script[src*="assets/index-"]')
          ?.getAttribute('src');
        if (match && booted && !booted.includes(match[0])) {
          if (sessionStorage.getItem('connectx_reloaded_for') !== match[0]) {
            sessionStorage.setItem('connectx_reloaded_for', match[0]);
            window.location.reload();
          }
        }
      } catch (err) {
        /* offline or mid-deploy — try again on the next focus */
      } finally {
        checking = false;
      }
    }
    window.addEventListener('focus', checkFresh);
    const timer = setInterval(checkFresh, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', checkFresh);
      clearInterval(timer);
    };
  }, []);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <FreshnessGuard />
      <AuthProvider>
        <PreferencesProvider>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
            <Route
              path="/login"
              element={
                <GuestRoute>
                  <Login />
                </GuestRoute>
              }
            />
            <Route
              path="/register"
              element={
                <GuestRoute>
                  <Register />
                </GuestRoute>
              }
            />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/home"
              element={
                <ProtectedRoute>
                  <Home />
                </ProtectedRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Chat />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reels"
              element={
                <ProtectedRoute>
                  <Reels />
                </ProtectedRoute>
              }
            />
            <Route
              path="/posts"
              element={
                <ProtectedRoute>
                  <Posts />
                </ProtectedRoute>
              }
            />
            <Route
              path="/weather"
              element={
                <ProtectedRoute>
                  <Weather />
                </ProtectedRoute>
              }
            />
            <Route
              path="/business"
              element={
                <ProtectedRoute>
                  <Business />
                </ProtectedRoute>
              }
            />
            <Route
              path="/business/:userId"
              element={
                <ProtectedRoute>
                  <Business />
                </ProtectedRoute>
              }
            />
            <Route
              path="/calendar"
              element={
                <ProtectedRoute>
                  <Calendar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/documents"
              element={
                <ProtectedRoute>
                  <Documents />
                </ProtectedRoute>
              }
            />
            <Route
              path="/security"
              element={
                <ProtectedRoute>
                  <Security />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <Admin />
                </ProtectedRoute>
              }
            />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </PreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
