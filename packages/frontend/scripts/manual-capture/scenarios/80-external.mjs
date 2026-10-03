// 取引先・外部倉庫の方向け(docs/manual/external/)のキャプチャ。ログインしていない状態で撮る
export const category = "external";

export default [
  {
    id: "quote-download",
    title: "書類のダウンロード(見積書の例)",
    path: "/quote-download?quoteId=QT-2026-0001-1&attachmentId=SAMPLE",
    anonymous: true,
    expectedErrors: ["/download-request/", "/download-verify/"],
    steps: (h) => h.shot("screen", { fullPage: false }),
  },
];
