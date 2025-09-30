import { ParticipantStandupState, RosterMember, StandupConversationState, StandupSessionState } from '../state.js';

export interface QuestionDescriptor {
  id: string;
  prompt: string;
}

export const STANDUP_QUESTIONS: QuestionDescriptor[] = [
  {
    id: 'past-work',
    prompt: 'What have you done since the last standup?',
  },
  {
    id: 'current-work',
    prompt: 'What are you working on now?',
  },
  {
    id: 'blockers',
    prompt: 'Anything in your way?',
  },
];

export interface ReadinessResult {
  accepted: boolean;
  question?: string;
}

export interface AnswerResult {
  nextQuestion?: string;
  completedParticipant?: boolean;
  sessionComplete?: boolean;
}

export interface SkipResult {
  skippedParticipantId?: string;
  sessionComplete?: boolean;
}

export class StandupManager {
  public beginSession(state: StandupConversationState, facilitatorId: string): StandupSessionState {
    const order = this.buildRosterOrder(state);
    const session: StandupSessionState = {
      id: `${Date.now()}`,
      facilitatorId,
      order,
      currentIndex: 0,
      currentQuestion: -1,
      awaitingReady: true,
      responses: {},
      startedAt: new Date().toISOString(),
      awaitingPublishConfirmation: false,
      completed: false,
    };

    state.activeSession = session;
    return session;
  }

  public isActive(state: StandupConversationState): boolean {
    return Boolean(state.activeSession && !state.activeSession.completed);
  }

  public getSession(state: StandupConversationState): StandupSessionState | undefined {
    return state.activeSession;
  }

  public getCurrentParticipant(state: StandupConversationState): string | undefined {
    const session = state.activeSession;
    if (!session) {
      return undefined;
    }

    return session.order[session.currentIndex];
  }

  public isAwaitingReady(session: StandupSessionState): boolean {
    return session.awaitingReady;
  }

  public markReady(state: StandupConversationState, userId: string): ReadinessResult {
    const session = state.activeSession;
    if (!session) {
      throw new Error('No active session');
    }

    if (session.completed) {
      return { accepted: false };
    }

    const current = session.order[session.currentIndex];
    if (current !== userId || !session.awaitingReady) {
      return { accepted: false };
    }

    session.awaitingReady = false;
    session.currentQuestion = 0;
    this.ensureParticipantState(session, userId);

    return {
      accepted: true,
      question: STANDUP_QUESTIONS[0]?.prompt,
    };
  }

  public recordAnswer(state: StandupConversationState, userId: string, response: string): AnswerResult {
    const session = state.activeSession;
    if (!session) {
      throw new Error('No active session');
    }

    if (session.completed) {
      return { sessionComplete: true };
    }

    const current = session.order[session.currentIndex];
    if (current !== userId || session.awaitingReady || session.currentQuestion < 0) {
      return { nextQuestion: undefined, completedParticipant: false, sessionComplete: false };
    }

    const participant = this.ensureParticipantState(session, userId);
    participant.answers[session.currentQuestion] = response.trim();

    if (session.currentQuestion < STANDUP_QUESTIONS.length - 1) {
      session.currentQuestion += 1;
      return { nextQuestion: STANDUP_QUESTIONS[session.currentQuestion].prompt };
    }

    // Completed last question
    session.currentQuestion = -1;
    session.awaitingReady = true;
    session.currentIndex += 1;

    if (session.currentIndex >= session.order.length) {
      session.completed = true;
      return { completedParticipant: true, sessionComplete: true };
    }

    return { completedParticipant: true };
  }

  public skipCurrent(state: StandupConversationState): SkipResult {
    const session = state.activeSession;
    if (!session) {
      throw new Error('No active session');
    }

    if (session.completed) {
      return { sessionComplete: true };
    }

    const current = session.order[session.currentIndex];
    const participant = this.ensureParticipantState(session, current);
    participant.skipped = true;
    session.awaitingReady = true;
    session.currentQuestion = -1;
    session.currentIndex += 1;

    if (session.currentIndex >= session.order.length) {
      session.completed = true;
      return { skippedParticipantId: current, sessionComplete: true };
    }

    return { skippedParticipantId: current };
  }

  public endSession(state: StandupConversationState): void {
    const session = state.activeSession;
    if (!session) {
      throw new Error('No active session');
    }

    session.awaitingPublishConfirmation = true;
    session.completed = true;
  }

  public clearSession(state: StandupConversationState): void {
    state.activeSession = undefined;
  }

  public getParticipantState(session: StandupSessionState, participantId: string): ParticipantStandupState | undefined {
    return session.responses[participantId];
  }

  public getOrderedParticipants(state: StandupConversationState): RosterMember[] {
    const session = state.activeSession;
    if (!session) {
      return [];
    }

    return session.order
      .map((id) => state.roster[id])
      .filter((member): member is RosterMember => Boolean(member));
  }

  public isAwaitingPublishConfirmation(session: StandupSessionState): boolean {
    return session.awaitingPublishConfirmation;
  }

  private ensureParticipantState(session: StandupSessionState, participantId: string): ParticipantStandupState {
    if (!session.responses[participantId]) {
      session.responses[participantId] = {
        answers: new Array(STANDUP_QUESTIONS.length).fill(''),
      };
    }

    return session.responses[participantId];
  }

  private buildRosterOrder(state: StandupConversationState): string[] {
    return state.rosterOrder
      .map((id) => state.roster[id])
      .filter((member): member is RosterMember => Boolean(member))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((member) => member.id);
  }
}

export function isAffirmative(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ['yes', 'y', 'ok', 'okay', 'sure', 'ready', 'yep'].includes(normalized);
}

export function isNegative(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ['no', 'n', 'nope'].includes(normalized);
}

export function formatParticipantName(member: RosterMember | undefined): string {
  return member?.name ?? 'Unknown teammate';
}

export function createParticipantMention(member: RosterMember): { text: string; entities: any[] } {
  const text = `<at>${member.name}</at>`;
  return {
    text: `${text} are you ready?`,
    entities: [
      {
        type: 'mention',
        text,
        mentioned: {
          id: member.aadObjectId ?? member.id,
          name: member.name,
        },
      },
    ],
  };
}

export function createQuestionPrompt(member: RosterMember, question: string): { text: string; entities: any[] } {
  const mentionText = `<at>${member.name}</at>`;
  return {
    text: `${mentionText} ${question}`,
    entities: [
      {
        type: 'mention',
        text: mentionText,
        mentioned: {
          id: member.aadObjectId ?? member.id,
          name: member.name,
        },
      },
    ],
  };
}

export function ensureRosterForSession(state: StandupConversationState): void {
  if (!state.rosterOrder.length) {
    throw new Error('Roster is empty. Add teammates before starting a stand-up.');
  }
}
