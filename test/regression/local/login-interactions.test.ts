import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  buttons: [] as Array<Record<string, any>>,
  cleanups: [] as Array<() => void>,
  enabled: false,
  forms: [] as Array<Record<string, any>>,
  inputs: [] as Array<Record<string, any>>,
  overrides: {} as Record<number, unknown>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  stateIndex: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: React.EffectCallback, deps?: React.DependencyList) => {
      if (!harness.enabled) return actual.useEffect(effect, deps);
      const cleanup = effect();
      if (typeof cleanup === "function") harness.cleanups.push(cleanup);
    },
    useState: (initial: unknown) => {
      if (!harness.enabled) return actual.useState(initial);
      const index = harness.stateIndex++;
      const value = Object.prototype.hasOwnProperty.call(harness.overrides, index)
        ? harness.overrides[index]
        : initial;
      const setter = vi.fn();
      harness.setters[index] = setter;
      return [value, setter];
    },
  };
});

vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const capture = (type: unknown, props: Record<string, any> | null) => {
    if (harness.enabled && type === "form") harness.forms.push(props ?? {});
  };
  return {
    ...actual,
    jsx: (type: any, props: any, key: any) => {
      capture(type, props);
      return actual.jsx(type, props, key);
    },
    jsxs: (type: any, props: any, key: any) => {
      capture(type, props);
      return actual.jsxs(type, props, key);
    },
  };
});

vi.mock("next/image", () => ({
  default: ({ src, alt, width, height, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement("img", { src, alt, width, height, ...props }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) =>
    React.createElement("a", { href, ...props }, children),
}));
vi.mock("lucide-react", () => ({
  Loader2: () => React.createElement("span", null, "loading"),
}));
vi.mock("@subboost/ui/components/ui/button", () => ({
  Button: (props: Record<string, any>) => {
    harness.buttons.push(props);
    return React.createElement("button", props, props.children);
  },
}));
vi.mock("@subboost/ui/components/ui/form-field", () => ({
  FormField: ({ children }: React.PropsWithChildren) => React.createElement("label", null, children),
}));
vi.mock("@subboost/ui/components/ui/input", () => ({
  Input: (props: Record<string, any>) => {
    harness.inputs.push(props);
    return React.createElement("input", props);
  },
}));
vi.mock("@subboost/ui/components/ui/password-field", () => ({
  PasswordField: ({ label: _label, description: _description, ...props }: Record<string, any>) => {
    harness.inputs.push(props);
    return React.createElement("input", { ...props, type: "password" });
  },
}));
vi.mock("@subboost/ui/store/config-store/auth-handoff", () => ({
  hasAuthConfigHandoff: vi.fn(() => false),
}));

import { LocalLogin } from "../../../local/src/components/local-login";
import { hasAuthConfigHandoff } from "@subboost/ui/store/config-store/auth-handoff";

function response(body: unknown, ok = true) {
  return {
    ok,
    text: vi.fn(async () => body === "" ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

function installWindow(hash = "") {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { href: "", hash, pathname: "/login", search: "" },
    history: { replaceState },
  });
  return window as unknown as {
    location: { href: string };
    history: { replaceState: ReturnType<typeof vi.fn> };
  };
}

function renderLogin(overrides: Record<number, unknown> = {}) {
  harness.enabled = true;
  harness.overrides = overrides;
  harness.stateIndex = 0;
  harness.setters = [];
  harness.cleanups = [];
  harness.forms = [];
  harness.inputs = [];
  harness.buttons = [];
  try {
    const html = renderToStaticMarkup(React.createElement(LocalLogin));
    return {
      html,
      buttons: harness.buttons,
      cleanups: harness.cleanups,
      forms: harness.forms,
      inputs: harness.inputs,
      setters: harness.setters,
    };
  } finally {
    harness.enabled = false;
  }
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("local login edge behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(hasAuthConfigHandoff).mockReturnValue(false);
    installWindow();
  });

  it("loads an unauthenticated state and trims a blank setup fragment", async () => {
    installWindow("#setup-token=%20%20");
    vi.stubGlobal("fetch", vi.fn(async () => response({ setupRequired: false, authenticated: false })));

    const view = renderLogin();
    await flushPromises();

    expect(view.setters[6]).toHaveBeenCalledWith("");
    expect(view.setters[0]).toHaveBeenCalledWith({ setupRequired: false, authenticated: false });
    expect(window.location.href).toBe("");
  });

  it("does not update auth state after a successful load is cancelled", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));

    const view = renderLogin();
    view.cleanups[0]();
    resolveFetch(response({ setupRequired: false, authenticated: true }));
    await flushPromises();

    expect(view.setters[0]).not.toHaveBeenCalled();
    expect(window.location.href).toBe("");
  });

  it("contains rejected auth loads before and after cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject("untyped failure")));
    let view = renderLogin();
    await flushPromises();
    expect(view.setters[5]).toHaveBeenCalledWith("加载失败");

    let rejectFetch!: (reason: Error) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    })));
    view = renderLogin();
    view.cleanups[0]();
    rejectFetch(new Error("cancelled"));
    await flushPromises();
    expect(view.setters[5]).not.toHaveBeenCalled();
  });

  it("submits an existing-admin login with no setup-token header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("")));
    const view = renderLogin({
      0: { setupRequired: false, authenticated: false },
      1: "admin",
      2: "secret",
    });

    await view.forms[0].onSubmit({ preventDefault: vi.fn() });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      headers: { "Content-Type": "application/json" },
    }));
    expect(window.location.href).toBe("/dashboard");
  });

  it("uses the default server error for a failed setup with an empty body", async () => {
    installWindow("#setup-token=setup-secret");
    vi.stubGlobal("fetch", vi.fn(async () => response("", false)));
    const view = renderLogin({
      0: { setupRequired: true, authenticated: false },
      1: "admin",
      2: "long-secret",
      3: "long-secret",
      6: "setup-secret",
    });

    await view.forms[0].onSubmit({ preventDefault: vi.fn() });

    expect(view.setters[5]).toHaveBeenCalledWith("登录失败");
    expect(view.setters[4]).toHaveBeenLastCalledWith(false);
  });

  it("uses the retry message for a non-Error submit rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject("network unavailable")));
    const view = renderLogin({
      0: { setupRequired: false, authenticated: false },
      1: "admin",
      2: "secret",
    });

    await view.forms[0].onSubmit({ preventDefault: vi.fn() });

    expect(view.setters[5]).toHaveBeenCalledWith("登录失败，请重试");
  });

  it("wires confirmation edits and every submit-disabled reason", () => {
    let view = renderLogin({
      0: { setupRequired: true, authenticated: false },
      1: "admin",
      2: "long-secret",
      3: "",
      5: "visible error",
      6: "setup-secret",
    });
    view.inputs.find((input) => input.placeholder === "确认密码")?.onChange({ target: { value: "confirmed" } });
    expect(view.setters[3]).toHaveBeenCalledWith("confirmed");
    expect(view.buttons[0].disabled).toBe(true);
    expect(view.html).toContain("visible error");

    view = renderLogin({
      0: { setupRequired: false, authenticated: false },
      1: "",
      2: "secret",
    });
    expect(view.buttons[0].disabled).toBe(true);

    view = renderLogin({
      0: { setupRequired: false, authenticated: false },
      1: "admin",
      2: "",
    });
    expect(view.buttons[0].disabled).toBe(true);

    view = renderLogin({
      0: { setupRequired: false, authenticated: false },
      1: "admin",
      2: "secret",
      4: true,
    });
    expect(view.buttons[0].disabled).toBe(true);
  });
});
