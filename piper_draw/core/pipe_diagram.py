from dataclasses import dataclass


@dataclass
class PipeDiagram:
    size: tuple[int]
    active_voxels: list[tuple[int]]