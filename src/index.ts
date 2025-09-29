import 'dotenv/config';
import express from 'express';
import { createStandupBot } from './teams/index.js';

const { app, adapter } = createStandupBot();

const server = express();
server.use(express.json());

server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await app.run(context);
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3978;
server.listen(port, () => {
  console.log(`⚡️ Stand-up bot listening on port ${port}`);
});
