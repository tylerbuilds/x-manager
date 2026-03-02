'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Trash2,
  Calendar,
  Plus,
  Loader2,
  Edit3,
  Clock,
  Send,
} from 'lucide-react';

interface Draft {
  id: number;
  accountSlot: number;
  text: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatRelativeDate(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export default function DraftManager() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Create new draft state
  const [newText, setNewText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Edit modal state
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [editText, setEditText] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Schedule state — keyed by draft id
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  // Delete busy tracking
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchDrafts = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/drafts');
      if (!res.ok) throw new Error('Failed to load drafts.');
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // --- Create ---
  const handleCreate = async () => {
    if (!newText.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText.trim(), account_slot: 1 }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to save draft.');
      }
      setNewText('');
      await fetchDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Edit open/close ---
  const openEdit = (draft: Draft) => {
    setEditingDraft(draft);
    setEditText(draft.text);
  };

  const closeEdit = () => {
    setEditingDraft(null);
    setEditText('');
  };

  // --- Update ---
  const handleUpdate = async () => {
    if (!editingDraft || !editText.trim()) return;
    setIsUpdating(true);
    setError('');
    try {
      const res = await fetch(`/api/drafts/${editingDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText.trim() }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to update draft.');
      }
      closeEdit();
      await fetchDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update draft.');
    } finally {
      setIsUpdating(false);
    }
  };

  // --- Delete ---
  const handleDelete = async (id: number) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    setDeletingId(id);
    setError('');
    try {
      const res = await fetch(`/api/drafts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to delete draft.');
      }
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete draft.');
    } finally {
      setDeletingId(null);
    }
  };

  // --- Schedule ---
  const openSchedule = (id: number) => {
    // Default to 1 hour from now, rounded to the nearest 15 min
    const d = new Date();
    d.setHours(d.getHours() + 1, Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    // datetime-local input requires "YYYY-MM-DDTHH:MM"
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setScheduleDateTime(local);
    setSchedulingId(id);
  };

  const closeSchedule = () => {
    setSchedulingId(null);
    setScheduleDateTime('');
  };

  const handleSchedule = async (draft: Draft) => {
    if (!scheduleDateTime) return;
    setIsScheduling(true);
    setError('');
    try {
      const scheduledTime = new Date(scheduleDateTime).toISOString();
      const fd = new FormData();
      fd.append('text', draft.text);
      fd.append('scheduled_time', scheduledTime);
      fd.append('account_slot', String(draft.accountSlot));

      const postRes = await fetch('/api/scheduler/posts', { method: 'POST', body: fd });
      if (!postRes.ok) {
        const body = await postRes.json();
        throw new Error(body.error || 'Failed to schedule post.');
      }

      // On success, delete the draft
      await fetch(`/api/drafts/${draft.id}`, { method: 'DELETE' });

      closeSchedule();
      await fetchDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule post.');
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 shrink-0">&#9888;</span>
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            className="ml-auto shrink-0 text-red-400 hover:text-red-600"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Create new draft */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 mb-3">
          <Plus className="h-4 w-4 text-teal-600" />
          New Draft
        </h2>
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="What's on your mind? Write a draft tweet..."
          rows={3}
          className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className={`text-xs ${newText.length > 280 ? 'text-red-500' : 'text-slate-400'}`}>
            {newText.length} / 280
          </span>
          <button
            onClick={handleCreate}
            disabled={isSaving || !newText.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Save Draft
          </button>
        </div>
      </div>

      {/* Draft list */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-teal-600" />
            Drafts
            {!isLoading && drafts.length > 0 && (
              <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                {drafts.length}
              </span>
            )}
          </h2>
          <button
            onClick={fetchDrafts}
            disabled={isLoading}
            className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">Loading drafts...</span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && drafts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <FileText className="h-10 w-10 mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">No drafts yet</p>
            <p className="text-xs mt-1">Write something above to save your first draft.</p>
          </div>
        )}

        {/* Draft cards */}
        {!isLoading && drafts.length > 0 && (
          <ul className="space-y-3">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition-shadow hover:shadow-sm"
              >
                {/* Text preview */}
                <p className="text-sm text-slate-800 leading-relaxed mb-3 whitespace-pre-wrap break-words">
                  {truncate(draft.text, 120)}
                </p>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3 w-3" />
                    {formatRelativeDate(draft.createdAt)}
                  </span>

                  {draft.source && (
                    <span className="rounded-full bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-medium text-teal-700">
                      {draft.source}
                    </span>
                  )}

                  <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs text-slate-500">
                    Slot {draft.accountSlot}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Edit */}
                  <button
                    onClick={() => openEdit(draft)}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>

                  {/* Schedule */}
                  <button
                    onClick={() => openSchedule(draft.id)}
                    className="flex items-center gap-1.5 rounded-md border border-blue-300 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Schedule
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(draft.id)}
                    disabled={deletingId === draft.id}
                    className="ml-auto flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400 hover:border-red-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                    aria-label="Delete draft"
                  >
                    {deletingId === draft.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {/* Inline schedule picker */}
                {schedulingId === draft.id && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs font-medium text-blue-800 mb-2 flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Pick a date &amp; time to publish
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="datetime-local"
                        value={scheduleDateTime}
                        onChange={(e) => setScheduleDateTime(e.target.value)}
                        className="rounded-md border border-blue-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => handleSchedule(draft)}
                        disabled={isScheduling || !scheduleDateTime}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isScheduling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Confirm
                      </button>
                      <button
                        onClick={closeSchedule}
                        disabled={isScheduling}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editingDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Edit3 className="h-4 w-4 text-teal-600" />
                Edit Draft
              </h3>
              <button
                onClick={closeEdit}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="p-5 space-y-3">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
                className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <div className="flex items-center justify-between">
                <span className={`text-xs ${editText.length > 280 ? 'text-red-500' : 'text-slate-400'}`}>
                  {editText.length} / 280
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                onClick={closeEdit}
                disabled={isUpdating}
                className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={isUpdating || !editText.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
