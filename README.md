# piper-draw

## Development guidelines
We adhere to [semantic versioning](https://semver.org/).
New features, bug fixes, etc. should be implemented on a seperate branch and merged via pull request on GitHub.

We use [`ruff`](https://docs.astral.sh/ruff/) for linting and code formatting.
In VSCode, you should get linting by installing the dependencies (which includes `ruff`) and then choosing the correct python interpreter.

Lint with `ruff check .` and format with `ruff format .`.

## Dependenies
We use `uv` to manage dependencies and virtual environments. Use `uv sync` to install all dependencies, use `uv sync --no-dev` to only install the production dependencies.