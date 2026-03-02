'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Clock3,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

type TabKey = 'rules' | 'feeds' | 'searches';

type AutomationRule = {
  id: number;
  name: string;
  triggerType: 'event' | 'schedule' | 'keyword';
  triggerConfig: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  actionType: 'like' | 'reply' | 'repost' | 'schedule_post' | 'send_dm' | 'dismiss' | 'tag' | 'webhook';
  actionConfig: Record<string, unknown>;
  accountSlot: number;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
};

type AutomationRun = {
  id: number;
  status: 'success' | 'failed' | 'skipped';
  triggerSource: string | null;
  error: string | null;
  createdAt: string | null;
};

type Feed = {
  id: number;
  url: string;
  title: string | null;
  accountSlot: number;
  checkIntervalMinutes: number;
  lastCheckedAt: string | null;
  lastEntryId: string | null;
  autoSchedule: boolean;
  template: string | null;
  status: 'active' | 'paused';
};

type SavedSearch = {
  id: number;
  keywords: string[];
  accountSlot: number;
  checkIntervalMinutes: number;
  lastCheckedAt: string | null;
  autoAction: 'like' | 'reply' | null;
  replyTemplate: string | null;
  notify: boolean;
  language: string | null;
  status: 'active' | 'paused';
};

const ruleTriggerOptions: Array<AutomationRule['triggerType']> = ['event', 'schedule', 'keyword'];
const ruleActionOptions: Array<AutomationRule['actionType']> = ['like', 'reply', 'repost', 'schedule_post', 'send_dm', 'dismiss', 'tag', 'webhook'];

function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-[linear-gradient(135deg,rgba(15,23,42,0.02),rgba(20,184,166,0.06))]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-slate-900 text-white p-2">{icon}</div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-600">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function AutomationWorkbench() {
  const [activeTab, setActiveTab] = useState<TabKey>('rules');
  const [busyKey, setBusyKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [ruleRuns, setRuleRuns] = useState<AutomationRun[]>([]);

  const [ruleName, setRuleName] = useState('');
  const [ruleTriggerType, setRuleTriggerType] = useState<AutomationRule['triggerType']>('event');
  const [ruleActionType, setRuleActionType] = useState<AutomationRule['actionType']>('reply');
  const [ruleEventType, setRuleEventType] = useState('inbox.new_mention');
  const [ruleCron, setRuleCron] = useState('0 9 * * *');
  const [ruleKeywords, setRuleKeywords] = useState('agent, launch');
  const [ruleActionText, setRuleActionText] = useState('Thanks for the mention: {text}');

  const [feedUrl, setFeedUrl] = useState('');
  const [feedTemplate, setFeedTemplate] = useState('{title} {url}');
  const [feedInterval, setFeedInterval] = useState('15');
  const [feedAutoSchedule, setFeedAutoSchedule] = useState(true);

  const [searchKeywords, setSearchKeywords] = useState('ai agents, orchestration');
  const [searchInterval, setSearchInterval] = useState('15');
  const [searchAutoAction, setSearchAutoAction] = useState<'none' | 'like' | 'reply'>('none');
  const [searchReplyTemplate, setSearchReplyTemplate] = useState('{suggestedReplyStarter}');
  const [searchNotify, setSearchNotify] = useState(true);

  const clearNotices = () => {
    setStatusMessage('');
    setErrorMessage('');
  };

  const loadRules = async () => {
    const response = await fetch('/api/automation/rules');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load automation rules.');
    setRules(data.rules || []);
  };

  const loadFeeds = async () => {
    const response = await fetch('/api/feeds');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load feeds.');
    setFeeds(data.feeds || []);
  };

  const loadSearches = async () => {
    const response = await fetch('/api/discovery/saved');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Failed to load saved searches.');
    setSearches(data.searches || []);
  };

  const refreshAll = async () => {
    clearNotices();
    setBusyKey('refresh');
    try {
      await Promise.all([loadRules(), loadFeeds(), loadSearches()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh automation workbench.');
    } finally {
      setBusyKey('');
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );

  const loadRuleRuns = async (ruleId: number) => {
    setBusyKey(`runs-${ruleId}`);
    try {
      const response = await fetch(`/api/automation/rules/${ruleId}/log?limit=8`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load rule runs.');
      setSelectedRuleId(ruleId);
      setRuleRuns(data.runs || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load rule runs.');
    } finally {
      setBusyKey('');
    }
  };

  const createRule = async () => {
    if (!ruleName.trim()) {
      setErrorMessage('Rule name is required.');
      return;
    }

    const triggerConfig =
      ruleTriggerType === 'event'
        ? { event_type: ruleEventType.trim() || '*' }
        : ruleTriggerType === 'schedule'
          ? { cron: ruleCron.trim() }
          : { keywords: ruleKeywords.split(',').map((value) => value.trim()).filter(Boolean) };

    const actionConfig =
      ruleActionType === 'reply' || ruleActionType === 'send_dm' || ruleActionType === 'schedule_post'
        ? { text: ruleActionText.trim() }
        : ruleActionType === 'webhook'
          ? { url: ruleActionText.trim() }
          : ruleActionType === 'tag'
            ? { tag: ruleActionText.trim() }
            : {};

    clearNotices();
    setBusyKey('create-rule');
    try {
      const response = await fetch('/api/automation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ruleName.trim(),
          trigger_type: ruleTriggerType,
          trigger_config: triggerConfig,
          action_type: ruleActionType,
          action_config: actionConfig,
          account_slot: 1,
          conditions: [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create rule.');

      setRuleName('');
      setStatusMessage(`Rule created: ${data.rule.name}`);
      await loadRules();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create rule.');
    } finally {
      setBusyKey('');
    }
  };

  const updateRuleEnabled = async (rule: AutomationRule, enabled: boolean) => {
    clearNotices();
    setBusyKey(`rule-toggle-${rule.id}`);
    try {
      const response = await fetch(`/api/automation/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update rule.');
      setStatusMessage(`Rule ${data.rule.name} ${enabled ? 'enabled' : 'paused'}.`);
      await loadRules();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update rule.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteRule = async (rule: AutomationRule) => {
    clearNotices();
    setBusyKey(`rule-delete-${rule.id}`);
    try {
      const response = await fetch(`/api/automation/rules/${rule.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to delete rule.');
      setStatusMessage(`Rule ${rule.name} deleted.`);
      if (selectedRuleId === rule.id) {
        setSelectedRuleId(null);
        setRuleRuns([]);
      }
      await loadRules();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete rule.');
    } finally {
      setBusyKey('');
    }
  };

  const createFeed = async () => {
    if (!feedUrl.trim()) {
      setErrorMessage('Feed URL is required.');
      return;
    }

    clearNotices();
    setBusyKey('create-feed');
    try {
      const response = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: feedUrl.trim(),
          template: feedTemplate.trim(),
          check_interval_minutes: Number(feedInterval) || 15,
          auto_schedule: feedAutoSchedule,
          account_slot: 1,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create feed.');
      setFeedUrl('');
      setStatusMessage(`Feed created: ${data.feed.url}`);
      await loadFeeds();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create feed.');
    } finally {
      setBusyKey('');
    }
  };

  const updateFeedStatus = async (feed: Feed, status: 'active' | 'paused') => {
    clearNotices();
    setBusyKey(`feed-toggle-${feed.id}`);
    try {
      const response = await fetch(`/api/feeds/${feed.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update feed.');
      setStatusMessage(`Feed ${data.feed.url} ${status === 'active' ? 'activated' : 'paused'}.`);
      await loadFeeds();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update feed.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteFeed = async (feed: Feed) => {
    clearNotices();
    setBusyKey(`feed-delete-${feed.id}`);
    try {
      const response = await fetch(`/api/feeds/${feed.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to delete feed.');
      setStatusMessage(`Feed deleted: ${feed.url}`);
      await loadFeeds();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete feed.');
    } finally {
      setBusyKey('');
    }
  };

  const createSearch = async () => {
    const keywords = searchKeywords.split(',').map((value) => value.trim()).filter(Boolean);
    if (keywords.length === 0) {
      setErrorMessage('At least one keyword is required.');
      return;
    }

    clearNotices();
    setBusyKey('create-search');
    try {
      const response = await fetch('/api/discovery/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          check_interval_minutes: Number(searchInterval) || 15,
          auto_action: searchAutoAction === 'none' ? null : searchAutoAction,
          reply_template: searchAutoAction === 'reply' ? searchReplyTemplate.trim() : null,
          notify: searchNotify,
          account_slot: 1,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create saved search.');
      setSearchKeywords('');
      setStatusMessage(`Saved search created for ${data.search.keywords.join(', ')}.`);
      await loadSearches();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create saved search.');
    } finally {
      setBusyKey('');
    }
  };

  const updateSearchStatus = async (search: SavedSearch, status: 'active' | 'paused') => {
    clearNotices();
    setBusyKey(`search-toggle-${search.id}`);
    try {
      const response = await fetch(`/api/discovery/saved/${search.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update saved search.');
      setStatusMessage(`Saved search ${data.search.keywords.join(', ')} ${status === 'active' ? 'activated' : 'paused'}.`);
      await loadSearches();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update saved search.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteSearch = async (search: SavedSearch) => {
    clearNotices();
    setBusyKey(`search-delete-${search.id}`);
    try {
      const response = await fetch(`/api/discovery/saved/${search.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to delete saved search.');
      setStatusMessage(`Saved search deleted: ${search.keywords.join(', ')}.`);
      await loadSearches();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete saved search.');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="space-y-6">
      <Panel
        title="Automation Workbench"
        subtitle="Rule triggers, RSS ingestion, and persistent keyword monitoring for Sprint 3."
        icon={<Bot size={18} />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'rules', label: 'Rules', icon: <ShieldAlert size={14} /> },
              { key: 'feeds', label: 'RSS Feeds', icon: <Newspaper size={14} /> },
              { key: 'searches', label: 'Saved Searches', icon: <Search size={14} /> },
            ] as Array<{ key: TabKey; label: string; icon: React.ReactNode }>).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                  activeTab === tab.key
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={refreshAll}
            disabled={busyKey === 'refresh'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {busyKey === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span>Refresh</span>
          </button>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800">
                <Plus size={14} />
                <span>Create automation rule</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={ruleName}
                  onChange={(event) => setRuleName(event.target.value)}
                  placeholder="Rule name"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <select
                  value={ruleTriggerType}
                  onChange={(event) => setRuleTriggerType(event.target.value as AutomationRule['triggerType'])}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ruleTriggerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <select
                  value={ruleActionType}
                  onChange={(event) => setRuleActionType(event.target.value as AutomationRule['actionType'])}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ruleActionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                  Slot 1 default. Conditions can be edited later through the API.
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {ruleTriggerType === 'event' && (
                  <input
                    value={ruleEventType}
                    onChange={(event) => setRuleEventType(event.target.value)}
                    placeholder="Event type, e.g. inbox.new_mention"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                )}
                {ruleTriggerType === 'schedule' && (
                  <input
                    value={ruleCron}
                    onChange={(event) => setRuleCron(event.target.value)}
                    placeholder="Cron expression"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                )}
                {ruleTriggerType === 'keyword' && (
                  <input
                    value={ruleKeywords}
                    onChange={(event) => setRuleKeywords(event.target.value)}
                    placeholder="Keywords, comma separated"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                )}
                <textarea
                  value={ruleActionText}
                  onChange={(event) => setRuleActionText(event.target.value)}
                  placeholder="Reply/template/tag/webhook URL"
                  className="min-h-[88px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <button
                onClick={createRule}
                disabled={busyKey === 'create-rule'}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyKey === 'create-rule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot size={14} />}
                <span>Create Rule</span>
              </button>
            </div>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">Live rules</h4>
                  <span className="text-xs text-slate-500">{rules.length} total</span>
                </div>
                <div className="space-y-3">
                  {rules.length === 0 ? (
                    <p className="text-sm text-slate-500">No automation rules yet.</p>
                  ) : (
                    rules.map((rule) => (
                      <div key={rule.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-900">{rule.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {rule.triggerType} → {rule.actionType} • runs {rule.runCount}
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] ${rule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {rule.enabled ? 'enabled' : 'paused'}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => updateRuleEnabled(rule, !rule.enabled)}
                            disabled={busyKey === `rule-toggle-${rule.id}`}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                          >
                            {rule.enabled ? 'Pause' : 'Enable'}
                          </button>
                          <button
                            onClick={() => loadRuleRuns(rule.id)}
                            disabled={busyKey === `runs-${rule.id}`}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                          >
                            {busyKey === `runs-${rule.id}` ? 'Loading...' : 'View Runs'}
                          </button>
                          <button
                            onClick={() => deleteRule(rule)}
                            disabled={busyKey === `rule-delete-${rule.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">Execution log</h4>
                  {selectedRule && <span className="text-xs text-slate-500">{selectedRule.name}</span>}
                </div>
                {selectedRuleId == null ? (
                  <p className="text-sm text-slate-500">Choose a rule to inspect recent runs.</p>
                ) : ruleRuns.length === 0 ? (
                  <p className="text-sm text-slate-500">No runs recorded yet for this rule.</p>
                ) : (
                  <div className="space-y-2">
                    {ruleRuns.map((run) => (
                      <div key={run.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                            run.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : run.status === 'failed'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}>
                            {run.status}
                          </span>
                          <span className="text-xs text-slate-400">{run.createdAt ? new Date(run.createdAt).toLocaleString() : 'unknown time'}</span>
                        </div>
                        {run.triggerSource && <div className="mt-1 text-xs text-slate-500">Trigger: {run.triggerSource}</div>}
                        {run.error && <div className="mt-1 text-xs text-rose-600">{run.error}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'feeds' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800">
                <Plus size={14} />
                <span>Add RSS/Atom feed</span>
              </div>
              <div className="space-y-3">
                <input
                  value={feedUrl}
                  onChange={(event) => setFeedUrl(event.target.value)}
                  placeholder="https://example.com/feed.xml"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <textarea
                  value={feedTemplate}
                  onChange={(event) => setFeedTemplate(event.target.value)}
                  placeholder="Post template"
                  className="min-h-[88px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={feedInterval}
                    onChange={(event) => setFeedInterval(event.target.value)}
                    placeholder="Check interval"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={feedAutoSchedule}
                      onChange={(event) => setFeedAutoSchedule(event.target.checked)}
                    />
                    Auto-schedule
                  </label>
                </div>
              </div>
              <button
                onClick={createFeed}
                disabled={busyKey === 'create-feed'}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyKey === 'create-feed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Newspaper size={14} />}
                <span>Create Feed</span>
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">Monitored feeds</h4>
                <span className="text-xs text-slate-500">{feeds.length} total</span>
              </div>
              <div className="space-y-3">
                {feeds.length === 0 ? (
                  <p className="text-sm text-slate-500">No feeds configured yet.</p>
                ) : (
                  feeds.map((feed) => (
                    <div key={feed.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{feed.title || feed.url}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{feed.url}</div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[11px] ${feed.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {feed.status}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                        <div>Every {feed.checkIntervalMinutes} min</div>
                        <div>{feed.autoSchedule ? 'Auto-scheduling on' : 'Manual only'}</div>
                        <div>{feed.lastCheckedAt ? new Date(feed.lastCheckedAt).toLocaleString() : 'Never checked'}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => updateFeedStatus(feed, feed.status === 'active' ? 'paused' : 'active')}
                          disabled={busyKey === `feed-toggle-${feed.id}`}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                        >
                          {feed.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteFeed(feed)}
                          disabled={busyKey === `feed-delete-${feed.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'searches' && (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800">
                <Plus size={14} />
                <span>Create saved search</span>
              </div>
              <div className="space-y-3">
                <input
                  value={searchKeywords}
                  onChange={(event) => setSearchKeywords(event.target.value)}
                  placeholder="Keywords, comma separated"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={searchInterval}
                    onChange={(event) => setSearchInterval(event.target.value)}
                    placeholder="Check interval"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <select
                    value={searchAutoAction}
                    onChange={(event) => setSearchAutoAction(event.target.value as 'none' | 'like' | 'reply')}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="none">Notify only</option>
                    <option value="like">Auto like</option>
                    <option value="reply">Auto reply</option>
                  </select>
                </div>
                <textarea
                  value={searchReplyTemplate}
                  onChange={(event) => setSearchReplyTemplate(event.target.value)}
                  placeholder="Reply template"
                  className="min-h-[88px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={searchNotify}
                    onChange={(event) => setSearchNotify(event.target.checked)}
                  />
                  Emit keyword match events
                </label>
              </div>
              <button
                onClick={createSearch}
                disabled={busyKey === 'create-search'}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyKey === 'create-search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 size={14} />}
                <span>Create Saved Search</span>
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">Watched keyword sets</h4>
                <span className="text-xs text-slate-500">{searches.length} total</span>
              </div>
              <div className="space-y-3">
                {searches.length === 0 ? (
                  <p className="text-sm text-slate-500">No saved searches configured yet.</p>
                ) : (
                  searches.map((search) => (
                    <div key={search.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{search.keywords.join(', ')}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            Every {search.checkIntervalMinutes} min • {search.autoAction ? `auto ${search.autoAction}` : 'notify only'}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[11px] ${search.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {search.status}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => updateSearchStatus(search, search.status === 'active' ? 'paused' : 'active')}
                          disabled={busyKey === `search-toggle-${search.id}`}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                        >
                          {search.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteSearch(search)}
                          disabled={busyKey === `search-delete-${search.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
