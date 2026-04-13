# piper-draw
An open source web application for building pipe diagrams for topological error correction.

## v0 Features
Using a drag-and-drop interface, the user can combine 1 type of cube with 1 type of pipe to create a vertical stack.
For now we follow the naming convention of cubes and pipes of TQEC. See [the terminology guide](https://tqec.github.io/tqec/user_guide/terminology.html).

The user can then press the **Export to Collada (.dae)** button.
This package contains a test that verifies the exported `.dae` file is correctly understood by the TQEC package.

## Usage
- Start the app locally and build your diagram in the browser using `piperdraw` in the command line.
- Assemble stack elements with drag-and-drop.
- Export the design via the Collada export button to generate a `.dae` file.
- Run the provided validation test to check `.dae` compatibility.

## Development guidelines
We adhere to [semantic versioning](https://semver.org/).
New features, bug fixes, etc. should be implemented on a separate branch and merged via pull request on GitHub.

We use [`ruff`](https://docs.astral.sh/ruff/) for linting and code formatting.
In VSCode, you should get linting by installing the dependencies (which includes `ruff`) and then choosing the correct python interpreter.

Lint with `ruff check .` and format with `ruff format .`.

### API Structure
`__init__.py` files should be considered as the outward-facing API. Consequently all functions and classes that are meant to be exposed beyond a (sub)module should be imported (made available) in the respective `__init__.py` file.

### Testing
We use `pytest`. For random numbers in test we use `pytest-randomly`, which sets a unique seed for each test run, such that failing tests are reproducible, but the seed is not fix.
Whenever using a random number in a test, make sure to invoke it from a seed obtained from `tests/randomly_utils.get_seeds()`.
You can feed this seed into your random number generator, e.g., `numpy.random.default_rng(seed)`.

The `tests` directory structure should generally reflect the same structure as the `piper_draw` directory.

## Dependencies
We use `uv` to manage dependencies and virtual environments. Use `uv sync` to install all dependencies, use `uv sync --no-dev` to only install the production dependencies.
