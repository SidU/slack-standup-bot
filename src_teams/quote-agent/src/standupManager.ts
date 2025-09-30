import { StandupRepository } from './repository';
import {
  RosterMember,
  SessionParticipant,
  StandupSession,
  SummaryChannelReference,
  TeamData
} from './types';

function cloneSession(session: StandupSession): StandupSession {
  return JSON.parse(JSON.stringify(session)) as StandupSession;
}

export class StandupManager {
  constructor(private readonly repository: StandupRepository) {}

  async getTeam(teamId: string): Promise<TeamData> {
    return this.repository.getTeamData(teamId);
  }

  async upsertRosterMember(teamId: string, member: RosterMember): Promise<RosterMember[]> {
    const team = await this.repository.updateTeamData(teamId, (data) => {
      const existingIndex = data.roster.findIndex((entry) => entry.id === member.id);
      if (existingIndex >= 0) {
        data.roster[existingIndex] = { ...data.roster[existingIndex], ...member };
      } else {
        data.roster.push(member);
      }
      data.roster.sort((a, b) => a.name.localeCompare(b.name));
    });
    return team.roster;
  }

  async removeRosterMember(teamId: string, memberId: string): Promise<{ removed: boolean; roster: RosterMember[] }> {
    let removed = false;
    const team = await this.repository.updateTeamData(teamId, (data) => {
      const before = data.roster.length;
      data.roster = data.roster.filter((entry) => entry.id !== memberId);
      removed = before !== data.roster.length;
    });
    return { removed, roster: team.roster };
  }

  async removeRosterMemberByName(teamId: string, name: string): Promise<RosterMember | undefined> {
    let removed: RosterMember | undefined;
    await this.repository.updateTeamData(teamId, (data) => {
      const index = data.roster.findIndex((member) => member.name.toLowerCase() === name.toLowerCase());
      if (index >= 0) {
        removed = data.roster[index];
        data.roster.splice(index, 1);
      }
    });
    return removed;
  }

  async listRoster(teamId: string): Promise<RosterMember[]> {
    const team = await this.repository.getTeamData(teamId);
    return team.roster;
  }

  async setSummaryChannel(teamId: string, channel: SummaryChannelReference): Promise<SummaryChannelReference> {
    const team = await this.repository.updateTeamData(teamId, (data) => {
      data.summaryChannel = channel;
    });
    return team.summaryChannel!;
  }

  async getSummaryChannel(teamId: string): Promise<SummaryChannelReference | undefined> {
    const team = await this.repository.getTeamData(teamId);
    return team.summaryChannel;
  }

  async getSession(teamId: string, channelId: string): Promise<StandupSession | undefined> {
    const team = await this.repository.getTeamData(teamId);
    const session = team.sessions[channelId];
    return session ? cloneSession(session) : undefined;
  }

  async startSession(teamId: string, channelId: string, session: StandupSession): Promise<StandupSession> {
    const team = await this.repository.updateTeamData(teamId, (data) => {
      if (data.sessions[channelId] && !data.sessions[channelId].completed) {
        throw new Error('An active session already exists for this channel.');
      }
      data.sessions[channelId] = session;
    });
    return cloneSession(team.sessions[channelId]);
  }

  async updateSession(teamId: string, channelId: string, updater: (session: StandupSession) => void): Promise<StandupSession | undefined> {
    let result: StandupSession | undefined;
    await this.repository.updateTeamData(teamId, (data) => {
      const existing = data.sessions[channelId];
      if (!existing) {
        return;
      }
      updater(existing);
      result = cloneSession(existing);
    });
    return result;
  }

  async clearSession(teamId: string, channelId: string): Promise<void> {
    await this.repository.updateTeamData(teamId, (data) => {
      delete data.sessions[channelId];
    });
  }

  buildParticipants(roster: RosterMember[]): SessionParticipant[] {
    return roster.map((member) => ({
      userId: member.id,
      name: member.name
    }));
  }
}
