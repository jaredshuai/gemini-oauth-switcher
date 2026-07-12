import { describe, expect, it } from "vitest";
import type { ProfileInfo } from "../src/shared/types";
import { describeUsageFailure, getProfileDisplayName } from "../src/renderer/utils";

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

  it("uses credential wording for Antigravity usage failures", () => {
    expect(describeUsageFailure({
      profileName: "agy-current",
      success: false,
      credentialStatus: "not_found",
      tiers: []
    }, "antigravity-cli")).toBe("无登录凭据");

    expect(describeUsageFailure({
      profileName: "agy-current",
      success: false,
      credentialStatus: "expired",
      tiers: []
    }, "antigravity-cli")).toBe("登录凭据已过期");
  });
});
