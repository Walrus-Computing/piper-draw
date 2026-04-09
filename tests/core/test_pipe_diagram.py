import pytest

from piper_draw import PipeDiagram, SingleVoxelBlock


class TestPipeDiagram:
    def test_empty_diagram(self):
        d = PipeDiagram()
        assert d.num_blocks == 0
        assert d.num_connections == 0
        assert d.blocks == []

    def test_add_block(self):
        d = PipeDiagram()
        b = SingleVoxelBlock((1, 2, 3))
        d.add_block(b)
        assert d.num_blocks == 1
        assert d.get_block((1, 2, 3)) is b

    def test_add_duplicate_raises(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((1, 2, 3)))
        with pytest.raises(ValueError, match="already exists"):
            d.add_block(SingleVoxelBlock((1, 2, 3)))

    def test_get_block(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((1, 2, 3)))
        b = d.get_block((1, 2, 3))
        assert b.coordinates == (1, 2, 3)

    def test_get_nonexistent_raises(self):
        d = PipeDiagram()
        with pytest.raises(KeyError):
            d.get_block((9, 9, 9))

    def test_remove_block(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((1, 2, 3)))
        d.remove_block((1, 2, 3))
        assert d.num_blocks == 0
        assert (1, 2, 3) not in d

    def test_remove_nonexistent_raises(self):
        d = PipeDiagram()
        with pytest.raises(KeyError):
            d.remove_block((9, 9, 9))

    def test_contains(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((1, 2, 3)))
        assert (1, 2, 3) in d
        assert (9, 9, 9) not in d

    def test_connect_and_neighbors(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        d.add_block(SingleVoxelBlock((1, 0, 0)))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        assert d.num_connections == 1
        nbrs = d.neighbors((0, 0, 0))
        assert len(nbrs) == 1
        assert nbrs[0].coordinates == (1, 0, 0)

    def test_connect_nonexistent_raises(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        with pytest.raises(KeyError):
            d.connect_blocks((0, 0, 0), (9, 9, 9))

    def test_connect_duplicate_raises(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        d.add_block(SingleVoxelBlock((1, 0, 0)))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        with pytest.raises(ValueError, match="already connected"):
            d.connect_blocks((0, 0, 0), (1, 0, 0))

    def test_disconnect(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        d.add_block(SingleVoxelBlock((1, 0, 0)))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        d.disconnect_blocks((0, 0, 0), (1, 0, 0))
        assert d.num_connections == 0

    def test_disconnect_nonexistent_raises(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        d.add_block(SingleVoxelBlock((1, 0, 0)))
        with pytest.raises(ValueError, match="not connected"):
            d.disconnect_blocks((0, 0, 0), (1, 0, 0))

    def test_remove_block_cleans_edges(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        d.add_block(SingleVoxelBlock((1, 0, 0)))
        d.connect_blocks((0, 0, 0), (1, 0, 0))
        d.remove_block((0, 0, 0))
        assert d.num_blocks == 1
        assert d.num_connections == 0

    def test_repr(self):
        d = PipeDiagram()
        d.add_block(SingleVoxelBlock((0, 0, 0)))
        assert "blocks=1" in repr(d)
