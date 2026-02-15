'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { KeyRound, Loader2, Save, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SettingsPayload {
  settings: {
    hasXApiKey: boolean;
    hasXApiSecret: boolean;
    hasXBearerToken: boolean;
    appBaseUrl: string;
    xApiBaseUrl: string;
    xUploadApiBaseUrl: string;
  };
  envOverrides?: {
    xApiKey: boolean;
    xApiSecret: boolean;
    xBearerToken: boolean;
    appBaseUrl: boolean;
    xApiBaseUrl: boolean;
    xUploadApiBaseUrl: boolean;
  };
}

interface SetupPanelProps {
  onSaved?: () => void;
}

export default function SetupPanel({ onSaved }: SetupPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [hasXApiKey, setHasXApiKey] = useState(false);
  const [hasXApiSecret, setHasXApiSecret] = useState(false);
  const [hasXBearerToken, setHasXBearerToken] = useState(false);
  const [envOverrides, setEnvOverrides] = useState<SettingsPayload['envOverrides']>();

  const [xApiKeyInput, setXApiKeyInput] = useState('');
  const [xApiSecretInput, setXApiSecretInput] = useState('');
  const [xBearerTokenInput, setXBearerTokenInput] = useState('');
  const [appBaseUrl, setAppBaseUrl] = useState('');
  const [xApiBaseUrl, setXApiBaseUrl] = useState('https://api.x.com');
  const [xUploadApiBaseUrl, setXUploadApiBaseUrl] = useState('https://upload.twitter.com');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/system/settings', { cache: 'no-store' });
      const data = (await response.json()) as SettingsPayload & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch settings');
      }

      setHasXApiKey(data.settings.hasXApiKey);
      setHasXApiSecret(data.settings.hasXApiSecret);
      setHasXBearerToken(data.settings.hasXBearerToken);
      setAppBaseUrl(data.settings.appBaseUrl || '');
      setXApiBaseUrl(data.settings.xApiBaseUrl || 'https://api.x.com');
      setXUploadApiBaseUrl(data.settings.xUploadApiBaseUrl || 'https://upload.twitter.com');
      setEnvOverrides(data.envOverrides);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch setup settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const hasAnyEnvOverride = useMemo(() => {
    if (!envOverrides) {
      return false;
    }
    return Object.values(envOverrides).some(Boolean);
  }, [envOverrides]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload: Record<string, string> = {
        appBaseUrl,
        xApiBaseUrl,
        xUploadApiBaseUrl,
      };

      if (xApiKeyInput.trim()) {
        payload.xApiKey = xApiKeyInput.trim();
      }
      if (xApiSecretInput.trim()) {
        payload.xApiSecret = xApiSecretInput.trim();
      }
      if (xBearerTokenInput.trim()) {
        payload.xBearerToken = xBearerTokenInput.trim();
      }

      const response = await fetch('/api/system/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        settings?: SettingsPayload['settings'];
      };

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings');
      }

      setMessage(data.message || 'Saved.');
      setXApiKeyInput('');
      setXApiSecretInput('');
      setXBearerTokenInput('');
      await fetchSettings();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dashboard-card fade-up mb-6">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-medium text-gray-900">First-Run Setup</h3>
        </div>

        <p className="text-sm text-gray-600">
          Paste your X API credentials here once, save, then connect account slot 1 and slot 2 below.
        </p>

        {hasAnyEnvOverride && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Some values are coming from environment variables and will override saved setup values.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 inline-flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 inline-flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading setup...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">X API Key</label>
                <input
                  type="password"
                  value={xApiKeyInput}
                  onChange={(e) => setXApiKeyInput(e.target.value)}
                  placeholder={hasXApiKey ? 'Saved (leave blank to keep)' : 'Enter API key'}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">X API Secret</label>
                <input
                  type="password"
                  value={xApiSecretInput}
                  onChange={(e) => setXApiSecretInput(e.target.value)}
                  placeholder={hasXApiSecret ? 'Saved (leave blank to keep)' : 'Enter API secret'}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">X Bearer Token</label>
                <input
                  type="password"
                  value={xBearerTokenInput}
                  onChange={(e) => setXBearerTokenInput(e.target.value)}
                  placeholder={hasXBearerToken ? 'Saved (leave blank to keep)' : 'Enter bearer token'}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">App Base URL</label>
                <input
                  type="text"
                  value={appBaseUrl}
                  onChange={(e) => setAppBaseUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="w-full p-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="text-sm text-blue-700 hover:text-blue-800"
            >
              {showAdvanced ? 'Hide advanced API host settings' : 'Show advanced API host settings'}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">X API Base URL</label>
                  <input
                    type="text"
                    value={xApiBaseUrl}
                    onChange={(e) => setXApiBaseUrl(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Upload API Base URL</label>
                  <input
                    type="text"
                    value={xUploadApiBaseUrl}
                    onChange={(e) => setXUploadApiBaseUrl(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>{saving ? 'Saving...' : 'Save Setup'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
