from dataclasses import dataclass
from enum import Enum
from typing import NamedTuple


class BlockError(Exception):
    pass


class FaceState(Enum):
    """All possible states a Block face can be in.

    For the colored boundaries (RED, GREEN, BLUE), the meaning of the face depends on its
    orientation: space-like faces carry the corresponding weight-2 stabilizers, while time-like
    faces represent initialization/measurement in that basis.

    Remark: Redundancy...
class FaceState(Enum):
    """All possible states a Block face can be in.

    For the colored boundaries (RED, GREEN, BLUE), the meaning of the face depends on its
    orientation: space-like faces carry the corresponding weight-2 stabilizers, while time-like
    faces represent initialization/measurement in that basis.

    OPEN: This face is to be merged with another open face unless it represents a port in time
        direction. A valid pipe diagram has every open face connected to another open face except
        ports.
    RED: X boundary. Space-like: weight-2 X-stabilizers. Time-like: |+> prep/measurement.
    GREEN: Y boundary. Space-like: weight-2 Y-stabilizers. Time-like: |+i> prep/measurement.
    BLUE: Z boundary. Space-like: weight-2 Z-stabilizers. Time-like: |0> prep/measurement.
    HADAMARD: A Hadamard pipe connector that applies a basis change between two open faces of
        neighboring blocks. (TODO: determine whether this is actually needed as a face state.)
    NULL: Placeholder for undetermined faces during diagram construction. A finalized pipe
        diagram must contain no NULL faces.
    """
    OPEN = "open"
    RED = "red"
    GREEN = "green"
    BLUE = "blue"
    HADAMARD = "hadamard"
    NULL = "null"


class Coordinate(NamedTuple):
    x: int
    y: int
    z: int
    # Extra dimension for 3d architecture


@dataclass(frozen=True, slots=True)
class Block:
    pass


@dataclass(frozen=True, slots=True)
class SingleVoxelBlock(Block):
    north: FaceState = FaceState.RED
    south: FaceState = FaceState.RED
    east: FaceState = FaceState.BLUE
    west: FaceState = FaceState.BLUE
    top: FaceState = FaceState.OPEN
    bottom: FaceState = FaceState.OPEN

    def __post_init__(self):
        if not self.is_valid_surface_code_bock():
            raise BlockError('')
        return super().__post_init__()
    
    def is_valid_suface_code_block(self):
        # TODO: Johannes 1
        pass


@dataclass(frozen=True, slots=True)
class YBlock(Block):
    """Placeholder"""
    def __post_init__(self):
        super().__post_init__()
        raise NotImplementedError
