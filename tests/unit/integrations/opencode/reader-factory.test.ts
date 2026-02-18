import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";

const mockExistsSync = vi.fn();

vi.mock("fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
}));

vi.mock("../../../../src/integrations/opencode/sqlite-reader.js", () => ({
  SqliteReader: vi.fn().mockImplementation((dbPath: string) => ({
    _type: "sqlite",
    _dbPath: dbPath,
    getSessionsUpdatedSince: vi.fn().mockResolvedValue([]),
  })),
}));

describe("createOpenCodeReader", () => {
  const originalEnv = process.env.EI_OPENCODE_DATA_PATH;
  
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EI_OPENCODE_DATA_PATH;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.EI_OPENCODE_DATA_PATH = originalEnv;
    } else {
      delete process.env.EI_OPENCODE_DATA_PATH;
    }
  });

  it("returns JsonReader when only storage/ exists", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith("opencode.db")) return false;
      if (path.endsWith("storage")) return true;
      return false;
    });

    const { createOpenCodeReader } = await import("../../../../src/integrations/opencode/reader-factory.js");
    const reader = await createOpenCodeReader("/test/data");

    expect(reader.constructor.name).toBe("JsonReader");
  });

  it("returns JsonReader when neither db nor storage exists", async () => {
    mockExistsSync.mockReturnValue(false);

    const { createOpenCodeReader } = await import("../../../../src/integrations/opencode/reader-factory.js");
    const reader = await createOpenCodeReader("/test/data");

    expect(reader.constructor.name).toBe("JsonReader");
  });

  it("uses EI_OPENCODE_DATA_PATH env var when set", async () => {
    process.env.EI_OPENCODE_DATA_PATH = "/custom/data/path";
    mockExistsSync.mockImplementation((path: string) => {
      return path.includes("/custom/data/path/storage");
    });

    const { createOpenCodeReader } = await import("../../../../src/integrations/opencode/reader-factory.js");
    await createOpenCodeReader();

    expect(mockExistsSync).toHaveBeenCalledWith("/custom/data/path/opencode.db");
    expect(mockExistsSync).toHaveBeenCalledWith("/custom/data/path/storage");
  });

  it("uses default path when no basePath or env var provided", async () => {
    mockExistsSync.mockReturnValue(false);
    const expectedDefault = join(process.env.HOME || "~", ".local", "share", "opencode");

    const { createOpenCodeReader } = await import("../../../../src/integrations/opencode/reader-factory.js");
    await createOpenCodeReader();

    expect(mockExistsSync).toHaveBeenCalledWith(join(expectedDefault, "opencode.db"));
  });
});
