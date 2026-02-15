'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

interface ReadinessResponse {
  ready: boolean;
  checkedAt: string;
  env: {
    xApiKey: boolean;
    xApiSecret: boolean;
    xBearerToken: boolean;
    appUrl: boolean;
  };
  auth: {
    connected: boolean;
    allConnected: boolean;
    requiredConnectedSlots: number;
    connectedEnough: boolean;
    connectedSlots: number[];
    slotStatus: Array<{
      slot: number;
      connected: boolean;
      username: string | null;
    }>;
  };
  scheduler: {
    inAppEnabled: boolean;
    intervalSeconds: number;
  };
  security?: {
    authRequired: boolean;
    hasAdminToken: boolean;
    hasEncryptionKey: boolean;
  };
  runtime?: {
    nodeVersion: string;
    strictBoot: boolean;
  };
  error?: string;
}

interface ReadinessCheck {
  label: string;
  ok: boolean;
  meta?: string;
}

interface ReadinessPanelProps {
  refreshTrigger?: number;
}

export default function ReadinessPanel({ refreshTrigger }: ReadinessPanelProps) {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/system/readiness', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to fetch readiness');
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch readiness');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  const checks = useMemo<ReadinessCheck[]>(() => {
    if (!data) return [];
    return [
      { label: 'X API key configured', ok: data.env.xApiKey },
      { label: 'X API secret configured', ok: data.env.xApiSecret },
      { label: 'X bearer token configured', ok: data.env.xBearerToken },
      { label: 'App URL configured', ok: data.env.appUrl },
      {
        label: `X account connected (need ${data.auth.requiredConnectedSlots})`,
        ok: data.auth.connectedEnough,
        meta: data.auth.connectedSlots.length > 0 ? `slots: ${data.auth.connectedSlots.join(', ')}` : 'none',
      },
      { label: 'In-app scheduler enabled', ok: data.scheduler.inAppEnabled, meta: `${data.scheduler.intervalSeconds}s interval` },
      { label: 'Encryption key available', ok: Boolean(data.security?.hasEncryptionKey) },
      {
        label: data.security?.authRequired ? 'Admin token configured' : 'API auth optional',
        ok: data.security?.authRequired ? Boolean(data.security?.hasAdminToken) : true,
      },
    ];
  }, [data]);

  return (
    <div className="dashboard-card fade-up mb-6">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">System Readiness</h3>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className={`rounded-md p-3 text-sm ${
              data.ready ? 'border border-green-200 bg-green-50 text-green-800' : 'border border-amber-200 bg-amber-50 text-amber-900'
            }`}>
              {data.ready ? 'Ready: credentials, at least one X account, and scheduler are configured.' : 'Not ready: complete the missing checks below.'}
            </div>

            <div className="space-y-2">
              {checks.map((check) => (
                <div key={check.label} className="flex items-center justify-between p-2 rounded-md border border-gray-100">
                  <div className="flex items-center gap-2">
                    {check.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                    <span className="text-sm text-gray-800">{check.label}</span>
                  </div>
                  {check.meta && <span className="text-xs text-gray-500">{check.meta}</span>}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-500">
              Checked at {new Date(data.checkedAt).toLocaleString()}
            </p>
            {data.runtime?.nodeVersion && (
              <p className="text-xs text-gray-500">
                Node {data.runtime.nodeVersion}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
