import { lazy, Suspense } from 'react';
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

export default function App() {
  return (
    <BrowserRouter>
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
