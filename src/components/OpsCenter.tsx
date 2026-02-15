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

  const [campaignName, setCampaignName] = useState('');
  const [campaignObjective, setCampaignObjective] = useState('');

  const [workingId, setWorkingId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals]);

  const clearMessages = () => {
    setStatusMessage('');
    setErrorMessage('');
  };

  const loadInbox = async () => {
    setLoadingInbox(true);
    try {
      const response = await fetch(`/api/engagement/inbox?account_slot=${accountSlot}&limit=50&status=new,reviewed,replied`);
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

  useEffect(() => {
    void loadInbox();
  }, [accountSlot]);

  useEffect(() => {
    void Promise.all([loadCampaigns(), loadApprovals()]);
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

          {loadingInbox ? (
            <div className="py-8 flex items-center justify-center text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : inboxItems.length === 0 ? (
            <p className="text-sm text-slate-500">No inbox items yet. Run sync to ingest mentions/DMs.</p>
          ) : (
            <div className="space-y-4 max-h-[720px] overflow-y-auto pr-1">
              {inboxItems.map((item) => (
                <div key={item.id} className="border border-slate-200 rounded-lg p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="text-xs text-slate-500 inline-flex items-center gap-2">
                      {item.sourceType === 'dm' ? <Mail size={14} /> : <MessageSquare size={14} />}
                      <span>{item.sourceType.toUpperCase()}</span>
                      <span>Slot {item.accountSlot}</span>
                      <span>{new Date(item.receivedAt).toLocaleString()}</span>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 capitalize">{item.status}</span>
                  </div>

                  <p className="text-sm text-slate-900 whitespace-pre-wrap">{item.text}</p>

                  {item.authorUsername && (
                    <p className="text-xs text-slate-500">Author: @{item.authorUsername}</p>
                  )}

                  {item.sourceType === 'mention' && (
                    <div className="space-y-2">
                      <textarea
                        value={replyDrafts[item.id] || ''}
                        onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                        placeholder="Draft reply..."
                        className="w-full p-2 border border-slate-300 rounded-md text-sm"
                        rows={2}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => sendReply(item)}
                          disabled={workingId === `reply-${item.id}`}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          {workingId === `reply-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={14} />}
                          <span>Reply</span>
                        </button>
                        <button
                          onClick={() => runEngagementAction('like', item)}
                          disabled={workingId === `like-${item.id}`}
                          className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50"
                        >
                          {workingId === `like-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp size={14} />}
                          <span>Like</span>
                        </button>
                        <button
                          onClick={() => runEngagementAction('repost', item)}
                          disabled={workingId === `repost-${item.id}`}
                          className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50"
                        >
                          {workingId === `repost-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat2 size={14} />}
                          <span>Repost</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {item.sourceType === 'dm' && (
                    <div className="space-y-2">
                      <textarea
                        value={dmDrafts[item.id] || ''}
                        onChange={(event) => setDmDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                        placeholder="Draft DM response..."
                        className="w-full p-2 border border-slate-300 rounded-md text-sm"
                        rows={2}
                      />
                      <button
                        onClick={() => sendDmReply(item)}
                        disabled={workingId === `dm-${item.id}`}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {workingId === `dm-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={14} />}
                        <span>Send DM</span>
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => updateInboxStatus(item, 'reviewed')}
                      disabled={workingId === `status-${item.id}`}
                      className="text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                    >
                      Mark Reviewed
                    </button>
                    <button
                      onClick={() => updateInboxStatus(item, 'dismissed')}
                      disabled={workingId === `status-${item.id}`}
                      className="text-xs px-2 py-1 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
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
    </div>
  );
}
