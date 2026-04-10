import networkx as nx

from .block import Block, Coordinate


class PipeDiagram:
    # NOTE: Since _graph and _spatial_map must be kept synchronized at all times, there is a lot of
    # potential for error. This should be refactored into a class that is dedicated to only doing
    # that correctly, once the logic is a bit more refined.
    def __init__(self) -> None:
        self._graph: nx.Graph = nx.Graph()
        # NetworkX graph with nodes being Blocks (possibly multi-voxel) and edges corresponding
        # to connections between two blocks.
        self._spatial_map: dict[Coordinate, Block] = {}

    def add_block(self, block: Block) -> None:
        if any(c in self._spatial_map for c in block.coordinates):
            raise ValueError("Block contains coordinates that are already occupied.")
        # Since coordinates enter the hash value of Blocks, verifying that all 
        self._graph.add_node(Block)

    def remove_block(self, block: Block) -> None:
        if block not in self._graph:
            raise KeyError('Block not in PipeDiagram')

        coords = block.coordinates
        for c in coords:
            del self._spatial_map[c]
        self._graph.remove_node(block)
    
    def remove_block_from(self, coordinate: Coordinate) -> None:
        if coordinate not in self._spatial_map:
            raise KeyError('Coordinate is not occupied by a block.')
        
        block = self._spatial_map[coordinate]
        coords = block.coordinates
        for c in coords:
            del self._spatial_map[c]
        self._graph.remove_node(block)

    def get_block_at(self, coordinate: Coordinate) -> Block:
        return self._spatial_map[coordinate]

    def connect_blocks(
        self,
        coord_a: tuple[int, int, int],
        coord_b: tuple[int, int, int],
    ) -> None:
        pass
        # for c in (coord_a, coord_b):
        #     if c not in self._graph:
        #         raise KeyError(f"No block at {c}.")
        # if self._graph.has_edge(coord_a, coord_b):
        #     raise ValueError(
        #         f"Blocks {coord_a} and {coord_b} are already connected."
        #     )
        # self._graph.add_edge(coord_a, coord_b)

    def disconnect_blocks(
        self,
        coord_a: tuple[int, int, int],
        coord_b: tuple[int, int, int],
    ) -> None:
        pass
        # if not self._graph.has_edge(coord_a, coord_b):
        #     raise ValueError(
        #         f"Blocks {coord_a} and {coord_b} are not connected."
        #     )
        # self._graph.remove_edge(coord_a, coord_b)

    def neighbors(
        self, coordinates: tuple[int, int, int]
    ) -> list[Block]:
        pass
        # if coordinates not in self._graph:
        #     raise KeyError(f"No block at {coordinates}.")
        # return [
        #     self._graph.nodes[n]["block"]
        #     for n in self._graph.neighbors(coordinates)
        # ]

    def __repr__(self) -> str:
        pass
        # return (
        #     f"PipeDiagram(blocks={self.num_blocks},"
        #     f" connections={self.num_connections})"
        # )
