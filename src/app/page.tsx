'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import MainDashboard from '@/components/MainDashboard';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import Scheduler from '@/components/Scheduler';
import TopicDiscovery from '@/components/TopicDiscovery';
import TwitterConnector from '@/components/TwitterConnector';
import SetupPanel from '@/components/SetupPanel';
import OpsCenter from '@/components/OpsCenter';

type AppView = 'dashboard' | 'calendar' | 'discovery' | 'ops' | 'accounts' | 'settings';

export default function Home() {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [authLoading, setAuthLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      setAuthLoading(true);
      try {
        const response = await fetch('/api/system/auth/session', { cache: 'no-store' });
        const data = await response.json();
        setAuthRequired(Boolean(data.authRequired));
        setAuthenticated(Boolean(data.authenticated));
      } catch {
        setAuthRequired(true);
        setAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    };
    void loadSession();
  }, []);

  const handleUnlock = async () => {
    if (!tokenInput.trim()) {
      setAuthError('Enter your admin token.');
      return;
    }

    setSubmittingAuth(true);
    setAuthError('');
    try {
      const response = await fetch('/api/system/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Login failed.');
      }
      setAuthenticated(true);
      setAuthRequired(Boolean(data.authRequired));
      setTokenInput('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch('/api/system/auth/logout', { method: 'POST' });
    } finally {
      setAuthenticated(false);
      setTokenInput('');
      setAuthError('');
      setCurrentView('dashboard');
      setIsLoggingOut(false);
      if (!authRequired) {
        window.location.reload();
      }
    }
  };

  const viewBody = useMemo(() => {
    if (currentView === 'dashboard') {
      return <MainDashboard />;
    }

    if (currentView === 'calendar') {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-h-[calc(100vh-124px)]">
          <div className="mb-4 pb-4 border-b border-slate-100">
            <h2 className="text-xl font-semibold text-slate-900">Content Planner</h2>
            <p className="text-sm text-slate-500">
              Visualize and manage your scheduled posts across connected X accounts.
            </p>
          </div>
          <Scheduler compact={false} />
        </div>
      );
    }

    if (currentView === 'discovery') {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-h-[calc(100vh-124px)]">
          <TopicDiscovery />
        </div>
      );
    }

    if (currentView === 'ops') {
      return <OpsCenter />;
    }

    if (currentView === 'accounts') {
      return (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-xl font-semibold text-slate-900">Account Connections</h2>
            <p className="text-sm text-slate-500 mt-1">
              Connect slot 1 and slot 2 to manage two X profiles from one workspace.
            </p>
          </div>
          <TwitterConnector />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 inline-flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
          <div>
            <h2 className="text-xl font-semibold text-slate-900">System Settings</h2>
            <p className="text-sm text-slate-500 mt-1">
              API credentials are encrypted at rest when `X_MANAGER_ENCRYPTION_KEY` is configured.
            </p>
          </div>
        </div>
        <SetupPanel />
      </div>
    );
  }, [currentView]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </main>
    );
  }

  if (authRequired && !authenticated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-cyan-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-slate-700" />
            <h1 className="text-lg font-semibold text-slate-900">Unlock X Manager</h1>
          </div>
          <p className="text-sm text-slate-600">
            Enter your `X_MANAGER_ADMIN_TOKEN` to access the dashboard and APIs.
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !submittingAuth) {
                void handleUnlock();
              }
            }}
            placeholder="Admin token"
            className="w-full p-3 border border-slate-300 rounded-lg"
          />
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <button
            onClick={handleUnlock}
            disabled={submittingAuth}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {submittingAuth ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock size={16} />}
            <span>{submittingAuth ? 'Unlocking...' : 'Unlock'}</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-cyan-50">
      <Sidebar
        activeView={currentView}
        onViewChange={(view) => setCurrentView(view as AppView)}
        onLogout={handleLogout}
      />
      <Topbar activeView={currentView} onViewChange={(view) => setCurrentView(view as AppView)} onLogout={handleLogout} />

      <div className="pl-16 pt-16">
        <div className="p-6">{viewBody}</div>
      </div>
    </main>
  );
}
