import 'dotenv/config';
import express from 'express';
import { App as DevApp } from '@microsoft/teams.apps';
import { ConsoleLogger } from '@microsoft/teams.common/logging';
import { DevtoolsPlugin } from '@microsoft/teams.dev';
import type { Application } from '@microsoft/teams-ai';
import type { TeamsAdapter } from '@microsoft/teams-ai';
import { createStandupBot } from './teams/index.js';
import type { StandupTurnState } from './teams/state.js';

const { app: teamsApp, adapter } = createStandupBot();

const server = express();
server.use(express.json());

server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await teamsApp.run(context);
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3978;
server.listen(port, () => {
  console.log(`⚡️ Stand-up bot listening on port ${port}`);
});

if (shouldEnableDevTools()) {
  startDevTools(adapter, teamsApp).catch((error) => {
    console.warn('⚠️ Failed to start DevTools:', error);
  });
}

function shouldEnableDevTools(): boolean {
  if (process.env.ENABLE_DEVTOOLS?.toLowerCase() === 'false') {
    return false;
  }

  if (process.env.ENABLE_DEVTOOLS?.toLowerCase() === 'true') {
    return true;
  }

  return process.env.NODE_ENV !== 'production';
}

async function startDevTools(
  teamsAdapter: TeamsAdapter,
  botApp: Application<StandupTurnState>,
): Promise<void> {
  const requestedUiPort = process.env.DEVTOOLS_PORT ? Number(process.env.DEVTOOLS_PORT) : 3979;
  const requestedServicePort = process.env.DEVTOOLS_SERVICE_PORT
    ? Number(process.env.DEVTOOLS_SERVICE_PORT)
    : requestedUiPort + 1;

  const devApp = new DevApp({
    skipAuth: true,
    logger: new ConsoleLogger('@standup/devtools', { level: 'info' }),
    plugins: [new DevtoolsPlugin({ customPort: requestedUiPort })],
  });

  devApp.on('activity', async (context) => {
    const credentialsFactory = (teamsAdapter as unknown as {
      credentialsFactory?: { isAuthenticationDisabled?: () => Promise<boolean> };
    }).credentialsFactory;

    let authHeader = '';
    if (credentialsFactory?.isAuthenticationDisabled) {
      const disabled = await credentialsFactory.isAuthenticationDisabled();
      if (!disabled) {
        authHeader = `Bearer ${context.token.toString()}`;
      }
    }

    await teamsAdapter.processActivityDirect(authHeader, context.activity as any, async (turnContext) => {
      await botApp.run(turnContext);
    });
  });

  devApp.event('error', ({ error }) => {
    console.error('DevTools encountered an error:', error);
  });

  await devApp.start(requestedServicePort);
  console.log(
    `🛠️ DevTools available at http://localhost:${requestedUiPort}/devtools (service port ${requestedServicePort})`,
  );
}
