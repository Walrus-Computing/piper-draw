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
- Export the design via the Collada export button.
- Run the provided validation test to check `.dae` compatibility.

## Development guidelines
We adhere to [semantic versioning](https://semver.org/).
New features, bug fixes, etc. should be implemented on a separate branch and merged via pull request on GitHub.
