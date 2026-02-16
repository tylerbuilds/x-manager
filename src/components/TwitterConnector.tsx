'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';

interface XAccount {
  id: number | null;
  slot: number;
  connected: boolean;
  twitterUsername: string | null;
  twitterDisplayName: string | null;
  twitterProfileImageUrl: string | null;
  twitterFollowersCount: number | null;
  twitterFriendsCount: number | null;
  twitterBio: string | null;
}

interface TwitterConnectorProps {
  onConnectionChange?: () => void;
}

const formatCount = (n: number | null): string => {
  if (n == null) return '0';
  return Intl.NumberFormat('en', { notation: 'compact' }).format(n);
};

function LetterAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const letter = (name || '?')[0].toUpperCase();
  const colors = ['#0f766e', '#0369a1', '#7c3aed', '#c2410c', '#be185d'];
  const color = colors[letter.charCodeAt(0) % colors.length];
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.45 }}
    >
      {letter}
    </div>
  );
}

function AccountCard({
  account,
  isDisconnecting,
  onDisconnect,
  isNew,
}: {
  account: XAccount;
  isDisconnecting: boolean;
  onDisconnect: () => void;
  isNew: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const username = account.twitterUsername || 'unknown';
  const displayName = account.twitterDisplayName || username;
  const avatarUrl = account.twitterProfileImageUrl;
  const showAvatar = avatarUrl && !imgError;

  return (
    <div className={`account-card-connected rounded-xl border border-slate-200 bg-white p-4 ${isNew ? 'fade-up success-glow' : ''}`}>
      <div className="flex items-start gap-3">
        {showAvatar ? (
          <img
            src={avatarUrl}
            alt={`@${username}`}
            width={48}
            height={48}
            className="rounded-full shrink-0"
            onError={() => setImgError(true)}
          />
        ) : (
          <LetterAvatar name={username} size={48} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 truncate">@{username}</span>
            <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">Connected</span>
          </div>
          {displayName !== username && (
            <p className="text-sm text-slate-600 truncate">{displayName}</p>
          )}
          {account.twitterBio && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{account.twitterBio}</p>
          )}
          <p className="text-xs text-slate-400 mt-1.5">
            {formatCount(account.twitterFollowersCount)} followers
            {' · '}
            {formatCount(account.twitterFriendsCount)} following
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          onClick={onDisconnect}
          disabled={isDisconnecting}
          className="text-xs text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
        >
          {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

export default function TwitterConnector({ onConnectionChange }: TwitterConnectorProps) {
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectingSlot, setConnectingSlot] = useState<number | null>(null);
  const [disconnectingSlot, setDisconnectingSlot] = useState<number | null>(null);
  const [oobState, setOobState] = useState<{ slot: number; authUrl: string; oauthToken: string; verifier: string; opened: boolean } | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [newlyConnectedSlot, setNewlyConnectedSlot] = useState<number | null>(null);

  const connectedAccounts = accounts.filter((a) => a.connected);
  const connectedCount = connectedAccounts.length;

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/user');
      if (!response.ok) {
        setAccounts([]);
        return;
      }
      const data = await response.json();
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('twitter_connected') === 'true') {
      const slot = Number(urlParams.get('slot') || '1');
      const username = urlParams.get('username');
      setNewlyConnectedSlot(slot);
      setSuccessMessage(username ? `Connected as @${username}!` : 'X account connected!');
      onConnectionChange?.();
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => {
        setSuccessMessage('');
        setNewlyConnectedSlot(null);
      }, 5000);
    }

    const error = urlParams.get('error');
    if (error) {
      const reason = urlParams.get('reason');
      let errorMsg = 'Failed to connect your X account. Please try again.';
      if (reason === 'missing_params') errorMsg = 'Connection failed due to missing parameters. Please try again.';
      else if (reason === 'server_error') errorMsg = 'Something went wrong on our end. Please try again.';
      setErrorMessage(errorMsg);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [fetchAccounts, onConnectionChange]);

  const findFirstEmptySlot = (): number | null => {
    const usedSlots = new Set(connectedAccounts.map((a) => a.slot));
    if (!usedSlots.has(1)) return 1;
    if (!usedSlots.has(2)) return 2;
    return null;
  };

  const handleConnect = async () => {
    const slot = findFirstEmptySlot();
    if (!slot) return;

    setConnectingSlot(slot);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/twitter/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.userMessage || data?.error || 'Failed to start connection.');
      }

      const data = await response.json();
      if (data.authUrl) {
        if (data.mode === 'oob') {
          setOobState({
            slot,
            authUrl: String(data.authUrl),
            oauthToken: String(data.oauthToken || ''),
            verifier: '',
            opened: false,
          });
          setConnectingSlot(null);
          return;
        }

        window.location.href = String(data.authUrl);
        return;
      }
      throw new Error('Could not get authorization URL. Please try again.');
    } catch (error) {
      console.error('Failed to connect X:', error);
      const message = error instanceof Error ? error.message : 'Failed to connect. Please try again.';
      setErrorMessage(message);
      setConnectingSlot(null);
    }
  };

  const handleCompleteOob = async () => {
    if (!oobState) return;

    const verifier = oobState.verifier.trim();
    if (!verifier) {
      setErrorMessage('Paste the code from X to finish connecting.');
      return;
    }

    setConnectingSlot(oobState.slot);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/twitter/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: oobState.slot,
          oauthVerifier: verifier,
          oauthToken: oobState.oauthToken || undefined,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to complete connection.');
      }

      setOobState(null);
      setNewlyConnectedSlot(oobState.slot);
      await fetchAccounts();
      const username = data?.username;
      setSuccessMessage(username ? `Connected as @${username}!` : 'X account connected!');
      onConnectionChange?.();
      setTimeout(() => {
        setSuccessMessage('');
        setNewlyConnectedSlot(null);
      }, 5000);
    } catch (error) {
      console.error('Failed to complete X auth:', error);
      const message = error instanceof Error ? error.message : 'Failed to finish connecting. Please try again.';
      setErrorMessage(message);
    } finally {
      setConnectingSlot(null);
    }
  };

  const handleDisconnect = async (account: XAccount) => {
    const username = account.twitterUsername ? `@${account.twitterUsername}` : 'this account';
    if (!confirm(`Disconnect ${username}? You can reconnect anytime.`)) return;

    setDisconnectingSlot(account.slot);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      await fetch(`/api/user?slot=${account.slot}`, { method: 'DELETE' });
      await fetchAccounts();
      setSuccessMessage(`${username} disconnected.`);
      onConnectionChange?.();
    } catch (error) {
      console.error('Failed to disconnect X:', error);
      setErrorMessage(`Failed to disconnect ${username}. Please try again.`);
    } finally {
      setDisconnectingSlot(null);
    }
  };

  const handleCancelOob = () => {
    setOobState(null);
    setErrorMessage('');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="animate-spin h-8 w-8 text-slate-400" />
      </div>
    );
  }

  const isConnecting = connectingSlot !== null;

  return (
    <div className="dashboard-card fade-up mb-6">
      <div className="p-6">
        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg mb-4 fade-up">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-800">{successMessage}</p>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-800">{errorMessage}</p>
              <button
                onClick={() => { setErrorMessage(''); handleConnect(); }}
                className="text-xs text-red-600 hover:text-red-800 underline mt-1"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* OOB Wizard */}
        {oobState && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 mb-4 space-y-5 fade-up">
            {/* Step 1 */}
            <div className="flex items-start gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${oobState.opened ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {oobState.opened ? <CheckCircle2 size={16} /> : '1'}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">Approve on X</p>
                <p className="text-xs text-slate-500 mt-0.5">Click below to open X in a new tab. Authorize the app to get your code.</p>
                <button
                  type="button"
                  onClick={() => {
                    window.open(oobState.authUrl, '_blank', 'noopener,noreferrer');
                    setOobState((prev) => prev ? { ...prev, opened: true } : prev);
                  }}
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <ExternalLink size={14} />
                  <span>Open X to Approve</span>
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-slate-200 text-slate-600 shrink-0">
                2
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">Paste Your Code</p>
                <p className="text-xs text-slate-500 mt-0.5">After approving, X shows a short code. Paste it below.</p>
                <input
                  type="text"
                  value={oobState.verifier}
                  onChange={(e) => setOobState((prev) => prev ? { ...prev, verifier: e.target.value } : prev)}
                  placeholder="Paste code here"
                  className="code-input mt-2 w-full max-w-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={handleCompleteOob}
                    disabled={isConnecting || !oobState.verifier.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {isConnecting ? <Loader2 className="animate-spin" size={14} /> : null}
                    <span>{isConnecting ? 'Connecting...' : 'Finish Connecting'}</span>
                  </button>
                  <button
                    onClick={handleCancelOob}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {connectedCount === 0 && !oobState && (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-slate-400" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">No accounts connected</h3>
            <p className="text-sm text-slate-500 mb-4">Connect your X account to start scheduling and posting.</p>
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {isConnecting ? <Loader2 className="animate-spin" size={16} /> : (
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              )}
              <span>{isConnecting ? 'Connecting...' : 'Connect Your First X Account'}</span>
            </button>
          </div>
        )}

        {/* Connected cards */}
        {connectedCount > 0 && (
          <div className="space-y-3">
            {connectedAccounts.map((account) => (
              <AccountCard
                key={account.slot}
                account={account}
                isDisconnecting={disconnectingSlot === account.slot}
                onDisconnect={() => handleDisconnect(account)}
                isNew={newlyConnectedSlot === account.slot}
              />
            ))}

            {/* Add another account button */}
            {connectedCount < 2 && !oobState && (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors disabled:opacity-50"
              >
                {isConnecting ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                <span>{isConnecting ? 'Connecting...' : 'Add Another Account'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
