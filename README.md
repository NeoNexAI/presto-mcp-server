# presto-mcp-server

MCP server para integrar **Presto** (software de presupuestos y mediciones de RIB Spain) con **Claude Code**.

Publicado por **NeoNexAI Agency** · Cota Zero (clientes de consultoría IA).

---

## Instalación rápida (Claude Code)

Añade al fichero `~/.claude/claude_desktop_config.json` o al `.mcp.json` del proyecto:

```json
{
  "mcpServers": {
    "presto": {
      "command": "npx",
      "args": ["-y", "github:NeoNexAI/presto-mcp-server"],
      "env": {}
    }
  }
}
```

Reinicia Claude Code. Las herramientas `presto_*` estarán disponibles.

---

## Herramientas disponibles

### Modo BC3 (funciona con licencia base de Presto)

| Herramienta | Qué hace |
|---|---|
| `presto_list_obras` | Lista archivos .bc3 en un directorio |
| `presto_get_obra` | Resumen de una obra: capítulos, partidas, total |
| `presto_get_capitulos` | Desglose por capítulos con importes |
| `presto_get_partidas` | Partidas de un capítulo |
| `presto_get_partida` | Detalle completo de una partida + descomposición |
| `presto_search_partidas` | Buscar partidas por texto |
| `presto_get_resumen` | Resumen ejecutivo completo (útil para clientes) |
| `presto_find_anomalias` | Detecta partidas sin descripción, precio 0, duplicados |
| `presto_read_concepto` | Árbol completo de un concepto (recursivo) |

### Modo WebAPI (requiere Presto ServerCloud)

| Herramienta | Qué hace |
|---|---|
| `presto_webapi_status` | Comprueba conectividad con el servidor |
| `presto_webapi_list_obras` | Lista obras en el servidor |
| `presto_webapi_call` | Llamada genérica a cualquier función del API |

---

## Flujo de trabajo con BC3 (sin licencia Server)

```
Presto → Archivo → Exportar → Formato BC3/FIEBDC → guardar .bc3
                                        ↓
                        Claude Code + presto-mcp-server
                        (análisis, auditoría, generación)
                                        ↓
                        Presto → Archivo → Importar → .bc3 editado
```

### Ejemplo de uso en Claude Code

```
# Analiza el presupuesto de una obra
presto_get_resumen archivo="C:/proyectos/obra-castellon.bc3"

# Detecta anomalías
presto_find_anomalias archivo="C:/proyectos/obra-castellon.bc3"

# Busca todas las partidas de hormigón
presto_search_partidas archivo="C:/proyectos/obra-castellon.bc3" query="hormigón"

# Ver detalle de un capítulo
presto_get_partidas archivo="C:/proyectos/obra-castellon.bc3" codigoCapitulo="C01"
```

---

## Configuración WebAPI (opcional)

Solo necesario con Presto ServerCloud. Añade al entorno:

```json
{
  "mcpServers": {
    "presto": {
      "command": "npx",
      "args": ["-y", "github:NeoNexAI/presto-mcp-server"],
      "env": {
        "PRESTO_WEBAPI_URL": "http://tu-servidor/webapi/",
        "PRESTO_WEBAPI_USER": "Administrador",
        "PRESTO_WEBAPI_PASS": "tu-contraseña"
      }
    }
  }
}
```

**Requisitos WebAPI**: Presto ServerCloud + IIS + ASP.NET Core Hosting Bundle.
Contacto RIB Spain: +34 914 483 800 · info@rib-software.es

---

## Formato BC3/FIEBDC-3

El formato BC3 es el estándar español de intercambio de presupuestos (FIEBDC-3).
Todos los programas de presupuestación españoles lo soportan: Presto, CYPE, Arquímedes, etc.

**Exportar BC3 desde Presto**: `Archivo → Exportar → Formato BC3/FIEBDC`

---

## Seguridad

- Las herramientas de lectura son **read-only** (no modifican ningún archivo).
- Las credenciales WebAPI nunca salen del MCP — se usan solo para autenticarse contra tu servidor local.
- No envía datos a terceros.

---

## Licencia

MIT · NeoNexAI Agency
