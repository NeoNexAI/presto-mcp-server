"""Servidor MCP de Presto (RIB) — automatizacion COM local + BC3.

Expone Presto a un agente por dos vias complementarias:

  * COM (Presto.App.25): control en vivo de la obra abierta — leer/escribir
    conceptos, precios y cualquier campo, e invocar opciones internas del
    programa. Requiere Presto INSTALADO y EJECUTANDOSE en este equipo.
  * BC3 (FIEBDC-3): leer/analizar ficheros de presupuesto sin abrir Presto.

Transporte: stdio (local, por PC del cliente).
"""

from __future__ import annotations

from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

from .bc3 import parse_bc3
from .presto_com import PrestoCOM, PrestoError

mcp = FastMCP("presto")

# Una sola conexion COM por proceso; perezosa (no toca Presto hasta la 1a tool COM).
_presto = PrestoCOM()

# Nombres de campo de la tabla principal. Verificables en Presto con
# "Ver: Lista de campos"; ajustables aqui si una version cambia algun nombre.
TABLE = "Conceptos"
F_CODIGO = "Conceptos.Código"
F_RESUMEN = "Conceptos.Resumen"
F_UD = "Conceptos.Ud"

# Esquemas de precio de Presto (precio unitario por escenario).
PRICE_SCHEMES = {
    "presupuesto": "Conceptos.PrPres",
    "certificacion": "Conceptos.PrCert",
    "real": "Conceptos.PrReal",
    "objetivo": "Conceptos.PrObj",
    "planificado": "Conceptos.PrPlan",
}


def _err(exc: Exception) -> dict[str, str]:
    return {"error": str(exc)}


# ============================================================ #
#  Conexion y obra
# ============================================================ #
@mcp.tool(
    annotations={"readOnlyHint": True, "openWorldHint": True},
)
def presto_status() -> dict[str, Any]:
    """Comprueba la conexion con Presto por COM y devuelve el ProgID activo.

    Usala primero para confirmar que Presto esta instalado y en ejecucion en
    este equipo antes de operar sobre la obra.
    """
    try:
        progid = _presto.connect()
        return {"conectado": True, "progid": progid}
    except PrestoError as exc:
        return {"conectado": False, "error": str(exc)}


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
def presto_open_obra(path: str) -> dict[str, Any]:
    """Abre una obra de Presto (.Presto) en la instancia en ejecucion.

    `path`: ruta absoluta al archivo .Presto en este equipo.
    """
    try:
        _presto.open_obra(path)
        return {"ok": True, "obra": path}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
def presto_close_obra() -> dict[str, Any]:
    """Cierra la obra actualmente abierta en Presto."""
    try:
        _presto.close_obra()
        return {"ok": True}
    except PrestoError as exc:
        return _err(exc)


# ============================================================ #
#  Genericas — cobertura del 100% del modelo de datos
# ============================================================ #
@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
def presto_read_records(
    table: str,
    fields: list[str],
    mask: str = "*",
    match_field: Optional[str] = None,
    limit: int = 200,
) -> dict[str, Any]:
    """Lee registros de CUALQUIER tabla de Presto filtrando por un campo.

    `table`: tabla (p. ej. "Conceptos", "Mediciones", "Facturas").
    `fields`: campos completos a devolver, p. ej. ["Conceptos.Código", "Conceptos.Resumen"].
    `mask`: comodin de Presto sobre `match_field` (p. ej. "E04*", "*").
    `match_field`: campo del filtro (por defecto, el primero de `fields`).
    Devuelve hasta `limit` filas como lista de objetos {campo: valor}.
    """
    try:
        rows = _presto.read_records(table, fields, mask, match_field, limit)
        return {"table": table, "count": len(rows), "rows": rows}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
def presto_get_field(code: str, field: str, table: str = TABLE, code_field: str = F_CODIGO) -> dict[str, Any]:
    """Lee un campo concreto del registro cuyo codigo es `code`.

    Ejemplo: leer el resumen de la partida "E04CM010" -> code="E04CM010",
    field="Conceptos.Resumen".
    """
    try:
        _presto.select(table, code_field, code)
        for _ in _presto.iterate():
            return {"code": code, "field": field, "value": _presto.get_field(field)}
        return {"error": f"No se encontro ningun registro con {code_field}={code}"}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
def presto_set_field(
    code: str,
    field: str,
    value: Any,
    table: str = TABLE,
    code_field: str = F_CODIGO,
) -> dict[str, Any]:
    """Escribe un campo del registro cuyo codigo es `code` (transaccional).

    La operacion se envuelve en BeginRedo/EndRedo (deshacible en Presto) y guarda
    con UpdateRecord. Modifica la obra: usar con criterio.
    """
    try:
        _presto.begin()
        try:
            _presto.select(table, code_field, code)
            written = False
            for _ in _presto.iterate():
                _presto.set_field(field, value)
                _presto.update_record(table)
                written = True
                break
        finally:
            _presto.end()
        if not written:
            return {"error": f"No se encontro ningun registro con {code_field}={code}"}
        return {"ok": True, "code": code, "field": field, "value": value}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
def presto_execute_option(code: int, params_json: str = "") -> dict[str, Any]:
    """Ejecuta una opcion interna de Presto (DLG_*) con parametros en JSON.

    Da acceso a operaciones masivas del programa que no tienen tool propia
    (multiplicar precios, reducir niveles, generar objetivo, exportar/importar
    formatos, etc.). `code` = codigo numerico del dialogo (p. ej. 9901 = reducir
    niveles). `params_json` = objeto JSON con la mascara y parametros del dialogo.
    Consulta los codigos en la documentacion de la API de Presto.
    """
    try:
        result = _presto.execute_option(code, params_json)
        return {"ok": True, "code": code, "result": result}
    except PrestoError as exc:
        return _err(exc)


# ============================================================ #
#  Curadas — conceptos, precios, busqueda, resumen
# ============================================================ #
@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
def presto_get_concepto(code: str) -> dict[str, Any]:
    """Devuelve los datos basicos de un concepto: codigo, unidad, resumen y precios."""
    try:
        _presto.select(TABLE, F_CODIGO, code)
        for _ in _presto.iterate():
            data: dict[str, Any] = {
                "codigo": _presto.get_field(F_CODIGO),
                "unidad": _presto.get_field(F_UD),
                "resumen": _presto.get_field(F_RESUMEN),
                "precios": {},
            }
            for nombre, campo in PRICE_SCHEMES.items():
                try:
                    data["precios"][nombre] = _presto.get_field(campo)
                except PrestoError:
                    pass
            return data
        return {"error": f"No existe el concepto {code}"}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
def presto_search_conceptos(text: str, limit: int = 50, by: str = "resumen") -> dict[str, Any]:
    """Busca conceptos por su resumen (por defecto) o por su codigo.

    `by`: "resumen" o "codigo". `text` admite comodines (se rodea de * si no los lleva).
    """
    field = F_RESUMEN if by == "resumen" else F_CODIGO
    mask = text if "*" in text else f"*{text}*"
    try:
        rows = _presto.read_records(TABLE, [F_CODIGO, F_UD, F_RESUMEN], mask, field, limit)
        return {"query": text, "by": by, "count": len(rows), "rows": rows}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
def presto_get_precios(code: str) -> dict[str, Any]:
    """Devuelve los precios del concepto en todos los esquemas (presupuesto, certificacion, real, objetivo, planificado)."""
    try:
        _presto.select(TABLE, F_CODIGO, code)
        for _ in _presto.iterate():
            out = {"codigo": code, "precios": {}}
            for nombre, campo in PRICE_SCHEMES.items():
                try:
                    out["precios"][nombre] = _presto.get_field(campo)
                except PrestoError:
                    out["precios"][nombre] = None
            return out
        return {"error": f"No existe el concepto {code}"}
    except PrestoError as exc:
        return _err(exc)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
def presto_set_precio(code: str, esquema: str, valor: float) -> dict[str, Any]:
    """Fija el precio unitario de un concepto en un esquema.

    `esquema`: uno de presupuesto | certificacion | real | objetivo | planificado.
    """
    campo = PRICE_SCHEMES.get(esquema)
    if not campo:
        return {"error": f"Esquema no valido: {esquema}. Usa: {', '.join(PRICE_SCHEMES)}"}
    return presto_set_field(code=code, field=campo, value=valor)


# ============================================================ #
#  BC3 (FIEBDC-3) — sin Presto
# ============================================================ #
@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def presto_bc3_resumen(path: str) -> dict[str, Any]:
    """Lee un fichero BC3 y devuelve un resumen (conceptos, capitulos, version, emisor)."""
    try:
        obra = parse_bc3(path)
        return obra.resumen()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"No se pudo leer el BC3: {exc}"}


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def presto_bc3_buscar(path: str, text: str, limit: int = 50) -> dict[str, Any]:
    """Busca conceptos por texto (en codigo o resumen) dentro de un fichero BC3."""
    try:
        obra = parse_bc3(path)
        t = text.lower()
        hits = [
            {"codigo": c.codigo, "unidad": c.unidad, "resumen": c.resumen, "precio": c.precio}
            for c in obra.conceptos.values()
            if t in c.codigo.lower() or t in c.resumen.lower()
        ]
        return {"query": text, "count": len(hits), "rows": hits[:limit]}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"No se pudo leer el BC3: {exc}"}


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def presto_bc3_concepto(path: str, code: str) -> dict[str, Any]:
    """Devuelve un concepto del BC3 con su texto y descomposicion (hijos)."""
    try:
        obra = parse_bc3(path)
        c = obra.conceptos.get(code)
        if not c:
            return {"error": f"No existe el concepto {code} en el BC3"}
        return {
            "codigo": c.codigo,
            "unidad": c.unidad,
            "resumen": c.resumen,
            "precio": c.precio,
            "texto": c.texto,
            "hijos": [
                {"codigo": h.codigo, "factor": h.factor, "rendimiento": h.rendimiento}
                for h in c.hijos
            ],
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": f"No se pudo leer el BC3: {exc}"}


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": False})
def presto_bc3_anomalias(path: str) -> dict[str, Any]:
    """Detecta posibles anomalias en un BC3: precios a 0/ausentes, conceptos sin resumen, partidas sin descomposicion."""
    try:
        obra = parse_bc3(path)
        sin_precio, sin_resumen, partidas_vacias = [], [], []
        for c in obra.conceptos.values():
            if (c.precio is None or c.precio == 0) and not c.hijos:
                sin_precio.append(c.codigo)
            if not c.resumen.strip():
                sin_resumen.append(c.codigo)
            if c.unidad and not c.hijos and c.precio is None:
                partidas_vacias.append(c.codigo)
        return {
            "precio_cero_o_ausente": sin_precio[:100],
            "sin_resumen": sin_resumen[:100],
            "partidas_sin_descomposicion": partidas_vacias[:100],
            "totales": {
                "precio_cero_o_ausente": len(sin_precio),
                "sin_resumen": len(sin_resumen),
                "partidas_sin_descomposicion": len(partidas_vacias),
            },
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": f"No se pudo leer el BC3: {exc}"}


def main() -> None:
    """Punto de entrada del servidor MCP (transporte stdio)."""
    mcp.run()


if __name__ == "__main__":
    main()
