declare module "troika-three-text" {
  export function preloadFont(
    options: { font?: string; characters?: string; sdfGlyphSize?: number },
    callback?: () => void,
  ): void;
}
