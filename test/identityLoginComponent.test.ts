import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function fixture(central: boolean) {
  const submitted: any[] = [];
  const buttons: any[] = [];
  const forms: any[] = [];
  const assigned: any[] = [];
  let effect: any;
  const module = { exports: {} as any };
  let stateIndex = 0;
  const primitive = (tag: string) => (props: any) =>
    React.createElement(
      tag,
      {
        ...(props.id ? { id: props.id } : {}),
        ...(props.className ? { className: props.className } : {}),
      },
      props.children
    );
  const mocks: any = {
    react: {
      ...React,
      useEffect: (fn: any) => {
        effect ??= fn;
      },
      useState: (initial: any) => {
        const i = stateIndex++;
        const value =
          i === 14
            ? "fixture-csrf"
            : initial && typeof initial === "object" && "username" in initial
              ? { ...initial, username: "alice", password: "secret-pass" }
              : initial;
        return [value, () => {}];
      },
    },
    "react/jsx-runtime": Object.fromEntries(Object.entries(require("react/jsx-runtime")).map(([key, value]) => [key,
      typeof value === "function" ? (type: any, props: any, ...args: any[]) => {
        if (type === "form") forms.push(props);
        return (value as any)(type, props, ...args);
      } : value,
    ])),
    "@/hooks/useSystemSettings": {
      useSystemSettings: () => ({
        loading: false,
        platformName: "RAgent",
        platformSubtitle: "existing subtitle",
      }),
    },
    "@/lib/htmlSanitizer": { renderTemplate: () => "" },
    "next-intl": { useTranslations: () => (key: string) => key },
    "next/link": { default: primitive("a") },
    "@/components/LocaleSwitcher": { default: primitive("div") },
    "@/lib/cloudbaseClient": {},
    "@/lib/axios": {
      default: {
        post: async (...args: any[]) => {
          submitted.push(args);
          return { data: { token: "legacy" } };
        },
        get: async () => ({ data: { envId: "env" } }),
      },
    },
    "@/lib/identityInteraction": {
      interactionPath: (uid: string) => "/interaction/" + uid,
      submitIdentityInteraction: async (...args: any[]) => {
        submitted.push(args);
        return "/auth/resume";
      },
    },
  };
  mocks["@/components/ui/button"] = {
    Button: (props: any) => {
      buttons.push(props);
      return React.createElement(
        "button",
        { className: props.className, disabled: props.disabled },
        props.children
      );
    },
  };
  for (const [path, names] of Object.entries({
    alert: ["Alert", "AlertDescription"],
    checkbox: ["Checkbox"],
    input: ["Input"],
    label: ["Label"],
    card: ["Card", "CardContent", "CardDescription", "CardHeader", "CardTitle"],
    tabs: ["Tabs", "TabsContent", "TabsList", "TabsTrigger"],
  }))
    mocks["@/components/ui/" + path] = Object.fromEntries(
      names.map((name) => [name, primitive(name === "Input" ? "input" : "div")])
    );
  mocks["lucide-react"] = new Proxy({}, { get: () => primitive("i") });
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../components/login-page.tsx", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => {
        if (!(id in mocks)) throw Error("Unexpected component import " + id);
        return mocks[id];
      },
      window: { location: { assign: (url: string) => assigned.push(url) } },
      localStorage: {
        setItem: () => {
          if (central) throw Error("Central login must not write local token");
        },
      },
      TextEncoder,
      setTimeout,
      clearTimeout,
      fetch: async () => ({
        ok: true,
        json: async () => ({ csrf: "fixture-csrf", cloudbaseEnvId: "env" }),
      }),
    }
  );
  const html = renderToStaticMarkup(
    React.createElement(module.exports.LoginPage, {
      onLogin: () => {},
      siteConfig: { icpNumber: "", icpBeianUrl: "" },
      ...(central ? { interactionUid: "uid" } : {}),
    })
  );
  return { html, buttons, forms, submitted, assigned, effect };
}
test("central mode reuses original login form layout and submits issuer interaction instead of local login", async () => {
  const normal = fixture(false);
  const central = fixture(true);
  for (const label of [
    "phoneSignIn",
    "passwordLogin",
    "phoneSmsTab",
    "register",
    "username",
    "password",
  ])
    assert.ok(central.html.includes(label));
  assert.equal(central.html, normal.html, "central mode must preserve existing visual markup");
  const login = central.buttons.find((b: any) => b.children === "loginButton");
  assert.ok(login);
  assert.equal(login.type, "submit");
  let prevented = false;
  await central.forms[0].onSubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(central.submitted[0][0], "uid");
  assert.equal(central.submitted[0][2].password, "secret-pass");
  assert.deepEqual(central.assigned, ["/auth/resume"]);
});

test("legacy login submits through the same native form used by Enter", async () => {
  const local = fixture(false);
  await local.forms[0].onSubmit({ preventDefault() {} });
  assert.equal(local.submitted.length, 1);
  assert.equal(local.submitted[0][0], "/api/user/login");
});
