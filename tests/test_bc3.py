"""Tests del parser/escritor BC3 (no requieren Presto ni Windows)."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from presto_mcp.bc3 import parse_bc3_text, parse_bc3, write_bc3, Bc3Obra, Concepto, Hijo  # noqa: E402

SAMPLE_BC3 = (
    "~V|ARCHIVO|Presto|FIEBDC-3/2016|||ANSI|\n"
    "~C|01#|%|MOVIMIENTO DE TIERRAS|1543.20||0|\n"
    "~C|E02AM010|m2|Desbroce y limpieza del terreno|0.95||1|\n"
    "~T|E02AM010|Desbroce y limpieza superficial del terreno por medios mecanicos.|\n"
    "~C|MO001|h|Peon ordinario|17.50||2|\n"
    "~C|MQ001|h|Pala cargadora|42.30||2|\n"
    "~D|01#|E02AM010\\1\\1623.4\\|\n"
    "~D|E02AM010|MO001\\1\\0.010\\MQ001\\1\\0.012\\|\n"
    "~C|E02BAD|m3|Excavacion sin precio||\\|1|\n"
)


def test_parse_meta_y_conceptos():
    obra = parse_bc3_text(SAMPLE_BC3)
    assert obra.meta["programa"] == "Presto"
    assert "FIEBDC-3" in obra.meta["version"]
    # 5 conceptos definidos por ~C (01#, E02AM010, MO001, MQ001, E02BAD)
    assert len(obra.conceptos) == 5
    assert obra.raiz == "01#"


def test_precio_y_texto():
    obra = parse_bc3_text(SAMPLE_BC3)
    desbroce = obra.conceptos["E02AM010"]
    assert desbroce.unidad == "m2"
    assert desbroce.precio == 0.95
    assert "Desbroce" in desbroce.texto


def test_descomposicion():
    obra = parse_bc3_text(SAMPLE_BC3)
    part = obra.conceptos["E02AM010"]
    hijos = {h.codigo: h for h in part.hijos}
    assert set(hijos) == {"MO001", "MQ001"}
    assert hijos["MO001"].rendimiento == 0.010
    assert hijos["MQ001"].rendimiento == 0.012


def test_capitulo_detectado():
    obra = parse_bc3_text(SAMPLE_BC3)
    assert obra.conceptos["01#"].es_capitulo is True
    assert obra.conceptos["E02AM010"].es_capitulo is False


def test_resumen():
    obra = parse_bc3_text(SAMPLE_BC3)
    r = obra.resumen()
    assert r["conceptos"] == 5
    assert r["capitulos"] >= 1
    assert r["programa_emisor"] == "Presto"


def test_roundtrip_write_read():
    obra = Bc3Obra(meta={"programa": "NeoNexAI", "version": "FIEBDC-3/2016"})
    obra.conceptos["P01"] = Concepto(
        codigo="P01", unidad="m2", resumen="Partida prueba", precio=12.5,
        texto="Texto de prueba", hijos=[Hijo("MO", 1.0, 0.5)],
    )
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "out.bc3")
        write_bc3(obra, path)
        back = parse_bc3(path)
    c = back.conceptos["P01"]
    assert c.resumen == "Partida prueba"
    assert c.precio == 12.5
    assert c.hijos[0].codigo == "MO"
    assert c.hijos[0].rendimiento == 0.5


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"OK   {fn.__name__}")
            passed += 1
        except Exception:  # noqa: BLE001
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{passed}/{len(fns)} tests OK")
    sys.exit(0 if passed == len(fns) else 1)
