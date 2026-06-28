---
name: presto-usage
description: >-
  Guía para manejar bien el MCP de Presto (presupuestos y mediciones de RIB, v2025).
  Úsala SIEMPRE que el trabajo implique Presto, ficheros BC3/FIEBDC o cualquier tool
  `presto_*` — leer/editar conceptos, precios, mediciones, certificaciones, exportar
  o auditar presupuestos. Explica las DOS vías (COM en vivo, que exige Presto ABIERTO,
  vs BC3 sobre ficheros sin Presto), el modelo de datos tabla.campo, cómo lograr
  cobertura total con las tools genéricas, y la precaución con las escrituras. Aunque
  el usuario no nombre "Presto", si habla de presupuestos de obra, partidas, capítulos,
  mediciones o ficheros .bc3/.dwg-presupuesto y el MCP está disponible, aplícala.
---

# Presto — cómo usar el MCP bien

Hay **dos vías** y elegir la correcta evita el 90% de los problemas:

- **COM (en vivo):** controla la obra **abierta en Presto**. Es la mayoría de
  tools. **Requiere Presto 2025 instalado Y ABIERTO** en este mismo equipo, con la
  obra abierta para operar sobre ella.
- **BC3 (ficheros):** las tools `presto_bc3_*` leen/analizan ficheros `.bc3`
  (FIEBDC-3) **sin Presto**. Úsalas para auditar/consultar un presupuesto que te
  pasan como fichero, aunque Presto no esté instalado.

## Flujo correcto (COM)

1. **Empieza SIEMPRE con `presto_status`.** Confirma que Presto responde por COM y
   el ProgID activo. Si falla: Presto no está abierto, o la versión no casa con el
   ProgID (Presto 2025 = `Presto.App.25`; otra versión → variable `PRESTO_PROGID`).
2. Asegúrate de que la **obra correcta está abierta** (`presto_open_obra` si hace
   falta abrir un `.Presto` concreto).
3. Lee/opera con las tools.

## Modelo de datos: `Tabla.Campo`

Presto organiza todo en tablas con campos. Los nombres exactos se ven en Presto con
**`Ver: Lista de campos`**; si una instalación difiere, ajusta el nombre. Los clave:

- Tabla **`Conceptos`**: `Conceptos.Código` (clave única), `Conceptos.Resumen`,
  `Conceptos.Ud`, y precios por escenario: `Conceptos.PrPres` (presupuesto),
  `PrCert` (certificación), `PrReal`, `PrObj` (objetivo), `PrPlan` (planificado).
- El filtro usa **comodines de Presto**: `"E04*"`, `"*hormigón*"`, `"*"`.

## Cobertura total con las genéricas

Cuando no haya una tool curada (`get_concepto`, `search_conceptos`, `get_precios`,
`set_precio`), usa las genéricas:

- `presto_read_records(table, fields, mask)` — lee cualquier tabla/campos.
- `presto_get_field` / `presto_set_field` — un campo de un registro por código.
- `presto_execute_option(code, params_json)` — ejecuta **cualquier opción interna**
  de Presto (multiplicar precios, reducir niveles, generar objetivo, exportar/importar
  formatos…). `code` = código del diálogo (p. ej. 9901 = reducir niveles). Es la
  llave maestra para operaciones masivas que no tienen tool propia.

## Escrituras: con cabeza

Las tools de escritura (`set_field`, `set_precio`, `execute_option`) **modifican la
obra del cliente**. Van envueltas en transacción `BeginRedo/EndRedo` (deshacibles
con Ctrl+Z en Presto), pero aun así:

- Antes de un cambio masivo o un `execute_option`, **resume al usuario qué vas a
  hacer y sobre cuántos registros**, y pide confirmación.
- Para tareas de solo lectura/análisis no hace falta; lee con libertad.

## Patrones frecuentes

- **Auditar un presupuesto que te pasan en fichero:** `presto_bc3_resumen` →
  `presto_bc3_anomalias` (precios a 0, sin resumen, partidas sin descomponer) →
  `presto_bc3_concepto` para detallar. Sin Presto abierto.
- **Trabajar sobre la obra abierta:** `presto_status` → `presto_search_conceptos`
  para localizar partidas → `presto_get_concepto`/`presto_get_precios` → editar con
  `presto_set_precio`/`presto_set_field` si procede.
- **Comparar escenarios:** lee `presto_get_precios` (trae los 5 esquemas a la vez).

## ¿BricsCAD / DWG?

Este MCP es de **presupuestos** (Presto), no de CAD. Para dibujar/editar planos en
BricsCAD se usa otro MCP (multiCAD). No intentes abrir DWG con las tools de Presto.
