import { Application } from '@microsoft/teams-ai';
import { ConversationReference, MessageFactory, TurnContext } from 'botbuilder';
import {
  RosterMember,
  StandupTurnState,
  ensureConversationState,
  getConversationReference,
  getUserDisplayName,
  getUserKey,
} from './state.js';
import { RosterStore } from './services/rosterStore.js';
import {
  StandupManager,
  createParticipantMention,
  createQuestionPrompt,
  ensureRosterForSession,
  formatParticipantName,
  isAffirmative,
  isNegative,
} from './services/standupManager.js';
import { SummaryFormatter } from './services/summaryFormatter.js';

interface ChannelSelection {
  id: string;
  name: string;
}

export function registerStandupHandlers(
  app: Application<StandupTurnState>,
  adapterBotId: string | undefined,
): void {
  const rosterStore = new RosterStore();
  const standupManager = new StandupManager();
  const summaryFormatter = new SummaryFormatter();

  app.message(/.*/i, async (context, state) => {
    const conversation = ensureConversationState(state);
    const rawText = (context.activity.text ?? '').trim();
    if (!rawText) {
      return;
    }

    const text = rawText.replace(/<at>[^<]+<\/at>/gi, '').trim();
    const normalized = text.toLowerCase();
    const userId = getUserKey(context);
    const userName = getUserDisplayName(context);

    const session = standupManager.getSession(conversation);
    if (session) {
      const handled = await handleActiveSessionMessage(
        context,
        state,
        conversation,
        standupManager,
        rosterStore,
        summaryFormatter,
        adapterBotId,
        text,
        normalized,
        userId,
      );

      if (handled) {
        await state.save(context);
        return;
      }
    }

    if (normalized.startsWith('help')) {
      await context.sendActivity(MessageFactory.text(buildHelpMessage()));
      return;
    }

    if (normalized.startsWith('join')) {
      const member = {
        id: userId,
        aadObjectId: context.activity.from?.aadObjectId,
        name: userName,
      };

      const result = rosterStore.addOrUpdateMember(conversation, member);
      await context.sendActivity(
        result.added
          ? MessageFactory.text(`🎉 Welcome aboard, ${member.name}! I'll include you in the next stand-up.`)
          : MessageFactory.text(`✅ You're already on the roster, ${member.name}.`),
      );
      await state.save(context);
      return;
    }

    if (normalized.startsWith('leave') || normalized.startsWith('quit')) {
      const removed = rosterStore.removeMember(conversation, userId);
      await context.sendActivity(
        removed
          ? MessageFactory.text(`👋 Got it, ${userName}. I've taken you off the roster.`)
          : MessageFactory.text(`🤔 I didn't have you on the roster, but I'm here if you change your mind.`),
      );
      await state.save(context);
      return;
    }

    if (normalized.startsWith('remove')) {
      const target = await resolveRemovalTarget(context, rosterStore, conversation, text);
      if (!target) {
        await context.sendActivity(
          MessageFactory.text('I could not figure out who to remove. Mention the teammate or spell their display name.'),
        );
        return;
      }

      const removed = rosterStore.removeMember(conversation, target.id);
      if (removed) {
        await context.sendActivity(
          MessageFactory.text(`🧹 Removed ${removed.name} from the roster.`),
        );
      } else {
        await context.sendActivity(
          MessageFactory.text(`I couldn't find ${target.name} on the roster.`),
        );
      }

      await state.save(context);
      return;
    }

    if (/(members|team|participants)/i.test(normalized)) {
      const members = rosterStore.listMembers(conversation);
      if (!members.length) {
        await context.sendActivity(MessageFactory.text('The roster is empty. Ask your teammates to send `join` to participate.'));
      } else {
        const names = members.map((member) => member.name).join(', ');
        await context.sendActivity(MessageFactory.text(`Current roster: ${names}`));
      }
      return;
    }

    if (normalized.startsWith('report')) {
      const channel = resolveChannelMention(context, text);
      if (channel && channel.id !== context.activity.conversation?.id) {
        conversation.summaryChannelId = channel.id;
        conversation.summaryConversationReference = undefined;
        await context.sendActivity(
          MessageFactory.text(
            `I'll aim to publish summaries in ${channel.name}. Please run \`report here\` from that channel so I can capture its conversation reference.`,
          ),
        );
      } else {
        conversation.summaryChannelId = context.activity.conversation?.id;
        conversation.summaryConversationReference = getConversationReference(context);
        await context.sendActivity(MessageFactory.text('Summaries will be posted right here.'));
      }
      await state.save(context);
      return;
    }

    if (normalized.startsWith('where')) {
      const channelId = conversation.summaryChannelId ?? context.activity.conversation?.id;
      if (!channelId) {
        await context.sendActivity(MessageFactory.text("I'm not sure yet. Use `report here` to set this channel."));
      } else if (
        conversation.summaryConversationReference &&
        conversation.summaryConversationReference.conversation?.id === channelId
      ) {
        await context.sendActivity(MessageFactory.text("I'll publish summaries in this channel."));
      } else {
        await context.sendActivity(
          MessageFactory.text(
            `I plan to report in channel ${conversation.summaryChannelId}. Run \`report here\` from there if you'd like me to store its reference.`,
          ),
        );
      }
      return;
    }

    if (normalized.startsWith('start')) {
      try {
        ensureRosterForSession(conversation);
      } catch (error) {
        await context.sendActivity(
          MessageFactory.text(
            error instanceof Error ? error.message : 'I need at least one teammate on the roster before starting.',
          ),
        );
        return;
      }

      if (standupManager.isActive(conversation)) {
        await context.sendActivity(
          MessageFactory.text('A stand-up is already in progress. Use `end` if you need to stop it.'),
        );
        return;
      }

      const summaryChannelId = conversation.summaryChannelId ?? context.activity.conversation?.id;
      if (!conversation.summaryConversationReference && summaryChannelId === context.activity.conversation?.id) {
        conversation.summaryConversationReference = getConversationReference(context);
      }
      conversation.summaryChannelId = summaryChannelId;

      const sessionState = standupManager.beginSession(conversation, userId);
      await context.sendActivity(
        MessageFactory.text(
          `🚀 Stand-up started! I'll check in with ${sessionState.order.length} teammates in alphabetical order.`,
        ),
      );

      await promptNextParticipant(context, conversation, rosterStore, standupManager);
      await state.save(context);
      return;
    }

    if (normalized.startsWith('end')) {
      if (!session) {
        await context.sendActivity(MessageFactory.text('There is no active stand-up right now.'));
        return;
      }

      standupManager.endSession(conversation);
      await context.sendActivity(
        MessageFactory.text('Stand-up paused. Reply with `yes` to publish the summary or `no` to discard it.'),
      );
      await state.save(context);
      return;
    }

    return;
  });

  async function handleActiveSessionMessage(
    context: TurnContext,
    state: StandupTurnState,
    conversation: ReturnType<typeof ensureConversationState>,
    manager: StandupManager,
    roster: RosterStore,
    formatter: SummaryFormatter,
    botAppId: string | undefined,
    text: string,
    normalized: string,
    userId: string,
  ): Promise<boolean> {
    const session = manager.getSession(conversation);
    if (!session) {
      return false;
    }

    if (manager.isAwaitingPublishConfirmation(session)) {
      if (session.facilitatorId !== userId) {
        await context.sendActivity(MessageFactory.text('Thanks! I just need the facilitator to confirm publication.'));
        return true;
      }

      if (isAffirmative(normalized) || normalized === 'publish') {
        await finalizeStandup(context, conversation, manager, roster, formatter, botAppId, state);
        return true;
      }

      if (isNegative(normalized) || normalized === 'skip' || normalized === 'cancel') {
        manager.clearSession(conversation);
        await context.sendActivity(MessageFactory.text('👍 No worries—summary discarded. The slate is clear.'));
        return true;
      }

      await context.sendActivity(MessageFactory.text('Please reply with `yes` to publish or `no` to skip.'));
      return true;
    }

    const currentParticipantId = manager.getCurrentParticipant(conversation);
    if (!currentParticipantId) {
      return false;
    }

    if (normalized === 'skip' && manager.isAwaitingReady(session)) {
      const skipped = manager.skipCurrent(conversation);
      const skippedMember = roster.getMember(conversation, currentParticipantId);
      await context.sendActivity(
        MessageFactory.text(`⏭️ Skipping ${formatParticipantName(skippedMember)}.`),
      );

      if (skipped.sessionComplete) {
        await completeStandupRun(context, conversation, manager, roster, formatter, botAppId, state);
        return true;
      }

      await promptNextParticipant(context, conversation, roster, manager);
      return true;
    }

    if (currentParticipantId === userId) {
      if (manager.isAwaitingReady(session)) {
        if (isAffirmative(normalized) || normalized === 'ready') {
          const readyResult = manager.markReady(conversation, userId);
          const member = roster.getMember(conversation, userId);
          if (readyResult.accepted && readyResult.question && member) {
            const prompt = createQuestionPrompt(member, readyResult.question);
            await context.sendActivity({
              type: 'message',
              text: prompt.text,
              entities: prompt.entities,
            });
            return true;
          }
        }

        if (isNegative(normalized) || normalized === 'skip') {
          const skipped = manager.skipCurrent(conversation);
          if (skipped.sessionComplete) {
            await completeStandupRun(context, conversation, manager, roster, formatter, botAppId, state);
            return true;
          }
          await promptNextParticipant(context, conversation, roster, manager);
          return true;
        }

        await context.sendActivity(
          MessageFactory.text('Just let me know when you are ready with a quick `yes`, or say `skip` to move on.'),
        );
        return true;
      }

      const answerResult = manager.recordAnswer(conversation, userId, text);
      if (answerResult.nextQuestion) {
        const member = roster.getMember(conversation, userId);
        if (member) {
          const prompt = createQuestionPrompt(member, answerResult.nextQuestion);
          await context.sendActivity({
            type: 'message',
            text: prompt.text,
            entities: prompt.entities,
          });
        }
        return true;
      }

      if (answerResult.completedParticipant) {
        await context.sendActivity(MessageFactory.text('✅ Thank you! I captured your update.'));
      }

      if (answerResult.sessionComplete) {
        await completeStandupRun(context, conversation, manager, roster, formatter, botAppId, state);
        return true;
      }

      await promptNextParticipant(context, conversation, roster, manager);
      return true;
    }

    if (manager.isAwaitingReady(session) && (isNegative(normalized) || normalized === 'skip')) {
      const skipped = manager.skipCurrent(conversation);
      const skippedMember = roster.getMember(conversation, currentParticipantId);
      await context.sendActivity(
        MessageFactory.text(`⏭️ Skipping ${formatParticipantName(skippedMember)}.`),
      );

      if (skipped.sessionComplete) {
        await completeStandupRun(context, conversation, manager, roster, formatter, botAppId, state);
        return true;
      }

      await promptNextParticipant(context, conversation, roster, manager);
      return true;
    }

    return false;
  }

  async function promptNextParticipant(
    context: TurnContext,
    conversation: ReturnType<typeof ensureConversationState>,
    roster: RosterStore,
    manager: StandupManager,
  ): Promise<void> {
    const nextParticipantId = manager.getCurrentParticipant(conversation);
    if (!nextParticipantId) {
      return;
    }

    const nextMember = roster.getMember(conversation, nextParticipantId);
    if (!nextMember) {
      return;
    }

    const mention = createParticipantMention(nextMember);
    await context.sendActivity({
      type: 'message',
      text: mention.text,
      entities: mention.entities,
    });
  }

  async function completeStandupRun(
    context: TurnContext,
    conversation: ReturnType<typeof ensureConversationState>,
    manager: StandupManager,
    roster: RosterStore,
    formatter: SummaryFormatter,
    botAppId: string | undefined,
    state: StandupTurnState,
  ): Promise<void> {
    await context.sendActivity(MessageFactory.text('🎉 That wraps everyone! I will prepare the summary.'));
    await finalizeStandup(context, conversation, manager, roster, formatter, botAppId, state);
  }

  async function finalizeStandup(
    context: TurnContext,
    conversation: ReturnType<typeof ensureConversationState>,
    manager: StandupManager,
    roster: RosterStore,
    formatter: SummaryFormatter,
    botAppId: string | undefined,
    state: StandupTurnState,
  ): Promise<void> {
    const session = manager.getSession(conversation);
    if (!session) {
      return;
    }

    const reference = conversation.summaryConversationReference ?? getConversationReference(context);
    if (!reference || !reference.conversation?.id) {
      await context.sendActivity(
        MessageFactory.text(
          "I couldn't find a channel to post the summary. Run `report here` in the target channel and start again.",
        ),
      );
      manager.clearSession(conversation);
      await state.save(context);
      return;
    }

    const pages = formatter.buildSummaryPages(conversation, session);
    try {
      await sendSummaryMessages(reference, pages, botAppId);
      manager.clearSession(conversation);
      await context.sendActivity(MessageFactory.text('📬 Summary posted! Nice work team.'));
      await state.save(context);
    } catch (error) {
      await context.sendActivity(
        MessageFactory.text(
          "⚠️ I couldn't publish the summary. Please try again or check my permissions.",
        ),
      );
      manager.clearSession(conversation);
      await state.save(context);
    }
  }

  async function sendSummaryMessages(
    reference: Partial<ConversationReference>,
    pages: { title: string; content: string }[],
    botAppId: string | undefined,
  ): Promise<void> {
    const adapter = app.adapter;
    if (!adapter) {
      throw new Error('Teams adapter is not configured.');
    }

    const appId = botAppId ?? process.env.MICROSOFT_APP_ID ?? '';
    if (!appId) {
      throw new Error('MICROSOFT_APP_ID is required to send proactive messages.');
    }

    await adapter.continueConversationAsync(appId, reference as ConversationReference, async (proactiveContext) => {
      for (const page of pages) {
        await proactiveContext.sendActivity(
          MessageFactory.text(`**${page.title}**\n\n${page.content}`, undefined, 'markdown'),
        );
      }
    });
  }
}

function resolveChannelMention(context: TurnContext, text: string): ChannelSelection | undefined {
  const mention = (context.activity.entities ?? []).find((entity) => {
    if (entity.type !== 'mention') {
      return false;
    }

    const details = entity.mentioned as any;
    return (
      details &&
      (details.role === 'channel' || details.kind === 'channel' || details.mentionType === 'channel') &&
      typeof details.id === 'string'
    );
  }) as { mentioned: { id?: string; name?: string }; text?: string } | undefined;

  if (mention?.mentioned?.id) {
    return {
      id: mention.mentioned.id,
      name: mention.mentioned.name ?? mention.text ?? 'that channel',
    };
  }

  const hashMatch = text.match(/#([a-z0-9-_]+)/i);
  if (hashMatch) {
    return {
      id: context.activity.conversation?.id ?? '',
      name: `#${hashMatch[1]}`,
    };
  }

  return undefined;
}

async function resolveRemovalTarget(
  context: TurnContext,
  roster: RosterStore,
  conversation: ReturnType<typeof ensureConversationState>,
  text: string,
): Promise<RosterMember | undefined> {
  const mention = (context.activity.entities ?? []).find((entity) => entity.type === 'mention');
  if (mention) {
    const mentioned = (mention as any).mentioned;
    if (mentioned?.id) {
      return roster.getMember(conversation, mentioned.aadObjectId ?? mentioned.id);
    }
  }

  const args = text.split(/\s+/).slice(1).join(' ').trim();
  if (!args) {
    return undefined;
  }

  return roster.findMemberByName(conversation, args);
}

function buildHelpMessage(): string {
  return [
    "Here's how I can help with stand-ups:",
    '- `join` / `leave` — manage your roster membership.',
    '- `remove @teammate` — take someone else off the roster.',
    '- `members` — list everyone currently participating.',
    '- `report here` or `report in #channel` — choose where summaries go.',
    '- `where do you report?` — confirm the summary destination.',
    '- `start` — kick off a stand-up.',
    '- `skip` — move past the queued teammate before questions begin.',
    '- `end` — stop the stand-up and choose whether to publish the summary.',
    '- During your turn just answer the three questions as I ask them.',
  ].join('\n');
}
