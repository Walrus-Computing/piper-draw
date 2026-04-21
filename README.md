<p align="center">
  <img src="assets/logo.svg" alt="piper-draw" width="640">
</p>

An open source web application for building pipe diagrams for topological error correction.

## v0 Features
Using a drag-and-drop interface, the user can combine 1 type of cube with 1 type of pipe to create a vertical stack.
For now we follow the naming convention of cubes and pipes of TQEC. See [the terminology guide](https://tqec.github.io/tqec/user_guide/terminology.html).

The user can then press the **Export to Collada (.dae)** button.
This package contains a test that verifies the exported `.dae` file is correctly understood by the TQEC package.

The **Verify (tqec)** button sends the current diagram to a FastAPI backend that builds a [`tqec.BlockGraph`](https://github.com/tqec/tqec) and reports per-cube validation errors.

The **Flows (tqec)** button opens a side panel that computes stabilizer flows (correlation surfaces) for the current diagram, also via the [tqec](https://github.com/tqec/tqec) package.

## Getting started

### Prerequisites
- Python 3.14+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Node.js and npm

### Starting the webapp

1. Install Python dependencies:
   ```sh
   uv sync
   ```
2. Install frontend dependencies:
   ```sh
   cd piper_draw/gui
   npm install
   ```
3. Start the development server (runs both the frontend and backend):
   ```sh
   npm run dev
   ```
   This launches the Vite frontend dev server and the FastAPI backend (`uvicorn`). Open the URL shown in the terminal (typically http://localhost:5173) in your browser.

### Usage
- Assemble stack elements with drag-and-drop.
- Export the design via the Collada export button to generate a `.dae` file.
- Click **Verify (tqec)** to run server-side validation via the [tqec](https://github.com/tqec/tqec) package; any errors are shown inline on the offending cubes.
- Click **Flows (tqec)** to compute and inspect stabilizer flows (correlation surfaces) for the current diagram via the [tqec](https://github.com/tqec/tqec) package.
- Run the provided validation test to check `.dae` compatibility.
- Use the **Templates** button in the toolbar to load a bundled example diagram (CNOT, CZ, move + rotation, three CNOTs, Steane encoding) and edit it as a starting point.

### Bundled templates
The `.dae` files served from `piper_draw/gui/public/templates/` are generated from
[`tqec.gallery`](https://github.com/tqec/tqec/tree/main/src/tqec/gallery) — they
originate from the TQEC project and are bundled here for convenience. Re-run the
generator if TQEC is updated:
```sh
uv run python scripts/generate_templates.py
```

### Testing
We use `pytest`. For random numbers in test we use `pytest-randomly`, which sets a unique seed for each test run, such that failing tests are reproducible, but the seed is not fix.
Whenever using a random number in a test, make sure to invoke it from a seed obtained from `tests/randomly_utils.get_seeds()`.
You can feed this seed into your random number generator, e.g., `numpy.random.default_rng(seed)`.

The `tests` directory structure should generally reflect the same structure as the `piper_draw` directory.

## Dependencies
We use `uv` to manage dependencies and virtual environments. Use `uv sync` to install all dependencies, use `uv sync --no-dev` to only install the production dependencies.
