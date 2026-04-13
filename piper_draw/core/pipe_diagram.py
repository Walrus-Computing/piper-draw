from dataclasses import dataclass


@dataclass
class PipeDiagram:
    size: tuple[int, int, int]
    active_voxels: list[tuple[int, int, int]]