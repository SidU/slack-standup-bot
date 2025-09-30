import { TeamsInfo, TurnContext, TeamsChannelAccount } from 'botbuilder';
import { RosterMember, StandupConversationState } from '../state.js';

export class RosterStore {
  public listMembers(state: StandupConversationState): RosterMember[] {
    const members = state.rosterOrder
      .map((id) => state.roster[id])
      .filter((member): member is RosterMember => Boolean(member));

    return members.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  public getMember(state: StandupConversationState, id: string): RosterMember | undefined {
    return state.roster[id];
  }

  public findMemberByName(state: StandupConversationState, name: string): RosterMember | undefined {
    const normalized = name.trim().toLowerCase();
    return Object.values(state.roster).find((member) => member.name.trim().toLowerCase() === normalized);
  }

  public addOrUpdateMember(state: StandupConversationState, member: RosterMember): { added: boolean; member: RosterMember } {
    const existing = state.roster[member.id];
    state.roster[member.id] = member;

    if (!state.rosterOrder.includes(member.id)) {
      state.rosterOrder.push(member.id);
    }

    state.rosterOrder = Array.from(new Set(state.rosterOrder));
    state.rosterOrder.sort((left, right) => {
      const leftMember = state.roster[left];
      const rightMember = state.roster[right];
      if (!leftMember || !rightMember) {
        return 0;
      }

      return leftMember.name.localeCompare(rightMember.name, undefined, { sensitivity: 'base' });
    });

    return { added: !existing, member: state.roster[member.id] };
  }

  public removeMember(state: StandupConversationState, id: string): RosterMember | undefined {
    const existing = state.roster[id];
    if (!existing) {
      return undefined;
    }

    delete state.roster[id];
    state.rosterOrder = state.rosterOrder.filter((memberId) => memberId !== id);
    return existing;
  }

  public async resolveMentionedMember(context: TurnContext, mentionText: string): Promise<RosterMember | undefined> {
    const mention = (context.activity.entities ?? []).find((entity) => {
      return entity.type === 'mention' && typeof entity.text === 'string' && entity.text.includes(mentionText);
    }) as { mentioned: TeamsChannelAccount; text: string } | undefined;

    if (!mention) {
      return undefined;
    }

    const account = mention.mentioned;
    if (!account?.id) {
      return undefined;
    }

    if (account.aadObjectId) {
      return {
        id: account.aadObjectId,
        name: account.name ?? mentionText,
        aadObjectId: account.aadObjectId,
      };
    }

    try {
      const member = await TeamsInfo.getMember(context, account.id);
      return {
        id: member.aadObjectId ?? member.id,
        aadObjectId: member.aadObjectId,
        name: member.name ?? mentionText,
      };
    } catch (error) {
      return {
        id: account.id,
        name: account.name ?? mentionText,
      };
    }
  }
}
