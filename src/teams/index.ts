import { Application, TeamsAdapter } from '@microsoft/teams-ai';
import { ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext } from 'botbuilder';
import { StandupTurnState } from './state.js';
import { registerStandupHandlers } from './handlers.js';

export interface StandupBotComponents {
  app: Application<StandupTurnState>;
  adapter: TeamsAdapter;
}

export function createStandupBot(): StandupBotComponents {
  const authConfig = {
    MicrosoftAppId: process.env.MICROSOFT_APP_ID,
    MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
    MicrosoftAppType: process.env.MICROSOFT_APP_TYPE,
    MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
  };

  const credentialsFactory = new ConfigurationServiceClientCredentialFactory(authConfig);
  const adapter = new TeamsAdapter(authConfig, credentialsFactory);

  adapter.onTurnError = async (context: TurnContext, error: Error) => {
    console.error('Unhandled bot error:', error);
    await context.sendActivity('😬 Something went wrong on my side. Please try again in a moment.');
  };

  const storage = new MemoryStorage();

  const app = new Application<StandupTurnState>({
    adapter,
    storage,
    removeRecipientMention: true,
    startTypingTimer: true,
    turnStateFactory: () => new StandupTurnState(),
  });

  registerStandupHandlers(app, process.env.MICROSOFT_APP_ID);

  return { app, adapter };
}
