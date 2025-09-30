import { Application } from '@microsoft/teams-ai';
import {
  Mention,
  MessageFactory,
  TeamsInfo,
  TurnContext
} from 'botbuilder';
import { StandupManager } from './standupManager';
import {
  RosterMember,
  SessionParticipant,
  StandupSession,
  SummaryChannelReference,
  STANDUP_QUESTIONS
} from './types';
import { buildStandupSummaryMessages } from './summary';

const AFFIRMATIVE_KEYWORDS = ['yes', 'y', 'ready', 'yep', 'sure', 'ok', 'okay'];
const SKIP_KEYWORDS = ['skip', 'no'];

export class StandupTeamsBot {
  constructor(
    private readonly app: Application,
    private readonly manager: StandupManager
  ) {}

  register(): void {
    this.app.activity('message', async (context, _state) => {
      await this.onMessage(context);
    });
  }

  private async onMessage(context: TurnContext): Promise<void> {
    const sanitizedText = this.sanitizeText(context);
    const teamId = this.getTeamId(context);
    const channelId = context.activity.conversation?.id;
    if (!teamId || !channelId) {
      return;
    }

    if (!sanitizedText) {
      await this.handleStandupResponse(context, '', teamId, channelId);
      return;
    }

    const tokens = sanitizedText.split(/\s+/).filter(Boolean);
    const commandWord = tokens[0]?.toLowerCase();
    const normalized = sanitizedText.toLowerCase();

    switch (commandWord) {
      case 'help':
        await this.handleHelp(context);
        return;
      case 'join':
        await this.handleJoin(context, teamId);
        return;
      case 'leave':
      case 'quit':
        await this.handleLeave(context, teamId);
        return;
      case 'remove':
        await this.handleRemove(context, teamId, sanitizedText);
        return;
      case 'members':
      case 'team':
      case 'participants':
        await this.handleMembers(context, teamId);
        return;
      case 'report':
        await this.handleReport(context, teamId);
        return;
      case 'start':
        await this.handleStart(context, teamId, channelId);
        return;
      case 'skip':
        await this.handleSkip(context, teamId, channelId, context.activity.from?.name ?? 'Someone');
        return;
      case 'end':
        await this.handleEnd(context, teamId, channelId);
        return;
      case 'publish':
        await this.handlePublish(context, teamId, channelId);
        return;
      case 'discard':
      case 'cancel':
        await this.handleDiscard(context, teamId, channelId);
        return;
      default:
        if (normalized.startsWith('where') && normalized.includes('report')) {
          await this.handleWhere(context, teamId);
          return;
        }
        if (commandWord === 'no') {
          await this.handleSkip(context, teamId, channelId, context.activity.from?.name ?? 'Someone');
          return;
        }
        await this.handleStandupResponse(context, sanitizedText, teamId, channelId);
    }
  }

  private sanitizeText(context: TurnContext): string {
    let text = context.activity.text ?? '';
    const mentions = context.activity.entities?.filter((entity) => {
      const mention = entity as Mention;
      return mention?.type === 'mention' && mention?.mentioned?.id === context.activity.recipient?.id;
    });
    if (mentions) {
      for (const mention of mentions) {
        if (mention.text) {
          text = text.replace(mention.text, '');
        }
      }
    }
    return text.trim();
  }

  private getTeamId(context: TurnContext): string | undefined {
    const channelData = context.activity.channelData as Record<string, any> | undefined;
    const teamId: string | undefined = channelData?.team?.id;
    return teamId ?? context.activity.conversation?.tenantId ?? context.activity.conversation?.id ?? undefined;
  }

  private getChannelName(context: TurnContext): string {
    const channelData = context.activity.channelData as Record<string, any> | undefined;
    return channelData?.channel?.name ?? context.activity.conversation?.name ?? 'this channel';
  }

  private getUserKey(context: TurnContext): string {
    return context.activity.from?.aadObjectId ?? context.activity.from?.id ?? '';
  }

  private async handleHelp(context: TurnContext): Promise<void> {
    const helpMessage = [
      'Here is what I can help with:',
      '• `start` – begin a stand-up in the current channel.',
      '• `skip` – skip the teammate currently being prompted.',
      '• `end` – end the active stand-up and choose to publish or discard the summary.',
      '• `join` / `leave` / `remove @user` – manage the stand-up roster.',
      '• `members` – list everyone on the roster.',
      '• `report here` – set the channel where I post summaries.',
      '• `where do you report?` – see the current summary destination.',
      '• `help` – show this guide again.'
    ].join('\n');
    await context.sendActivity(MessageFactory.text(helpMessage));
  }

  private async handleJoin(context: TurnContext, teamId: string): Promise<void> {
    const profile = await this.getMemberProfile(context, context.activity.from?.id ?? '');
    const member: RosterMember = {
      id: profile.id,
      name: profile.name,
      aadObjectId: profile.aadObjectId,
      userPrincipalName: profile.userPrincipalName
    };
    const roster = await this.manager.upsertRosterMember(teamId, member);
    await context.sendActivity(MessageFactory.text(`Welcome aboard, ${member.name}! You're now part of the stand-up roster (${roster.length} teammates).`));
  }

  private async handleLeave(context: TurnContext, teamId: string): Promise<void> {
    const userId = context.activity.from?.id ?? '';
    const profile = await this.getMemberProfile(context, userId);
    const roster = await this.manager.listRoster(teamId);
    const wasMember = roster.some((member) => member.id === profile.id);
    if (!wasMember) {
      await context.sendActivity(MessageFactory.text('You were not on the roster, but I made sure you are cleared out.'));
      return;
    }
    await this.manager.removeRosterMember(teamId, profile.id);
    await context.sendActivity(MessageFactory.text(`Got it, ${profile.name}. You're off the roster.`));
  }

  private async handleRemove(context: TurnContext, teamId: string, text: string): Promise<void> {
    const target = this.parseMentionTarget(context, text);
    if (!target) {
      await context.sendActivity(MessageFactory.text('Please mention the teammate you want me to remove.'));
      return;
    }

    if (target.id) {
      const { removed } = await this.manager.removeRosterMember(teamId, target.id);
      if (removed) {
        await context.sendActivity(MessageFactory.text(`Removed ${target.name ?? 'that teammate'} from the roster.`));
      } else {
        await context.sendActivity(MessageFactory.text(`I couldn't find that teammate on the roster.`));
      }
      return;
    }

    const removed = await this.manager.removeRosterMemberByName(teamId, target.name ?? '');
    if (removed) {
      await context.sendActivity(MessageFactory.text(`Removed ${removed.name} from the roster.`));
    } else {
      await context.sendActivity(MessageFactory.text(`I couldn't find ${target.name} on the roster.`));
    }
  }

  private async handleMembers(context: TurnContext, teamId: string): Promise<void> {
    const roster = await this.manager.listRoster(teamId);
    if (roster.length === 0) {
      await context.sendActivity(MessageFactory.text('Your roster is empty. Ask teammates to `join` so we can kick off a stand-up.'));
      return;
    }
    const names = roster.map((member) => member.name).join(', ');
    await context.sendActivity(MessageFactory.text(`Current roster (${roster.length}): ${names}`));
  }

  private async handleReport(context: TurnContext, teamId: string): Promise<void> {
    const mention = this.parseChannelMention(context);
    let note: string | undefined;
    if (mention && mention.id !== context.activity.conversation?.id) {
      note = 'I could not capture that channel mention, so I will use the current channel instead.';
    }
    const channelReference = TurnContext.getConversationReference(context.activity);
    const channel: SummaryChannelReference = {
      id: context.activity.conversation?.id ?? channelReference.conversation?.id ?? 'current-channel',
      name: mention?.name ?? this.getChannelName(context),
      conversationReference: channelReference
    };
    await this.manager.setSummaryChannel(teamId, channel);
    const message = note
      ? `${note} Summaries will be posted in ${channel.name}.`
      : `I'll post summaries in ${channel.name}.`;
    await context.sendActivity(MessageFactory.text(message));
  }

  private async handleWhere(context: TurnContext, teamId: string): Promise<void> {
    const summaryChannel = await this.manager.getSummaryChannel(teamId);
    if (!summaryChannel) {
      await context.sendActivity(MessageFactory.text('I do not have a summary channel yet. Use `report here` from your desired channel.'));
      return;
    }
    await context.sendActivity(MessageFactory.text(`I post summaries in ${summaryChannel.name}.`));
  }

  private async handleStart(context: TurnContext, teamId: string, channelId: string): Promise<void> {
    const roster = await this.manager.listRoster(teamId);
    if (roster.length === 0) {
      await context.sendActivity(MessageFactory.text('I need at least one teammate on the roster before starting a stand-up. Ask them to `join`.'));
      return;
    }

    const existingSession = await this.manager.getSession(teamId, channelId);
    if (existingSession && !existingSession.completed) {
      await context.sendActivity(MessageFactory.text('A stand-up is already in progress in this channel. Use `skip`, `end`, or wait for it to finish.'));
      return;
    }

    let summaryChannel = await this.manager.getSummaryChannel(teamId);
    if (!summaryChannel) {
      const channelReference = TurnContext.getConversationReference(context.activity);
      summaryChannel = {
        id: channelReference.conversation?.id ?? channelId,
        name: this.getChannelName(context),
        conversationReference: channelReference
      };
      await this.manager.setSummaryChannel(teamId, summaryChannel);
      await context.sendActivity(MessageFactory.text(`No summary channel configured yet, so I'll use ${summaryChannel.name}.`));
    }

    const participants = this.manager.buildParticipants(roster);
    if (participants.length === 0) {
      await context.sendActivity(MessageFactory.text('I need at least one participant to start.'));
      return;
    }

    const initiator = await this.getMemberProfile(context, context.activity.from?.id ?? '');
    const session: StandupSession = {
      id: `${channelId}-${Date.now()}`,
      channelId,
      conversationReference: TurnContext.getConversationReference(context.activity),
      summaryChannel,
      participants,
      responses: {},
      skipped: [],
      currentIndex: 0,
      awaitingReady: true,
      awaitingQuestionIndex: 0,
      awaitingUserId: participants[0]?.userId,
      startedById: initiator.id,
      startedByName: initiator.name,
      startedAt: new Date().toISOString(),
      completed: false
    };

    try {
      await this.manager.startSession(teamId, channelId, session);
    } catch (error) {
      await context.sendActivity(MessageFactory.text('I could not start a new stand-up because one is already running.'));
      return;
    }

    const participantNames = participants.map((participant) => participant.name).join(', ');
    await context.sendActivity(MessageFactory.text(`Stand-up time! I'll go in this order: ${participantNames}.`));
    await this.promptParticipant(context, teamId, channelId, session.participants[0]);
  }

  private async handleSkip(context: TurnContext, teamId: string, channelId: string, skipper: string): Promise<void> {
    const session = await this.manager.getSession(teamId, channelId);
    if (!session || session.completed) {
      return;
    }
    const participant = session.participants[session.currentIndex];
    if (!participant) {
      return;
    }

    await this.manager.updateSession(teamId, channelId, (state) => {
      if (!state.skipped.includes(participant.userId)) {
        state.skipped.push(participant.userId);
      }
      state.awaitingReady = true;
      state.awaitingQuestionIndex = 0;
      state.awaitingUserId = undefined;
      state.currentIndex = Math.min(state.currentIndex + 1, state.participants.length);
    });

    await context.sendActivity(MessageFactory.text(`${skipper} skipped ${participant.name}.`));
    await this.advanceSession(context, teamId, channelId);
  }

  private async handleEnd(context: TurnContext, teamId: string, channelId: string): Promise<void> {
    const session = await this.manager.getSession(teamId, channelId);
    if (!session || session.completed) {
      await context.sendActivity(MessageFactory.text('There is no active stand-up to end.'));
      return;
    }
    const requester = await this.getMemberProfile(context, context.activity.from?.id ?? '');
    await this.manager.updateSession(teamId, channelId, (state) => {
      state.confirmation = {
        requestedById: requester.id,
        requestedByName: requester.name
      };
    });
    await context.sendActivity(MessageFactory.text(`${requester.name}, type \`publish\` to share the summary or \`discard\` to cancel it.`));
  }

  private async handlePublish(context: TurnContext, teamId: string, channelId: string): Promise<void> {
    const session = await this.manager.getSession(teamId, channelId);
    if (!session || !session.confirmation) {
      return;
    }
    const userKey = this.getUserKey(context);
    if (userKey !== session.confirmation.requestedById) {
      await context.sendActivity(MessageFactory.text('Only the person who ended the stand-up can publish or discard the summary.'));
      return;
    }
    await this.finishSession(context, teamId, channelId, session, true);
  }

  private async handleDiscard(context: TurnContext, teamId: string, channelId: string): Promise<void> {
    const session = await this.manager.getSession(teamId, channelId);
    if (!session || !session.confirmation) {
      return;
    }
    const userKey = this.getUserKey(context);
    if (userKey !== session.confirmation.requestedById) {
      await context.sendActivity(MessageFactory.text('Only the person who ended the stand-up can publish or discard the summary.'));
      return;
    }
    await this.manager.clearSession(teamId, channelId);
    await context.sendActivity(MessageFactory.text('Okay, I discarded the collected updates.'));
  }

  private async handleStandupResponse(context: TurnContext, text: string, teamId: string, channelId: string): Promise<void> {
    const session = await this.manager.getSession(teamId, channelId);
    if (!session || session.completed) {
      return;
    }

    const participant = session.participants[session.currentIndex];
    if (!participant) {
      await this.finishSession(context, teamId, channelId, session, true);
      return;
    }

    const userKey = this.getUserKey(context);
    if (SKIP_KEYWORDS.includes(text.toLowerCase())) {
      await this.handleSkip(context, teamId, channelId, context.activity.from?.name ?? 'Someone');
      return;
    }

    if (session.awaitingReady) {
      if (userKey !== participant.userId) {
        return;
      }
      if (this.isAffirmative(text)) {
        await this.manager.updateSession(teamId, channelId, (state) => {
          state.awaitingReady = false;
          state.awaitingQuestionIndex = 0;
        });
        await context.sendActivity(MessageFactory.text(`Great! ${STANDUP_QUESTIONS[0]}`));
      } else {
        await context.sendActivity(MessageFactory.text('No worries. Say `yes` when you are ready or `skip` to move on.'));
      }
      return;
    }

    if (userKey !== participant.userId) {
      return;
    }

    const updated = await this.manager.updateSession(teamId, channelId, (state) => {
      const progress = state.responses[participant.userId] ?? {
        updates: '',
        current: '',
        blockers: ''
      };
      const currentQuestion = state.awaitingQuestionIndex;
      if (currentQuestion === 0) {
        progress.updates = appendResponse(progress.updates, text);
      } else if (currentQuestion === 1) {
        progress.current = appendResponse(progress.current, text);
      } else {
        progress.blockers = appendResponse(progress.blockers, text);
      }
      state.responses[participant.userId] = progress;
      if (state.awaitingQuestionIndex < STANDUP_QUESTIONS.length - 1) {
        state.awaitingQuestionIndex += 1;
      } else {
        state.awaitingReady = true;
        state.awaitingQuestionIndex = 0;
        state.awaitingUserId = undefined;
        state.currentIndex += 1;
      }
    });

    if (!updated) {
      return;
    }

    if (updated.awaitingReady && updated.currentIndex >= updated.participants.length) {
      await this.finishSession(context, teamId, channelId, updated, true);
      return;
    }

    if (updated.awaitingReady) {
      await context.sendActivity(MessageFactory.text(`Thanks, ${participant.name}!`));
      await this.advanceSession(context, teamId, channelId);
      return;
    }

    const nextQuestionIndex = updated.awaitingQuestionIndex;
    await context.sendActivity(MessageFactory.text(STANDUP_QUESTIONS[nextQuestionIndex]));
  }

  private async advanceSession(context: TurnContext, teamId: string, channelId: string): Promise<void> {
    const session = await this.manager.getSession(teamId, channelId);
    if (!session) {
      return;
    }
    if (session.currentIndex >= session.participants.length) {
      await this.finishSession(context, teamId, channelId, session, true);
      return;
    }
    const participant = session.participants[session.currentIndex];
    await this.promptParticipant(context, teamId, channelId, participant);
  }

  private async promptParticipant(context: TurnContext, teamId: string, channelId: string, participant?: SessionParticipant): Promise<void> {
    if (!participant) {
      const session = await this.manager.getSession(teamId, channelId);
      if (session) {
        await this.finishSession(context, teamId, channelId, session, true);
      }
      return;
    }
    await this.manager.updateSession(teamId, channelId, (state) => {
      state.awaitingReady = true;
      state.awaitingQuestionIndex = 0;
      state.awaitingUserId = participant.userId;
    });
    const mention = this.createMention(participant);
    const promptText = `${mention.text} are you ready for your stand-up update? Reply \`yes\` when ready or \`skip\`.`;
    await context.sendActivity({
      type: 'message',
      text: promptText,
      entities: [mention]
    });
  }

  private async finishSession(context: TurnContext, teamId: string, channelId: string, session: StandupSession, publish: boolean): Promise<void> {
    if (!session || session.completed) {
      return;
    }
    if (publish) {
      await context.sendActivity(MessageFactory.text('Stand-up complete! I am preparing the summary...'));
      const summaryMessages = buildStandupSummaryMessages(session);
      try {
        for (const message of summaryMessages) {
          await this.app.sendProactiveActivity(session.summaryChannel.conversationReference, MessageFactory.text(message));
        }
        await context.sendActivity(MessageFactory.text(`Summary posted in ${session.summaryChannel.name}.`));
      } catch (error) {
        await context.sendActivity(MessageFactory.text(`I could not post the summary to ${session.summaryChannel.name}. Please try again later.`));
      }
    } else {
      await context.sendActivity(MessageFactory.text('Stand-up complete without publishing a summary.'));
    }
    await this.manager.clearSession(teamId, channelId);
  }

  private createMention(participant: SessionParticipant): Mention {
    return {
      type: 'mention',
      text: `<at>${participant.name}</at>`,
      mentioned: {
        id: participant.userId,
        name: participant.name
      }
    } as Mention;
  }

  private isAffirmative(text: string): boolean {
    return AFFIRMATIVE_KEYWORDS.some((keyword) => text.toLowerCase() === keyword);
  }

  private parseMentionTarget(context: TurnContext, text: string): { id?: string; name?: string } | undefined {
    const entities = context.activity.entities as Mention[] | undefined;
    if (entities) {
      for (const entity of entities) {
        if (entity.type === 'mention' && entity.mentioned?.id && entity.mentioned.id !== context.activity.recipient?.id) {
          return { id: entity.mentioned.id, name: entity.mentioned.name };
        }
      }
    }
    const name = text.split(/\s+/).slice(1).join(' ').trim();
    if (!name) {
      return undefined;
    }
    return { name };
  }

  private parseChannelMention(context: TurnContext): { id: string; name: string } | undefined {
    const entities = context.activity.entities as Mention[] | undefined;
    if (!entities) {
      return undefined;
    }
    for (const entity of entities) {
      const mentioned: any = entity.mentioned;
      if (entity.type === 'mention' && mentioned?.id && mentioned?.role === 'channel') {
        return { id: mentioned.id, name: entity.text ?? mentioned.name ?? 'that channel' };
      }
    }
    return undefined;
  }

  private async getMemberProfile(context: TurnContext, userId: string): Promise<{ id: string; name: string; aadObjectId?: string; userPrincipalName?: string }> {
    try {
      const member = await TeamsInfo.getMember(context, userId);
      return {
        id: member.id,
        name: member.name ?? context.activity.from?.name ?? 'Unknown teammate',
        aadObjectId: member.aadObjectId,
        userPrincipalName: (member as any).userPrincipalName
      };
    } catch (error) {
      return {
        id: context.activity.from?.id ?? userId,
        name: context.activity.from?.name ?? 'Unknown teammate'
      };
    }
  }
}

function appendResponse(existing: string, addition: string): string {
  if (!existing) {
    return addition.trim();
  }
  return `${existing}\n${addition.trim()}`;
}
