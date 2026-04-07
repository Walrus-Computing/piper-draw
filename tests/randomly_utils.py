from typing import Generator
import random


def get_seeds(num_seeds: int) -> int | Generator[int]:
    '''Utility function for obtaining reproducible seeds,
    which are managed by pytest-randomly.'''
    return (random.randint(0, 2e63) for _ in range(num_seeds))
