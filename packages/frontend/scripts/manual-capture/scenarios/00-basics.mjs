// はじめに(docs/manual/basics/)のキャプチャ。ログイン・ダッシュボード・メニュー・プロフィール・スマートフォン表示。
export const category = "basics";

export default [
  { id: "login", title: "ログイン画面", path: "/login", anonymous: true, steps: (h) => h.shot("screen", { fullPage: false }) },
  { id: "forgot-password", title: "パスワードを忘れた場合", path: "/forgot-password", anonymous: true, steps: (h) => h.shot("screen", { fullPage: false }) },
  { id: "dashboard", title: "ダッシュボード", path: "/dashboard", steps: (h) => h.shot("screen", { fullPage: false }) },
  { id: "profile", title: "プロフィール", path: "/profile", steps: (h) => h.shot("screen") },
  {
    id: "phone-menu",
    title: "スマートフォンでのメニュー",
    path: "/dashboard",
    viewport: "phone",
    steps: async (h) => {
      await h.shot("dashboard", { fullPage: false });
      const menuButton = h.page.getByRole("button", { name: /メニュー|☰/ }).first();
      if (await menuButton.isVisible().catch(() => false)) {
        await menuButton.click();
        await h.settle();
        await h.shot("drawer", { fullPage: false });
      } else {
        h.note("スマートフォン表示でメニューボタンが見つからない");
      }
    },
  },
];
