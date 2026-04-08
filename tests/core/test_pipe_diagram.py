import pytest

from piper_draw import Block, Face, FaceState, PipeDiagram


class TestBlock:
    def test_creation_defaults(self):
        b = Block((1, 2, 3))
        assert b.coordinates == (1, 2, 3)
        assert b.block_type == "regular"

    def test_creation_y_type(self):
        b = Block((0, 0, 0), block_type="Y")
        assert b.block_type == "Y"

    def test_invalid_block_type(self):
        with pytest.raises(ValueError, match="Invalid block_type"):
            Block((0, 0, 0), block_type="invalid")

    def test_invalid_coordinates_length(self):
        with pytest.raises(TypeError, match="3-tuple of ints"):
            Block((1, 2))

    def test_invalid_coordinates_type(self):
        with pytest.raises(TypeError, match="3-tuple of ints"):
            Block((1.0, 2, 3))

    def test_read_only_coordinates(self):
        b = Block((1, 2, 3))
        with pytest.raises(AttributeError):
            b.coordinates = (4, 5, 6)

    def test_read_only_block_type(self):
        b = Block((1, 2, 3))
        with pytest.raises(AttributeError):
            b.block_type = "Y"

    def test_no_arbitrary_attrs(self):
        b = Block((1, 2, 3))
        with pytest.raises(AttributeError):
            b.foo = "bar"

    def test_default_face_states(self):
        b = Block((0, 0, 0))
        assert b.get_face(Face.NORTH) == FaceState.RED
        assert b.get_face(Face.SOUTH) == FaceState.RED
        assert b.get_face(Face.EAST) == FaceState.BLUE
        assert b.get_face(Face.WEST) == FaceState.BLUE
        assert b.get_face(Face.TOP) == FaceState.OPEN
        assert b.get_face(Face.BOTTOM) == FaceState.OPEN

    def test_set_and_get_face(self):
        b = Block((0, 0, 0))
        b.set_face(Face.NORTH, FaceState.OPEN)
        assert b.get_face(Face.NORTH) == FaceState.OPEN

    def test_set_face_invalid_face(self):
        b = Block((0, 0, 0))
        with pytest.raises(TypeError, match="Face enum member"):
            b.set_face("north", FaceState.OPEN)

    def test_set_face_invalid_value(self):
        b = Block((0, 0, 0))
        with pytest.raises(TypeError, match="FaceState enum member"):
            b.set_face(Face.NORTH, True)

    def test_repr(self):
        b = Block((1, 2, 3), block_type="Y")
        assert "1, 2, 3" in repr(b)
        assert "'Y'" in repr(b)

    def test_equality(self):
        assert Block((1, 2, 3)) == Block((1, 2, 3))
        assert Block((1, 2, 3)) != Block((4, 5, 6))

    def test_hash(self):
        assert hash(Block((1, 2, 3))) == hash(Block((1, 2, 3)))


class TestPipeDiagram:
    def test_empty_diagram(self):
        d = PipeDiagram()
        assert d.num_blocks == 0
        assert d.num_connections == 0
        assert d.blocks == []

    def test_add_block(self):
        d = PipeDiagram()
        b = d.add_block((1, 2, 3))
        assert isinstance(b, Block)
        assert b.coordinates == (1, 2, 3)
        assert d.num_blocks == 1

    def test_add_block_with_type(self):
        d = PipeDiagram()
        b = d.add_block((0, 0, 0), block_type="Y")
        assert b.block_type == "Y"

    def test_add_duplicate_raises(self):
        d = PipeDiagram()
        d.add_block((1, 2, 3))
        with pytest.raises(ValueError, match="already exists"):
            d.add_block((1, 2, 3))

    def test_get_block(self):
        d = PipeDiagram()
        d.add_block((1, 2, 3))
        b = d.get_block((1, 2, 3))
        assert b.coordinates == (1, 2, 3)

    def test_get_nonexistent_raises(self):
        d = PipeDiagram()
        with pytest.raises(KeyError):
            d.get_block((9, 9, 9))

    def test_remove_block(self):
        d = PipeDiagram()
        d.add_block((1, 2, 3))
        d.remove_block((1, 2, 3))
        assert d.num_blocks == 0
        assert (1, 2, 3) not in d

    def test_remove_nonexistent_raises(self):
        d = PipeDiagram()
        with pytest.raises(KeyError):
            d.remove_block((9, 9, 9))

    def test_contains(self):
        d = PipeDiagram()
        d.add_block((1, 2, 3))
        assert (1, 2, 3) in d
        assert (9, 9, 9) not in d

    def test_connect_and_neighbors(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        d.add_block((1, 0, 0))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        assert d.num_connections == 1
        nbrs = d.neighbors((0, 0, 0))
        assert len(nbrs) == 1
        assert nbrs[0].coordinates == (1, 0, 0)

    def test_connect_nonexistent_raises(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        with pytest.raises(KeyError):
            d.connect_blocks((0, 0, 0), (9, 9, 9))

    def test_connect_duplicate_raises(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        d.add_block((1, 0, 0))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        with pytest.raises(ValueError, match="already connected"):
            d.connect_blocks((0, 0, 0), (1, 0, 0))

    def test_disconnect(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        d.add_block((1, 0, 0))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        d.disconnect_blocks((0, 0, 0), (1, 0, 0))
        assert d.num_connections == 0

    def test_disconnect_nonexistent_raises(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        d.add_block((1, 0, 0))
        with pytest.raises(ValueError, match="not connected"):
            d.disconnect_blocks((0, 0, 0), (1, 0, 0))

    def test_remove_block_cleans_edges(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        d.add_block((1, 0, 0))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        d.remove_block((0, 0, 0))
        assert d.num_blocks == 1
        assert d.num_connections == 0

    def test_repr(self):
        d = PipeDiagram()
        d.add_block((0, 0, 0))
        assert "blocks=1" in repr(d)
