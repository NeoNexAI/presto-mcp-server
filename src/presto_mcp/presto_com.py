"""Cliente de automatización COM de Presto (RIB Software).

Presto expone un servidor de automatización COM cuyo ProgID es ``Presto.App.NN``
donde ``NN`` es la versión mayor (Presto 2025 -> ``Presto.App.25``). Se documenta
en la nota técnica oficial de RIB "API y WebAPI - Desarrollo de complementos".

Patrón de uso real (VBScript del manual oficial), traducido a este wrapper::

    Set po = GetObject("", "Presto.App.18")        -> connect()
    po.Open "C:\\obra.Presto"                       -> open_obra()
    po.BeginRedo                                     -> begin()
    po.SetElement 1, "Conceptos", "Conceptos.Codigo", "E04*"   -> select()
    While po.GetElement(1) = 0 : ... : Wend          -> iterate()
    v = po.GetField("Conceptos.Resumen")             -> get_field()
    po.SetField "Conceptos.Estado", 1                -> set_field()
    po.UpdateRecord("Conceptos")                     -> update_record()
    po.EndRedo                                        -> end()
    po.Close                                          -> close_obra()

``pywin32`` (módulo ``win32com``) solo existe en Windows; el import es perezoso
para que el resto del paquete (p. ej. el parser BC3 y sus tests) funcione en
cualquier plataforma sin Presto instalado.
"""

from __future__ import annotations

import os
from typing import Any, Iterator, Optional

# Versiones de Presto a sondear si no se fija PRESTO_PROGID. La primera es la
# del cliente (2025 = 25). Se incluyen vecinas por robustez ante upgrades.
_DEFAULT_VERSIONS = (25, 26, 24, 23, 22, 21, 20, 19, 18)


class PrestoError(RuntimeError):
    """Error accionable de la capa COM de Presto."""


def _format_com_error(exc: Exception) -> str:
    """Convierte un error COM crudo en un mensaje accionable."""
    msg = str(exc)
    lowered = msg.lower()
    if "invalid class string" in lowered or "no se ha registrado" in lowered or "0x800401f3" in lowered:
        return (
            "No se encontro el servidor de automatizacion de Presto. Verifica que "
            "Presto esta INSTALADO en este equipo y que la version coincide con el "
            "ProgID (Presto 2025 = 'Presto.App.25'). Puedes fijarlo con la variable "
            "de entorno PRESTO_PROGID."
        )
    if "0x800401e3" in lowered or "operation unavailable" in lowered or "moniker" in lowered:
        return (
            "Presto no esta en ejecucion. Abre Presto (y la obra, si la operacion la "
            "necesita) antes de usar esta herramienta."
        )
    return f"Error COM de Presto: {msg}"


class PrestoCOM:
    """Envoltura fina y segura sobre el objeto COM de Presto.

    No mantiene estado de obra propio: refleja el de la instancia de Presto a la
    que se conecta. Diseñada para ser instanciada una vez por proceso del MCP.
    """

    def __init__(self, progid: Optional[str] = None) -> None:
        self._app: Any = None
        self._progid: Optional[str] = progid or os.environ.get("PRESTO_PROGID") or None

    # ------------------------------------------------------------------ #
    # Conexion
    # ------------------------------------------------------------------ #
    def _candidates(self) -> tuple[str, ...]:
        if self._progid:
            return (self._progid,)
        return tuple(f"Presto.App.{v}" for v in _DEFAULT_VERSIONS)

    def connect(self) -> str:
        """Conecta con la instancia de Presto en ejecucion (o la arranca).

        Devuelve el ProgID con el que conecto. Lanza PrestoError si no encuentra
        ningun Presto instalado/ejecutandose.
        """
        if self._app is not None:
            return self._progid or "Presto.App"

        try:
            import win32com.client  # type: ignore
            import pythoncom  # type: ignore
        except ImportError as exc:  # pragma: no cover - depende del entorno
            raise PrestoError(
                "Falta 'pywin32'. Instalalo en este equipo Windows con "
                "'pip install pywin32' (necesario para hablar con Presto por COM)."
            ) from exc

        pythoncom.CoInitialize()  # seguro de llamar varias veces por hilo
        last_err: Optional[Exception] = None
        for progid in self._candidates():
            # 1) Engancharse a una instancia de Presto ya abierta.
            try:
                self._app = win32com.client.GetObject("", progid)
                self._progid = progid
                return progid
            except Exception as exc:  # noqa: BLE001 - probamos el siguiente candidato
                last_err = exc
            # 2) Si no hay instancia activa, intentar arrancar una.
            try:
                self._app = win32com.client.Dispatch(progid)
                self._progid = progid
                return progid
            except Exception as exc:  # noqa: BLE001
                last_err = exc
        raise PrestoError(_format_com_error(last_err) if last_err else "No se pudo conectar con Presto.")

    @property
    def app(self) -> Any:
        if self._app is None:
            self.connect()
        return self._app

    # ------------------------------------------------------------------ #
    # Obra
    # ------------------------------------------------------------------ #
    def open_obra(self, path: str) -> None:
        if not os.path.isfile(path):
            raise PrestoError(f"No existe el archivo de obra: {path}")
        try:
            self.app.Open(path)
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    def close_obra(self) -> None:
        try:
            self.app.Close()
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    # ------------------------------------------------------------------ #
    # Transacciones (deshacer/rehacer)
    # ------------------------------------------------------------------ #
    def begin(self) -> None:
        self.app.BeginRedo()

    def end(self) -> None:
        self.app.EndRedo()

    # ------------------------------------------------------------------ #
    # Seleccion / iteracion / campos
    # ------------------------------------------------------------------ #
    def select(self, table: str, field: str, mask: str) -> None:
        """Filtra los registros de ``table`` cuyo ``field`` casa con ``mask``.

        ``mask`` admite comodines de Presto, p. ej. ``"E04*"`` o ``"*"``.
        """
        try:
            self.app.SetElement(1, table, field, mask)
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    def iterate(self) -> Iterator[int]:
        """Itera sobre la seleccion activa (equivale a ``While GetElement(1)=0``)."""
        try:
            while self.app.GetElement(1) == 0:
                yield 1
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    def get_field(self, field: str) -> Any:
        """Lee ``Tabla.Campo`` del registro actual de la seleccion."""
        try:
            return self.app.GetField(field)
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    def set_field(self, field: str, value: Any) -> int:
        """Escribe ``Tabla.Campo`` en el registro actual. Devuelve 0 si OK."""
        try:
            return int(self.app.SetField(field, value) or 0)
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    def update_record(self, table: str) -> int:
        """Persiste los cambios del registro actual de ``table``."""
        try:
            return int(self.app.UpdateRecord(table) or 0)
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    # ------------------------------------------------------------------ #
    # Lectura de alto nivel
    # ------------------------------------------------------------------ #
    def read_records(
        self,
        table: str,
        fields: list[str],
        mask: str = "*",
        match_field: Optional[str] = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        """Filtra ``table`` y devuelve una lista de dicts ``{campo: valor}``.

        ``fields`` son nombres completos ``Tabla.Campo``. ``match_field`` es el
        campo sobre el que aplica ``mask`` (por defecto, el primero de ``fields``).
        """
        if not fields:
            raise PrestoError("Debes indicar al menos un campo en 'fields'.")
        mf = match_field or fields[0]
        self.select(table, mf, mask)
        rows: list[dict[str, Any]] = []
        for _ in self.iterate():
            rows.append({f: self.get_field(f) for f in fields})
            if len(rows) >= limit:
                break
        return rows

    # ------------------------------------------------------------------ #
    # Operaciones avanzadas (cualquier opcion del menu de Presto)
    # ------------------------------------------------------------------ #
    def execute_option(self, code: int, params_json: str = "") -> Any:
        """Ejecuta una opcion interna de Presto (DLG_*) con parametros JSON.

        Da acceso a las operaciones masivas del programa (multiplicar precios,
        reducir niveles, generar objetivo, exportar/importar formatos, etc.).
        ``code`` es el codigo numerico del dialogo (p. ej. 9901 = reducir niveles).
        """
        try:
            return self.app.ExecuteOption(code, params_json)
        except Exception as exc:  # noqa: BLE001
            raise PrestoError(_format_com_error(exc)) from exc

    def raw(self) -> Any:
        """Devuelve el objeto COM crudo para operaciones no envueltas."""
        return self.app
