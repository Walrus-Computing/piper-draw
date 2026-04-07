from dataclasses import dataclass
from typing import Tuple, List


@dataclass
class PipeDiagram:
    size: Tuple[int]
    active_voxels: List[Tuple[int]]