import pytest

from piper_draw import Block, FaceState, SingleVoxelBlock


class TestBlock:
    @pytest.mark.parametrize('coordinates', [(1, 2), (1, 3, 4, 2), [1, 2, 3], (1, 2., 3)])
    def test_raises_on_bad_coordinates(self, coordinates):
        with pytest.raises(TypeError):
            SingleVoxelBlock(coordinates)

    def test_frozen(self):
        b = Block((1, 2, 3))
        with pytest.raises(AttributeError):
            b.coordinates = (4, 5, 6)

    def test_no_arbitrary_attrs(self):
        b = Block((1, 2, 3))
        with pytest.raises((AttributeError, TypeError)):
            # When slots=True and frozen=True there is a bug in raising the error.
            # Hence, the TypeError.
            b.foo = "bar"

    def test_hash(self):
        a = Block((1, 2, 3))
        b = Block((1, 2, 3))
        c = Block((-1, 3, 0))
        assert hash(a) == hash(b)
        assert hash(a) != hash(c)


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
    
    def test_face_nullable(self):
        a = SingleVoxelBlock((1, 2, 3), top=FaceState.NULL)
        assert a.top == FaceState.NULL

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
        b = SingleVoxelBlock((1, 2, 3), north=FaceState.OPEN)
        c = SingleVoxelBlock((1, 2, 4), north=FaceState.OPEN)
        d = SingleVoxelBlock((4, 5, 6))
        assert a != b
        assert b != c
        assert a != d

    def test_hash(self):
        a = SingleVoxelBlock((1, 2, 3))
        b = SingleVoxelBlock((1, 2, 3))
        c = SingleVoxelBlock((1, 2, 3), east=FaceState.RED)
        d = SingleVoxelBlock((1, 2, 4), east=FaceState.RED)
        assert hash(a) == hash(b)
        assert hash(a) != hash(c)
        assert hash(c) != hash(d)
