# presto-mcp-server

MCP server que conecta **Claude** con **Presto** (software de presupuestos y
mediciones de **RIB Software**) — versión **2025**.

Por **NeoNexAI Agency** (para Cota Zero y clientes de consultoría IA).

Dos vías complementarias:

- **COM en vivo (`Presto.App.25`)** — controla la obra **abierta** en Presto:
  leer/escribir conceptos, precios y cualquier campo, e invocar opciones internas
  del programa. Requiere **Presto instalado y ejecutándose** en el mismo equipo.
- **BC3 (FIEBDC-3)** — lee y analiza ficheros de presupuesto **sin abrir Presto**
  (multiplataforma; ideal para auditoría rápida).

> Presto de escritorio **no tiene API REST** (eso es solo Presto *ServerCloud*).
> La integración local correcta es **COM**, que la documentación oficial de RIB
> soporta para VBScript, VB.NET y **Python (`win32com`)** — que es lo que usa este server.

---

## Requisitos

- **Windows** (la vía COM es Windows-only).
- **Presto 2025** instalado en el equipo (para la vía COM). Si tu versión no es la
  25, fija el ProgID con la variable `PRESTO_PROGID` (p. ej. `Presto.App.26`).
- **Python ≥ 3.10**.
- La vía **BC3 funciona sin Presto** (solo necesita los ficheros `.bc3`).

---

## Instalación en el PC del cliente (Claude Code)

Requiere **Python** y **[uv](https://docs.astral.sh/uv/)** (`pip install uv`).
Publicado en **PyPI** como [`presto-mcp-server`](https://pypi.org/project/presto-mcp-server/).
`uvx` instala y ejecuta sin dejar nada que mantener; `@latest` trae siempre la última versión:

```bash
claude mcp add presto -s user -- uvx presto-mcp-server@latest
```

- `-s user` → disponible en todos los proyectos de ese PC.
- Para una versión de Presto distinta de 2025, añade el ProgID:
  `--env PRESTO_PROGID=Presto.App.26`.

**Alternativas:**

```bash
# con pip
pip install presto-mcp-server
claude mcp add presto -s user -- python -m presto_mcp

# sin PyPI, directo de GitHub (no autoactualiza salvo --refresh)
claude mcp add presto -s user -- uvx --from git+https://github.com/NeoNexAI/presto-mcp-server presto-mcp
```

**Claude Desktop** — bloque equivalente en su `mcp.json`:

```json
{
  "mcpServers": {
    "presto": {
      "command": "uvx",
      "args": ["presto-mcp-server@latest"],
      "env": { "PRESTO_PROGID": "Presto.App.25" }
    }
  }
}
```

Para la vía COM: **abre Presto** (y la obra, si la operación la necesita) antes de
usar las herramientas. Comprueba la conexión con `presto_status`.

---

## Herramientas

### Conexión y obra
| Tool | Qué hace |
|---|---|
| `presto_status` | Comprueba la conexión COM y devuelve el ProgID activo |
| `presto_open_obra` | Abre una obra `.Presto` en la instancia en ejecución |
| `presto_close_obra` | Cierra la obra abierta |

### Genéricas — cobertura del 100% del modelo de datos
| Tool | Qué hace |
|---|---|
| `presto_read_records` | Lee cualquier tabla/campos filtrando por máscara |
| `presto_get_field` | Lee un campo de un registro por su código |
| `presto_set_field` | Escribe un campo (transaccional, deshacible) |
| `presto_execute_option` | Ejecuta cualquier opción interna de Presto (DLG_*) con JSON |

### Curadas — conceptos y precios
| Tool | Qué hace |
|---|---|
| `presto_get_concepto` | Código, unidad, resumen y precios de un concepto |
| `presto_search_conceptos` | Busca conceptos por resumen o código |
| `presto_get_precios` | Precios en todos los esquemas (presupuesto, certificación, real, objetivo, planificado) |
| `presto_set_precio` | Fija el precio de un concepto en un esquema |

### BC3 (FIEBDC-3) — sin Presto
| Tool | Qué hace |
|---|---|
| `presto_bc3_resumen` | Resumen de un fichero BC3 (conceptos, capítulos, emisor) |
| `presto_bc3_buscar` | Busca conceptos por texto en un BC3 |
| `presto_bc3_concepto` | Concepto del BC3 con texto y descomposición |
| `presto_bc3_anomalias` | Precios a 0/ausentes, sin resumen, partidas sin descomposición |

---

## Modelo de datos de Presto (referencia rápida)

La automatización trabaja sobre **tablas.campo**. Los nombres exactos se ven en
Presto con **`Ver: Lista de campos`**. Los más usados:

- Tabla **`Conceptos`**: `Conceptos.Código` (clave única), `Conceptos.Resumen`,
  `Conceptos.Ud`, y precios `Conceptos.PrPres` (presupuesto), `PrCert`
  (certificación), `PrReal`, `PrObj` (objetivo), `PrPlan` (planificado).
- Filtrado por máscara con comodines de Presto: `"E04*"`, `"*hormigón*"`, `"*"`.

Operaciones masivas (multiplicar precios, reducir niveles, generar objetivo,
exportar/importar formatos…) → `presto_execute_option` con el código del diálogo.

---

## Desarrollo

```bash
python -m py_compile src/presto_mcp/*.py     # comprobar sintaxis
python tests/test_bc3.py                      # tests del parser BC3 (sin Presto)
```

**Estado de validación:** el parser **BC3 está verificado (6/6 tests)** y el
servidor MCP **carga y registra las 15 tools**. La vía **COM** solo puede probarse
e2e en un equipo con **Presto 2025 abierto** → se valida en sesión presencial con
el cliente. Si algún nombre de campo difiere en una instalación concreta, se ajusta
con `Ver: Lista de campos` (las tools genéricas aceptan cualquier `tabla.campo`).

---

## Licencia

MIT · NeoNexAI Agency
