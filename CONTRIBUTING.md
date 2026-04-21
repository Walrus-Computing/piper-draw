# Contributing to piper-draw

## Branching strategy

- **`dev`** is the integration branch. All pull requests should target `dev`.
- **`main`** is the stable/release branch. Changes are merged from `dev` into `main` for releases.

## How to contribute

1. Create a feature branch from `dev`:
   ```sh
   git checkout dev
   git pull origin dev
   git checkout -b your-branch-name
   ```
2. Make your changes and commit them.
3. Push your branch and open a pull request **targeting `dev`** (not `main`).
4. Ensure CI checks pass before requesting review.

## Development setup

See the [README](README.md#getting-started) for prerequisites and setup instructions.

## Testing

Run the test suite before submitting your PR:

```sh
make test
```

See the [README testing section](README.md) for details on test conventions.
