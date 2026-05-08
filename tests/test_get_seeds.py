from types import GeneratorType

from tests.randomly_utils import get_seeds


def test_get_seeds():
    assert isinstance(get_seeds(), GeneratorType)

    a = next(get_seeds())
    b = next(get_seeds())
    assert a != b

    assert len(list(get_seeds(5))) == 5
