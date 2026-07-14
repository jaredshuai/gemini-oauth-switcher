import { describe, expect, it } from "vitest";
import type { LastSwitchResult, ProfileInfo } from "../src/shared/types";
import * as rendererUtils from "../src/renderer/utils";
import {
  describeUsageFailure,
  formatUsageAriaLabel,
  formatUsageTierLabel,
  getProfileDisplayName,
  toDisplayUsagePercentage,
  usageBarClass
} from "../src/renderer/utils";

describe("renderer utils", () => {
  it("hides the auto-update setting for portable builds", () => {
    const shouldShowAutoUpdateSetting = (rendererUtils as typeof rendererUtils & {
      shouldShowAutoUpdateSetting?: (runtime: { isPortable: boolean }) => boolean;
    }).shouldShowAutoUpdateSetting;

    expect(shouldShowAutoUpdateSetting).toBeTypeOf("function");
    expect(shouldShowAutoUpdateSetting!({ isPortable: true })).toBe(false);
    expect(shouldShowAutoUpdateSetting!({ isPortable: false })).toBe(true);
  });

  it("describes current update state with the latest version when available", () => {
    const describeAppUpdate = (rendererUtils as typeof rendererUtils & {
      describeAppUpdate?: (
        status: { phase: string; latestVersion?: string },
        runtime: { isPackaged: boolean; isPortable: boolean },
        autoUpdateEnabled: boolean
      ) => { text: string; tone: string };
    }).describeAppUpdate;

    expect(describeAppUpdate).toBeTypeOf("function");
    expect(describeAppUpdate!({ phase: "downloading", latestVersion: "0.2.4" }, {
      isPackaged: true,
      isPortable: false
    }, true)).toEqual({ text: "新版本 v0.2.4 · 下载中", tone: "active" });
    expect(describeAppUpdate!({ phase: "downloaded", latestVersion: "v0.2.4" }, {
      isPackaged: true,
      isPortable: false
    }, true)).toEqual({ text: "新版本 v0.2.4 · 等待安装", tone: "ready" });
    expect(describeAppUpdate!({ phase: "up-to-date" }, {
      isPackaged: true,
      isPortable: false
    }, true)).toEqual({ text: "已是最新版本", tone: "ready" });
    expect(describeAppUpdate!({ phase: "idle" }, {
      isPackaged: true,
      isPortable: true
    }, true)).toEqual({ text: "便携版需手动更新", tone: "muted" });
  });

  it("compacts account diagnostics only when the current account and local environment are healthy", () => {
    expect(rendererUtils.shouldCompactAccountStatus("gemini", true, {
      envRisks: [],
      geminiCommand: { available: true },
      checkedAt: 100
    })).toBe(true);
    expect(rendererUtils.shouldCompactAccountStatus("antigravity-cli", true, {
      envRisks: [],
      geminiCommand: { available: false },
      checkedAt: 100
    })).toBe(true);
    expect(rendererUtils.shouldCompactAccountStatus("gemini", true, {
      envRisks: ["检测到 GOOGLE_API_KEY"],
      geminiCommand: { available: true },
      checkedAt: 100
    })).toBe(false);
    expect(rendererUtils.shouldCompactAccountStatus("gemini", false, {
      envRisks: [],
      geminiCommand: { available: true },
      checkedAt: 100
    })).toBe(false);
  });

  it("hides stale switch history that no longer belongs to the visible account list", () => {
    const lastSwitch: LastSwitchResult = {
      profileName: "old-profile",
      switchedAt: 100,
      verified: true,
      targetTool: "gemini"
    };
    const profiles: ProfileInfo[] = [{
      name: "current-profile",
      profilePath: "C:\\profiles\\current-profile",
      oauthPath: "C:\\profiles\\current-profile\\.gemini\\oauth_creds.json",
      exists: true,
      isCurrent: true
    }];

    expect(rendererUtils.getVisibleLastSwitch(lastSwitch, "gemini", profiles)).toBeUndefined();
    expect(rendererUtils.getVisibleLastSwitch({ ...lastSwitch, profileName: "current-profile" }, "gemini", profiles))
      .toEqual({ ...lastSwitch, profileName: "current-profile" });
    expect(rendererUtils.getVisibleLastSwitch(
      { ...lastSwitch, profileName: "current-profile" },
      "gemini",
      [{ ...profiles[0], isCurrent: false }]
    )).toBeUndefined();
    expect(rendererUtils.getVisibleLastSwitch(lastSwitch, "antigravity-cli", profiles)).toBeUndefined();
  });

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

  it("converts utilization to remaining percentage without mutating API used values", () => {
    expect(toDisplayUsagePercentage(15, "used")).toBe(15);
    expect(toDisplayUsagePercentage(15, "remaining")).toBe(85);
    expect(toDisplayUsagePercentage(0, "remaining")).toBe(100);
    expect(toDisplayUsagePercentage(100, "remaining")).toBe(0);
    expect(toDisplayUsagePercentage(26.4, "remaining")).toBe(74);
  });

  it("keeps bar severity keyed to used pressure even in remaining mode", () => {
    expect(usageBarClass(15)).toBe("bg-emerald-500");
    expect(usageBarClass(75)).toBe("bg-amber-500");
    expect(usageBarClass(95)).toBe("bg-red-500");
  });

  it("formats remaining-mode tier labels only for recognized time quotas", () => {
    expect(formatUsageTierLabel("周", "used")).toBe("周");
    expect(formatUsageTierLabel("5h", "used")).toBe("5h");
    expect(formatUsageTierLabel("Pro", "used")).toBe("Pro");

    expect(formatUsageTierLabel("周", "remaining")).toBe("周限额剩余");
    expect(formatUsageTierLabel("5h", "remaining")).toBe("5 小时剩余");
    // Model/tier names must not grow a 剩余 suffix (78px column overflow risk).
    expect(formatUsageTierLabel("Pro", "remaining")).toBe("Pro");
    expect(formatUsageTierLabel("Flash", "remaining")).toBe("Flash");
    expect(formatUsageTierLabel("Flash Lite", "remaining")).toBe("Flash Lite");
    expect(formatUsageTierLabel("配额", "remaining")).toBe("配额");
  });

  it("keeps aria wording explicit about remaining vs used percentage", () => {
    expect(formatUsageAriaLabel(["Gemini", "周限额剩余"], 85, "remaining")).toBe("Gemini 周限额剩余 85%");
    expect(formatUsageAriaLabel(["Flash"], 40, "remaining")).toBe("Flash 剩余 40%");
    expect(formatUsageAriaLabel(["Pro"], 74, "remaining")).toBe("Pro 剩余 74%");
    expect(formatUsageAriaLabel(["Pro"], 26, "used")).toBe("Pro 已用 26%");
  });
});
