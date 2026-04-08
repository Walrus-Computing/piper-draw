import networkx as nx

from .block import Block


class PipeDiagram:
    def __init__(self) -> None:
        self._graph: nx.Graph = nx.Graph()

    def add_block(
        self,
        coordinates: tuple[int, int, int],
        block_type: str = "regular",
    ) -> Block:
        if coordinates in self._graph:
            raise ValueError(f"Block already exists at {coordinates}.")
        block = Block(coordinates, block_type)
        self._graph.add_node(coordinates, block=block)
        return block

    def remove_block(self, coordinates: tuple[int, int, int]) -> None:
        if coordinates not in self._graph:
            raise KeyError(f"No block at {coordinates}.")
        self._graph.remove_node(coordinates)

    def get_block(self, coordinates: tuple[int, int, int]) -> Block:
        if coordinates not in self._graph:
            raise KeyError(f"No block at {coordinates}.")
        return self._graph.nodes[coordinates]["block"]

    def connect_blocks(
        self,
        coord_a: tuple[int, int, int],
        coord_b: tuple[int, int, int],
    ) -> None:
        for c in (coord_a, coord_b):
            if c not in self._graph:
                raise KeyError(f"No block at {c}.")
        if self._graph.has_edge(coord_a, coord_b):
            raise ValueError(
                f"Blocks {coord_a} and {coord_b} are already connected."
            )
        self._graph.add_edge(coord_a, coord_b)

    def disconnect_blocks(
        self,
        coord_a: tuple[int, int, int],
        coord_b: tuple[int, int, int],
    ) -> None:
        if not self._graph.has_edge(coord_a, coord_b):
            raise ValueError(
                f"Blocks {coord_a} and {coord_b} are not connected."
            )
        self._graph.remove_edge(coord_a, coord_b)

    def neighbors(self, coordinates: tuple[int, int, int]) -> list[Block]:
        if coordinates not in self._graph:
            raise KeyError(f"No block at {coordinates}.")
        return [
            self._graph.nodes[n]["block"] for n in self._graph.neighbors(coordinates)
        ]

    @property
    def blocks(self) -> list[Block]:
        return [data["block"] for _, data in self._graph.nodes(data=True)]

    @property
    def num_blocks(self) -> int:
        return self._graph.number_of_nodes()

    @property
    def num_connections(self) -> int:
        return self._graph.number_of_edges()

    def __contains__(self, coordinates: tuple[int, int, int]) -> bool:
        return coordinates in self._graph

    def __repr__(self) -> str:
        return (
            f"PipeDiagram(blocks={self.num_blocks},"
            f" connections={self.num_connections})"
        )
