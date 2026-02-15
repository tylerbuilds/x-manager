'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Image as ImageIcon, Calendar, Link2 } from 'lucide-react';

type DraftTweet = {
  text: string;
  media_urls?: string[];
};

type DraftResponse = {
  article: {
    title: string;
    canonical_url: string;
    quote_candidates: string[];
    downloaded_media_urls: string[];
  };
  draft: {
    account_slot: number;
    source_url: string;
    tweets: DraftTweet[];
  };
};

interface CreateThreadFromArticleProps {
  onScheduled?: () => void;
}

export default function CreateThreadFromArticle({ onScheduled }: CreateThreadFromArticleProps) {
  const [articleUrl, setArticleUrl] = useState('');
  const [accountSlot, setAccountSlot] = useState(1);
  const [maxTweets, setMaxTweets] = useState(6);
  const [includeImages, setIncludeImages] = useState(true);
  const [scheduledTime, setScheduledTime] = useState('');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<DraftResponse | null>(null);

  const handleCreateDraft = async () => {
    if (!articleUrl.trim()) {
      setError('Enter an article URL first.');
      return;
    }

    setLoadingDraft(true);
    setError('');
    setSuccess('');
    setDraft(null);

    try {
      const response = await fetch('/api/agent/create-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_url: articleUrl.trim(),
          account_slot: accountSlot,
          max_tweets: maxTweets,
          include_images: includeImages,
          schedule: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create thread draft.');
      }

      setDraft(data as DraftResponse);
      setSuccess('Thread draft created. Review and schedule below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread draft.');
    } finally {
      setLoadingDraft(false);
    }
  };

  const updateTweetText = (index: number, text: string) => {
    if (!draft) return;
    const tweets = [...draft.draft.tweets];
    tweets[index] = { ...tweets[index], text };
    setDraft({
      ...draft,
      draft: {
        ...draft.draft,
        tweets,
      },
    });
  };

  const handleSchedule = async () => {
    if (!draft) {
      setError('Create a draft first.');
      return;
    }

    if (!scheduledTime) {
      setError('Pick a scheduled time.');
      return;
    }

    const scheduledIso = new Date(scheduledTime).toISOString();
    if (!scheduledIso || Number.isNaN(new Date(scheduledIso).getTime())) {
      setError('Invalid scheduled time.');
      return;
    }

    setScheduling(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/scheduler/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: accountSlot,
          scheduled_time: scheduledIso,
          dedupe: true,
          source_url: draft.draft.source_url,
          tweets: draft.draft.tweets,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to schedule thread.');
      }

      const scheduledCount = Number(data?.scheduled || 0);
      setSuccess(`Thread scheduled (${scheduledCount} posts).`);
      onScheduled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule thread.');
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="dashboard-card fade-up">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-teal-600" />
          <h3 className="font-semibold text-slate-800">Create Thread From Article</h3>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Article URL</label>
          <input
            type="url"
            value={articleUrl}
            onChange={(e) => setArticleUrl(e.target.value)}
            placeholder="https://swarmsignal.net/..."
            className="w-full p-2 border border-slate-300 rounded-md text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700">Account Slot</label>
            <select
              value={accountSlot}
              onChange={(e) => setAccountSlot(Number(e.target.value))}
              className="w-full p-2 border border-slate-300 rounded-md text-sm"
            >
              <option value={1}>Slot 1</option>
              <option value={2}>Slot 2</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Max Tweets</label>
            <input
              type="number"
              min={2}
              max={12}
              value={maxTweets}
              onChange={(e) => setMaxTweets(Math.max(2, Math.min(12, Number(e.target.value) || 6)))}
              className="w-full p-2 border border-slate-300 rounded-md text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
              />
              Pull article images
            </label>
          </div>
        </div>

        <button
          onClick={handleCreateDraft}
          disabled={loadingDraft}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-50"
        >
          {loadingDraft ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          <span>{loadingDraft ? 'Creating Draft...' : 'Create Draft'}</span>
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-700">{success}</p>}

        {draft && (
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="text-sm text-slate-700 space-y-1">
              <p className="font-medium">{draft.article.title}</p>
              <p className="inline-flex items-center gap-1 text-slate-600">
                <Link2 size={14} />
                <span className="break-all">{draft.article.canonical_url}</span>
              </p>
              <p className="inline-flex items-center gap-1 text-slate-600">
                <ImageIcon size={14} />
                <span>{draft.article.downloaded_media_urls.length} image(s) saved from article</span>
              </p>
            </div>

            <div className="space-y-2">
              {draft.draft.tweets.map((tweet, index) => (
                <div key={index} className="border border-slate-200 rounded-md p-2">
                  <label className="text-xs text-slate-500">Tweet {index + 1}</label>
                  <textarea
                    value={tweet.text}
                    onChange={(e) => updateTweetText(index, e.target.value)}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-md text-sm"
                    rows={3}
                  />
                  {tweet.media_urls && tweet.media_urls.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      Media: {tweet.media_urls.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 inline-flex items-center gap-2">
                <Calendar size={14} />
                Schedule Time
              </label>
              <input
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md text-sm"
              />
            </div>

            <button
              onClick={handleSchedule}
              disabled={scheduling}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {scheduling ? <Loader2 className="animate-spin" size={16} /> : <Calendar size={16} />}
              <span>{scheduling ? 'Scheduling...' : 'Schedule Thread'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
