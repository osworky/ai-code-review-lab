"""Importa tarifas desde un CSV de la carpeta data/.

    python scripts/importar_tarifas.py tarifas.csv
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

DATA_DIR = Path("data").resolve()


def leer_tarifas(nombre: str) -> list[dict[str, str]]:
    """Lee un CSV de data/."""
    ruta = DATA_DIR / nombre
    with open(ruta, newline="", encoding="utf-8") as archivo:
        return list(csv.DictReader(archivo))


def main(argv: list[str]) -> int:
    if len(argv) == 4 and argv[2] == "--moneda":
        filas = [fila for fila in leer_tarifas(argv[1]) if fila.get("moneda") == argv[3]]
    elif len(argv) == 2:
        filas = leer_tarifas(argv[1])
    else:
        print("uso: importar_tarifas.py archivo.csv [--moneda USD|EUR]", file=sys.stderr)
        return 2
    print(f"{len(filas)} tarifas leídas")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
