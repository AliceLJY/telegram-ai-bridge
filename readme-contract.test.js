import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageManifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const readmeCn = readFileSync(new URL("./README_CN.md", import.meta.url), "utf8");

describe("public documentation contract", () => {
  test("release badge and install path match the repository", () => {
    expect(packageManifest.version).toBe("5.0.1");
    expect(packageManifest.private).toBe(true);
    expect(readme).toContain("version-5.0.1");
    expect(readmeCn).toContain("version-5.0.1");
    expect(readme).toContain("historical v3.1.0 snapshot");
    expect(readmeCn).toContain("历史 v3.1.0 快照");
    expect(readme).not.toContain("v4.1");
    expect(readmeCn).not.toContain("v4.1");
  });

  test("data and competitor boundaries avoid absolute claims", () => {
    expect(readme).not.toContain("Code and credentials never leave your machine");
    expect(readmeCn).not.toContain("代码和凭证不出本机");
    expect(readme).not.toContain("Provider-locked");
    expect(readmeCn).not.toContain("绑定 Provider");
    expect(readme).toContain("https://code.claude.com/docs/en/remote-control");
    expect(readme).toContain("https://code.claude.com/docs/en/channels");
    expect(readme).toContain("https://docs.openclaw.ai/providers");
  });
});
