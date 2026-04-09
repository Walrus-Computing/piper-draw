import pytest

from piper_draw import Block, FaceState, SingleVoxelBlock


class TestBlock:
    def test_coordinates_validation(self):
        with pytest.raises(TypeError, match="3-tuple of ints"):
            Block((1, 2))

    def test_coordinates_type_validation(self):
        with pytest.raises(TypeError, match="3-tuple of ints"):
            Block((1.0, 2, 3))

    def test_frozen(self):
        b = Block((1, 2, 3))
        with pytest.raises(AttributeError):
            b.coordinates = (4, 5, 6)

    def test_no_arbitrary_attrs(self):
        b = Block((1, 2, 3))
        with pytest.raises(AttributeError):
            b.foo = "bar"

    def test_hash(self):
        assert hash(Block((1, 2, 3))) == hash((1, 2, 3))


class TestSingleVoxelBlock:
    def test_creation_defaults(self):
        b = SingleVoxelBlock((1, 2, 3))
        assert b.coordinates == (1, 2, 3)
        assert b.north == FaceState.RED
        assert b.south == FaceState.RED
        assert b.east == FaceState.BLUE
        assert b.west == FaceState.BLUE
        assert b.top == FaceState.OPEN
        assert b.bottom == FaceState.OPEN

    def test_custom_face_states(self):
        b = SingleVoxelBlock((0, 0, 0), north=FaceState.OPEN)
        assert b.north == FaceState.OPEN
        assert b.south == FaceState.RED

    def test_is_block(self):
        assert isinstance(SingleVoxelBlock((0, 0, 0)), Block)

    def test_frozen(self):
        b = SingleVoxelBlock((1, 2, 3))
        with pytest.raises(AttributeError):
            b.north = FaceState.OPEN

    def test_equality(self):
        a = SingleVoxelBlock((1, 2, 3))
        b = SingleVoxelBlock((1, 2, 3))
        assert a == b

    def test_inequality(self):
        a = SingleVoxelBlock((1, 2, 3))
        b = SingleVoxelBlock((4, 5, 6))
        assert a != b

    def test_inequality_different_faces(self):
        a = SingleVoxelBlock((1, 2, 3))
        b = SingleVoxelBlock((1, 2, 3), north=FaceState.OPEN)
        assert a != b

    def test_hash(self):
        a = SingleVoxelBlock((1, 2, 3))
        b = SingleVoxelBlock((1, 2, 3))
        assert hash(a) == hash(b)
        assert hash(a) == hash((1, 2, 3))
