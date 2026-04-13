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
    All possible states a Block face can be in.

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

    @classmethod
    def from_tqec(cls, kind: str) -> "FaceState":
        mapping = {"X": cls.RED, "Z": cls.BLUE, "Y": cls.GREEN}
        return mapping[kind]


class Coordinate(NamedTuple):
    x: int
    y: int
    z: int
    # Extra dimension for 3d architecture


@dataclass(frozen=True, slots=True)
class Block:
    def __post_init__(self):
        if not self.is_valid_block():
            raise BlockError('Invalid block configuration.')

    def is_valid_block(self) -> bool:
        return True


@dataclass(frozen=True, slots=True)
class SingleVoxelBlock(Block):
    north: FaceState = FaceState.RED
    south: FaceState = FaceState.RED
    east: FaceState = FaceState.BLUE
    west: FaceState = FaceState.BLUE
    top: FaceState = FaceState.OPEN
    bottom: FaceState = FaceState.OPEN

    def __post_init__(self):
        if not self.is_valid_surface_code_block():
            raise BlockError('')
        return super().__post_init__()

    def is_valid_surface_code_block(self):
        # TODO: Johannes 1
        return True

    @staticmethod
    def from_tqec_cube_dict(cube_dict: dict) -> "SingleVoxelBlock":
        faces = [FaceState.from_tqec(k) for k in cube_dict["kind"]]
        return SingleVoxelBlock(*faces)


@dataclass(frozen=True, slots=True)
class YBlock(Block):
    """Placeholder"""

    def __post_init__(self):
        super().__post_init__()
        raise NotImplementedError
