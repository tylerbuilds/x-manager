'use client';

import { useState } from 'react';
import { Loader2, Search, Link2, Copy, BarChart3 } from 'lucide-react';

type Topic = {
  id: string;
  text: string;
  url: string;
  createdAt: string | null;
  language: string | null;
  relevanceScore: number;
  suggestedReplyStarter: string;
  author: {
    username: string | null;
    name: string | null;
    verified: boolean;
  };
  metrics: {
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
  };
};

type UsageResponse = {
  fetchedAt: string;
  endpoint: string;
  usage: unknown;
};

export default function TopicDiscovery() {
  const [keywords, setKeywords] = useState('ai agents, productivity');
  const [limit, setLimit] = useState(10);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [source, setSource] = useState<'live' | 'cache' | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<UsageResponse | null>(null);

  const searchTopics = async () => {
    setIsSearching(true);
    setError('');

    try {
      const params = new URLSearchParams({
        keywords,
        limit: String(limit),
      });

      const response = await fetch(`/api/discovery/topics?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to discover topics.');
      }

      setTopics(data.topics || []);
      setSource(data.source || 'live');
      setQuery(data.query || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover topics.');
      setTopics([]);
      setSource(null);
      setQuery('');
    } finally {
      setIsSearching(false);
    }
  };

  const refreshUsage = async () => {
    setIsRefreshingUsage(true);
    setError('');

    try {
      const response = await fetch('/api/usage/tweets?days=7');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to fetch usage.');
      }

      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch usage.');
    } finally {
      setIsRefreshingUsage(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard write can fail on restricted contexts.
    }
  };

  return (
    <div className="dashboard-card fade-up mt-6">
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Topic Discovery</h3>
            <p className="text-sm text-gray-600 mt-1">
              Find reply-worthy posts and keep an eye on usage credits.
            </p>
          </div>
          <button
            onClick={refreshUsage}
            disabled={isRefreshingUsage}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isRefreshingUsage ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            <span>{isRefreshingUsage ? 'Refreshing...' : 'Fetch Usage'}</span>
          </button>
        </div>

        {usage && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <p className="text-sm text-blue-900">
              Usage snapshot from <span className="font-medium">{new Date(usage.fetchedAt).toLocaleString()}</span>
            </p>
            <pre className="text-xs text-blue-900 mt-2 overflow-x-auto">{JSON.stringify(usage.usage, null, 2)}</pre>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Keywords</label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="ai agents, dev tools, startup ops"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Results</label>
            <input
              type="number"
              min={10}
              max={25}
              value={limit}
              onChange={(e) => setLimit(Math.min(Math.max(Number(e.target.value) || 10, 10), 25))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <button
          onClick={searchTopics}
          disabled={isSearching || !keywords.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span>{isSearching ? 'Searching...' : 'Find Topics'}</span>
        </button>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {query && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            Search query: <span className="font-mono">{query}</span>{' '}
            {source && <span className="text-gray-500">({source})</span>}
          </div>
        )}

        <div className="space-y-3">
          {topics.length === 0 && !isSearching ? (
            <p className="text-sm text-gray-500">No topics yet. Run a keyword search to populate candidates.</p>
          ) : (
            topics.map((topic) => (
              <div key={topic.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900">
                      {topic.author.name || topic.author.username || 'Unknown author'}
                    </span>
                    {topic.author.username && <span> · @{topic.author.username}</span>}
                    {topic.author.verified && <span> · Verified</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    Score {topic.relevanceScore} · {topic.createdAt ? new Date(topic.createdAt).toLocaleString() : 'Unknown time'}
                  </div>
                </div>

                <p className="text-sm text-gray-900 whitespace-pre-wrap">{topic.text}</p>

                <div className="text-xs text-gray-600 flex gap-4 flex-wrap">
                  <span>Likes: {topic.metrics.likes}</span>
                  <span>Replies: {topic.metrics.replies}</span>
                  <span>Reposts: {topic.metrics.reposts}</span>
                  <span>Quotes: {topic.metrics.quotes}</span>
                </div>

                <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-800">
                  <p className="font-medium text-gray-900 mb-1">Reply starter</p>
                  <p>{topic.suggestedReplyStarter}</p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={topic.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Link2 className="h-4 w-4" />
                    Open Post
                  </a>
                  <button
                    onClick={() => copyText(topic.suggestedReplyStarter)}
                    className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Reply Starter
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
