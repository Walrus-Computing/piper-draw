# Contributing to piper-draw

## Branching strategy

- **`main`** is the only long-lived branch. Merges to `main` auto-deploy to
  <https://piper-draw.walruscomputing.com>, so test your change locally first
  (see [Development setup](#development-setup)).

## How to contribute

1. Create a feature branch from `main`:
   ```sh
   git checkout main
   git pull origin main
   git checkout -b your-branch-name
   ```
2. Make your changes and commit them.
3. Push your branch and open a pull request **targeting `main`**.
4. Ensure CI checks pass before requesting review.

## Development setup

See the [README](README.md#getting-started) for prerequisites and setup instructions.

## Testing

Run the test suite before submitting your PR:

```sh
make test
```

See the [README testing section](README.md) for details on test conventions.
