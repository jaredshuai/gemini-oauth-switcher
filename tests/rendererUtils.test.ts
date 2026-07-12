import { describe, expect, it } from "vitest";
import type { ProfileInfo } from "../src/shared/types";
import { getProfileDisplayName } from "../src/renderer/utils";

describe("renderer utils", () => {
  it("uses a resolved account email when no custom nickname exists", () => {
    const profile: ProfileInfo = {
      id: "agy-current",
      name: "antigravity-account-016f80c7",
      accountEmail: "agy.user@gmail.com",
      profilePath: "",
      oauthPath: "",
      exists: true,
      isCurrent: true
    };

    expect(getProfileDisplayName(profile, {})).toBe("agy.user@gmail.com");
    expect(getProfileDisplayName(profile, { "agy-current": "Work" })).toBe("Work");
  });
});
