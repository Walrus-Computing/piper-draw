import { describe, expect, it } from "vitest";
import type { ViewSnapshotV1 } from "./viewSnapshot";
import { iframeSnippet, injectBlob, isDevShell, jsonForScript } from "./htmlExport";

const VIEW: ViewSnapshotV1 = {
  vv: 1,
  scene: { v: 1, blocks: [], portMeta: [], portPositions: [] },
  flowVizMode: false,
  selectedFlow: null,
  viewMode: { kind: "persp" },
  camera: null,
  showGrid: false,
  background: "#CBDFC6",
};

describe("jsonForScript", () => {
  it("escapes < so a </script> in the payload can't terminate the block", () => {
    const json = JSON.stringify({ s: "a</script>b" });
    const out = jsonForScript(json);
    expect(out).not.toContain("<");
    expect(out).not.toContain("</script>");
    // Reversing the escape yields the original parseable JSON.
    expect(JSON.parse(out.replace(/\\u003c/g, "<"))).toEqual({ s: "a</script>b" });
  });

  it("neutralizes an HTML comment close (-->)", () => {
    const out = jsonForScript(JSON.stringify({ s: "x-->y" }));
    expect(out).not.toContain("-->");
  });
});

describe("injectBlob", () => {
  it("inserts the blob script before </head>", () => {
    const html = "<html><head><title>v</title></head><body></body></html>";
    const out = injectBlob(html, VIEW);
    expect(out.indexOf("window.__PIPER_VIEW__")).toBeGreaterThan(-1);
    expect(out.indexOf("window.__PIPER_VIEW__")).toBeLessThan(out.indexOf("</head>"));
  });

  it("prepends the blob when there is no <head>", () => {
    const out = injectBlob("<div>hi</div>", VIEW);
    expect(out.startsWith("<script>window.__PIPER_VIEW__=")).toBe(true);
  });

  it("a script-breaking payload does not introduce a second </script>", () => {
    const view = { ...VIEW, background: "evil</script><img onerror=x>" };
    const out = injectBlob("<html><head></head></html>", view);
    // Only our own injected tag's closing </script> should be present.
    expect((out.match(/<\/script>/g) ?? []).length).toBe(1);
  });
});

describe("isDevShell", () => {
  it("flags a Vite dev shell (client runtime or /src/ module)", () => {
    expect(isDevShell('<script type="module" src="/@vite/client"></script>')).toBe(true);
    expect(isDevShell('<script type="module" src="/src/viewer/viewer-main.tsx"></script>')).toBe(true);
  });

  it("passes a production-inlined / hashed-asset shell", () => {
    expect(isDevShell('<script type="module" src="/assets/viewer-abc123.js"></script>')).toBe(false);
    expect(isDevShell("<html><head></head><body><script>/*inlined*/</script></body></html>")).toBe(false);
  });
});

describe("iframeSnippet", () => {
  it("uses the default filename", () => {
    expect(iframeSnippet()).toContain('src="pipe-diagram.html"');
  });

  it("HTML-escapes a filename containing quotes/angle brackets (no attribute injection)", () => {
    const snippet = iframeSnippet('a".html" onload="alert(1)');
    expect(snippet).not.toMatch(/src="a"/); // the raw quote must not close the attr
    expect(snippet).toContain("&quot;");
    expect(snippet).not.toContain("onload=\"alert(1)\"");
  });

  it("escapes &, <, >", () => {
    expect(iframeSnippet("a&b<c>.html")).toContain("a&amp;b&lt;c&gt;.html");
  });
});
