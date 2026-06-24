/**
 * Parser nativo del formato BC3/FIEBDC-3 (estándar español presupuestos).
 * Spec: https://www.fiebdc.es/
 *
 * Registros relevantes:
 *   ~V  Cabecera (versión, propietario, comentario)
 *   ~C  Concepto (capítulo, partida, mano de obra, material...)
 *   ~D  Descomposición (árbol jerárquico)
 *   ~K  Presupuesto de ejecución por niveles (importes)
 *   ~E  Medición (líneas de medición de una partida en un capítulo)
 *   ~W  Control de cambios (opcional)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface BC3Header {
  version: string;
  propietario: string;
  comentario: string;
  fecha: string;
  charset: string;
}

/** Nat: tipo de concepto según FIEBDC.
 * 0=Obra, 1=Capítulo, 2=Partida alzada, 3=Partida, 4=MO, 5=Maquinaria, 6=Material, 7=Auxiliar */
export type NaturalezaConcepto = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Concepto {
  codigo: string;
  unidad: string;
  resumen: string;
  precio: number;
  fecha: string;
  tipo: string;
  naturaleza: NaturalezaConcepto;
  descripcion: string;
}

export interface LineaDescomposicion {
  codigoHijo: string;
  factor: string;
  rendimiento: number;
  orden: number;
}

export interface Medicion {
  comentario: string;
  unidades: number;
  longitud: number;
  latitud: number;
  altura: number;
  total: number;
}

export interface ObraBC3 {
  header: BC3Header;
  conceptos: Map<string, Concepto>;
  descomposicion: Map<string, LineaDescomposicion[]>;
  rawLines: string[];
}

function parseNum(s: string): number {
  if (!s || s.trim() === '') return 0;
  return parseFloat(s.replace(',', '.')) || 0;
}

function parseNat(campo: string): NaturalezaConcepto {
  const raw = campo?.trim();
  if (!raw) return 3;
  const first = raw.charAt(0);
  const n = parseInt(first, 10);
  if (n >= 0 && n <= 7) return n as NaturalezaConcepto;
  return 3;
}

export async function parseBC3File(filePath: string): Promise<ObraBC3> {
  const absPath = path.resolve(filePath);
  const raw = await fs.readFile(absPath, { encoding: 'latin1' });
  const lines = raw.split(/\r?\n/);

  const obra: ObraBC3 = {
    header: { version: '', propietario: '', comentario: '', fecha: '', charset: 'latin1' },
    conceptos: new Map(),
    descomposicion: new Map(),
    rawLines: lines,
  };

  let currentDesc = '';
  let currentCodigo = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const sep = line.charAt(1);
    if (sep !== '~' && line.charAt(0) !== '~') continue;

    const tipo = line.startsWith('~~') ? line.slice(0, 3) : line.slice(0, 2);
    const content = line.slice(tipo.length);
    const fields = content.split('|');

    if (tipo === '~V') {
      obra.header.version = fields[0]?.trim() ?? '';
      obra.header.propietario = fields[1]?.trim() ?? '';
      obra.header.comentario = fields[2]?.trim() ?? '';
      obra.header.fecha = fields[3]?.trim() ?? '';
    } else if (tipo === '~C') {
      const codigo = fields[0]?.trim() ?? '';
      if (!codigo) continue;
      const concepto: Concepto = {
        codigo,
        unidad: fields[1]?.trim() ?? '',
        resumen: fields[2]?.trim() ?? '',
        precio: parseNum(fields[3]),
        fecha: fields[4]?.trim() ?? '',
        tipo: fields[5]?.trim() ?? '',
        naturaleza: parseNat(fields[6]),
        descripcion: '',
      };
      obra.conceptos.set(codigo, concepto);
      currentCodigo = codigo;
      currentDesc = '';
    } else if (tipo === '~T') {
      currentDesc += (fields[0] ?? '');
      const c = obra.conceptos.get(currentCodigo);
      if (c) c.descripcion = currentDesc;
    } else if (tipo === '~D') {
      const padre = fields[0]?.trim() ?? '';
      if (!padre) continue;
      const hijos: LineaDescomposicion[] = [];
      for (let i = 1; i < fields.length - 1; i += 3) {
        const codigoHijo = fields[i]?.trim();
        if (!codigoHijo) continue;
        hijos.push({
          codigoHijo,
          factor: fields[i + 1]?.trim() ?? '',
          rendimiento: parseNum(fields[i + 2]),
          orden: i,
        });
      }
      if (hijos.length > 0) {
        const existing = obra.descomposicion.get(padre) ?? [];
        obra.descomposicion.set(padre, [...existing, ...hijos]);
      }
    }
  }

  return obra;
}

export function getNaturalezaName(n: NaturalezaConcepto): string {
  const names = ['Obra', 'Capítulo', 'Partida alzada', 'Partida', 'Mano de obra', 'Maquinaria', 'Material', 'Auxiliar'];
  return names[n] ?? 'Desconocido';
}

export function getConceptosByNat(obra: ObraBC3, nat: NaturalezaConcepto): Concepto[] {
  return Array.from(obra.conceptos.values()).filter((c) => c.naturaleza === nat);
}

export function getHijos(obra: ObraBC3, codigoPadre: string): Concepto[] {
  const lineas = obra.descomposicion.get(codigoPadre) ?? [];
  return lineas
    .map((l) => obra.conceptos.get(l.codigoHijo))
    .filter((c): c is Concepto => c !== undefined);
}

export function calcImporte(obra: ObraBC3, codigoPadre: string, codigoHijo: string): number {
  const lineas = obra.descomposicion.get(codigoPadre) ?? [];
  const linea = lineas.find((l) => l.codigoHijo === codigoHijo);
  const hijo = obra.conceptos.get(codigoHijo);
  if (!linea || !hijo) return 0;
  return linea.rendimiento * hijo.precio;
}

export function calcTotalCapitulo(obra: ObraBC3, codigoCapitulo: string): number {
  const lineas = obra.descomposicion.get(codigoCapitulo) ?? [];
  return lineas.reduce((sum, l) => {
    const hijo = obra.conceptos.get(l.codigoHijo);
    return sum + (hijo ? l.rendimiento * hijo.precio : 0);
  }, 0);
}

export function getObraCodigo(obra: ObraBC3): string | undefined {
  for (const [codigo, c] of obra.conceptos) {
    if (c.naturaleza === 0) return codigo;
  }
  // Fallback: buscar el padre raíz (código que no aparece como hijo de nadie)
  const hijos = new Set<string>();
  for (const lineas of obra.descomposicion.values()) {
    for (const l of lineas) hijos.add(l.codigoHijo);
  }
  for (const codigo of obra.descomposicion.keys()) {
    if (!hijos.has(codigo)) return codigo;
  }
  return undefined;
}
