import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  images: [] as any[],
  stateSetter: vi.fn(),
  userState: {} as Record<string, any>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
    useState: () => [false, mocks.stateSetter],
  };
});
vi.mock("next/link", () => ({
  default: (props: any) => {
    const { href, children } = props;
    return React.createElement("a", { href }, children);
  },
}));
vi.mock("lucide-react", () => ({
  ChevronDown: (props: any) => React.createElement("span", { className: props.className }, "down"),
  LayoutDashboard: () => null,
  LogIn: () => null,
  LogOut: () => null,
  Settings: () => null,
  Shield: () => null,
  User: () => null,
}));
vi.mock("@subboost/ui/components/ui/button", () => ({
  Button: ({ asChild: _asChild, ...props }: any) => React.createElement("button", props, props.children),
}));
vi.mock("@subboost/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: (props: any) => React.createElement("div", null, props.children),
  DropdownMenuContent: ({ align: _align, ...props }: any) => React.createElement("div", props, props.children),
  DropdownMenuItem: ({ asChild: _asChild, ...props }: any) => React.createElement("div", props, props.children),
  DropdownMenuLabel: (props: any) => React.createElement("div", props, props.children),
  DropdownMenuSeparator: (props: any) => React.createElement("hr", props),
  DropdownMenuTrigger: ({ asChild: _asChild, ...props }: any) => React.createElement("div", props, props.children),
}));
vi.mock("@subboost/ui/components/ui/safe-image", () => ({
  SafeImage: (props: any) => {
    mocks.images.push(props);
    return React.createElement("span", null, props.alt, props.fallback);
  },
}));
vi.mock("@subboost/ui/store/config-store/auth-handoff", () => ({ captureAuthConfigHandoff: vi.fn() }));
vi.mock("@subboost/ui/store/config-store", () => ({
  useConfigStore: Object.assign(vi.fn(), { getState: vi.fn(() => ({})) }),
}));
vi.mock("@subboost/ui/store/user-store", () => ({ useUserStore: () => mocks.userState }));

import { UserMenu } from "../../../packages/ui/src/components/auth/user-menu";

describe("user-menu display fallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.images = [];
    mocks.userState = {
      user: {
        avatarUrl: "",
        isAdmin: false,
        isBanned: false,
        name: "",
        username: "fallback-user",
        trustLevel: 1,
        subscriptionCount: 0,
        quota: { maxSubscriptions: 2 },
      },
      isLoading: true,
      fetchUser: vi.fn(),
      logout: vi.fn(),
    };
  });

  it("uses the username everywhere when the display name is empty and keeps the closed chevron state", () => {
    const html = renderToStaticMarkup(React.createElement(UserMenu));

    expect(mocks.images.map((image) => image.alt)).toEqual([
      "fallback-user",
      "fallback-user",
    ]);
    expect(html).toContain("fallback-user");
    expect(html).not.toContain("rotate-180");
    expect(mocks.userState.fetchUser).toHaveBeenCalled();
  });
});
