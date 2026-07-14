import { describe, expect, it } from "vitest";
import { buildOAuthLoginInspectionState } from "../src/renderer/hooks/useOAuthLoginFlow";

describe("OAuth login flow state", () => {
  it("prepares the detected account for saving", () => {
    expect(buildOAuthLoginInspectionState({
      oauthExists: true,
      accountEmail: "user@example.com",
      proposedProfileName: "user@example.com",
      proposedNickname: "Work"
    }, "OAuth 文件")).toEqual({
      profileNameDraft: "user@example.com",
      nicknameDraft: "Work",
      status: {
        tone: "success",
        text: "已识别到账号 user@example.com。"
      }
    });
  });

  it("surfaces a duplicate account without inventing another profile name", () => {
    expect(buildOAuthLoginInspectionState({
      oauthExists: true,
      accountEmail: "user@example.com",
      proposedProfileName: "user@example.com",
      conflictProfileName: "user@example.com"
    }, "OAuth 文件")).toEqual({
      profileNameDraft: "user@example.com",
      nicknameDraft: "",
      status: {
        tone: "error",
        text: "账号已存在：user@example.com。请不要重复新增，或手动改成新的保存名称。"
      }
    });
  });

  it("asks for a save name when credentials do not expose an email", () => {
    expect(buildOAuthLoginInspectionState({ oauthExists: true }, "登录凭据")).toEqual({
      profileNameDraft: "",
      nicknameDraft: "",
      status: {
        tone: "success",
        text: "已检测到 登录凭据，但没有识别出邮箱。请手动填写保存名称。"
      }
    });
  });
});
