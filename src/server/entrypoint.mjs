#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadConfig } from '../auth/config.mjs';
import { createCompanionServer } from './app.mjs';

const configPath = process.env.ENGINEERING_MCP_CHATGPT_CONFIG;
if (!configPath) {
  console.error('ENGINEERING_MCP_CHATGPT_CONFIG is required');
  process.exit(1);
}

let config;
try {
  config = loadConfig(resolve(configPath));
} catch (error) {
  console.error(error?.code ?? error?.message ?? 'CONFIGURATION_FAILED');
  process.exit(1);
}

const server = createCompanionServer(config);
server.on('error', (error) => {
  console.error(error?.code ?? 'SERVER_FAILED');
  process.exitCode = 1;
});
server.listen(config.server.port, config.server.host, () => {
  console.log(JSON.stringify({
    status: 'LISTENING',
    profile: config.profile,
    host: config.server.host,
    port: config.server.port,
    path: config.server.path,
  }));
});

