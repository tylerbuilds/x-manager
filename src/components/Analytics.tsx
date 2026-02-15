'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Eye, Heart, Repeat2, MessageSquare, Bookmark, TrendingUp, Clock, Loader2, RefreshCw } from 'lucide-react';

type OverviewData = {
  totalPosts: number;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  totalEngagements: number;
  engagementRate: number;
};

type TimeseriesPoint = {
  day: string;
  post_count: number;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  engagement: number;
};

type PostMetric = {
  id: number;
  text: string;
  account_slot: number;
  twitter_post_id: string;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  engagement: number;
  engagementRate: number;
};

type HeatmapCell = {
  dayOfWeek: number;
  hour: number;
  avgEngagement: number;
  postCount: number;
};

type BestSlot = {
  dayOfWeek: number;
  hour: number;
  avgEngagement: number;
  postCount: number;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function MetricCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
        <span className="text-sm text-slate-600">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900">{typeof value === 'number' ? formatNumber(value) : value}</div>
    </div>
  );
}

export default function Analytics() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [topPosts, setTopPosts] = useState<PostMetric[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [bestSlots, setBestSlots] = useState<BestSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, timeseriesRes, postsRes, bestTimesRes] = await Promise.all([
        fetch(`/api/analytics/overview?days=${days}`),
        fetch(`/api/analytics/timeseries?days=${days}`),
        fetch(`/api/analytics/posts?sort=engagement&limit=10`),
        fetch(`/api/analytics/best-times?days=90`),
      ]);

      if (overviewRes.ok) {
        setOverview(await overviewRes.json());
      }
      if (timeseriesRes.ok) {
        const ts = await timeseriesRes.json();
        setTimeseries(ts.data || []);
      }
      if (postsRes.ok) {
        const p = await postsRes.json();
        setTopPosts(p.posts || []);
      }
      if (bestTimesRes.ok) {
        const bt = await bestTimesRes.json();
        setHeatmap(bt.heatmap || []);
        setBestSlots(bt.bestSlots || []);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <span className="ml-3 text-slate-600">Loading analytics...</span>
      </div>
    );
  }

  const maxEngagement = Math.max(...timeseries.map((d) => d.engagement), 1);
  const maxHeatVal = Math.max(...heatmap.map((c) => c.avgEngagement), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Analytics</h2>
          <p className="text-sm text-slate-500">Track your X post performance and engagement trends.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="p-2 border border-slate-300 rounded-lg text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={loadData}
            className="p-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Posts"
          value={overview?.totalPosts || 0}
          icon={<BarChart3 size={18} className="text-blue-600" />}
          color="bg-blue-50"
        />
        <MetricCard
          label="Impressions"
          value={overview?.impressions || 0}
          icon={<Eye size={18} className="text-purple-600" />}
          color="bg-purple-50"
        />
        <MetricCard
          label="Engagements"
          value={overview?.totalEngagements || 0}
          icon={<TrendingUp size={18} className="text-emerald-600" />}
          color="bg-emerald-50"
        />
        <MetricCard
          label="Eng. Rate"
          value={`${overview?.engagementRate || 0}%`}
          icon={<Heart size={18} className="text-rose-600" />}
          color="bg-rose-50"
        />
      </div>

      {/* Engagement Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Likes" value={overview?.likes || 0} icon={<Heart size={16} className="text-rose-500" />} color="bg-rose-50" />
        <MetricCard label="Retweets" value={overview?.retweets || 0} icon={<Repeat2 size={16} className="text-green-500" />} color="bg-green-50" />
        <MetricCard label="Replies" value={overview?.replies || 0} icon={<MessageSquare size={16} className="text-blue-500" />} color="bg-blue-50" />
        <MetricCard label="Bookmarks" value={overview?.bookmarks || 0} icon={<Bookmark size={16} className="text-amber-500" />} color="bg-amber-50" />
      </div>

      {/* Daily Engagement Trend - CSS Bar Chart */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Daily Engagement Trend</h3>
        {timeseries.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">No data yet. Metrics are collected automatically for posted tweets.</p>
        ) : (
          <div className="flex items-end gap-1 h-48 overflow-x-auto pb-6 relative">
            {timeseries.map((point) => {
              const height = maxEngagement > 0 ? (point.engagement / maxEngagement) * 100 : 0;
              return (
                <div key={point.day} className="flex flex-col items-center flex-shrink-0 group" style={{ minWidth: '24px' }}>
                  <div className="relative w-full flex justify-center">
                    <div
                      className="w-5 bg-gradient-to-t from-teal-600 to-teal-400 rounded-t transition-all hover:from-teal-700 hover:to-teal-500"
                      style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${point.day}: ${point.engagement} engagements, ${point.post_count} posts`}
                    />
                    <div className="absolute bottom-full mb-1 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {point.day}: {point.engagement} eng, {point.post_count} posts
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 rotate-[-45deg] origin-top-left whitespace-nowrap">
                    {point.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Performing Posts */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Top Performing Posts</h3>
          {topPosts.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No posted tweets with metrics yet.</p>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {topPosts.map((post, idx) => (
                <div key={post.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-xs font-bold text-slate-400 bg-slate-100 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <p className="text-sm text-slate-800 line-clamp-2">{post.text}</p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Eye size={12} /> {formatNumber(post.impressions)}</span>
                    <span className="inline-flex items-center gap-1"><Heart size={12} className="text-rose-400" /> {post.likes}</span>
                    <span className="inline-flex items-center gap-1"><Repeat2 size={12} className="text-green-400" /> {post.retweets}</span>
                    <span className="inline-flex items-center gap-1"><MessageSquare size={12} className="text-blue-400" /> {post.replies}</span>
                    <span className="font-medium text-teal-700">{post.engagementRate}% ER</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Best Time to Post Heatmap */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Best Time to Post</h3>
          <p className="text-xs text-slate-500 mb-4">Based on average engagement by day and hour (last 90 days)</p>

          {heatmap.length === 0 || maxHeatVal === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">Not enough data to show best times.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {/* Hour labels */}
                <div className="flex ml-10 mb-1">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-slate-400">
                      {h % 3 === 0 ? `${h}` : ''}
                    </div>
                  ))}
                </div>
                {/* Grid rows */}
                {DAY_NAMES.map((dayName, d) => (
                  <div key={d} className="flex items-center gap-1 mb-[2px]">
                    <span className="text-xs text-slate-500 w-9 text-right">{dayName}</span>
                    <div className="flex flex-1 gap-[1px]">
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = heatmap.find((c) => c.dayOfWeek === d && c.hour === h);
                        const intensity = cell ? cell.avgEngagement / maxHeatVal : 0;
                        const bg =
                          intensity === 0
                            ? 'bg-slate-100'
                            : intensity < 0.25
                              ? 'bg-teal-100'
                              : intensity < 0.5
                                ? 'bg-teal-300'
                                : intensity < 0.75
                                  ? 'bg-teal-500'
                                  : 'bg-teal-700';
                        return (
                          <div
                            key={h}
                            className={`flex-1 h-5 rounded-sm ${bg} transition-colors`}
                            title={`${dayName} ${h}:00 - Avg engagement: ${cell?.avgEngagement.toFixed(1) || '0'} (${cell?.postCount || 0} posts)`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
                {/* Legend */}
                <div className="flex items-center justify-end gap-1 mt-3">
                  <span className="text-[10px] text-slate-400">Less</span>
                  <div className="w-4 h-3 rounded-sm bg-slate-100" />
                  <div className="w-4 h-3 rounded-sm bg-teal-100" />
                  <div className="w-4 h-3 rounded-sm bg-teal-300" />
                  <div className="w-4 h-3 rounded-sm bg-teal-500" />
                  <div className="w-4 h-3 rounded-sm bg-teal-700" />
                  <span className="text-[10px] text-slate-400">More</span>
                </div>
              </div>
            </div>
          )}

          {/* Best Slots */}
          {bestSlots.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <h4 className="text-sm font-medium text-slate-700 mb-2 inline-flex items-center gap-1">
                <Clock size={14} /> Recommended Times
              </h4>
              <div className="flex flex-wrap gap-2">
                {bestSlots.map((slot, i) => (
                  <span key={i} className="text-xs bg-teal-50 text-teal-800 px-2 py-1 rounded-full border border-teal-200">
                    {DAY_NAMES[slot.dayOfWeek]} {slot.hour}:00 ({slot.avgEngagement.toFixed(1)} avg)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
