"""Importa tarifas desde un CSV que vive dentro de data/.

    python scripts/importar_tarifas.py tarifas.csv
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

DATA_DIR = Path("data").resolve()


def leer_tarifas(nombre: str) -> list[dict[str, str]]:
    """Lee un CSV de data/. Rechaza rutas que salgan de esa carpeta."""
    ruta = (DATA_DIR / nombre).resolve()
    if DATA_DIR not in ruta.parents:
        raise ValueError("el archivo debe estar dentro de data/")
    with open(ruta, newline="", encoding="utf-8") as archivo:
        return list(csv.DictReader(archivo))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("uso: importar_tarifas.py archivo.csv", file=sys.stderr)
        return 2
    filas = leer_tarifas(argv[1])
    print(f"{len(filas)} tarifas leídas")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
