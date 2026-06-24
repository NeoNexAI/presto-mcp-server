/**
 * Stub para el WebAPI de Presto ServerCloud.
 *
 * La WebAPI de Presto NO es un REST estándar: funciona mediante DLLs .NET
 * (PrestoCloudJsonModel + PrestoCloudWebApi) que envuelven llamadas HTTP POST
 * al servidor. Los endpoints exactos no están documentados públicamente.
 *
 * Este stub informa al usuario de los requisitos y ofrece las herramientas
 * como NO-OP con mensaje explicativo cuando la URL no está configurada.
 *
 * Para activar el modo WebAPI:
 *   1. Obtener licencia Presto ServerCloud
 *   2. Configurar IIS + ASP.NET Core Hosting Bundle
 *   3. Establecer PRESTO_WEBAPI_URL=http://tu-servidor/webapi/
 *   4. Establecer PRESTO_WEBAPI_USER y PRESTO_WEBAPI_PASS
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const WEBAPI_URL = process.env['PRESTO_WEBAPI_URL'];
const WEBAPI_USER = process.env['PRESTO_WEBAPI_USER'];
const WEBAPI_PASS = process.env['PRESTO_WEBAPI_PASS'];

function webapiNotConfigured(): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: [
          '## WebAPI de Presto no configurada',
          '',
          'El modo WebAPI requiere **Presto ServerCloud** y configuración adicional:',
          '',
          '1. Licencia **Presto ServerCloud** (RIB Spain)',
          '2. **IIS** + ASP.NET Core Hosting Bundle en el servidor',
          '3. Variables de entorno:',
          '   - `PRESTO_WEBAPI_URL=http://tu-servidor/webapi/`',
          '   - `PRESTO_WEBAPI_USER=usuario`',
          '   - `PRESTO_WEBAPI_PASS=contraseña`',
          '',
          '**Alternativa sin licencia Server**: usa las herramientas `presto_*` con BC3.',
          'Exporta el BC3 desde Presto → úsalo con este MCP → importa de vuelta.',
          '',
          'Contacto RIB Spain: +34 914 483 800 · info@rib-software.es',
        ].join('\n'),
      },
    ],
  };
}

async function webapiPost(endpoint: string, body: object): Promise<{ ok: boolean; data: unknown; error?: string }> {
  if (!WEBAPI_URL || !WEBAPI_USER || !WEBAPI_PASS) {
    return { ok: false, data: null, error: 'WebAPI no configurada' };
  }
  const url = new URL(endpoint, WEBAPI_URL).toString();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: WEBAPI_USER, password: WEBAPI_PASS, ...body }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, data: null, error: String(err) };
  }
}

export function registerWebAPITools(server: McpServer): void {

  server.registerTool(
    'presto_webapi_status',
    {
      title: 'Estado del WebAPI de Presto ServerCloud',
      description: 'Comprueba si el WebAPI de Presto ServerCloud está configurado y accesible. Devuelve la versión del servidor si está disponible.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      if (!WEBAPI_URL) return webapiNotConfigured();
      const result = await webapiPost('Login', { user: WEBAPI_USER, password: WEBAPI_PASS });
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `❌ WebAPI no accesible en ${WEBAPI_URL}: ${result.error ?? JSON.stringify(result.data)}` }],
        };
      }
      return {
        content: [{ type: 'text', text: `✅ WebAPI accesible en ${WEBAPI_URL}` }],
        structuredContent: result.data as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'presto_webapi_list_obras',
    {
      title: 'Listar obras en Presto Server (WebAPI)',
      description: 'Lista las obras disponibles en Presto ServerCloud via WebAPI. Requiere PRESTO_WEBAPI_URL configurada.',
      inputSchema: {
        directorio: z.string().optional().default('').describe('Directorio en el servidor (vacío = raíz)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ directorio }) => {
      if (!WEBAPI_URL) return webapiNotConfigured();
      const result = await webapiPost('ListFiles', { directory: directorio, recursive: false });
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Error WebAPI: ${result.error ?? JSON.stringify(result.data)}` }] };
      }
      const files = Array.isArray(result.data) ? result.data : (result.data as Record<string, unknown>)?.files ?? [];
      return {
        content: [{ type: 'text', text: `## Obras en Presto Server\n${JSON.stringify(files, null, 2)}` }],
        structuredContent: { files } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'presto_webapi_call',
    {
      title: 'Llamada genérica al WebAPI de Presto',
      description: 'Ejecuta una función del API de Presto via WebAPI. Para usuarios avanzados con Presto ServerCloud. Funciones disponibles: GetField, SetField, FindEqual, FindNext, GetElement, UpdateRecord, InsertRecord, DeleteRecord, EvalNum, EvalStr.',
      inputSchema: {
        funcion: z.string().describe('Nombre de la función del API de Presto (p.ej. "GetField", "FindEqual")'),
        parametros: z.record(z.unknown()).optional().default({}).describe('Parámetros de la función en JSON'),
        obra: z.string().optional().describe('Ruta de la obra en el servidor (si se requiere abrirla)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ funcion, parametros, obra }) => {
      if (!WEBAPI_URL) return webapiNotConfigured();
      const body = obra ? { function: funcion, obra, params: parametros } : { function: funcion, params: parametros };
      const result = await webapiPost('Execute', body);
      return {
        content: [{ type: 'text', text: `## Resultado ${funcion}\n\`\`\`json\n${JSON.stringify(result.data, null, 2)}\n\`\`\`` }],
        structuredContent: result,
      };
    },
  );
}
