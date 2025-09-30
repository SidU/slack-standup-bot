import express from 'express';
import * as dotenv from 'dotenv';
import { Application } from '@microsoft/teams-ai';
import { TeamsAdapter } from '@microsoft/teams-ai/lib/TeamsAdapter';
import {
  ConfigurationServiceClientCredentialFactory,
  MemoryStorage
} from 'botbuilder';
import { StandupRepository } from './repository';
import { StandupManager } from './standupManager';
import { StandupTeamsBot } from './bot';

dotenv.config();

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3978;

const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID ?? '',
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? '',
  MicrosoftAppType: process.env.MICROSOFT_APP_TYPE,
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID
});

const adapter = new TeamsAdapter(undefined, credentialsFactory);
adapter.onTurnError = async (context, error) => {
  console.error('Bot encountered an error:', error);
  await context.sendActivity('Sorry, something went wrong. Please try again.');
};

const storage = new MemoryStorage();

const application = new Application({
  adapter,
  storage,
  botAppId: process.env.MICROSOFT_APP_ID,
  removeRecipientMention: true,
  startTypingTimer: false,
  longRunningMessages: false
});

const repository = new StandupRepository(storage);
const manager = new StandupManager(repository);
const bot = new StandupTeamsBot(application, manager);
bot.register();

const server = express();
server.use(express.json());

server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await application.run(context);
  });
});

server.get('/', (_req, res) => {
  res.send('Stand-up bot is running.');
});

server.listen(port, () => {
  console.log(`Stand-up bot listening on port ${port}`);
});
