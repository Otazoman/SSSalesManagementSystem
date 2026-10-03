import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailItem } from "./DetailItem";

describe("DetailItem", () => {
  it("isUpdate:falseの場合は新値のみ表示する", () => {
    render(<DetailItem label="単位名称" newVal="個" oldVal={null} isUpdate={false} />);
    expect(screen.getByText("個")).toBeInTheDocument();
    expect(screen.queryByText("➔")).not.toBeInTheDocument();
  });

  it("isUpdate:trueかつ値が変わっている場合は新旧比較表示にする", () => {
    render(<DetailItem label="単位名称" newVal="キログラム" oldVal="個" isUpdate />);
    expect(screen.getByText("個")).toBeInTheDocument();
    expect(screen.getByText("キログラム")).toBeInTheDocument();
    expect(screen.getByText("➔")).toBeInTheDocument();
  });

  it("値がnull/undefinedの場合は「-」を表示する", () => {
    render(<DetailItem label="備考" newVal={undefined} oldVal={undefined} isUpdate={false} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
