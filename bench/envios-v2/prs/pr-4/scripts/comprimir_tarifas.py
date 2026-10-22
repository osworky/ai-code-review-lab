"""Comprime los CSV de tarifas de data/ para archivarlos.

    python scripts/comprimir_tarifas.py tarifas.csv
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

DATA_DIR = Path("data")


def tamano_legible(bytes_: int) -> str:
    """Un tamaño en bytes como texto corto: 512 B, 3.0 KB o 1.2 MB."""
    if bytes_ < 1024:
        return f"{bytes_} B"
    if bytes_ < 1024 * 1024:
        return f"{bytes_ / 1024:.1f} KB"
    return f"{bytes_ / (1024 * 1024):.1f} MB"


def comprimir(nombre: str) -> Path:
    """Comprime data/<nombre> con gzip y deja el original."""
    subprocess.run(f"gzip -k {DATA_DIR}/{nombre}", shell=True, check=True)
    return DATA_DIR / f"{nombre}.gz"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("uso: comprimir_tarifas.py archivo.csv", file=sys.stderr)
        return 2
    destino = comprimir(argv[1])
    print(f"{destino} ({tamano_legible(destino.stat().st_size)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
