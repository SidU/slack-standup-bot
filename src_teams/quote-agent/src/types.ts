import { ConversationReference } from 'botbuilder';

export interface RosterMember {
  id: string;
  name: string;
  aadObjectId?: string;
  userPrincipalName?: string;
}

export interface SummaryChannelReference {
  id: string;
  name: string;
  conversationReference: Partial<ConversationReference>;
}

export interface StandupResponses {
  updates: string;
  current: string;
  blockers: string;
}

export interface SessionParticipant {
  userId: string;
  name: string;
}

export interface StandupConfirmation {
  requestedById: string;
  requestedByName: string;
}

export interface StandupSession {
  id: string;
  channelId: string;
  conversationReference: Partial<ConversationReference>;
  summaryChannel: SummaryChannelReference;
  participants: SessionParticipant[];
  responses: Record<string, StandupResponses>;
  skipped: string[];
  currentIndex: number;
  awaitingReady: boolean;
  awaitingQuestionIndex: number;
  awaitingUserId?: string;
  startedById: string;
  startedByName: string;
  startedAt: string;
  confirmation?: StandupConfirmation;
  completed: boolean;
}

export interface TeamData {
  roster: RosterMember[];
  summaryChannel?: SummaryChannelReference;
  sessions: Record<string, StandupSession>;
}

export const STANDUP_QUESTIONS: ReadonlyArray<string> = [
  'What have you done since the last stand-up?',
  'What are you working on now?',
  'Anything in your way?'
];
