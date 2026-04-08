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


_DEFAULT_FACE_STATES: dict[Face, FaceState] = {
    Face.NORTH: FaceState.RED,
    Face.SOUTH: FaceState.RED,
    Face.EAST: FaceState.BLUE,
    Face.WEST: FaceState.BLUE,
    Face.TOP: FaceState.OPEN,
    Face.BOTTOM: FaceState.OPEN,
}


class Block:
    __slots__ = ("_coordinates", "_block_type", "_faces")

    def __init__(
        self,
        coordinates: tuple[int, int, int],
        block_type: str = "regular",
    ) -> None:
        if block_type not in ("regular", "Y"):
            raise ValueError(
                f"Invalid block_type: {block_type!r}. Must be 'regular' or 'Y'."
            )
        if len(coordinates) != 3 or not all(isinstance(c, int) for c in coordinates):
            raise TypeError("coordinates must be a 3-tuple of ints.")
        self._coordinates = coordinates
        self._block_type = block_type
        self._faces: dict[Face, FaceState] = dict(_DEFAULT_FACE_STATES)

    @property
    def coordinates(self) -> tuple[int, int, int]:
        return self._coordinates

    @property
    def block_type(self) -> str:
        return self._block_type

    def get_face(self, face: Face) -> FaceState:
        return self._faces[face]

    def set_face(self, face: Face, value: FaceState) -> None:
        if not isinstance(face, Face):
            raise TypeError(f"face must be a Face enum member, got {type(face)}")
        if not isinstance(value, FaceState):
            raise TypeError(
                f"value must be a FaceState enum member, got {type(value)}"
            )
        self._faces[face] = value

    def __repr__(self) -> str:
        return (
            f"Block(coordinates={self._coordinates},"
            f" block_type={self._block_type!r})"
        )

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Block):
            return NotImplemented
        return (
            self._coordinates == other._coordinates
            and self._block_type == other._block_type
        )

    def __hash__(self) -> int:
        return hash(self._coordinates)
