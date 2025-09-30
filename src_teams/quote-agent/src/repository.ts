import { MemoryStorage, Storage, StoreItem } from 'botbuilder';
import { TeamData } from './types';

interface TeamStoreItem extends StoreItem {
  data: TeamData;
}

const TEAM_PREFIX = 'team-data/';

function createDefaultTeamData(): TeamData {
  return {
    roster: [],
    sessions: {}
  };
}

function cloneTeamData(team: TeamData): TeamData {
  return JSON.parse(JSON.stringify(team)) as TeamData;
}

export class StandupRepository {
  private readonly storage: Storage;

  constructor(storage?: Storage) {
    this.storage = storage ?? new MemoryStorage();
  }

  async getTeamData(teamId: string): Promise<TeamData> {
    const key = this.toKey(teamId);
    const record = await this.storage.read([key]);
    const item = record[key] as TeamStoreItem | undefined;
    if (!item || !item.data) {
      return createDefaultTeamData();
    }
    return cloneTeamData(item.data);
  }

  async updateTeamData(teamId: string, updater: (team: TeamData) => void): Promise<TeamData> {
    const key = this.toKey(teamId);
    const record = await this.storage.read([key]);
    const existing = record[key] as TeamStoreItem | undefined;
    const team = existing?.data ? cloneTeamData(existing.data) : createDefaultTeamData();
    updater(team);
    const changes: Record<string, TeamStoreItem> = {
      [key]: {
        ...(existing ?? {}),
        data: team,
        eTag: '*'
      }
    };
    await this.storage.write(changes);
    return cloneTeamData(team);
  }

  async clearTeam(teamId: string): Promise<void> {
    const key = this.toKey(teamId);
    await this.storage.delete([key]);
  }

  private toKey(teamId: string): string {
    return `${TEAM_PREFIX}${teamId}`;
  }
}
