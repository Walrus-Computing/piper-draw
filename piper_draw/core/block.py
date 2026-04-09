from dataclasses import dataclass
from enum import Enum


class FaceState(Enum):
    OPEN = "open"
    '''Indicates that this face is to be merged with another open face.'''
    BLUE = "blue"
    '''Z boundary (where Z-stabilizers with support 2 live)'''
    RED = "red"
    '''X boundary (where X-stabilizers with support 2 live)'''
    NULL = "null"
    '''Temporary placeholder. Needs to set eventually for a valid pipediagram.'''


@dataclass(frozen=True, slots=True)
class Block:
    coordinates: tuple[int, int, int]

    def __post_init__(self) -> None:
        coords = self.coordinates
        violations = (
            not isinstance(coords, tuple),
            len(coords) != 3,
            not all(isinstance(c, int) for c in coords)
        )
        if any(violations):
            raise TypeError("coordinates must be a 3-tuple of ints.")


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
