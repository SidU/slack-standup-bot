import { ConversationReference, TurnContext } from 'botbuilder';
import { TurnState } from '@microsoft/teams-ai';

export interface RosterMember {
  id: string;
  aadObjectId?: string;
  name: string;
}

export interface ParticipantStandupState {
  answers: string[];
  skipped?: boolean;
}

export interface StandupSessionState {
  id: string;
  facilitatorId: string;
  order: string[];
  currentIndex: number;
  currentQuestion: number;
  awaitingReady: boolean;
  responses: Record<string, ParticipantStandupState>;
  startedAt: string;
  awaitingPublishConfirmation: boolean;
  completed: boolean;
}

export interface StandupConversationState {
  roster: Record<string, RosterMember>;
  rosterOrder: string[];
  summaryChannelId?: string;
  summaryConversationReference?: Partial<ConversationReference>;
  activeSession?: StandupSessionState;
}

export class StandupTurnState extends TurnState<StandupConversationState> {
  public constructor() {
    super();
  }
}

export function ensureConversationState(state: StandupTurnState): StandupConversationState {
  let conversation: StandupConversationState;

  try {
    conversation = state.conversation;
  } catch (error) {
    conversation = {
      roster: {},
      rosterOrder: [] as string[],
    };
    state.conversation = conversation;
    return conversation;
  }

  conversation = conversation ?? {
    roster: {},
    rosterOrder: [] as string[],
  };

  if (!conversation.roster) {
    conversation.roster = {};
  }

  if (!conversation.rosterOrder) {
    conversation.rosterOrder = [];
  }

  state.conversation = conversation;
  return conversation;
}

export function getUserKey(context: TurnContext): string {
  return context.activity.from?.aadObjectId ?? context.activity.from?.id ?? 'unknown-user';
}

export function getUserDisplayName(context: TurnContext): string {
  return context.activity.from?.name ?? 'Unknown User';
}

export function getConversationReference(context: TurnContext): Partial<ConversationReference> {
  return TurnContext.getConversationReference(context.activity);
}
