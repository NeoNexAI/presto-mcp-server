import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseBC3File,
  getConceptosByNat,
  getHijos,
  calcTotalCapitulo,
  getObraCodigo,
  getNaturalezaName,
  type ObraBC3,
  type Concepto,
} from '../services/bc3-parser.js';

function fmt(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function conceitoRow(c: Concepto): string {
  return `${c.codigo} | ${getNaturalezaName(c.naturaleza)} | ${c.unidad} | ${fmt(c.precio)} € | ${c.resumen}`;
}

export function registerBC3Tools(server: McpServer): void {

  server.registerTool(
    'presto_list_obras',
    {
      title: 'Listar obras BC3',
      description: 'Lista todos los archivos BC3 (.bc3) en un directorio. Devuelve nombre, tamaño y fecha de modificación.',
      inputSchema: {
        directorio: z.string().describe('Ruta al directorio donde buscar archivos .bc3'),
        recursivo: z.boolean().optional().default(false).describe('Si buscar en subdirectorios'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ directorio, recursivo }) => {
      const dir = path.resolve(directorio);
      const entries = await fs.readdir(dir, { withFileTypes: true, recursive: recursivo });
      const bc3Files = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.bc3'))
        .map((e) => {
          const fullPath = path.join(e.parentPath ?? dir, e.name);
          return { name: e.name, path: fullPath };
        });

      if (bc3Files.length === 0) {
        return { content: [{ type: 'text', text: `No se encontraron archivos .bc3 en ${dir}` }] };
      }

      const rows = await Promise.all(
        bc3Files.map(async (f) => {
          try {
            const stat = await fs.stat(f.path);
            return `${f.name} | ${(stat.size / 1024).toFixed(1)} KB | ${stat.mtime.toLocaleDateString('es-ES')} | ${f.path}`;
          } catch {
            return `${f.name} | ? | ? | ${f.path}`;
          }
        }),
      );

      const text = `## Archivos BC3 en ${dir}\n\n| Nombre | Tamaño | Modificado | Ruta |\n|---|---|---|---|\n${rows.map((r) => `| ${r} |`).join('\n')}`;
      return { content: [{ type: 'text', text }], structuredContent: { files: bc3Files } };
    },
  );

  server.registerTool(
    'presto_get_obra',
    {
      title: 'Obtener resumen de obra BC3',
      description: 'Lee un archivo BC3 y devuelve: cabecera de la obra, número de capítulos, número de partidas y presupuesto total estimado.',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo }) => {
      const obra = await parseBC3File(archivo);
      const obraCodigo = getObraCodigo(obra);
      const capitulos = getConceptosByNat(obra, 1);
      const partidas = getConceptosByNat(obra, 3);
      const alzadas = getConceptosByNat(obra, 2);
      const obraConcepto = obraCodigo ? obra.conceptos.get(obraCodigo) : undefined;

      const total = capitulos.reduce((sum, c) => sum + calcTotalCapitulo(obra, c.codigo), 0);

      const text = [
        `## Obra: ${obraConcepto?.resumen ?? obraCodigo ?? 'Sin nombre'}`,
        `- **Código**: ${obraCodigo ?? '-'}`,
        `- **Versión BC3**: ${obra.header.version}`,
        `- **Propietario**: ${obra.header.propietario || '-'}`,
        `- **Fecha**: ${obra.header.fecha || '-'}`,
        `- **Comentario**: ${obra.header.comentario || '-'}`,
        '',
        `### Estructura`,
        `- Capítulos: ${capitulos.length}`,
        `- Partidas: ${partidas.length + alzadas.length}`,
        `- Total conceptos: ${obra.conceptos.size}`,
        '',
        `### Presupuesto total estimado`,
        `**${fmt(total)} €**`,
        '',
        `> Para un desglose por capítulos usa \`presto_get_capitulos\`.`,
      ].join('\n');

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          obra: obraConcepto,
          numCapitulos: capitulos.length,
          numPartidas: partidas.length,
          totalEuros: total,
          header: obra.header,
        },
      };
    },
  );

  server.registerTool(
    'presto_get_capitulos',
    {
      title: 'Listar capítulos de una obra BC3',
      description: 'Lee un archivo BC3 y devuelve todos los capítulos con su importe total y número de partidas.',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo }) => {
      const obra = await parseBC3File(archivo);
      const obraCodigo = getObraCodigo(obra);
      const capitulos = obraCodigo ? getHijos(obra, obraCodigo).filter((c) => c.naturaleza === 1) : getConceptosByNat(obra, 1);

      const rows = capitulos.map((cap) => {
        const total = calcTotalCapitulo(obra, cap.codigo);
        const partidas = getHijos(obra, cap.codigo).filter((c) => c.naturaleza === 3 || c.naturaleza === 2);
        return { cap, total, numPartidas: partidas.length };
      });

      const totalObra = rows.reduce((s, r) => s + r.total, 0);

      const table = [
        `| # | Código | Capítulo | Partidas | Importe | % |`,
        `|---|---|---|---|---|---|`,
        ...rows.map((r, i) => {
          const pct = totalObra > 0 ? ((r.total / totalObra) * 100).toFixed(1) : '0.0';
          return `| ${i + 1} | ${r.cap.codigo} | ${r.cap.resumen} | ${r.numPartidas} | ${fmt(r.total)} € | ${pct}% |`;
        }),
        `| | | **TOTAL** | | **${fmt(totalObra)} €** | 100% |`,
      ].join('\n');

      const text = `## Capítulos de ${archivo}\n\n${table}`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { capitulos: rows.map((r) => ({ ...r.cap, total: r.total, numPartidas: r.numPartidas })) },
      };
    },
  );

  server.registerTool(
    'presto_get_partidas',
    {
      title: 'Listar partidas de un capítulo BC3',
      description: 'Lee un archivo BC3 y devuelve las partidas de un capítulo específico (código, unidad, descripción, precio unitario, rendimiento, importe).',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
        codigoCapitulo: z.string().describe('Código del capítulo (obtenido con presto_get_capitulos)'),
        limite: z.number().optional().default(50).describe('Número máximo de partidas a devolver'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo, codigoCapitulo, limite }) => {
      const obra = await parseBC3File(archivo);
      const cap = obra.conceptos.get(codigoCapitulo);
      if (!cap) {
        return { content: [{ type: 'text', text: `Capítulo '${codigoCapitulo}' no encontrado en ${archivo}` }] };
      }

      const lineas = obra.descomposicion.get(codigoCapitulo) ?? [];
      const rows = lineas
        .map((l) => {
          const hijo = obra.conceptos.get(l.codigoHijo);
          if (!hijo) return null;
          return {
            codigo: hijo.codigo,
            nat: getNaturalezaName(hijo.naturaleza),
            unidad: hijo.unidad,
            resumen: hijo.resumen,
            precioUnitario: hijo.precio,
            rendimiento: l.rendimiento,
            importe: l.rendimiento * hijo.precio,
            factor: l.factor,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .slice(0, limite);

      const total = rows.reduce((s, r) => s + r.importe, 0);

      const table = [
        `| Código | Tipo | Ud | Resumen | P.Unit € | Rend | Importe € |`,
        `|---|---|---|---|---|---|---|`,
        ...rows.map(
          (r) => `| ${r.codigo} | ${r.nat} | ${r.unidad} | ${r.resumen.slice(0, 60)} | ${fmt(r.precioUnitario)} | ${r.rendimiento} | ${fmt(r.importe)} |`,
        ),
        `| | | | **TOTAL CAPÍTULO** | | | **${fmt(total)} €** |`,
      ].join('\n');

      const text = `## Partidas: ${cap.resumen} (${codigoCapitulo})\n\n${table}\n\n${rows.length < lineas.length ? `*Mostrando ${rows.length} de ${lineas.length}. Aumenta el parámetro \`limite\`.*` : ''}`;
      return { content: [{ type: 'text', text }], structuredContent: { partidas: rows, total } };
    },
  );

  server.registerTool(
    'presto_search_partidas',
    {
      title: 'Buscar partidas en BC3',
      description: 'Busca partidas (y capítulos) en un archivo BC3 por texto en el resumen o en la descripción. Case-insensitive.',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
        query: z.string().describe('Texto a buscar en código, resumen o descripción'),
        soloPartidas: z.boolean().optional().default(true).describe('Si true, solo devuelve partidas (nat=3). Si false, incluye todos los conceptos.'),
        limite: z.number().optional().default(30).describe('Máximo de resultados'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo, query, soloPartidas, limite }) => {
      const obra = await parseBC3File(archivo);
      const q = query.toLowerCase();
      const resultados = Array.from(obra.conceptos.values())
        .filter((c) => {
          if (soloPartidas && c.naturaleza !== 3 && c.naturaleza !== 2) return false;
          return (
            c.codigo.toLowerCase().includes(q) ||
            c.resumen.toLowerCase().includes(q) ||
            c.descripcion.toLowerCase().includes(q)
          );
        })
        .slice(0, limite);

      if (resultados.length === 0) {
        return { content: [{ type: 'text', text: `No se encontraron resultados para "${query}" en ${archivo}` }] };
      }

      const rows = resultados.map((c) => `| ${c.codigo} | ${getNaturalezaName(c.naturaleza)} | ${c.unidad} | ${fmt(c.precio)} € | ${c.resumen.slice(0, 70)} |`);
      const text = [
        `## Resultados para "${query}" (${resultados.length})`,
        '',
        `| Código | Tipo | Ud | Precio € | Resumen |`,
        `|---|---|---|---|---|`,
        ...rows,
      ].join('\n');

      return { content: [{ type: 'text', text }], structuredContent: { resultados } };
    },
  );

  server.registerTool(
    'presto_get_resumen',
    {
      title: 'Resumen ejecutivo de obra BC3',
      description: 'Genera un resumen ejecutivo completo de una obra BC3: totales, desglose por capítulos, top 5 capítulos por importe y estadísticas de partidas.',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo }) => {
      const obra = await parseBC3File(archivo);
      const obraCodigo = getObraCodigo(obra);
      const obraConcepto = obraCodigo ? obra.conceptos.get(obraCodigo) : undefined;
      const capitulos = obraCodigo ? getHijos(obra, obraCodigo).filter((c) => c.naturaleza === 1) : getConceptosByNat(obra, 1);
      const partidas = getConceptosByNat(obra, 3);
      const partidasAlzadas = getConceptosByNat(obra, 2);

      const capData = capitulos
        .map((cap) => ({
          ...cap,
          total: calcTotalCapitulo(obra, cap.codigo),
          numPartidas: getHijos(obra, cap.codigo).filter((c) => c.naturaleza === 3 || c.naturaleza === 2).length,
        }))
        .sort((a, b) => b.total - a.total);

      const totalObra = capData.reduce((s, c) => s + c.total, 0);
      const top5 = capData.slice(0, 5);

      const partidasSinDescripcion = partidas.filter((p) => !p.descripcion?.trim()).length;
      const partidasConPrecioCero = partidas.filter((p) => p.precio === 0).length;
      const precioMedioPartida = partidas.length > 0 ? partidas.reduce((s, p) => s + p.precio, 0) / partidas.length : 0;

      const text = [
        `# Resumen ejecutivo: ${obraConcepto?.resumen ?? 'Obra sin nombre'}`,
        '',
        `## Totales`,
        `| Concepto | Valor |`,
        `|---|---|`,
        `| Presupuesto total | **${fmt(totalObra)} €** |`,
        `| Capítulos | ${capData.length} |`,
        `| Partidas | ${partidas.length + partidasAlzadas.length} |`,
        `| Precio medio partida | ${fmt(precioMedioPartida)} € |`,
        '',
        `## Top 5 capítulos por importe`,
        `| # | Capítulo | Importe | % Total |`,
        `|---|---|---|---|`,
        ...top5.map((c, i) => {
          const pct = totalObra > 0 ? ((c.total / totalObra) * 100).toFixed(1) : '0.0';
          return `| ${i + 1} | ${c.resumen.slice(0, 50)} | ${fmt(c.total)} € | ${pct}% |`;
        }),
        '',
        `## Alertas de calidad`,
        `| Alerta | Cantidad |`,
        `|---|---|`,
        `| Partidas sin descripción | ${partidasSinDescripcion} |`,
        `| Partidas con precio = 0 | ${partidasConPrecioCero} |`,
      ].join('\n');

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          totalEuros: totalObra,
          numCapitulos: capData.length,
          numPartidas: partidas.length,
          alertas: { sinDescripcion: partidasSinDescripcion, precioCero: partidasConPrecioCero },
          top5Capitulos: top5,
        },
      };
    },
  );

  server.registerTool(
    'presto_get_partida',
    {
      title: 'Obtener detalle de una partida BC3',
      description: 'Devuelve todos los datos de una partida: código, unidad, precio, descripción completa y descomposición (mano de obra, materiales, maquinaria).',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
        codigo: z.string().describe('Código exacto de la partida'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo, codigo }) => {
      const obra = await parseBC3File(archivo);
      const concepto = obra.conceptos.get(codigo);
      if (!concepto) {
        return { content: [{ type: 'text', text: `Partida '${codigo}' no encontrada en ${archivo}` }] };
      }

      const lineas = obra.descomposicion.get(codigo) ?? [];
      const descomp = lineas.map((l) => {
        const hijo = obra.conceptos.get(l.codigoHijo);
        return {
          codigo: l.codigoHijo,
          tipo: hijo ? getNaturalezaName(hijo.naturaleza) : '?',
          unidad: hijo?.unidad ?? '',
          resumen: hijo?.resumen ?? '',
          precio: hijo?.precio ?? 0,
          rendimiento: l.rendimiento,
          importe: l.rendimiento * (hijo?.precio ?? 0),
        };
      });

      const totalDescomp = descomp.reduce((s, d) => s + d.importe, 0);

      const text = [
        `## Partida: ${concepto.resumen}`,
        `- **Código**: ${concepto.codigo}`,
        `- **Tipo**: ${getNaturalezaName(concepto.naturaleza)}`,
        `- **Unidad**: ${concepto.unidad}`,
        `- **Precio unitario**: ${fmt(concepto.precio)} €`,
        '',
        concepto.descripcion ? `### Descripción\n${concepto.descripcion}\n` : '',
        descomp.length > 0
          ? [
              `### Descomposición`,
              `| Tipo | Código | Resumen | Precio | Rend | Importe |`,
              `|---|---|---|---|---|---|`,
              ...descomp.map((d) => `| ${d.tipo} | ${d.codigo} | ${d.resumen.slice(0, 50)} | ${fmt(d.precio)} € | ${d.rendimiento} | ${fmt(d.importe)} € |`),
              `| | | **Total descomposición** | | | **${fmt(totalDescomp)} €** |`,
            ].join('\n')
          : '_Sin descomposición en el BC3._',
      ].join('\n');

      return {
        content: [{ type: 'text', text }],
        structuredContent: { concepto, descomposicion: descomp, totalDescomposicion: totalDescomp },
      };
    },
  );

  server.registerTool(
    'presto_find_anomalias',
    {
      title: 'Detectar anomalías en BC3',
      description: 'Analiza un archivo BC3 y detecta posibles problemas: partidas sin descripción, precio cero, descomposición vacía, capítulos sin partidas, duplicados.',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo }) => {
      const obra = await parseBC3File(archivo);
      const partidas = [...getConceptosByNat(obra, 3), ...getConceptosByNat(obra, 2)];
      const capitulos = getConceptosByNat(obra, 1);

      const sinDescripcion = partidas.filter((p) => !p.descripcion?.trim());
      const precioCero = partidas.filter((p) => p.precio === 0);
      const sinDescomp = partidas.filter((p) => (obra.descomposicion.get(p.codigo) ?? []).length === 0);
      const capitulosSinPartidas = capitulos.filter((c) => {
        const hijos = getHijos(obra, c.codigo);
        return hijos.filter((h) => h.naturaleza === 3 || h.naturaleza === 2).length === 0;
      });

      // Detectar posibles duplicados por resumen similar
      const resumenesMapa = new Map<string, Concepto[]>();
      for (const p of partidas) {
        const key = p.resumen.toLowerCase().trim().slice(0, 50);
        const arr = resumenesMapa.get(key) ?? [];
        arr.push(p);
        resumenesMapa.set(key, arr);
      }
      const posiblesDuplicados = Array.from(resumenesMapa.values()).filter((arr) => arr.length > 1);

      const sections: string[] = ['# Análisis de anomalías BC3\n'];

      if (sinDescripcion.length > 0) {
        sections.push(
          `## ⚠️ Partidas sin descripción (${sinDescripcion.length})\n` +
          sinDescripcion.slice(0, 20).map((p) => `- ${p.codigo}: ${p.resumen.slice(0, 60)}`).join('\n'),
        );
      }
      if (precioCero.length > 0) {
        sections.push(
          `## ⚠️ Partidas con precio = 0 (${precioCero.length})\n` +
          precioCero.slice(0, 20).map((p) => `- ${p.codigo}: ${p.resumen.slice(0, 60)}`).join('\n'),
        );
      }
      if (sinDescomp.length > 0) {
        sections.push(
          `## ℹ️ Partidas sin descomposición (${sinDescomp.length})\n` +
          sinDescomp.slice(0, 10).map((p) => `- ${p.codigo}: ${p.resumen.slice(0, 60)}`).join('\n'),
        );
      }
      if (capitulosSinPartidas.length > 0) {
        sections.push(
          `## ⚠️ Capítulos sin partidas (${capitulosSinPartidas.length})\n` +
          capitulosSinPartidas.map((c) => `- ${c.codigo}: ${c.resumen}`).join('\n'),
        );
      }
      if (posiblesDuplicados.length > 0) {
        sections.push(
          `## ⚠️ Posibles partidas duplicadas (${posiblesDuplicados.length} grupos)\n` +
          posiblesDuplicados.slice(0, 10).map((arr) => `- "${arr[0].resumen.slice(0, 50)}": ${arr.map((p) => p.codigo).join(', ')}`).join('\n'),
        );
      }

      if (sections.length === 1) sections.push('✅ No se detectaron anomalías.');

      return {
        content: [{ type: 'text', text: sections.join('\n\n') }],
        structuredContent: {
          sinDescripcion: sinDescripcion.length,
          precioCero: precioCero.length,
          sinDescomposicion: sinDescomp.length,
          capitulosSinPartidas: capitulosSinPartidas.length,
          posiblesDuplicados: posiblesDuplicados.length,
        },
      };
    },
  );

  server.registerTool(
    'presto_read_concepto',
    {
      title: 'Leer todos los datos de un concepto BC3',
      description: 'Devuelve todos los campos raw de un concepto Presto: código, naturaleza, unidad, precio, descripción completa y árbol de descomposición recursivo.',
      inputSchema: {
        archivo: z.string().describe('Ruta al archivo .bc3'),
        codigo: z.string().describe('Código del concepto'),
        profundidad: z.number().optional().default(2).describe('Niveles de descomposición a expandir (1=solo hijos directos)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ archivo, codigo, profundidad }) => {
      const obra = await parseBC3File(archivo);
      const concepto = obra.conceptos.get(codigo);
      if (!concepto) {
        return { content: [{ type: 'text', text: `Concepto '${codigo}' no encontrado.` }] };
      }

      function buildTree(cod: string, nivel: number): Record<string, unknown> {
        const c = obra.conceptos.get(cod);
        if (!c) return { codigo: cod, error: 'no encontrado' };
        const lineas = obra.descomposicion.get(cod) ?? [];
        return {
          codigo: c.codigo,
          naturaleza: getNaturalezaName(c.naturaleza),
          unidad: c.unidad,
          resumen: c.resumen,
          precio: c.precio,
          descripcion: c.descripcion?.slice(0, 200),
          hijos: nivel > 0 ? lineas.map((l) => ({ rendimiento: l.rendimiento, ...buildTree(l.codigoHijo, nivel - 1) })) : `(${lineas.length} hijos, profundidad máxima)`,
        };
      }

      const tree = buildTree(codigo, profundidad);
      return {
        content: [{ type: 'text', text: `## Concepto ${codigo}\n\`\`\`json\n${JSON.stringify(tree, null, 2)}\n\`\`\`` }],
        structuredContent: tree as Record<string, unknown>,
      };
    },
  );
}
