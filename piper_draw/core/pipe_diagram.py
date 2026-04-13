import networkx as nx
from .block import Block, Coordinate
from .rulesets import surface_code_lattice_surgery


class PipeDiagramError(Exception):
    pass


class PipeDiagram:
    def __init__(self) -> None:
        self._graph: nx.Graph = nx.Graph()

    def add_block(self, coordinate: Coordinate, block: Block) -> None:
        if coordinate in self._graph:
            raise PipeDiagramError("coordinate already occupied.")
        # Since coordinates enter the hash value of Blocks, verifying that all 
        if self.compatible_with_neighbors(coordinate, block):
            self._graph.add_node(coordinate, block=block)
        raise PipeDiagramError

    def remove_block(self, block: Block) -> None:
        # if block not in self._graph:
        #     raise KeyError('Block not in PipeDiagram')

        # coords = block.coordinates
        # for c in coords:
        #     del self._spatial_map[c]
        # self._graph.remove_node(block)
        pass
    
    def remove_block_from(self, coordinate: Coordinate) -> None:
        # if coordinate not in self._spatial_map:
        #     raise KeyError('Coordinate is not occupied by a block.')
        
        # block = self._spatial_map[coordinate]
        # coords = block.coordinates
        # for c in coords:
        #     del self._spatial_map[c]
        # self._graph.remove_node(block)
        pass

    def get_block_at(self, coordinate: Coordinate) -> Block:
        pass

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

    def compatible_with_neighbors(self, coordinate, block) -> bool:
        # TODO: Johannes
        pass


def are_compatible(
        block1: Block,
        block2: Block,
        coordinate1: Coordinate,
        coordinate2: Coordinate
    ) -> bool:
    '''Executes a sequence of checks.'''
    # TODO: Johannes 3
    for check in surface_code_lattice_surgery:
        if not check:
            raise PipeDiagramError
    
    return True