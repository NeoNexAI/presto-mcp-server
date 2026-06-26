"""Lectura y escritura de ficheros BC3 (estandar FIEBDC-3).

BC3 es el formato abierto de intercambio de presupuestos y mediciones usado por
Presto, Arquimedes, Menfis, etc. Es texto plano con registros que empiezan por
``~<tipo>`` y campos separados por ``|``; los subcampos por ``\\``.

Registros soportados:
  ~V  cabecera del fichero (version FIEBDC, programa emisor, juego de caracteres)
  ~C  concepto       -> codigo | unidad | resumen | precios\\ | fechas\\ | tipo
  ~T  texto largo    -> codigo | texto
  ~D  descomposicion -> codigo_padre | (cod_hijo\\factor\\rendimiento)\\...
  ~M  medicion       -> padre\\hijo\\ | posicion | total | lineas...

No requiere Presto ni Windows: es parsing de texto puro.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Concepto:
    codigo: str
    unidad: str = ""
    resumen: str = ""
    precio: Optional[float] = None
    tipo: str = ""
    texto: str = ""
    hijos: list["Hijo"] = field(default_factory=list)

    @property
    def es_capitulo(self) -> bool:
        # En BC3 los capitulos suelen acabar en '#' o '##'; tambien sin unidad
        # economica y con descomposicion de partidas.
        return self.codigo.endswith("#") or self.tipo == "0"


@dataclass
class Hijo:
    codigo: str
    factor: float = 1.0
    rendimiento: float = 1.0


@dataclass
class Bc3Obra:
    meta: dict[str, str] = field(default_factory=dict)
    conceptos: dict[str, Concepto] = field(default_factory=dict)
    raiz: Optional[str] = None  # codigo del concepto raiz (la obra)

    def resumen(self) -> dict[str, object]:
        capitulos = [c for c in self.conceptos.values() if c.es_capitulo]
        partidas = [c for c in self.conceptos.values() if c.hijos and not c.es_capitulo]
        return {
            "conceptos": len(self.conceptos),
            "capitulos": len(capitulos),
            "partidas_con_descomposicion": len(partidas),
            "raiz": self.raiz,
            "version_fiebdc": self.meta.get("version", ""),
            "programa_emisor": self.meta.get("programa", ""),
        }


def _to_float(value: str) -> Optional[float]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def _split_records(raw: str) -> list[str]:
    """Divide el texto en registros. Un registro va de un '~' al siguiente."""
    # Normaliza saltos de linea: dentro de un registro pueden existir.
    parts = re.split(r"(?=~[A-Z])", raw)
    return [p.strip() for p in parts if p.strip().startswith("~")]


def _detect_encoding(raw_bytes: bytes) -> str:
    """El campo 6 del registro ~V indica el juego de caracteres (ANSI/UTF-8)."""
    head = raw_bytes[:400].decode("latin-1", errors="ignore").upper()
    if "UTF-8" in head or "UTF8" in head:
        return "utf-8"
    return "cp1252"  # ANSI Windows, el mas comun en BC3 españoles


def parse_bc3(path: str) -> Bc3Obra:
    """Lee un fichero BC3 y devuelve la estructura de la obra."""
    with open(path, "rb") as fh:
        raw_bytes = fh.read()
    enc = _detect_encoding(raw_bytes)
    raw = raw_bytes.decode(enc, errors="replace")
    return parse_bc3_text(raw)


def parse_bc3_text(raw: str) -> Bc3Obra:
    """Igual que ``parse_bc3`` pero a partir de una cadena ya decodificada."""
    obra = Bc3Obra()
    for record in _split_records(raw):
        tipo = record[1]
        body = record[2:].lstrip(" \t\r\n")
        fields = body.split("|")

        if tipo == "V":
            # ~V | propiedad_archivo | programa | version_formato | ... | charset
            obra.meta["programa"] = fields[2].strip() if len(fields) > 2 else ""
            obra.meta["version"] = fields[3].strip() if len(fields) > 3 else ""
            if len(fields) > 6:
                obra.meta["charset"] = fields[6].strip()

        elif tipo == "C":
            # ~C | codigo(s) | unidad | resumen | precio\precio | fecha\ | tipo
            if len(fields) < 2:
                continue
            codigo = fields[1].split("\\")[0].strip()
            if not codigo:
                continue
            precios = fields[4].split("\\") if len(fields) > 4 else []
            precio = _to_float(precios[0]) if precios else None
            c = obra.conceptos.get(codigo) or Concepto(codigo=codigo)
            c.unidad = fields[2].strip() if len(fields) > 2 else c.unidad
            c.resumen = fields[3].strip() if len(fields) > 3 else c.resumen
            c.precio = precio if precio is not None else c.precio
            c.tipo = fields[6].strip() if len(fields) > 6 else c.tipo
            obra.conceptos[codigo] = c
            if obra.raiz is None:
                obra.raiz = codigo

        elif tipo == "T":
            # ~T | codigo | texto largo
            if len(fields) < 3:
                continue
            codigo = fields[1].strip()
            c = obra.conceptos.get(codigo) or Concepto(codigo=codigo)
            c.texto = fields[2].strip()
            obra.conceptos[codigo] = c

        elif tipo == "D":
            # ~D | padre | hijo\factor\rendimiento\ hijo2\factor2\rend2\ ...
            if len(fields) < 3:
                continue
            padre = fields[1].strip()
            c = obra.conceptos.get(padre) or Concepto(codigo=padre)
            tokens = [t for t in fields[2].split("\\")]
            # tripletas codigo, factor, rendimiento
            for i in range(0, len(tokens) - 2, 3):
                cod = tokens[i].strip()
                if not cod:
                    continue
                c.hijos.append(
                    Hijo(
                        codigo=cod,
                        factor=_to_float(tokens[i + 1]) or 1.0,
                        rendimiento=_to_float(tokens[i + 2]) or 1.0,
                    )
                )
            obra.conceptos[padre] = c

    return obra


# ---------------------------------------------------------------------------- #
# Escritura (export basico de conceptos + textos + descomposicion)
# ---------------------------------------------------------------------------- #
def write_bc3(obra: Bc3Obra, path: str, encoding: str = "cp1252") -> None:
    """Serializa una ``Bc3Obra`` a un fichero BC3 valido (registros V/C/T/D)."""
    lines: list[str] = []
    programa = obra.meta.get("programa", "NeoNexAI-Presto-MCP")
    version = obra.meta.get("version", "FIEBDC-3/2016")
    lines.append(f"~V||{programa}|{version}||||ANSI|")

    for c in obra.conceptos.values():
        precio = "" if c.precio is None else f"{c.precio:g}"
        lines.append(f"~C|{c.codigo}|{c.unidad}|{c.resumen}|{precio}||{c.tipo}|")
        if c.texto:
            lines.append(f"~T|{c.codigo}|{c.texto}|")
        if c.hijos:
            trips = "".join(
                f"{h.codigo}\\{h.factor:g}\\{h.rendimiento:g}\\" for h in c.hijos
            )
            lines.append(f"~D|{c.codigo}|{trips}|")

    with open(path, "w", encoding=encoding, errors="replace", newline="\r\n") as fh:
        fh.write("\n".join(lines) + "\n")
