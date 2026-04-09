from dataclasses import dataclass
from enum import Enum


class FaceState(Enum):
    OPEN = "open"
    BLUE = "blue"
    RED = "red"


class Face(Enum):
    NORTH = "north"
    SOUTH = "south"
    EAST = "east"
    WEST = "west"
    TOP = "top"
    BOTTOM = "bottom"


@dataclass(frozen=True, slots=True)
class Block:
    coordinates: tuple[int, int, int]

    def __post_init__(self) -> None:
        coords = self.coordinates
        if (
            len(coords) != 3
            or not all(isinstance(c, int) for c in coords)
        ):
            raise TypeError("coordinates must be a 3-tuple of ints.")

    def __hash__(self) -> int:
        return hash(self.coordinates)


@dataclass(frozen=True, slots=True)
class SingleVoxelBlock(Block):
    north: FaceState = FaceState.RED
    south: FaceState = FaceState.RED
    east: FaceState = FaceState.BLUE
    west: FaceState = FaceState.BLUE
    top: FaceState = FaceState.OPEN
    bottom: FaceState = FaceState.OPEN


@dataclass(frozen=True, slots=True)
class YBlock(Block):
    """Placeholder"""
    def __post_init__(self):
        super().__post_init__()
        raise NotImplementedError
