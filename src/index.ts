#!/usr/bin/env node
/**
 * presto-mcp-server — MCP para Presto presupuestos (RIB Spain / Soft SA)
 *
 * Modo BC3 (por defecto): lee/analiza archivos .bc3 exportados de Presto.
 *   Funciona con la licencia base de Presto. No requiere Presto Server.
 *
 * Modo WebAPI (stub): necesita Presto ServerCloud + IIS + env vars configuradas.
 *   Configurar: PRESTO_WEBAPI_URL, PRESTO_WEBAPI_USER, PRESTO_WEBAPI_PASS
 *
 * Uso:
 *   node dist/index.js                 (stdio, para Claude Code)
 *   npx -y github:NeoNexAI/presto-mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerBC3Tools } from './tools/bc3-tools.js';
import { registerWebAPITools } from './tools/webapi-tools.js';

const server = new McpServer({
  name: 'presto-mcp-server',
  version: '1.0.0',
});

registerBC3Tools(server);
registerWebAPITools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr no cierra el servidor stdio
  process.stderr.write('presto-mcp-server v1.0.0 arrancado (stdio)\n');
}

main().catch((err) => {
  process.stderr.write(`Error fatal: ${err}\n`);
  process.exit(1);
});
