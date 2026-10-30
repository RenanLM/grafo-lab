"""Gera os ícones do GrafoLab (assets/images/*.png) e o SVG-fonte (assets/brand/).

Uso (a partir da raiz do repositório):
    python scripts/gerar-icones.py

Dependência apenas de desenvolvimento: PyMuPDF (`pip install pymupdf`).
O glifo é um grafo de 4 vértices (triângulo com uma haste), desenhado em coordenadas
de glifo e centralizado/escalado para cada variante de ícone.
"""

import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
import pymupdf  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
IMAGENS = RAIZ / "assets" / "images"
MARCA = RAIZ / "assets" / "brand"

AZUL = "#3B4FD8"
AZUL_CLARO = "#8FA0FF"
NOITE = "#0E1020"

# Vértices e arestas do glifo (unidades arbitrárias).
VERTICES = {"A": (0.0, 0.0), "B": (2.0, 0.3), "C": (1.0, 1.8), "D": (-0.9, 2.1)}
ARESTAS = [("A", "B"), ("B", "C"), ("C", "A"), ("C", "D")]
RAIO = 0.30
TRACO = 0.15


def glifo_svg(cor: str, tamanho: int, fracao: float, fundo: str | None) -> str:
    """SVG quadrado `tamanho` x `tamanho` com o glifo centralizado ocupando `fracao` do lado."""
    xs = [x for x, _ in VERTICES.values()]
    ys = [y for _, y in VERTICES.values()]
    largura = max(xs) - min(xs) + 2 * RAIO
    altura = max(ys) - min(ys) + 2 * RAIO
    escala = fracao * tamanho / max(largura, altura)
    centro_x = (max(xs) + min(xs)) / 2
    centro_y = (max(ys) + min(ys)) / 2

    def ponto(v: tuple[float, float]) -> tuple[float, float]:
        return (
            tamanho / 2 + (v[0] - centro_x) * escala,
            tamanho / 2 + (v[1] - centro_y) * escala,
        )

    partes = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{tamanho}" height="{tamanho}" '
        f'viewBox="0 0 {tamanho} {tamanho}">'
    ]
    if fundo:
        partes.append(f'<rect width="{tamanho}" height="{tamanho}" fill="{fundo}"/>')
    for origem, destino in ARESTAS:
        (x1, y1), (x2, y2) = ponto(VERTICES[origem]), ponto(VERTICES[destino])
        partes.append(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="{cor}" stroke-width="{TRACO * escala:.2f}" stroke-linecap="round"/>'
        )
    for v in VERTICES.values():
        x, y = ponto(v)
        partes.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{RAIO * escala:.2f}" fill="{cor}"/>')
    partes.append("</svg>")
    return "".join(partes)


def renderizar(svg: str, destino: Path, lado: int, transparente: bool) -> None:
    doc = pymupdf.open(stream=svg.encode("utf-8"), filetype="svg")
    pagina = doc[0]
    zoom = lado / pagina.rect.width
    pix = pagina.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=transparente)
    destino.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(destino))
    print(f"{destino.relative_to(RAIZ)} ({pix.width}x{pix.height})")


def main() -> None:
    MARCA.mkdir(parents=True, exist_ok=True)
    (MARCA / "grafolab-icone.svg").write_text(glifo_svg("#FFFFFF", 1024, 0.56, AZUL), encoding="utf-8")
    (MARCA / "grafolab-glifo.svg").write_text(glifo_svg(AZUL, 1024, 0.9, None), encoding="utf-8")

    renderizar(glifo_svg("#FFFFFF", 1024, 0.56, AZUL), IMAGENS / "icon.png", 1024, False)
    renderizar(glifo_svg("#FFFFFF", 1024, 0.44, None), IMAGENS / "android-icon-foreground.png", 1024, True)
    renderizar(glifo_svg("#000000", 1024, 0.44, None), IMAGENS / "android-icon-monochrome.png", 1024, True)
    renderizar(glifo_svg("#FFFFFF", 1024, 0.9, None), IMAGENS / "splash-icon.png", 1024, True)
    renderizar(glifo_svg(AZUL_CLARO, 1024, 0.9, None), IMAGENS / "splash-icon-dark.png", 1024, True)
    renderizar(glifo_svg("#FFFFFF", 256, 0.62, AZUL), IMAGENS / "favicon.png", 48, False)


if __name__ == "__main__":
    main()
