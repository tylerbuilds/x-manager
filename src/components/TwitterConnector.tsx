'use client';

import { useState, useEffect, useCallback } from 'react';
import { Twitter, Link, Unlink, Loader2 } from 'lucide-react';

interface XAccount {
  id: number | null;
  slot: number;
  connected: boolean;
  twitterUsername: string | null;
  twitterDisplayName: string | null;
}

interface TwitterConnectorProps {
  onConnectionChange?: () => void;
}

const DEFAULT_SLOTS = [1, 2];

export default function TwitterConnector({ onConnectionChange }: TwitterConnectorProps) {
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectingSlot, setConnectingSlot] = useState<number | null>(null);
  const [disconnectingSlot, setDisconnectingSlot] = useState<number | null>(null);
  const [oobStateBySlot, setOobStateBySlot] = useState<Record<number, { authUrl: string; oauthToken: string; verifier: string }>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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
      setSuccessMessage(`X account connected successfully on slot ${slot}.`);
      onConnectionChange?.();
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const error = urlParams.get('error');
    if (error) {
      const reason = urlParams.get('reason');
      let errorMsg = 'Failed to connect X account';
      if (reason === 'missing_params') errorMsg = 'X authentication failed: Missing parameters';
      else if (reason === 'server_error') errorMsg = 'X authentication failed: Server error';
      setErrorMessage(errorMsg);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [fetchAccounts, onConnectionChange]);

  const getAccountForSlot = (slot: number): XAccount | null => {
    return accounts.find((account) => account.slot === slot) || null;
  };

  const handleConnectTwitter = async (slot: number) => {
    setConnectingSlot(slot);
    setErrorMessage('');
    try {
      const response = await fetch('/api/twitter/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to get X auth URL');
      }

      const data = await response.json();
      if (data.authUrl) {
        if (data.mode === 'oob') {
          setOobStateBySlot((prev) => ({
            ...prev,
            [slot]: {
              authUrl: String(data.authUrl),
              oauthToken: String(data.oauthToken || ''),
              verifier: '',
            },
          }));
          setSuccessMessage('X requires a PIN-based (oob) flow for this app. Open the auth page, then paste the verifier here.');
          setConnectingSlot(null);
          return;
        }

        window.location.href = String(data.authUrl);
        return;
      }
      throw new Error('Auth URL missing');
    } catch (error) {
      console.error('Failed to connect X:', error);
      const message = error instanceof Error ? error.message : `Failed to connect X account for slot ${slot}`;
      setErrorMessage(message);
      setConnectingSlot(null);
    }
  };

  const handleCompleteOob = async (slot: number) => {
    const state = oobStateBySlot[slot];
    if (!state) return;

    const verifier = state.verifier.trim();
    if (!verifier) {
      setErrorMessage('Enter the verifier/PIN from X to complete the connection.');
      return;
    }

    setConnectingSlot(slot);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/twitter/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot,
          oauthVerifier: verifier,
          oauthToken: state.oauthToken || undefined,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to complete X authentication.');
      }

      setOobStateBySlot((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });

      await fetchAccounts();
      setSuccessMessage(`X account connected successfully on slot ${slot}.`);
      onConnectionChange?.();
    } catch (error) {
      console.error('Failed to complete X OOB auth:', error);
      const message = error instanceof Error ? error.message : `Failed to connect X account for slot ${slot}`;
      setErrorMessage(message);
    } finally {
      setConnectingSlot(null);
    }
  };

  const handleDisconnectTwitter = async (slot: number) => {
    if (!confirm(`Disconnect X account from slot ${slot}?`)) return;
    setDisconnectingSlot(slot);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await fetch(`/api/user?slot=${slot}`, { method: 'DELETE' });
      await fetchAccounts();
      setOobStateBySlot((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      setSuccessMessage(`X account disconnected from slot ${slot}.`);
      onConnectionChange?.();
    } catch (error) {
      console.error('Failed to disconnect X:', error);
      setErrorMessage(`Failed to disconnect X account from slot ${slot}`);
    } finally {
      setDisconnectingSlot(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
      </div>
    );
  }

  return (
    <div className="dashboard-card fade-up mb-6">
      <div className="p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Twitter className="text-blue-400" size={24} />
          <h3 className="text-lg font-medium text-gray-900">X Connections (2 Slots)</h3>
        </div>

        {successMessage && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
            <p className="text-sm text-green-800">{successMessage}</p>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
            <p className="text-sm text-red-800">{errorMessage}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DEFAULT_SLOTS.map((slot) => {
            const account = getAccountForSlot(slot);
            const isConnected = Boolean(account?.connected);
            const isConnecting = connectingSlot === slot;
            const isDisconnecting = disconnectingSlot === slot;
            const oobState = oobStateBySlot[slot];

            return (
              <div key={slot} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900">Account Slot {slot}</h4>
                  {isConnected ? (
                    <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">Connected</span>
                  ) : (
                    <span className="text-xs text-amber-800 bg-amber-50 px-2 py-1 rounded-full">Not connected</span>
                  )}
                </div>

                {isConnected ? (
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <Link className="text-green-600" size={18} />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-800">
                          {account?.twitterUsername ? `@${account.twitterUsername}` : 'Connected (username unavailable)'}
                        </p>
                        {account?.twitterDisplayName && (
                          <p className="text-sm text-green-600">
                            {account.twitterDisplayName}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDisconnectTwitter(slot)}
                      disabled={isDisconnecting}
                      className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm text-red-600 hover:text-red-800 border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50"
                    >
                      {isDisconnecting ? <Loader2 className="animate-spin" size={14} /> : <Unlink size={14} />}
                      <span>{isDisconnecting ? 'Disconnecting...' : 'Disconnect Slot'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      Connect this slot to schedule/post from a second X account.
                    </p>
                    {oobState ? (
                      <div className="space-y-3">
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-sm text-amber-900">
                            Your X app is configured as a Desktop app, so X requires the PIN (oob) flow.
                          </p>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => window.open(oobState.authUrl, '_blank', 'noopener,noreferrer')}
                            className="flex-1 min-w-[160px] flex items-center justify-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                          >
                            <Twitter size={16} />
                            <span>Open Auth Page</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setOobStateBySlot((prev) => {
                              const next = { ...prev };
                              delete next[slot];
                              return next;
                            })}
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Verifier / PIN</label>
                          <input
                            type="text"
                            value={oobState.verifier}
                            onChange={(e) => setOobStateBySlot((prev) => ({
                              ...prev,
                              [slot]: { ...prev[slot], verifier: e.target.value },
                            }))}
                            placeholder="Paste the verifier from X"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                        </div>

                        <button
                          onClick={() => handleCompleteOob(slot)}
                          disabled={isConnecting || !oobState.verifier.trim()}
                          className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          {isConnecting ? <Loader2 className="animate-spin" size={16} /> : <Link size={16} />}
                          <span>{isConnecting ? 'Completing...' : 'Complete Connection'}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConnectTwitter(slot)}
                        disabled={isConnecting}
                        className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                      >
                        {isConnecting ? <Loader2 className="animate-spin" size={16} /> : <Twitter size={16} />}
                        <span>{isConnecting ? 'Connecting...' : `Connect Slot ${slot}`}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
