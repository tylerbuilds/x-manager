export type CampaignPlanInput = {
  objective: string;
  instructions?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
};

export type DraftTask = {
  taskType: 'research' | 'post' | 'reply' | 'dm' | 'approval';
  title: string;
  details: string;
  dueAt: Date | null;
  priority: number;
  status: 'pending' | 'waiting_approval';
};

function interpolateDueAt(startAt: Date | null, endAt: Date | null, progress: number): Date | null {
  if (!startAt || !endAt) return null;
  const start = startAt.getTime();
  const end = endAt.getTime();
  if (end <= start) return new Date(start);
  return new Date(start + Math.floor((end - start) * progress));
}

export function buildDefaultCampaignPlan(input: CampaignPlanInput): DraftTask[] {
  const objective = input.objective.trim();
  const instructionLine = input.instructions?.trim() ? `Constraints: ${input.instructions?.trim()}` : 'No extra constraints provided.';

  return [
    {
      taskType: 'research',
      title: 'Collect target topics and audience signals',
      details: `Analyze mentions, discovery trends, and historical engagement for objective: ${objective}. ${instructionLine}`,
      dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, 0.1),
      priority: 1,
      status: 'pending',
    },
    {
      taskType: 'post',
      title: 'Draft primary content sequence',
      details: `Create 5-10 core posts/threads aligned with objective: ${objective}. Include publication windows and account slot selection.`,
      dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, 0.25),
      priority: 1,
      status: 'pending',
    },
    {
      taskType: 'approval',
      title: 'Approval checkpoint: scheduled content',
      details: 'Require approval before publishing campaign’s first content batch.',
      dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, 0.35),
      priority: 1,
      status: 'waiting_approval',
    },
    {
      taskType: 'reply',
      title: 'Execute daily reply workflow',
      details: 'Sync inbox and respond to high-relevance mentions with approved reply policy.',
      dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, 0.6),
      priority: 2,
      status: 'pending',
    },
    {
      taskType: 'dm',
      title: 'Run targeted DM outreach',
      details: 'Send personalized DMs to qualified accounts with clear CTA and track outcomes.',
      dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, 0.75),
      priority: 2,
      status: 'pending',
    },
    {
      taskType: 'approval',
      title: 'Approval checkpoint: campaign closeout',
      details: 'Review campaign outcomes, follow-up queue, and handoff recommendations.',
      dueAt: interpolateDueAt(input.startAt || null, input.endAt || null, 0.95),
      priority: 2,
      status: 'waiting_approval',
    },
  ];
}
