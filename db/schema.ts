import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  createdAt: text('created_at').notNull(),
});
export const organizations = sqliteTable('organizations', {
  id: text().primaryKey(),
  name: text().notNull(),
  business: text().notNull().default(''),
  timezone: text().notNull().default('America/Sao_Paulo'),
  createdAt: text('created_at').notNull(),
});
export const memberships = sqliteTable(
  'memberships',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text().notNull(),
  },
  (t) => [uniqueIndex('membership_org_user').on(t.orgId, t.userId)],
);
export const authTokens = sqliteTable('auth_tokens', {
  hash: text().primaryKey(),
  email: text().notNull(),
  name: text().notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull(),
  participantId: text('participant_id'),
});
export const sessions = sqliteTable('sessions', {
  hash: text().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: text('expires_at').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', {
  key: text().primaryKey(),
  count: integer().notNull(),
  until: text().notNull(),
});
export const participants = sqliteTable(
  'participants',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    email: text().notNull(),
    kind: text().notNull().default('external'),
    role: text().notNull().default('member'),
    department: text().notNull().default(''),
    responsibilities: text().notNull().default(''),
    revision: integer().notNull().default(0),
  },
  (t) => [uniqueIndex('participant_org_email').on(t.orgId, t.email)],
);
export const meetings = sqliteTable(
  'meetings',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    objective: text().notNull().default(''),
    scheduledAt: text('scheduled_at').notNull(),
    duration: integer().notNull().default(60),
    location: text().notNull().default(''),
    topic: text().notNull().default(''),
    agenda: text().notNull().default('[]'),
    status: text().notNull().default('planned'),
    draft: text(),
    revision: integer().notNull().default(0),
    version: integer().notNull().default(0),
    finalizationToken: text('finalization_token'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('meeting_org_schedule').on(t.orgId, t.scheduledAt)],
);
export const meetingParticipants = sqliteTable(
  'meeting_participants',
  {
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id),
    present: integer().notNull().default(0),
  },
  (t) => [uniqueIndex('meeting_participant').on(t.meetingId, t.participantId)],
);
export const files = sqliteTable('files', {
  id: text().primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => meetings.id),
  key: text().notNull(),
  name: text().notNull(),
  mime: text().notNull(),
  size: integer().notNull(),
  createdAt: text('created_at').notNull(),
});
export const transcripts = sqliteTable('transcripts', {
  id: text().primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => meetings.id),
  fileId: text('file_id').references(() => files.id),
  content: text().notNull(),
  source: text().notNull(),
  createdAt: text('created_at').notNull(),
});
export const jobs = sqliteTable(
  'jobs',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id),
    requestKey: text('request_key').notNull(),
    state: text().notNull(),
    step: text().notNull(),
    input: text().notNull(),
    result: text(),
    error: text(),
    attempts: integer().notNull().default(0),
    baseRevision: integer('base_revision').notNull(),
    applied: integer().notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('job_request').on(t.meetingId, t.requestKey),
    index('job_meeting').on(t.meetingId, t.createdAt),
  ],
);
export const minutes = sqliteTable(
  'minutes',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id),
    number: integer().notNull(),
    content: text().notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('minutes_version').on(t.meetingId, t.number)],
);
export const decisions = sqliteTable('decisions', {
  id: text().primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => meetings.id),
  minutesId: text('minutes_id')
    .notNull()
    .references(() => minutes.id),
  description: text().notNull(),
  evidence: text().notNull(),
  active: integer().notNull().default(1),
});
export const tasks = sqliteTable(
  'tasks',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id),
    minutesId: text('minutes_id')
      .notNull()
      .references(() => minutes.id),
    description: text().notNull(),
    evidence: text().notNull(),
    assigneeId: text('assignee_id').references(() => participants.id),
    dueDate: text('due_date'),
    status: text().notNull().default('open'),
    active: integer().notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('task_org_due').on(t.orgId, t.dueDate)],
);
export const acceptances = sqliteTable(
  'acceptances',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    minutesId: text('minutes_id')
      .notNull()
      .references(() => minutes.id),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id),
    recipientName: text('recipient_name').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    status: text().notNull().default('pending'),
    comment: text().notNull().default(''),
    respondedAt: text('responded_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('acceptance_recipient').on(t.minutesId, t.participantId)],
);
export const deliveries = sqliteTable('deliveries', {
  id: text().primaryKey(),
  orgId: text('org_id'),
  meetingId: text('meeting_id'),
  kind: text().notNull(),
  recipient: text().notNull(),
  subject: text().notNull(),
  body: text(),
  status: text().notNull(),
  providerId: text('provider_id'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  error: text(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const events = sqliteTable(
  'events',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    meetingId: text('meeting_id').references(() => meetings.id),
    actor: text().notNull(),
    action: text().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('event_meeting').on(t.meetingId, t.createdAt)],
);

export const memoryChats = sqliteTable(
  'memory_chats',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('memory_chat_owner').on(t.orgId, t.userId, t.createdAt)],
);
export const memoryTurns = sqliteTable(
  'memory_turns',
  {
    id: text().primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => memoryChats.id),
    question: text().notNull(),
    filters: text().notNull(),
    answer: text(),
    dependencies: text().notNull().default('[]'),
    state: text().notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('memory_turn_chat').on(t.chatId, t.createdAt)],
);

export const agendaProposals = sqliteTable(
  'agenda_proposals',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    meetingId: text('meeting_id').references(() => meetings.id),
    input: text().notNull(),
    content: text(),
    dependencies: text().notNull().default('[]'),
    state: text().notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('agenda_proposal_owner').on(t.orgId, t.userId, t.createdAt)],
);

export const meetingMaterials = sqliteTable(
  'meeting_materials',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    revision: integer().notNull(),
    key: text().notNull(),
    snapshot: text().notNull(),
    dependencies: text().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('material_meeting_created').on(t.meetingId, t.createdAt)],
);

export const recordings = sqliteTable('recordings', {
  fileId: text('file_id')
    .primaryKey()
    .references(() => files.id),
  complete: integer().notNull().default(0),
  partCount: integer('part_count').notNull().default(0),
});
export const recordingParts = sqliteTable(
  'recording_parts',
  {
    id: text().primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    sequence: integer().notNull(),
    key: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    digest: text().notNull(),
    transcript: text(),
  },
  (t) => [uniqueIndex('recording_sequence').on(t.fileId, t.sequence)],
);
export const knowledgeDocuments = sqliteTable(
  'knowledge_documents',
  {
    id: text().primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    title: text().notNull(),
    category: text().notNull(),
    content: text().notNull(),
    state: text().notNull().default('draft'),
    revision: integer().notNull().default(0),
    date: text().notNull().default(''),
    key: text(),
    filename: text(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('knowledge_org_state').on(t.orgId, t.state)],
);
