'use client';

import { useMemo, useState } from 'react';
import { FileUp, Loader2, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

interface CsvImportIssue {
  lineNumber: number;
  message: string;
  field?: string;
}

interface CsvPreviewPost {
  lineNumber: number;
  accountSlot: number;
  text: string;
  scheduledTime: string;
  communityId: string | null;
  replyToTweetId: string | null;
}

interface CsvImporterProps {
  onImported?: () => void;
}

function defaultStartTimeValue(): string {
  const now = new Date(Date.now() + 5 * 60_000);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function CsvImporter({ onImported }: CsvImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [startTime, setStartTime] = useState(defaultStartTimeValue());
  const [reschedulePast, setReschedulePast] = useState(true);
  const [accountSlot, setAccountSlot] = useState(1);
  const [preview, setPreview] = useState<CsvPreviewPost[]>([]);
  const [errors, setErrors] = useState<CsvImportIssue[]>([]);
  const [warnings, setWarnings] = useState<CsvImportIssue[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState('');
  const [validRows, setValidRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

  const canImport = useMemo(() => {
    return preview.length > 0 && errors.length === 0 && !isImporting;
  }, [preview.length, errors.length, isImporting]);

  const buildFormData = (dryRun: boolean): FormData => {
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }
    formData.append('dry_run', dryRun ? 'true' : 'false');
    formData.append('interval_minutes', String(intervalMinutes));
    formData.append('start_time', startTime);
    formData.append('reschedule_past', reschedulePast ? 'true' : 'false');
    formData.append('account_slot', String(accountSlot));
    return formData;
  };

  const handlePreview = async () => {
    if (!file) {
      setStatusError('Please choose a CSV file first.');
      return;
    }

    setIsPreviewing(true);
    setStatusMessage('');
    setStatusError('');
    setPreview([]);
    setErrors([]);
    setWarnings([]);

    try {
      const response = await fetch('/api/scheduler/import-csv', {
        method: 'POST',
        body: buildFormData(true),
      });

      const data = await response.json();
      setPreview(data.preview || []);
      setErrors(data.errors || []);
      setWarnings(data.warnings || []);
      setValidRows(data.validRows || 0);
      setTotalRows(data.totalRows || 0);

      if (!response.ok) {
        setStatusError(data.error || 'CSV preview failed.');
        return;
      }

      setStatusMessage(`Preview ready: ${data.validRows || 0} valid row(s).`);
    } catch (error) {
      console.error('CSV preview failed:', error);
      setStatusError('Failed to preview CSV import.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!file || !canImport) {
      return;
    }

    setIsImporting(true);
    setStatusMessage('');
    setStatusError('');

    try {
      const response = await fetch('/api/scheduler/import-csv', {
        method: 'POST',
        body: buildFormData(false),
      });
      const data = await response.json();

      if (!response.ok) {
        setStatusError(data.error || 'CSV import failed.');
        return;
      }

      setStatusMessage(`Imported ${data.imported || 0} post(s) into your scheduler.`);
      setWarnings(data.warnings || []);
      onImported?.();
    } catch (error) {
      console.error('CSV import failed:', error);
      setStatusError('Failed to import CSV.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="dashboard-card fade-up mt-6">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileUp className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-medium text-gray-900">CSV Tweet Import</h3>
        </div>

        <p className="text-sm text-gray-600">
          Upload a CSV with columns like <code>text</code>, <code>scheduled_time</code>, <code>community_id</code>, <code>reply_to_tweet_id</code>, and <code>account_slot</code>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const selected = e.target.files?.[0] || null;
                setFile(selected);
                setPreview([]);
                setErrors([]);
                setWarnings([]);
                setStatusMessage('');
                setStatusError('');
              }}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Auto Interval (min)</label>
            <input
              type="number"
              min={1}
              max={1440}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Math.min(Math.max(Number(e.target.value) || 60, 1), 1440))}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Auto Start Date &amp; Time</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Slot</label>
            <select
              value={accountSlot}
              onChange={(e) => setAccountSlot(Number(e.target.value))}
              className="w-full p-2 border border-gray-300 rounded-lg"
            >
              <option value={1}>Account 1</option>
              <option value={2}>Account 2</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          CSV rows with <code>scheduled_time</code> always use that exact date/time. Auto interval/start only applies to rows without a schedule.
        </p>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={reschedulePast}
            onChange={(e) => setReschedulePast(e.target.checked)}
            className="rounded border-gray-300"
          />
          Auto-reschedule rows that are in the past
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handlePreview}
            disabled={!file || isPreviewing || isImporting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span>{isPreviewing ? 'Previewing...' : 'Preview Import'}</span>
          </button>

          <button
            onClick={handleImport}
            disabled={!canImport || isPreviewing}
            className="inline-flex items-center gap-2 px-4 py-2 border border-green-600 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span>{isImporting ? 'Importing...' : 'Import Into Scheduler'}</span>
          </button>
        </div>

        {(totalRows > 0 || validRows > 0) && (
          <div className="text-sm text-gray-600">
            Rows: {validRows} valid / {totalRows} total
          </div>
        )}

        {statusMessage && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {statusMessage}
          </div>
        )}

        {statusError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 inline-flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{statusError}</span>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="text-sm font-semibold text-red-800 mb-2">Import Errors</h4>
            <ul className="text-sm text-red-700 space-y-1">
              {errors.slice(0, 20).map((issue, index) => (
                <li key={`${issue.lineNumber}-${index}`}>
                  Line {issue.lineNumber}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <h4 className="text-sm font-semibold text-amber-900 mb-2">Warnings</h4>
            <ul className="text-sm text-amber-800 space-y-1">
              {warnings.slice(0, 20).map((issue, index) => (
                <li key={`${issue.lineNumber}-${index}`}>
                  Line {issue.lineNumber}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">Preview (first {preview.length} row(s))</div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-white border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Line</th>
                    <th className="text-left p-2">Account</th>
                    <th className="text-left p-2">Scheduled</th>
                    <th className="text-left p-2">Text</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={`${row.lineNumber}-${row.scheduledTime}`} className="border-b border-gray-100 align-top">
                      <td className="p-2 text-gray-500">{row.lineNumber}</td>
                      <td className="p-2 text-gray-700">#{row.accountSlot}</td>
                      <td className="p-2 text-gray-700 whitespace-nowrap">{new Date(row.scheduledTime).toLocaleString()}</td>
                      <td className="p-2 text-gray-900">
                        <div>{row.text}</div>
                        {(row.communityId || row.replyToTweetId) && (
                          <div className="mt-1 text-xs text-gray-500">
                            {row.communityId && <span>community_id={row.communityId} </span>}
                            {row.replyToTweetId && <span>reply_to_tweet_id={row.replyToTweetId}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
