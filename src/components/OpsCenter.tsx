'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  ThumbsUp,
  Repeat2,
  ClipboardCheck,
  Sparkles,
} from 'lucide-react';

type InboxStatus = 'new' | 'reviewed' | 'replied' | 'dismissed';

type InboxItem = {
  id: number;
  accountSlot: number;
  sourceType: 'mention' | 'dm';
  sourceId: string;
  conversationId: string | null;
  authorUserId: string | null;
  authorUsername: string | null;
  text: string;
  status: InboxStatus;
  receivedAt: string;
  inReplyToTweetId?: string | null;
};

type ConversationMessage = {
  id: number;
  source_id: string;
  author_username: string | null;
  text: string;
  received_at: number;
  status: string;
};

type Campaign = {
  id: number;
  name: string;
  objective: string;
  accountSlot: number;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  startAt: string | null;
  endAt: string | null;
};

type Approval = {
  id: number;
  campaignId: number;
  taskId: number | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  decisionNote: string | null;
};

export default function OpsCenter() {
  const [accountSlot, setAccountSlot] = useState(1);
  const [includeDms, setIncludeDms] = useState(true);

  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);

  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [dmDrafts, setDmDrafts] = useState<Record<number, string>>({});

  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ConversationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  const [savedReplies, setSavedReplies] = useState<Array<{ id: number; name: string; text: string; category: string | null; useCount: number }>>([]);
  const [showSavedRepliesManager, setShowSavedRepliesManager] = useState(false);
  const [newReplyName, setNewReplyName] = useState('');
  const [newReplyText, setNewReplyText] = useState('');
  const [newReplyCategory, setNewReplyCategory] = useState('');

  const [campaignName, setCampaignName] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');

  const [workingId, setWorkingId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxStatusFilter, setInboxStatusFilter] = useState('');

  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals]);

  const clearMessages = () => {
    setStatusMessage('');
    setErrorMessage('');
  };

  const loadInbox = async () => {
    setLoadingInbox(true);
    try {
      const params = new URLSearchParams();
      params.set('account_slot', String(accountSlot));
      params.set('limit', '50');
      if (inboxSearch) params.set('search', inboxSearch);
      if (inboxStatusFilter) {
        params.set('status', inboxStatusFilter);
      } else {
        params.set('status', 'new,reviewed,replied');
      }
      const qs = params.toString();
      const response = await fetch(`/api/engagement/inbox${qs ? `?${qs}` : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load inbox.');
      setInboxItems(data.items || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load inbox.');
    } finally {
      setLoadingInbox(false);
    }
  };

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const response = await fetch('/api/agent/campaigns');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load campaigns.');
      setCampaigns(data.items || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load campaigns.');
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const loadApprovals = async () => {
    setLoadingApprovals(true);
    try {
      const response = await fetch('/api/agent/approvals');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load approvals.');
      setApprovals(data.items || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load approvals.');
    } finally {
      setLoadingApprovals(false);
    }
  };

  const loadSavedReplies = async () => {
    try {
      const response = await fetch('/api/engagement/saved-replies');
      const data = await response.json();
      if (response.ok) setSavedReplies(data.items || []);
    } catch { /* ignore */ }
  };

  const insertSavedReply = (itemId: number, replyText: string, replyId: number, isDm: boolean) => {
    if (isDm) {
      setDmDrafts((prev) => ({ ...prev, [itemId]: (prev[itemId] || '') + replyText }));
    } else {
      setReplyDrafts((prev) => ({ ...prev, [itemId]: (prev[itemId] || '') + replyText }));
    }
    // Increment use count
    void fetch(`/api/engagement/saved-replies/${replyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incrementUseCount: true }),
    });
  };

  const createSavedReply = async () => {
    if (!newReplyName.trim() || !newReplyText.trim()) return;
    try {
      await fetch('/api/engagement/saved-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newReplyName, text: newReplyText, category: newReplyCategory || undefined }),
      });
      setNewReplyName('');
      setNewReplyText('');
      setNewReplyCategory('');
      await loadSavedReplies();
    } catch { /* ignore */ }
  };

  const deleteSavedReply = async (id: number) => {
    await fetch(`/api/engagement/saved-replies/${id}`, { method: 'DELETE' });
    await loadSavedReplies();
  };

  const loadThread = async (sourceId: string) => {
    setSelectedThread(sourceId);
    setLoadingThread(true);
    try {
      const response = await fetch(`/api/engagement/inbox/conversations/${encodeURIComponent(sourceId)}`);
      const data = await response.json();
      if (response.ok) {
        setThreadMessages(data.messages || []);
      }
    } catch {
      setThreadMessages([]);
    } finally {
      setLoadingThread(false);
    }
  };

  // Group inbox items by conversation threads
  const groupedInbox = (() => {
    const threads = new Map<string, InboxItem[]>();
    for (const item of inboxItems) {
      const key = item.conversationId || item.sourceId;
      if (!threads.has(key)) threads.set(key, []);
      threads.get(key)!.push(item);
    }
    // Sort threads by latest message
    return Array.from(threads.entries())
      .map(([key, items]) => ({
        threadId: key,
        latest: items[items.length - 1],
        items,
        hasMultiple: items.length > 1,
      }))
      .sort((a, b) => new Date(b.latest.receivedAt).getTime() - new Date(a.latest.receivedAt).getTime());
  })();

  useEffect(() => {
    void loadInbox();
  }, [accountSlot]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadInbox();
    }, 300);
    return () => clearTimeout(timer);
  }, [inboxSearch, inboxStatusFilter]);

  useEffect(() => {
    void Promise.all([loadCampaigns(), loadApprovals(), loadSavedReplies()]);
  }, []);

  const syncInbox = async () => {
    clearMessages();
    setWorkingId('sync');
    try {
      const response = await fetch('/api/engagement/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: accountSlot,
          include_mentions: true,
          include_dms: includeDms,
          count: 25,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to sync inbox.');
      setStatusMessage(`Synced inbox: ${data.synced.mentions} mentions, ${data.synced.dms} DMs.`);
      await loadInbox();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to sync inbox.');
    } finally {
      setWorkingId('');
    }
  };

  const updateInboxStatus = async (item: InboxItem, status: InboxStatus) => {
    clearMessages();
    setWorkingId(`status-${item.id}`);
    try {
      const response = await fetch(`/api/engagement/inbox/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update inbox item.');
      setStatusMessage(`Inbox item ${item.id} updated to ${status}.`);
      await loadInbox();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update inbox item.');
    } finally {
      setWorkingId('');
    }
  };

  const sendReply = async (item: InboxItem) => {
    const text = (replyDrafts[item.id] || '').trim();
    if (!text) {
      setErrorMessage('Enter a reply first.');
      return;
    }

    clearMessages();
    setWorkingId(`reply-${item.id}`);
    try {
      const response = await fetch('/api/engagement/actions/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: item.accountSlot,
          inbox_id: item.id,
          reply_to_tweet_id: item.sourceId,
          text,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send reply.');
      setStatusMessage(`Reply sent (tweet id: ${data.tweetId || 'unknown'}).`);
      setReplyDrafts((prev) => ({ ...prev, [item.id]: '' }));
      await loadInbox();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send reply.');
    } finally {
      setWorkingId('');
    }
  };

  const sendDmReply = async (item: InboxItem) => {
    const text = (dmDrafts[item.id] || '').trim();
    if (!text) {
      setErrorMessage('Enter a DM response first.');
      return;
    }
    if (!item.authorUserId) {
      setErrorMessage('Cannot reply to this DM: sender id missing.');
      return;
    }

    clearMessages();
    setWorkingId(`dm-${item.id}`);
    try {
      const response = await fetch('/api/engagement/actions/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: item.accountSlot,
          inbox_id: item.id,
          recipient_user_id: item.authorUserId,
          text,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to send DM.');
      setStatusMessage(`DM sent (event id: ${data.eventId || 'unknown'}).`);
      setDmDrafts((prev) => ({ ...prev, [item.id]: '' }));
      await loadInbox();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send DM.');
    } finally {
      setWorkingId('');
    }
  };

  const runEngagementAction = async (type: 'like' | 'repost', item: InboxItem) => {
    clearMessages();
    setWorkingId(`${type}-${item.id}`);
    try {
      const response = await fetch(`/api/engagement/actions/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_slot: item.accountSlot,
          inbox_id: item.id,
          tweet_id: item.sourceId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Failed to ${type}.`);
      setStatusMessage(type === 'like' ? 'Post liked.' : 'Post reposted.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Failed to ${type}.`);
    } finally {
      setWorkingId('');
    }
  };

  const createCampaign = async () => {
    if (!campaignName.trim() || !campaignObjective.trim()) {
      setErrorMessage('Campaign name and objective are required.');
      return;
    }

    clearMessages();
    setWorkingId('campaign-create');
    try {
      const response = await fetch('/api/agent/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim(),
          objective: campaignObjective.trim(),
          account_slot: accountSlot,
          status: 'draft',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to create campaign.');

      setCampaignName('');
      setCampaignObjective('');
      setStatusMessage(`Campaign created: ${data.campaign.name}`);
      await loadCampaigns();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create campaign.');
    } finally {
      setWorkingId('');
    }
  };

  const buildCampaignPlan = async (campaignId: number) => {
    clearMessages();
    setWorkingId(`plan-${campaignId}`);
    try {
      const response = await fetch(`/api/agent/campaigns/${campaignId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to generate campaign plan.');
      setStatusMessage(`Campaign plan generated with ${data.insertedCount} task(s).`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate campaign plan.');
    } finally {
      setWorkingId('');
    }
  };

  const setCampaignStatus = async (campaign: Campaign, status: Campaign['status']) => {
    clearMessages();
    setWorkingId(`campaign-status-${campaign.id}`);
    try {
      const response = await fetch(`/api/agent/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update campaign status.');
      setStatusMessage(`Campaign ${campaign.id} set to ${status}.`);
      await loadCampaigns();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update campaign status.');
    } finally {
      setWorkingId('');
    }
  };

  const decideApproval = async (approval: Approval, status: 'approved' | 'rejected') => {
    clearMessages();
    setWorkingId(`approval-${approval.id}`);
    try {
      const response = await fetch('/api/agent/approvals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: approval.id,
          status,
          decision_note: status === 'approved' ? 'Approved from Ops Center.' : 'Rejected from Ops Center.',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to update approval.');
      setStatusMessage(`Approval ${approval.id} marked ${status}.`);
      await loadApprovals();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update approval.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Ops Center</h2>
            <p className="text-sm text-slate-600">Agent-ready engagement inbox, campaign orchestration, and approvals.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={accountSlot}
              onChange={(event) => setAccountSlot(Number(event.target.value))}
              className="p-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value={1}>Slot 1</option>
              <option value={2}>Slot 2</option>
            </select>
            <label className="text-sm text-slate-700 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeDms}
                onChange={(event) => setIncludeDms(event.target.checked)}
              />
              Sync DMs
            </label>
            <button
              onClick={() => setShowSavedRepliesManager(true)}
              className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
            >
              Quick Replies
            </button>
            <button
              onClick={syncInbox}
              disabled={workingId === 'sync'}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              {workingId === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span>Sync Inbox</span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 inline-flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 inline-flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
              <MessageSquare size={18} className="text-slate-700" />
              Engagement Inbox
            </h3>
            <button
              onClick={loadInbox}
              disabled={loadingInbox}
              className="text-sm px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingInbox ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={inboxSearch}
              onChange={(e) => setInboxSearch(e.target.value)}
              placeholder="Search inbox..."
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={inboxStatusFilter}
              onChange={(e) => setInboxStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="replied">Replied</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>

          {loadingInbox ? (
            <div className="py-8 flex items-center justify-center text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : inboxItems.length === 0 ? (
            <p className="text-sm text-slate-500">No inbox items yet. Run sync to ingest mentions/DMs.</p>
          ) : (
            <div className="flex gap-4 max-h-[720px]">
              {/* Conversation List */}
              <div className={`space-y-2 overflow-y-auto pr-1 ${selectedThread ? 'w-2/5 hidden xl:block' : 'w-full'}`}>
                {groupedInbox.map((thread) => {
                  const item = thread.latest;
                  const isSelected = selectedThread === thread.threadId;
                  return (
                    <div
                      key={thread.threadId}
                      onClick={() => loadThread(thread.threadId)}
                      className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                        isSelected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {item.sourceType === 'dm' ? <Mail size={12} className="text-slate-400" /> : <MessageSquare size={12} className="text-slate-400" />}
                          <span className="text-xs font-medium text-slate-700">@{item.authorUsername || 'unknown'}</span>
                          {thread.hasMultiple && (
                            <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 rounded-full">{thread.items.length}</span>
                          )}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${item.status === 'new' ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-slate-100 text-slate-500'}`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-800 line-clamp-2">{item.text}</p>
                      <span className="text-[10px] text-slate-400">{new Date(item.receivedAt).toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>

              {/* Conversation Detail */}
              {selectedThread && (
                <div className="flex-1 border border-slate-200 rounded-lg flex flex-col">
                  <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-lg">
                    <h4 className="text-sm font-medium text-slate-700">Thread</h4>
                    <button onClick={() => setSelectedThread(null)} className="text-xs text-slate-500 hover:text-slate-700">Close</button>
                  </div>

                  {loadingThread ? (
                    <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                  ) : (
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {threadMessages.map((msg) => (
                        <div key={msg.id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-700">@{msg.author_username || 'unknown'}</span>
                            <span className="text-[10px] text-slate-400">{new Date(msg.received_at * 1000).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-slate-900 whitespace-pre-wrap bg-slate-50 rounded-lg p-2">{msg.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reply area for selected thread */}
                  {(() => {
                    const item = inboxItems.find((i) => i.sourceId === selectedThread || i.conversationId === selectedThread);
                    if (!item) return null;

                    if (item.sourceType === 'mention') {
                      return (
                        <div className="p-3 border-t border-slate-100 space-y-2">
                          <div className="flex items-start gap-2">
                            <textarea
                              value={replyDrafts[item.id] || ''}
                              onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                              placeholder="Reply to thread..."
                              className="flex-1 p-2 border border-slate-300 rounded-md text-sm"
                              rows={2}
                            />
                            {savedReplies.length > 0 && (
                              <div className="relative group">
                                <button className="px-2 py-2 border border-slate-300 rounded-md text-xs hover:bg-slate-50 whitespace-nowrap">Quick</button>
                                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 w-48 hidden group-hover:block max-h-48 overflow-y-auto">
                                  {savedReplies.map((sr) => (
                                    <button
                                      key={sr.id}
                                      onClick={() => insertSavedReply(item.id, sr.text, sr.id, false)}
                                      className="block w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                                    >
                                      <span className="font-medium">{sr.name}</span>
                                      <p className="text-slate-500 truncate">{sr.text}</p>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => sendReply(item)}
                              disabled={workingId === `reply-${item.id}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                              {workingId === `reply-${item.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send size={12} />}
                              Reply
                            </button>
                            <button onClick={() => runEngagementAction('like', item)} disabled={workingId === `like-${item.id}`} className="inline-flex items-center gap-1 px-2 py-1.5 border border-slate-300 rounded-md text-xs hover:bg-slate-50 disabled:opacity-50">
                              <ThumbsUp size={12} /> Like
                            </button>
                            <button onClick={() => runEngagementAction('repost', item)} disabled={workingId === `repost-${item.id}`} className="inline-flex items-center gap-1 px-2 py-1.5 border border-slate-300 rounded-md text-xs hover:bg-slate-50 disabled:opacity-50">
                              <Repeat2 size={12} /> Repost
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => updateInboxStatus(item, 'reviewed')} disabled={workingId === `status-${item.id}`} className="text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50">Mark Reviewed</button>
                            <button onClick={() => updateInboxStatus(item, 'dismissed')} disabled={workingId === `status-${item.id}`} className="text-xs px-2 py-1 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50">Dismiss</button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="p-3 border-t border-slate-100 space-y-2">
                        <textarea
                          value={dmDrafts[item.id] || ''}
                          onChange={(event) => setDmDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          placeholder="Reply to DM..."
                          className="w-full p-2 border border-slate-300 rounded-md text-sm"
                          rows={2}
                        />
                        <button
                          onClick={() => sendDmReply(item)}
                          disabled={workingId === `dm-${item.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          {workingId === `dm-${item.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send size={12} />}
                          Send DM
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-6">
            <h3 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2 mb-3">
              <Sparkles size={18} className="text-slate-700" />
              Campaigns
            </h3>

            <div className="space-y-2 mb-4">
              <input
                type="text"
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="Campaign name"
                className="w-full p-2 border border-slate-300 rounded-md text-sm"
              />
              <textarea
                value={campaignObjective}
                onChange={(event) => setCampaignObjective(event.target.value)}
                placeholder="Campaign objective"
                className="w-full p-2 border border-slate-300 rounded-md text-sm"
                rows={2}
              />
              <button
                onClick={createCampaign}
                disabled={workingId === 'campaign-create'}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-md text-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {workingId === 'campaign-create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles size={14} />}
                <span>Create Campaign</span>
              </button>
            </div>

            {loadingCampaigns ? (
              <div className="py-4 text-slate-500 text-sm">Loading campaigns...</div>
            ) : campaigns.length === 0 ? (
              <p className="text-sm text-slate-500">No campaigns yet.</p>
            ) : (
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="border border-slate-200 rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{campaign.name}</p>
                      <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 capitalize">{campaign.status}</span>
                    </div>
                    <p className="text-xs text-slate-600">{campaign.objective}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => buildCampaignPlan(campaign.id)}
                        disabled={workingId === `plan-${campaign.id}`}
                        className="text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                      >
                        {workingId === `plan-${campaign.id}` ? 'Planning...' : 'Plan + Save Tasks'}
                      </button>
                      {campaign.status !== 'active' ? (
                        <button
                          onClick={() => setCampaignStatus(campaign, 'active')}
                          disabled={workingId === `campaign-status-${campaign.id}`}
                          className="text-xs px-2 py-1 border border-green-300 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50"
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          onClick={() => setCampaignStatus(campaign, 'paused')}
                          disabled={workingId === `campaign-status-${campaign.id}`}
                          className="text-xs px-2 py-1 border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 disabled:opacity-50"
                        >
                          Pause
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-6">
            <h3 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2 mb-3">
              <ClipboardCheck size={18} className="text-slate-700" />
              Approvals
            </h3>

            <button
              onClick={loadApprovals}
              disabled={loadingApprovals}
              className="mb-3 text-sm px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingApprovals ? 'Loading...' : 'Refresh Approvals'}
            </button>

            {pendingApprovals.length === 0 ? (
              <p className="text-sm text-slate-500">No pending approvals.</p>
            ) : (
              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                {pendingApprovals.map((approval) => (
                  <div key={approval.id} className="border border-slate-200 rounded-md p-3 space-y-2">
                    <div className="text-xs text-slate-600">
                      Campaign {approval.campaignId} • Task {approval.taskId ?? 'n/a'}
                    </div>
                    <div className="text-xs text-slate-500">
                      Requested by {approval.requestedBy} at {new Date(approval.requestedAt).toLocaleString()}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideApproval(approval, 'approved')}
                        disabled={workingId === `approval-${approval.id}`}
                        className="text-xs px-2 py-1 border border-green-300 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => decideApproval(approval, 'rejected')}
                        disabled={workingId === `approval-${approval.id}`}
                        className="text-xs px-2 py-1 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Saved Replies Manager Modal */}
      {showSavedRepliesManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Saved Quick Replies</h3>
              <button onClick={() => setShowSavedRepliesManager(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 mb-4 space-y-2">
              <input
                type="text"
                value={newReplyName}
                onChange={(e) => setNewReplyName(e.target.value)}
                placeholder="Reply name (e.g. 'Thank you')"
                className="w-full p-2 border border-slate-300 rounded-md text-sm"
              />
              <textarea
                value={newReplyText}
                onChange={(e) => setNewReplyText(e.target.value)}
                placeholder="Reply text..."
                className="w-full p-2 border border-slate-300 rounded-md text-sm"
                rows={2}
              />
              <input
                type="text"
                value={newReplyCategory}
                onChange={(e) => setNewReplyCategory(e.target.value)}
                placeholder="Category (optional)"
                className="w-full p-2 border border-slate-300 rounded-md text-sm"
              />
              <button
                onClick={createSavedReply}
                disabled={!newReplyName.trim() || !newReplyText.trim()}
                className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm hover:bg-slate-800 disabled:opacity-50"
              >
                Add Reply
              </button>
            </div>

            {savedReplies.length === 0 ? (
              <p className="text-sm text-slate-500">No saved replies yet.</p>
            ) : (
              <div className="space-y-2">
                {savedReplies.map((reply) => (
                  <div key={reply.id} className="border border-slate-200 rounded-lg p-3 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{reply.name}</p>
                      <p className="text-xs text-slate-600 mt-1">{reply.text}</p>
                      <div className="flex gap-2 mt-1">
                        {reply.category && <span className="text-[10px] bg-slate-100 px-1.5 rounded">{reply.category}</span>}
                        <span className="text-[10px] text-slate-400">Used {reply.useCount}x</span>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteSavedReply(reply.id)}
                      className="text-red-500 hover:text-red-700 text-xs ml-2"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
